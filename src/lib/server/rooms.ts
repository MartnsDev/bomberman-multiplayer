import { MAX_PLAYERS } from "../protocol";
import { randomBytes, randomUUID } from "node:crypto";
import type { Command, Player, Room, ServerEvent } from "../protocol";
interface Client {
  send: (event: ServerEvent) => void;
  owner: boolean;
  id?: string;
  code?: string;
}
import { successor, election } from "./succession";
interface Member extends Player {
  ownerOnly?: boolean;
  gameReady?: boolean;
  voteHost?: string;
  voteAt?: number;
  token: string;
  client?: Client;
  timer?: ReturnType<typeof setTimeout>;
}
interface InternalRoom {
  code: string;
  hostId: string;
  members: Member[];
  started: boolean;
}
export class RoomService {
  private rooms = new Map<string, InternalRoom>();
  constructor(
    private capacity = Math.max(
      2,
      Math.min(MAX_PLAYERS, Number(process.env.MAX_PLAYERS) || MAX_PLAYERS),
    ),
  ) {}
  private snapshot(r: InternalRoom): Room {
    return {
      code: r.code,
      hostId: r.hostId,
      started: r.started,
      capacity: this.capacity,
      players: r.members.map(({ id, name, avatar, slot, connected }) => ({
        id,
        name,
        avatar,
        slot,
        connected,
      })),
    };
  }
  private broadcast(r: InternalRoom) {
    for (const m of r.members)
      m.client?.send({ type: "room", room: this.snapshot(r) });
  }
  private find(c: Client) {
    const r = c.code ? this.rooms.get(c.code) : undefined;
    if (!r || !r.members.some((m) => m.id === c.id && m.client === c))
      throw Error("Entre em uma sala.");
    return r;
  }
  hasToken(token?: string) {
    return (
      !!token &&
      [...this.rooms.values()].some((r) =>
        r.members.some((m) => m.connected && m.token === token),
      )
    );
  }
  handle(c: Client, msg: Command) {
    if (msg.type === "ping") {
      c.send({ type: "pong" });
      return;
    }
    if (msg.type === "leave") {
      this.leave(c, true);
      return;
    }
    if (msg.type === "create" || msg.type === "join") {
      if (c.code) throw Error("Saia da sala atual primeiro.");
      let r: InternalRoom;
      if (msg.type === "create") {
        if (!c.owner) throw Error("Somente o proprietário pode criar salas.");
        if (this.rooms.size >= 100) throw Error("Limite de salas atingido.");
        let code: string;
        do {
          const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          code = Array.from(randomBytes(6), (n) => alphabet[n % 32]).join("");
        } while (this.rooms.has(code));
        r = { code, hostId: "", members: [], started: false };
        this.rooms.set(code, r);
      } else {
        const found = this.rooms.get(msg.code);
        if (!found) throw Error("Sala não encontrada. Confira o código.");
        r = found;
        if (r.members.length >= this.capacity) throw Error("Sala cheia.");
        if (
          r.members.some(
            (member) =>
              member.name.toLocaleLowerCase("pt-BR") ===
              msg.name.toLocaleLowerCase("pt-BR"),
          )
        )
          throw Error("Esse nome já está na sala. Escolha outro perfil.");
      }
      const slot = Array.from({ length: this.capacity }, (_, i) => i).find(
        (i) => !r.members.some((m) => m.slot === i),
      )!;
      const m: Member = {
        id: randomUUID(),
        name: msg.name,
        avatar: msg.avatar,
        slot,
        connected: true,
        token: randomBytes(32).toString("hex"),
        client: c,
        ownerOnly: msg.type === "create",
        gameReady: false,
      };
      r.members.push(m);
      if (msg.type === "create") r.hostId = m.id;
      c.id = m.id;
      c.code = r.code;
      c.send({
        type: "room",
        room: this.snapshot(r),
        selfId: m.id,
        token: m.token,
      });
      this.broadcast(r);
      return;
    }
    if (msg.type === "resume") {
      if (c.code) throw Error("Já conectado.");
      const r = this.rooms.get(msg.code);
      const m = r?.members.find(
        (m) =>
          m.token === msg.token &&
          !m.connected &&
          (!(m.ownerOnly ?? m.slot === 0) || c.owner),
      );
      if (!r || !m)
        throw Error("Não foi possível reconectar. Entre novamente.");
      clearTimeout(m.timer);
      m.connected = true;
      m.gameReady = false;
      m.client = c;
      c.id = m.id;
      c.code = r.code;
      c.send({
        type: "room",
        room: this.snapshot(r),
        selfId: m.id,
        token: m.token,
      });
      this.broadcast(r);
      return;
    }
    const r = this.find(c);
    if (msg.type === "game-ready" || msg.type === "game-away") {
      r.members.find((p) => p.id === c.id)!.gameReady =
        msg.type === "game-ready";
      const current = r.members.find((p) => p.id === r.hostId);
      if (
        msg.type === "game-ready" &&
        r.started &&
        (!current?.connected || current.gameReady === false)
      ) {
        const next = successor(
          r.members.filter((p) => p.gameReady),
          r.hostId,
        );
        if (next) {
          r.hostId = next.id;
          this.broadcast(r);
        }
      }
      return;
    }
    if (msg.type === "yield-host") {
      if (r.started && c.id === r.hostId) {
        const next = successor(
          r.members.filter((p) => p.gameReady),
          r.hostId,
        );
        if (next) {
          r.hostId = next.id;
          this.broadcast(r);
        }
      }
      return;
    }
    if (msg.type === "elect-host") {
      if (!r.started || r.hostId !== msg.hostId) return;
      const voter = r.members.find((p) => p.id === c.id)!;
      if (!voter.gameReady || voter.id === r.hostId) return;
      voter.voteHost = msg.hostId;
      voter.voteAt = Date.now();
      const next = election(r.members, r.hostId);
      if (next) {
        r.hostId = next.id;
        this.broadcast(r);
      }
      return;
    }
    if (msg.type === "start") {
      if (c.id !== r.hostId || !c.owner)
        throw Error("Somente o anfitrião pode iniciar.");
      r.started = true;
      this.broadcast(r);
      return;
    }
    if (msg.type === "signal") {
      const target = r.members.find((m) => m.id === msg.target && m.connected);
      if (
        target &&
        target.id !== c.id &&
        c.id !== r.hostId &&
        target.id !== r.hostId &&
        (msg.signal.kind === "netplay" || msg.signal.kind === "netplay-ready")
      )
        return;
      if (
        !target ||
        target.id === c.id ||
        (c.id !== r.hostId && target.id !== r.hostId)
      )
        throw Error("Destino de sinalização inválido.");
      if (
        msg.signal.kind === "description" &&
        ((c.id === r.hostId && msg.signal.description.type !== "offer") ||
          (c.id !== r.hostId && msg.signal.description.type !== "answer"))
      )
        throw Error("Negociação inválida.");
      target.client?.send({ type: "signal", from: c.id!, signal: msg.signal });
    }
  }
  leave(c: Client, explicit = false) {
    const r = c.code ? this.rooms.get(c.code) : undefined;
    const m = r?.members.find((m) => m.id === c.id && m.client === c);
    c.code = undefined;
    c.id = undefined;
    if (!r || !m) return;
    if (m.id === r.hostId && (!r.started || (explicit && c.owner))) {
      for (const p of r.members) {
        clearTimeout(p.timer);
        p.client?.send({
          type: "closed",
          message: "O anfitrião encerrou a sala.",
        });
        if (p.client) {
          p.client.code = undefined;
          p.client.id = undefined;
        }
      }
      this.rooms.delete(r.code);
      return;
    }
    m.connected = false;
    m.client = undefined;
    if (m.id === r.hostId) {
      const next = successor(r.members, r.hostId);
      if (next) r.hostId = next.id;
    }
    if (explicit) {
      r.members = r.members.filter((p) => p !== m);
      if (!r.members.length) {
        this.rooms.delete(r.code);
        return;
      }
      if (!r.members.some((p) => p.id === r.hostId)) r.hostId = r.members[0].id;
    } else
      m.timer = setTimeout(() => {
        r.members = r.members.filter((p) => p !== m);
        if (!r.members.length) this.rooms.delete(r.code);
        this.broadcast(r);
      }, 15000).unref();
    this.broadcast(r);
  }
}
const shared = globalThis as typeof globalThis & {
  __bomberRooms?: RoomService;
};
export const rooms = (shared.__bomberRooms ??= new RoomService());
export type { Client };
