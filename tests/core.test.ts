import { describe, it, expect, vi } from "vitest";
import { RoomService, type Client } from "../src/lib/server/rooms";
import { RemoteInput } from "../src/lib/remote/inputs";
import { commandSchema, avatarSchema } from "../src/lib/protocol";
import type { ServerEvent, Room } from "../src/lib/protocol";
const client = (owner = false) => {
  const events: ServerEvent[] = [];
  const c: Client = { owner, send: (e) => events.push(e) };
  return {
    c,
    events,
    room: () =>
      (events.filter((e) => e.type === "room").at(-1) as { room: Room }).room,
  };
};
describe("salas autoritativas", () => {
  it("cede a coordenação somente para outro participante preparado e em primeiro plano", () => {
    const svc = new RoomService(3),
      h = client(true),
      g = client(),
      t = client();
    svc.handle(h.c, { type: "create", name: "H" });
    const code = h.room().code;
    for (const [p, name] of [
      [g, "G"],
      [t, "T"],
    ] as const)
      svc.handle(p.c, { type: "join", code, name });
    for (const p of [h, g, t]) svc.handle(p.c, { type: "game-ready" });
    svc.handle(h.c, { type: "start" });
    svc.handle(g.c, { type: "game-away" });
    svc.handle(g.c, { type: "yield-host" });
    expect(t.room().hostId).toBe(h.c.id);
    svc.handle(h.c, { type: "game-away" });
    svc.handle(h.c, { type: "yield-host" });
    expect(t.room().hostId).toBe(t.c.id);
    expect(t.c.owner).toBe(false);
    expect(t.room().players.find((p) => p.id === t.c.id)?.slot).toBe(2);
    svc.handle(t.c, { type: "game-away" });
    svc.handle(h.c, { type: "game-ready" });
    expect(h.room().hostId).toBe(h.c.id);
  });
  it("transfere a coordenação sem trocar controles ou conceder administração", () => {
    const svc = new RoomService(3),
      h = client(true),
      g = client(),
      third = client();
    svc.handle(h.c, { type: "create", name: "H" });
    const code = h.room().code;
    for (const [c, name] of [
      [g, "G"],
      [third, "T"],
    ] as const)
      svc.handle(c.c, { type: "join", name, code });
    for (const c of [h, g, third]) svc.handle(c.c, { type: "game-ready" });
    svc.handle(h.c, { type: "start" });
    svc.leave(h.c);
    expect(g.room().hostId).toBe(g.c.id);
    expect(g.room().started).toBe(true);
    expect(g.room().players.find((p) => p.id === g.c.id)?.slot).toBe(1);
    expect(g.c.owner).toBe(false);
    expect(() => svc.handle(g.c, { type: "create", name: "x" })).toThrow();
    svc.leave(g.c, true);
    expect(third.room().hostId).toBe(third.c.id);
    svc.leave(third.c, true);
  });
  it("exige maioria dos demais jogadores para trocar um anfitrião ainda presente", () => {
    const svc = new RoomService(3),
      h = client(true),
      g = client(),
      t = client();
    svc.handle(h.c, { type: "create", name: "H" });
    const code = h.room().code;
    for (const [c, name] of [
      [g, "G"],
      [t, "T"],
    ] as const)
      svc.handle(c.c, { type: "join", name, code });
    for (const c of [h, g, t]) svc.handle(c.c, { type: "game-ready" });
    svc.handle(h.c, { type: "start" });
    const old = h.c.id!;
    svc.handle(g.c, { type: "elect-host", hostId: old });
    expect(g.room().hostId).toBe(old);
    svc.handle(t.c, { type: "elect-host", hostId: old });
    expect(g.room().hostId).toBe(g.c.id);
    expect(g.c.owner).toBe(false);
    svc.leave(g.c, true);
    svc.leave(h.c, true);
    svc.leave(t.c, true);
  });
  it("exige proprietário, atribui vagas, recusa códigos e encerra com host", () => {
    const service = new RoomService(2),
      host = client(true),
      guest = client();
    expect(() =>
      service.handle(guest.c, { type: "create", name: "X" }),
    ).toThrow();
    service.handle(host.c, { type: "create", name: "Host" });
    const code = host.room().code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(() =>
      service.handle(guest.c, { type: "join", name: "X", code: "AAAAAA" }),
    ).toThrow();
    service.handle(guest.c, { type: "join", name: "Friend", code });
    expect(guest.room().players.map((p) => p.slot)).toEqual([0, 1]);
    expect(() =>
      service.handle(client().c, { type: "join", name: "Third", code }),
    ).toThrow("cheia");
    expect(() => service.handle(guest.c, { type: "start" })).toThrow();
    service.handle(host.c, { type: "start" });
    expect(guest.room().started).toBe(true);
    service.leave(host.c, true);
    expect(guest.events.at(-1)?.type).toBe("closed");
    expect(service.hasToken("bad")).toBe(false);
  });
  it("libera vaga e reconecta apenas com token próprio", () => {
    const service = new RoomService(2),
      h = client(true),
      g = client();
    service.handle(h.c, { type: "create", name: "H" });
    const code = h.room().code;
    service.handle(g.c, { type: "join", name: "G", code });
    const event = g.events.find((e) => e.type === "room" && e.token) as {
      token: string;
    };
    service.leave(g.c);
    expect(h.room().players[1].connected).toBe(false);
    const restored = client();
    expect(() =>
      service.handle(restored.c, { type: "resume", code, token: "fake" }),
    ).toThrow();
    service.handle(restored.c, { type: "resume", code, token: event.token });
    expect(restored.room().players[1].slot).toBe(1);
    service.leave(restored.c, true);
    service.handle(client().c, { type: "join", name: "New", code });
    expect(h.room().players.map((p) => p.slot)).toEqual([0, 1]);
    service.leave(h.c);
  });
  it("não aceita sinalização fora da sala", () => {
    const svc = new RoomService(4),
      h = client(true),
      g = client();
    svc.handle(h.c, { type: "create", name: "H" });
    svc.handle(g.c, { type: "join", code: h.room().code, name: "G" });
    expect(() =>
      svc.handle(g.c, {
        type: "signal",
        target: "00000000-0000-4000-8000-000000000000",
        signal: { kind: "candidate", candidate: { candidate: "" } },
      }),
    ).toThrow();
    svc.leave(h.c);
  });
});
describe("entradas remotas", () => {
  it("mantém combinações no slot confiável e libera após perda de pacotes", () => {
    const inject = vi.fn(),
      input = new RemoteInput(1, inject);
    expect(
      input.receive(
        JSON.stringify({ type: "input", buttons: [4, 8], seq: 1 }),
        100,
      ),
    ).toBe(true);
    expect(inject.mock.calls).toEqual([
      [1, 4, 1],
      [1, 8, 1],
    ]);
    expect(
      input.receive(
        JSON.stringify({ type: "input", buttons: [], seq: 0 }),
        200,
      ),
    ).toBe(false);
    expect(
      input.receive(
        JSON.stringify({ type: "input", buttons: [4], seq: 2, slot: 0 }),
        250,
      ),
    ).toBe(false);
    input.expire(900);
    expect(inject.mock.calls.slice(-2)).toEqual([
      [1, 4, 0],
      [1, 8, 0],
    ]);
  });
  it("valida botão e mensagens", () => {
    const input = new RemoteInput(1, vi.fn());
    expect(input.receive("{broken")).toBe(false);
    expect(
      input.receive(JSON.stringify({ type: "input", buttons: [27], seq: 1 })),
    ).toBe(false);
    expect(
      commandSchema.safeParse({ type: "join", name: "x", code: "../api" })
        .success,
    ).toBe(false);
  });
});

