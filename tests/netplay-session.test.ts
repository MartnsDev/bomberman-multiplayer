import { afterEach, describe, expect, it, vi } from "vitest";
import { NetplaySession, type NetplayStatus } from "../src/lib/netplay/session";
import type { FrameCore } from "../src/lib/netplay/lockstep";
import type { Compatibility } from "../src/lib/netplay/protocol";
import { setImmediate as settle } from "node:timers/promises";

const compatibility: Compatibility = {
  protocol: 3,
  rom: "a".repeat(64),
  core: "b".repeat(64),
  settings: "c".repeat(64),
};
class Core implements FrameCore {
  number = 0;
  value = 0;
  inputs: number[][] = [];
  history = new Map<number, number>();
  step(masks: number[]) {
    this.inputs.push([...masks]);
    this.value =
      (Math.imul(this.value, 31) +
        masks.reduce((n, m, s) => n + Math.imul(s + 1, m), 0)) >>>
      0;
    this.history.set(++this.number, this.value);
    return this.number;
  }
  frame() {
    return this.number;
  }
  save() {
    const b = new Uint8Array(8),
      v = new DataView(b.buffer);
    v.setUint32(0, this.number);
    v.setUint32(4, this.value);
    return b;
  }
  load(b: Uint8Array, n: number) {
    this.number = n;
    this.value = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(
      4,
    );
  }
}
const active: NetplaySession[] = [];
afterEach(() => {
  for (const s of active.splice(0)) s.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function room(count: number, latency = 0, loseFirstHello = false) {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "performance",
    ],
  });
  let id = 0;
  const raf = new Map<number, FrameRequestCallback>();
  const callbackSlots = new Map<FrameRequestCallback, number>();
  const frozen = new Set<number>();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    if (!callbackSlots.has(cb)) callbackSlots.set(cb, callbackSlots.size);
    raf.set(++id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (n: number) => raf.delete(n));
  const cores = Array.from({ length: count }, () => new Core()),
    statuses: NetplayStatus[] = [];
  const stalled = Array.from({ length: count }, () => 0);
  const sessions = cores.map(
    (core, slot) =>
      new NetplaySession({
        host: slot === 0,
        slot,
        slots: cores.map((_, i) => i),
        core,
        compatibility,
        coordinatorStalled: () => {
          stalled[slot]++;
        },
        update: (s) => {
          statuses[slot] = s;
        },
      }),
  );
  active.push(...sessions);
  type Delivery = {
    due: number;
    to: number;
    from: number;
    data: string | ArrayBuffer;
  };
  const dropped = new Set<number>();
  const queue: Delivery[] = [],
    dueByLink = new Map<string, number>();
  let retransmit = 0;
  const send = (from: number, to: number) => (data: string | Uint8Array) => {
    if (
      loseFirstHello &&
      from === 1 &&
      typeof data === "string" &&
      JSON.parse(data).type === "hello"
    ) {
      loseFirstHello = false;
      return;
    }
    const key = `${from}:${to}`,
      now = performance.now();
    const isInput =
      typeof data === "string" && JSON.parse(data).type === "input";
    if (isInput && dropped.has(from)) return;
    const extra = isInput ? retransmit : 0;
    if (extra) retransmit = 0;
    const due = Math.max(now + latency + extra, dueByLink.get(key) ?? 0);
    dueByLink.set(key, due);
    const copy = typeof data === "string" ? data : new Uint8Array(data).buffer;
    queue.push({ due, to, from, data: copy });
  };
  for (let slot = 1; slot < count; slot++) {
    sessions[0].attach(slot, send(0, slot));
    sessions[slot].attach(0, send(slot, 0));
  }
  async function deliver() {
    for (;;) {
      queue.sort((a, b) => a.due - b.due);
      const next = queue[0];
      if (!next || next.due > performance.now()) return;
      queue.shift();
      await sessions[next.to].receive(next.from, next.data);
    }
  }
  async function advance(frames: number) {
    for (let f = 0; f < frames; f++) {
      await vi.advanceTimersByTimeAsync(1000 / 60);
      await deliver();
      const pending = [...raf.values()];
      raf.clear();
      for (const cb of pending)
        if (frozen.has(callbackSlots.get(cb)!)) raf.set(++id, cb);
        else cb(performance.now());
      await settle();
      await deliver();
    }
  }
  await advance(20);
  return {
    cores,
    sessions,
    statuses,
    advance,
    stalled,
    freeze: (slot: number, value: boolean) => {
      if (value) frozen.add(slot);
      else frozen.delete(slot);
    },
    reconnect: (slot = 1) => {
      sessions[0].attach(slot, send(0, slot));
      sessions[slot].attach(0, send(slot, 0));
    },
    dropInput: (slot: number, drop: boolean) => {
      if (drop) dropped.add(slot);
      else dropped.delete(slot);
    },
    loseNextInput: () => {
      retransmit = 220;
    },
    setLatency: (value: number) => {
      latency = value;
    },
  };
}
describe("sessão determinística completa", () => {
  it("solicita eleição quando o coordenador congela mesmo mantendo o canal aberto", async () => {
    const r = await room(3);
    r.sessions[0].start();
    await r.advance(140);
    r.freeze(0, true);
    await r.advance(260);
    expect(r.stalled[0]).toBe(0);
    expect(r.stalled[1]).toBeGreaterThan(0);
    expect(r.stalled[2]).toBeGreaterThan(0);
  });
  it("aceita um aviso de presença atrasado sem derrubar o canal de outro jogador", async () => {
    const r = await room(3);
    r.sessions[0].start();
    await r.advance(140);
    r.sessions[1].setMembers([0, 1]);
    await expect(
      r.sessions[1].receive(
        0,
        JSON.stringify({
          type: "roster",
          slots: [0, 1, 2],
          activeSlots: [0, 1, 2],
        }),
      ),
    ).resolves.toBeUndefined();
    expect(r.statuses[1].phase).toBe("running");
  });
  it("recupera o atraso de uma aba suspensa e volta a receber seus botões", async () => {
    const r = await room(3);
    r.sessions[2].setButtons([8]);
    r.sessions[0].start();
    await r.advance(140);
    r.freeze(2, true);
    const before = r.cores[0].frame();
    await r.advance(50);
    expect(r.cores[0].frame()).toBeGreaterThan(before + 45);
    r.freeze(2, false);
    await r.advance(150);
    expect(r.cores[0].frame() - r.cores[2].frame()).toBeLessThanOrEqual(2);
    expect(r.statuses[0].activeSlots).toContain(2);
    expect(r.cores[0].inputs.slice(-30).every((m) => m[2] === 256)).toBe(true);
    expect(
      r.statuses.every((s) => s.corrections === 0 && s.phase === "running"),
    ).toBe(true);
  });
  it("mantém a taxa de quadros com RTT móvel de 160 ms sem perder sincronização", async () => {
    const r = await room(3, 80);
    r.sessions[0].start();
    await r.advance(600);
    expect(
      r.statuses.every((s) => s.phase === "running" && s.corrections === 0),
    ).toBe(true);
    expect(r.statuses[0].fps).toBeGreaterThanOrEqual(55);
    expect(r.statuses[0].verifiedFrame).toBeGreaterThanOrEqual(480);
    expect(
      r.statuses.every((s) => s.inputDelay >= 13 && s.automaticDelay),
    ).toBe(true);
  });
  it("respeita o atraso manual mesmo quando a rede exige um buffer maior", async () => {
    const r = await room(2, 80);
    r.sessions[0].setDelay(6);
    r.sessions[0].start();
    await r.advance(360);
    expect(
      r.statuses.every(
        (s) => s.inputDelay === 6 && !s.automaticDelay && s.phase === "running",
      ),
    ).toBe(true);
  });
  it("reduz o atraso após a rede estabilizar sem sobrescrever comandos já enviados", async () => {
    const r = await room(3, 80);
    r.sessions[0].start();
    await r.advance(360);
    expect(r.statuses[0].inputDelay).toBeGreaterThanOrEqual(13);
    r.setLatency(10);
    await r.advance(1000);
    expect(
      r.statuses.every(
        (s) =>
          s.phase === "running" && s.corrections === 0 && s.inputDelay === 6,
      ),
    ).toBe(true);
    expect(r.statuses[0].fps).toBeGreaterThanOrEqual(55);
    expect(r.statuses[0].verifiedFrame).toBeGreaterThan(960);
  });
  it("conclui a negociação quando o primeiro HELLO chega antes do registro do outro lado", async () => {
    const r = await room(2, 0, true);
    expect(r.statuses.every((s) => s.phase === "ready")).toBe(true);
    r.sessions[0].start();
    await r.advance(130);
    await vi.waitFor(() =>
      expect(r.statuses.every((s) => s.verifiedFrame >= 120)).toBe(true),
    );
  });
  for (const count of [2, 3, 4, 5])
    it(`${count} controles independentes, snapshots e checksums periódicos`, async () => {
      const r = await room(count);
      expect(r.statuses.every((s) => s.phase === "ready")).toBe(true);
      r.sessions.forEach((s, i) => s.setButtons([i + 4, 8]));
      r.sessions[0].start();
      await r.advance(370);
      expect(r.cores.every((c) => c.frame() >= 350)).toBe(true);
      expect(
        r.statuses.every(
          (s) =>
            s.verifiedFrame >= 240 &&
            s.corrections === 0 &&
            s.phase === "running",
        ),
      ).toBe(true);
      const common = Math.min(...r.cores.map((c) => c.frame()));
      expect(new Set(r.cores.map((c) => c.history.get(common))).size).toBe(1);
    });
  it("aguarda retransmissão de entrada perdida, preservando os estados", async () => {
    const r = await room(3, 20);
    r.sessions[0].setDelay(12);
    r.sessions[0].start();
    await r.advance(80);
    const before = r.cores[0].frame();
    r.loseNextInput();
    await r.advance(8);
    expect(r.cores[0].frame() - before).toBeLessThanOrEqual(8);
    await r.advance(350);
    expect(r.statuses[0].verifiedFrame).toBeGreaterThanOrEqual(240);
    expect(
      r.statuses.every((s) => s.corrections === 0 && s.phase === "running"),
    ).toBe(true);
    expect(
      Math.max(...r.cores.map((c) => c.frame())) -
        Math.min(...r.cores.map((c) => c.frame())),
    ).toBeLessThanOrEqual(2);
  });
  it("detecta divergência, restaura o estado canônico e pausa após reincidências", async () => {
    const r = await room(2);
    r.sessions[0].start();
    await r.advance(130);
    for (let attempt = 1; attempt <= 3; attempt++) {
      r.cores[1].value ^= 123;
      await r.advance(125);
      expect(r.statuses[0].corrections).toBe(attempt);
      if (attempt < 3) {
        expect(r.statuses.every((s) => s.phase === "running")).toBe(true);
        expect(r.cores[0].value).toBe(r.cores[1].value);
      }
    }
    expect(r.statuses.every((s) => s.phase === "paused")).toBe(true);
  });
  it("continua após a saída de um convidado e restaura apenas quem retorna", async () => {
    const r = await room(3);
    r.sessions[0].start();
    await r.advance(130);
    r.sessions[0].disconnect(2);
    r.sessions[2].disconnect(0);
    const before = r.cores[0].frame();
    await r.advance(160);
    expect(r.cores[0].frame()).toBeGreaterThan(before + 150);
    expect(
      [r.statuses[0], r.statuses[1]].every(
        (s) => s.phase === "running" && s.corrections === 0,
      ),
    ).toBe(true);
    const joining = r.cores[0].frame();
    r.reconnect(2);
    await r.advance(200);
    expect(r.cores[0].frame()).toBeGreaterThan(joining + 190);
    expect(
      r.statuses.every(
        (s) =>
          s.phase === "running" &&
          s.verifiedFrame >= 480 &&
          s.corrections === 0,
      ),
    ).toBe(true);
  });
  it("não prende a partida num canal silencioso e retoma o controle com entradas novas", async () => {
    const r = await room(3);
    r.sessions[2].setButtons([8]);
    r.sessions[0].start();
    await r.advance(140);
    r.dropInput(2, true);
    const f = r.cores[0].frame();
    await r.advance(150);
    expect(r.cores[0].frame()).toBeGreaterThan(f + 140);
    expect(r.statuses[0].activeSlots).not.toContain(2);
    expect(r.statuses.every((s) => s.inputDelay >= 8)).toBe(true);
    expect(r.cores[0].inputs.slice(-30).every((m) => m[2] === 0)).toBe(true);
    r.dropInput(2, false);
    await r.advance(150);
    expect(r.statuses[0].activeSlots).toContain(2);
    expect(r.cores[0].inputs.slice(-30).some((m) => m[2] === 256)).toBe(true);
    expect(
      r.statuses.every((s) => s.phase === "running" && s.corrections === 0),
    ).toBe(true);
  });
});
