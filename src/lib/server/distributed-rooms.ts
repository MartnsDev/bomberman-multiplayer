import { MAX_PLAYERS } from "../protocol";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { Redis } from "@upstash/redis";
import type { Command, Player, Room, ServerEvent } from "../protocol";
import { redis } from "./redis";
import { successor, election } from "./succession";
export class RoomClosedError extends Error {
  constructor() {
    super("O anfitrião encerrou a sala.");
  }
}
const TTL = 6 * 3600,
  GRACE = 45000;
interface Member extends Player {
  ownerOnly?: boolean;
  gameReady?: boolean;
  voteHost?: string;
  voteAt?: number;
  token: string;
  lastSeen: number;
  connection: string;
}
interface StoredRoom {
  code: string;
  hostId: string;
  players: Member[];
  started: boolean;
  capacity: number;
  version: number;
  closed: boolean;
}
interface Envelope {
  to?: string;
  event: ServerEvent;
}
export interface DistributedClient {
  owner: boolean;
  connection: string;
  send: (event: ServerEvent) => void;
  id?: string;
  code?: string;
  cursor: string;
  ready?: boolean;
}
const COMMIT = `local raw=redis.call('GET',KEYS[1]);if not raw then return '' end;local old=cjson.decode(raw);if old.version~=tonumber(ARGV[1]) then return '' end;redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]);local id='';local events=cjson.decode(ARGV[4]);for _,e in ipairs(events) do id=redis.call('XADD',KEYS[2],'MAXLEN','~',256,'*','data',cjson.encode(e)) end;redis.call('EXPIRE',KEYS[2],ARGV[3]);return id=='' and '-' or id`;