describe("identidades da turma", () => {
  it("compartilha nome/foto em quatro slots e mantém identidade na reconexão", () => {
    const svc = new RoomService(4),
      h = client(true),
      g = client(),
      helo = client(),
      gu = client();
    svc.handle(h.c, {
      type: "create",
      name: "Matheus",
      avatar: "/avatars/matheus.png",
    });
    const code = h.room().code;
    svc.handle(g.c, {
      type: "join",
      code,
      name: "Gabi",
      avatar: "/avatars/gabi.png",
    });
    svc.handle(helo.c, { type: "join", code, name: "Helo" });
    svc.handle(gu.c, {
      type: "join",
      code,
      name: "Gu",
      avatar: "/avatars/gu.png",
    });
    expect(h.room().players.map((p) => p.slot)).toEqual([0, 1, 2, 3]);
    expect(h.room().players.map((p) => p.avatar)).toEqual([
      "/avatars/matheus.png",
      "/avatars/gabi.png",
      undefined,
      "/avatars/gu.png",
    ]);
    const event = gu.events.find((e) => e.type === "room" && e.token) as {
      token: string;
    };
    svc.leave(gu.c);
    const restored = client();
    svc.handle(restored.c, { type: "resume", code, token: event.token });
    expect(restored.room().players[3].avatar).toBe("/avatars/gu.png");
    svc.leave(h.c);
  });
  it("recusa fotos externas/SVG/tamanho excessivo e nomes repetidos", () => {
    expect(
      avatarSchema.safeParse("https://externo.example/foto.jpg").success,
    ).toBe(false);
    expect(
      avatarSchema.safeParse("data:image/svg+xml;base64,AAAA").success,
    ).toBe(false);
    expect(
      avatarSchema.safeParse("data:image/jpeg;base64," + "A".repeat(30000))
        .success,
    ).toBe(false);
    const svc = new RoomService(4),
      h = client(true);
    svc.handle(h.c, { type: "create", name: "Matheus" });
    expect(() =>
      svc.handle(client().c, {
        type: "join",
        code: h.room().code,
        name: "matheus",
      }),
    ).toThrow("já está");
    svc.leave(h.c);
  });
});

