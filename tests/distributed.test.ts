import { test, expect } from "vitest";
import { config } from "dotenv";
import { randomUUID, createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import {
  RoomClosedError,
  DistributedRooms,
  type DistributedClient,
} from "../src/lib/server/distributed-rooms";
import type { ServerEvent, Room } from "../src/lib/protocol";

const enabled = process.env.TEST_REDIS === "1";
if (enabled) config({ path: ".private/vercel-development.env", quiet: true });
test.skipIf(!enabled)(
  "Redis real: salas entre instâncias, entrada simultânea, sinalização privada e retomada do anfitrião",
  async () => {
    const db = new Redis({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
      automaticDeserialization: false,
    });
    const prefix = `bmr:test:${randomUUID()}`,
      a = new DistributedRooms(db, prefix),
      b = new DistributedRooms(db, prefix);
    const client = (owner = false) => {
      const events: ServerEvent[] = [];
      const c: DistributedClient = {
        owner,
        connection: randomUUID(),
        cursor: "0-0",
        send: (event) => events.push(event),
      };
      return {
        c,
        events,
        room: () =>
          (events.filter((e) => e.type === "room").at(-1) as { room: Room })
            .room,
        token: () =>
          (
            events.find((e) => e.type === "room" && e.token) as {
              token: string;
            }
          ).token,
      };
    };
    const host = client(true),
      guests = [client(), client(), client(), client()];
    let code = "";
    const tokens: string[] = [];
    try {
      await a.handle(host.c, {
        type: "create",
        name: "Matheus",
        avatar: "/avatars/matheus.png",
      });
      code = host.room().code;
      tokens.push(host.token());
      await Promise.all(
        guests.map((g, i) =>
          b.handle(g.c, {
            type: "join",
            code,
            name: ["Gabi", "Helo", "Gu", "Jogador 5"][i],
          }),
        ),
      );
      tokens.push(...guests.map((g) => g.token()));
      await expect(
        b.handle(client().c, { type: "join", code, name: "Sexta pessoa" }),
      ).rejects.toThrow("cheia");
      await a.poll(host.c);
      expect(
        host
          .room()
          .players.map((p) => p.slot)
          .sort(),
      ).toEqual([0, 1, 2, 3, 4]);
      await expect(b.handle(guests[0].c, { type: "start" })).rejects.toThrow(
        "anfitrião",
      );
      await a.handle(host.c, { type: "start" });
      await b.poll(guests[0].c);
      expect(guests[0].room().started).toBe(true);
      await a.handle(host.c, {
        type: "signal",
        target: guests[0].c.id!,
        signal: {
          kind: "description",
          description: { type: "offer", sdp: "test-sdp" },
        },
      });
      await b.poll(guests[0].c);
      await b.poll(guests[1].c);
      expect(guests[0].events.some((e) => e.type === "signal")).toBe(true);
      expect(guests[1].events.some((e) => e.type === "signal")).toBe(false);
      const attacker = client();
      await expect(
        b.handle(attacker.c, { type: "resume", code, token: host.token() }),
      ).rejects.toThrow();
      const resumed = client(true);
      await b.handle(resumed.c, { type: "resume", code, token: host.token() });
      expect(resumed.c.id).toBe(host.c.id);
      expect(await a.hasToken(guests[0].token())).toBe(true);
      await expect(a.heartbeat(host.c)).rejects.toThrow("substituída");
      await b.leave(resumed.c);
      await expect(
        a.handle(guests[0].c, {
          type: "signal",
          target: resumed.c.id || host.c.id!,
          signal: { kind: "candidate", candidate: { candidate: "" } },
        }),
      ).rejects.toBeInstanceOf(RoomClosedError);
      await a.poll(guests[0].c);
      expect(guests[0].events.at(-1)?.type).toBe("closed");
      expect(await a.hasToken(guests[0].token())).toBe(false);
    } finally {
      if (code)
        await db.del(
          `${prefix}:${code}`,
          `${prefix}:${code}:events`,
          ...tokens.map(
            (token) =>
              `${prefix}:token:${createHash("sha256").update(token).digest("hex")}`,
          ),
        );
    }
  },
  45000,
);

test.skipIf(!enabled)(
  "Redis real: troca autoritativa de coordenador e reserva de controles",
  async () => {
    const db = new Redis({
        url: process.env.KV_REST_API_URL!,
        token: process.env.KV_REST_API_TOKEN!,
        automaticDeserialization: false,
      }),
      prefix = `bmr:test:${randomUUID()}`,
      a = new DistributedRooms(db, prefix),
      b = new DistributedRooms(db, prefix);
    const make = (owner = false) => {
      const events: ServerEvent[] = [];
      const c: DistributedClient = {
        owner,
        connection: randomUUID(),
        cursor: "0-0",
        send: (e) => events.push(e),
      };
      return { c, events };
    };
    const h = make(true),
      g = make(),
      t = make();
    let code = "";
    const tokens: string[] = [];
    try {
      await a.handle(h.c, { type: "create", name: "H" });
      const initial = h.events.find((e) => e.type === "room") as Extract<
        ServerEvent,
        { type: "room" }
      >;
      code = initial.room.code;
      tokens.push(initial.token!);
      for (const [p, name] of [
        [g, "G"],
        [t, "T"],
      ] as const) {
        await b.handle(p.c, { type: "join", code, name });
        tokens.push(
          (
            p.events.find((e) => e.type === "room") as Extract<
              ServerEvent,
              { type: "room" }
            >
          ).token!,
        );
      }
      for (const p of [h, g, t]) await a.handle(p.c, { type: "game-ready" });
      await a.handle(h.c, { type: "start" });
      await b.handle(g.c, { type: "game-away" });
      await a.handle(h.c, { type: "yield-host" });
      await b.poll(t.c);
      expect(
        (
          t.events.filter((e) => e.type === "room").at(-1) as Extract<
            ServerEvent,
            { type: "room" }
          >
        ).room.hostId,
      ).toBe(t.c.id);
      await b.handle(t.c, { type: "game-away" });
      await a.handle(h.c, { type: "game-ready" });
      await a.poll(h.c);
      expect(
        (
          h.events.filter((e) => e.type === "room").at(-1) as Extract<
            ServerEvent,
            { type: "room" }
          >
        ).room.hostId,
      ).toBe(h.c.id);
      await b.handle(g.c, { type: "game-ready" });
      await a.disconnect(h.c);
      await b.poll(g.c);
      const room = (
        g.events.filter((e) => e.type === "room").at(-1) as Extract<
          ServerEvent,
          { type: "room" }
        >
      ).room;
      expect(room.hostId).toBe(g.c.id);
      expect(room.players.find((p) => p.id === g.c.id)?.slot).toBe(1);
      expect(room.started).toBe(true);
      expect(g.c.owner).toBe(false);
      const restored = make(true);
      await b.handle(restored.c, { type: "resume", code, token: tokens[0] });
      expect(restored.c.id).toBe(h.c.id);
      await a.disconnect(h.c);
      await b.poll(g.c);
      const latest = JSON.parse((await db.get<string>(`${prefix}:${code}`))!);
      expect(
        latest.players.find((p: any) => p.id === restored.c.id).connected,
      ).toBe(true);
      await b.disconnect(g.c);
      await a.poll(t.c);
      expect(
        (
          t.events.filter((e) => e.type === "room").at(-1) as Extract<
            ServerEvent,
            { type: "room" }
          >
        ).room.hostId,
      ).not.toBe(g.c.id);
    } finally {
      if (code)
        await db.del(
          `${prefix}:${code}`,
          `${prefix}:${code}:events`,
          ...tokens.map(
            (token) =>
              `${prefix}:token:${createHash("sha256").update(token).digest("hex")}`,
          ),
        );
    }
  },
  45000,
);

test.skipIf(!enabled)(
  "Redis real: criar, iniciar e retomar sala sem senha administrativa",
  async () => {
    const db = new Redis({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
      automaticDeserialization: false,
    });
    const prefix = `bmr:test:${randomUUID()}`,
      a = new DistributedRooms(db, prefix),
      b = new DistributedRooms(db, prefix);
    const make = () => {
      const events: ServerEvent[] = [];
      const c: DistributedClient = {
        owner: false,
        connection: randomUUID(),
        cursor: "0-0",
        send: (e) => events.push(e),
      };
      return { c, events };
    };
    const h = make(),
      g = make(),
      resumed = make();
    let code = "";
    const tokens: string[] = [];
    try {
      await a.handle(h.c, { type: "create", name: "Visitante" });
      const initial = h.events.find(
        (e) => e.type === "room" && e.token,
      ) as Extract<ServerEvent, { type: "room" }>;
      code = initial.room.code;
      tokens.push(initial.token!);
      await b.handle(g.c, { type: "join", code, name: "Amigo" });
      tokens.push(
        (
          g.events.find((e) => e.type === "room" && e.token) as Extract<
            ServerEvent,
            { type: "room" }
          >
        ).token!,
      );
      for (const p of [h, g]) await a.handle(p.c, { type: "game-ready" });
      await expect(b.handle(g.c, { type: "start" })).rejects.toThrow(
        "anfitrião",
      );
      await a.handle(h.c, { type: "start" });
      await b.poll(g.c);
      expect(
        (
          g.events.filter((e) => e.type === "room").at(-1) as Extract<
            ServerEvent,
            { type: "room" }
          >
        ).room.started,
      ).toBe(true);
      await a.disconnect(h.c);
      await b.handle(resumed.c, {
        type: "resume",
        code,
        token: initial.token!,
      });
      expect(resumed.c.id).toBe(h.c.id);
      expect(resumed.c.owner).toBe(false);
      const stored = JSON.parse((await db.get<string>(`${prefix}:${code}`))!);
      expect(stored.hostId).toBe(g.c.id);
      expect(stored.players.find((p: any) => p.id === resumed.c.id).slot).toBe(
        0,
      );
      expect(
        stored.players.find((p: any) => p.id === resumed.c.id).ownerOnly,
      ).toBe(false);
    } finally {
      if (code)
        await db.del(
          `${prefix}:${code}`,
          `${prefix}:${code}:events`,
          ...tokens.map(
            (t) =>
              `${prefix}:token:${createHash("sha256").update(t).digest("hex")}`,
          ),
        );
    }
  },
  45000,
);