export class DistributedRooms {
  constructor(
    private db: Redis = redis(),
    private prefix = "bmr:rooms:v1",
  ) {}
  private key(code: string) {
    return `${this.prefix}:${code}`;
  }
  private events(code: string) {
    return `${this.key(code)}:events`;
  }
  private tokenKey(token: string) {
    return `${this.prefix}:token:${createHash("sha256").update(token).digest("hex")}`;
  }
  private view(r: StoredRoom): Room {
    return {
      code: r.code,
      hostId: r.hostId,
      capacity: r.capacity,
      started: r.started,
      players: r.players.map(({ id, name, avatar, slot, connected }) => ({
        id,
        name,
        avatar,
        slot,
        connected,
      })),
    };
  }
  private async get(code: string) {
    const raw = await this.db.get<string>(this.key(code));
    return raw ? (JSON.parse(raw) as StoredRoom) : undefined;
  }
  private async mutate<T>(
    code: string,
    change: (room: StoredRoom, events: Envelope[]) => T,
  ) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const room = await this.get(code);
      if (!room) throw Error("Sala não encontrada. Confira o código.");
      const before = room.version;
      const events: Envelope[] = [];
      const result = change(room, events);
      room.version++;
      const cursor = await this.db.eval<unknown[], string>(
        COMMIT,
        [this.key(code), this.events(code)],
        [before, JSON.stringify(room), TTL, JSON.stringify(events)],
      );
      if (cursor) return { result, room, cursor };
    }
    throw Error("A sala está ocupada. Tente novamente.");
  }
  private present(room: StoredRoom) {
    if (room.closed) throw new RoomClosedError();
  }
  private member(room: StoredRoom, c: DistributedClient) {
    this.present(room);
    const m = room.players.find(
      (p) => p.id === c.id && p.connection === c.connection,
    );
    if (!m) throw Error("Conexão substituída. Entre novamente.");
    return m;
  }
  private async associate(
    c: DistributedClient,
    room: StoredRoom,
    member: Member,
    cursor: string,
  ) {
    c.ready = false;
    c.id = member.id;
    c.code = room.code;
    c.cursor = cursor === "-" ? "0-0" : cursor;
    await this.db.set(
      this.tokenKey(member.token),
      JSON.stringify({ code: room.code, id: member.id }),
      { ex: TTL },
    );
    c.send({
      type: "room",
      room: this.view(room),
      selfId: member.id,
      token: member.token,
    });
    c.ready = true;
  }
  async hasToken(token?: string) {
    if (!token || token.length > 128) return false;
    const raw = await this.db.get<string>(this.tokenKey(token));
    if (!raw) return false;
    const { code, id } = JSON.parse(raw);
    const r = await this.get(code);
    return (
      !!r &&
      !r.closed &&
      r.players.some(
        (p) =>
          p.id === id && p.token === token && Date.now() - p.lastSeen < GRACE,
      )
    );
  }
  async handle(c: DistributedClient, msg: Command) {
    if (msg.type === "ping") {
      await this.heartbeat(c);
      c.send({ type: "pong" });
      return;
    }
    if (msg.type === "leave") {
      await this.leave(c);
      return;
    }
    if (msg.type === "create") {
      if (c.code) throw Error("Saia da sala atual primeiro.");
      const member: Member = {
        id: randomUUID(),
        name: msg.name,
        avatar: msg.avatar,
        slot: 0,
        connected: true,
        token: randomBytes(32).toString("hex"),
        connection: c.connection,
        lastSeen: Date.now(),
        ownerOnly: c.owner,
        gameReady: false,
      };
      for (let n = 0; n < 10; n++) {
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const code = Array.from(randomBytes(6), (x) => alphabet[x % 32]).join(
          "",
        );
        const room: StoredRoom = {
          code,
          hostId: member.id,
          players: [member],
          started: false,
          capacity: Math.max(
            2,
            Math.min(
              MAX_PLAYERS,
              Number(process.env.MAX_PLAYERS) || MAX_PLAYERS,
            ),
          ),
          version: 0,
          closed: false,
        };
        if (
          await this.db.set(this.key(code), JSON.stringify(room), {
            nx: true,
            ex: TTL,
          })
        ) {
          await this.associate(c, room, member, "0-0");
          return;
        }
      }
      throw Error("Não foi possível criar a sala.");
    }
    if (msg.type === "join") {
      if (c.code) throw Error("Saia da sala atual primeiro.");
      const member: Member = {
        id: randomUUID(),
        name: msg.name,
        avatar: msg.avatar,
        slot: 0,
        connected: true,
        token: randomBytes(32).toString("hex"),
        connection: c.connection,
        lastSeen: Date.now(),
        ownerOnly: false,
        gameReady: false,
      };
      const { room, cursor } = await this.mutate(msg.code, (r, events) => {
        this.present(r);
        r.players = r.players.filter(
          (p) => p.id === r.hostId || Date.now() - p.lastSeen < GRACE,
        );
        if (r.players.length >= r.capacity) throw Error("Sala cheia.");
        if (
          r.players.some(
            (p) =>
              p.name.toLocaleLowerCase("pt-BR") ===
              msg.name.toLocaleLowerCase("pt-BR"),
          )
        )
          throw Error("Esse nome já está na sala. Escolha outro perfil.");
        member.slot = Array.from({ length: r.capacity }, (_, i) => i).find(
          (i) => !r.players.some((p) => p.slot === i),
        )!;
        r.players.push({ ...member });
        events.push({ event: { type: "room", room: this.view(r) } });
      });
      await this.associate(c, room, member, cursor);
      return;
    }
    if (msg.type === "resume") {
      if (c.code) throw Error("Já conectado.");
      const { room, cursor, result } = await this.mutate(
        msg.code,
        (r, events) => {
          this.present(r);
          const m = r.players.find((p) => p.token === msg.token);
          if (!m || ((m.ownerOnly ?? m.slot === 0) && !c.owner))
            throw Error("Não foi possível reconectar. Entre novamente.");
          m.connection = c.connection;
          m.lastSeen = Date.now();
          m.connected = true;
          m.gameReady = false;
          events.push({ event: { type: "room", room: this.view(r) } });
          return { ...m };
        },
      );
      await this.associate(c, room, result, cursor);
      return;
    }
    if (!c.code || !c.id) throw Error("Entre em uma sala.");
    await this.mutate(c.code, (r, events) => {
      const m = this.member(r, c);
      m.lastSeen = Date.now();
      if (msg.type === "game-ready" || msg.type === "game-away") {
        m.gameReady = msg.type === "game-ready";
        const current = r.players.find((p) => p.id === r.hostId);
        if (
          msg.type === "game-ready" &&
          r.started &&
          (!current?.connected || current.gameReady === false)
        ) {
          const next = successor(
            r.players.filter((p) => p.gameReady),
            r.hostId,
          );
          if (next) {
            r.hostId = next.id;
            events.push({ event: { type: "room", room: this.view(r) } });
          }
        }
        return;
      }
      if (msg.type === "yield-host") {
        if (r.started && m.id === r.hostId) {
          const next = successor(
            r.players.filter((p) => p.gameReady),
            r.hostId,
          );
          if (next) {
            r.hostId = next.id;
            events.push({ event: { type: "room", room: this.view(r) } });
          }
        }
        return;
      }
      if (msg.type === "elect-host") {
        if (
          !r.started ||
          r.hostId !== msg.hostId ||
          !m.gameReady ||
          m.id === r.hostId
        )
          return;
        m.voteHost = msg.hostId;
        m.voteAt = Date.now();
        const next = election(r.players, r.hostId);
        if (next) {
          r.hostId = next.id;
          events.push({ event: { type: "room", room: this.view(r) } });
        }
        return;
      }
      if (msg.type === "start") {
        if (m.id !== r.hostId) throw Error("Somente o anfitrião pode iniciar.");
        r.started = true;
        events.push({ event: { type: "room", room: this.view(r) } });
        return;
      }
      if (msg.type === "signal") {
        const target = r.players.find(
          (p) =>
            p.id === msg.target &&
            p.connected &&
            Date.now() - p.lastSeen < GRACE,
        );
        if (
          target &&
          target.id !== m.id &&
          m.id !== r.hostId &&
          target.id !== r.hostId &&
          (msg.signal.kind === "netplay" || msg.signal.kind === "netplay-ready")
        )
          return;
        if (
          !target ||
          target.id === m.id ||
          (m.id !== r.hostId && target.id !== r.hostId)
        )
          throw Error("Destino de sinalização inválido.");
        if (
          msg.signal.kind === "description" &&
          ((m.id === r.hostId && msg.signal.description.type !== "offer") ||
            (m.id !== r.hostId && msg.signal.description.type !== "answer"))
        )
          throw Error("Negociação inválida.");
        events.push({
          to: target.id,
          event: { type: "signal", from: m.id, signal: msg.signal },
        });
      }
    });
  }
  async heartbeat(c: DistributedClient) {
    if (!c.code || !c.id) return;
    await this.mutate(c.code, (r, events) => {
      const m = this.member(r, c);
      m.lastSeen = Date.now();
      const oldHost = r.players.find((p) => p.id === r.hostId);
      if (r.started && oldHost && Date.now() - oldHost.lastSeen > GRACE) {
        oldHost.connected = false;
        const next = successor(r.players, r.hostId);
        if (next) {
          r.hostId = next.id;
          events.push({ event: { type: "room", room: this.view(r) } });
        }
      }
      const previous = r.players.length;
      r.players = r.players.filter(
        (p) => p.id === r.hostId || Date.now() - p.lastSeen < GRACE,
      );
      if (previous !== r.players.length)
        events.push({ event: { type: "room", room: this.view(r) } });
    });
  }
  async poll(c: DistributedClient) {
    if (!c.code || !c.id || !c.ready) return;
    const result = (await this.db.xread(this.events(c.code), c.cursor, {
      count: 64,
    })) as unknown as [string, [string, string[]][]][] | null;
    for (const [, entries] of result ?? [])
      for (const [id, fields] of entries) {
        c.cursor = id;
        const envelope = JSON.parse(
          fields[fields.indexOf("data") + 1],
        ) as Envelope;
        if (!envelope.to || envelope.to === c.id) {
          c.send(envelope.event);
          if (envelope.event.type === "closed") {
            c.ready = false;
            c.code = undefined;
            c.id = undefined;
            return;
          }
        }
      }
  }
  async leave(c: DistributedClient) {
    if (!c.code || !c.id) return;
    const code = c.code;
    await this.mutate(code, (r, events) => {
      const member = r.players.find(
        (p) => p.id === c.id && p.connection === c.connection,
      );
      if (!member) return;
      if (member.id === r.hostId && (!r.started || c.owner)) {
        r.closed = true;
        events.push({
          event: { type: "closed", message: "O anfitrião encerrou a sala." },
        });
      } else {
        r.players = r.players.filter((p) => p.id !== member.id);
        if (!r.players.length) r.closed = true;
        if (member.id === r.hostId) {
          const next = successor(r.players, r.hostId);
          if (next) r.hostId = next.id;
          else if (r.players[0]) r.hostId = r.players[0].id;
        }
        events.push({ event: { type: "room", room: this.view(r) } });
      }
    });
    c.send({ type: "closed", message: "Você saiu da sala." });
    c.code = undefined;
    c.id = undefined;
  }
  async disconnect(c: DistributedClient) {
    if (!c.code || !c.id) return;
    await this.mutate(c.code, (r, events) => {
      const member = r.players.find(
        (p) => p.id === c.id && p.connection === c.connection,
      );
      if (!member || r.closed) return;
      member.connected = false;
      if (r.started && member.id === r.hostId) {
        const next = successor(r.players, r.hostId);
        if (next) r.hostId = next.id;
      }
      events.push({ event: { type: "room", room: this.view(r) } });
    });
  }
}
let service: DistributedRooms | undefined;
export function distributedRooms() {
  return (service ??= new DistributedRooms());
}