describe("capacidade total de cinco pessoas", () => {
  it("atribui o quinto controle, recusa uma sexta pessoa e reutiliza a vaga", () => {
    const service = new RoomService(),
      host = client(true),
      guests = Array.from({ length: 4 }, () => client());
    service.handle(host.c, { type: "create", name: "Host" });
    const code = host.room().code;
    guests.forEach((guest, i) =>
      service.handle(guest.c, {
        type: "join",
        code,
        name: `Convidado ${i + 1}`,
      }),
    );
    expect(host.room().capacity).toBe(5);
    expect(host.room().players.map((p) => p.slot)).toEqual([0, 1, 2, 3, 4]);
    expect(() =>
      service.handle(client().c, { type: "join", code, name: "Sexta pessoa" }),
    ).toThrow("cheia");
    service.leave(guests[3].c, true);
    const next = client();
    service.handle(next.c, { type: "join", code, name: "Nova pessoa" });
    expect(next.room().players.at(-1)?.slot).toBe(4);
    service.leave(host.c);
  });
  it("aceita combinações remotas somente no quinto slot atribuído", () => {
    const inject = vi.fn(),
      input = new RemoteInput(4, inject);
    expect(
      input.receive(
        JSON.stringify({ type: "input", buttons: [7, 0], seq: 1 }),
        100,
      ),
    ).toBe(true);
    expect(inject.mock.calls).toEqual([
      [4, 0, 1],
      [4, 7, 1],
    ]);
    input.clear();
    expect(inject.mock.calls.slice(-2)).toEqual([
      [4, 7, 0],
      [4, 0, 0],
    ]);
  });
  it("preserva entradas simultâneas dos quatro convidados ao sair e reutilizar uma vaga", () => {
    const state = Array.from({ length: 5 }, () => new Set<number>());
    const inject = (slot: number, button: number, down: number) => {
      if (down) state[slot].add(button);
      else state[slot].delete(button);
    };
    inject(0, 6, 1);
    const guests = [1, 2, 3, 4].map((slot) => new RemoteInput(slot, inject));
    guests.forEach((input) =>
      input.receive(
        JSON.stringify({ type: "input", buttons: [0, 7], seq: 1 }),
        100,
      ),
    );
    expect(state.map((buttons) => [...buttons])).toEqual([
      [6],
      [0, 7],
      [0, 7],
      [0, 7],
      [0, 7],
    ]);
    guests[1].clear();
    expect(state.map((buttons) => [...buttons])).toEqual([
      [6],
      [0, 7],
      [],
      [0, 7],
      [0, 7],
    ]);
    const replacement = new RemoteInput(2, inject);
    replacement.receive(
      JSON.stringify({ type: "input", buttons: [4], seq: 1 }),
      200,
    );
    guests[3].receive(
      JSON.stringify({ type: "input", buttons: [7], seq: 2 }),
      200,
    );
    expect(state.map((buttons) => [...buttons])).toEqual([
      [6],
      [0, 7],
      [4],
      [0, 7],
      [7],
    ]);
    guests[0].expire(1000);
    expect([...state[1]]).toEqual([]);
    expect([...state[4]]).toEqual([7]);
  });
});
