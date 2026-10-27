import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  LockstepCoordinator,
  LockstepReplica,
  inputPacket,
  type FrameCore,
} from "../src/lib/netplay/lockstep";
import {
  compatible,
  compatibilitySchema,
  type Compatibility,
} from "../src/lib/netplay/protocol";
describe("netplay por quadro", () => {
  it("retém o avanço enquanto um participante estiver atrasado e preserva cinco controles", () => {
    const epoch = randomUUID(),
      host = new LockstepCoordinator(epoch, [0, 1, 2, 3, 4]);
    for (const slot of [4, 2, 0, 1])
      expect(
        host.receive(slot, inputPacket(epoch, 0, slot, (1 << slot) | 256)),
      ).toBe("accepted");
    expect(host.take()).toBeUndefined();
    expect(host.frame).toBe(0);
    host.receive(3, inputPacket(epoch, 0, 3, 264));
    expect(host.take()?.masks).toEqual([257, 258, 260, 264, 272]);
    expect(host.take()).toBeUndefined();
  });
  it("recusa falsificação de controle, épocas antigas e reescrita de entradas", () => {
    const epoch = randomUUID(),
      host = new LockstepCoordinator(epoch, [0, 2]);
    expect(host.receive(2, inputPacket(epoch, 0, 0, 1))).toBe("rejected");
    expect(host.receive(2, inputPacket(randomUUID(), 0, 2, 1))).toBe(
      "rejected",
    );
    expect(host.receive(2, inputPacket(epoch, 999999, 2, 1))).toBe("rejected");
    expect(host.receive(2, inputPacket(epoch, 0, 2, 3))).toBe("accepted");
    expect(host.receive(2, inputPacket(epoch, 0, 2, 3))).toBe("duplicate");
    expect(host.receive(2, inputPacket(epoch, 0, 2, 7))).toBe("rejected");
  });
  it("reordena mensagens sem executar quadros incompletos, repetidos ou conflitantes", () => {
    const epoch = randomUUID(),
      host = new LockstepCoordinator(epoch, [0, 1]);
    for (const f of [2, 0, 1])
      for (const slot of [1, 0])
        host.receive(slot, inputPacket(epoch, f, slot, f + slot));
    let n = 0;
    const calls: number[][] = [];
    const core: FrameCore = {
      step: (m) => {
        calls.push(m);
        return ++n;
      },
      frame: () => n,
      save: () => new Uint8Array(),
      load: () => {},
    };
    const replica = new LockstepReplica(epoch, core),
      commits = [host.take()!, host.take()!, host.take()!];
    replica.receive(commits[2]);
    expect(replica.advance()).toBe(false);
    replica.receive(commits[0]);
    expect(replica.receive({ ...commits[0], masks: [8, 0, 0, 0, 0] })).toBe(
      false,
    );
    expect(replica.advance()).toBe(true);
    expect(replica.advance()).toBe(false);
    replica.receive(commits[1]);
    expect(replica.advance()).toBe(true);
    expect(replica.advance()).toBe(true);
    expect(replica.receive(commits[0])).toBe(false);
    expect(calls).toEqual([
      [0, 1, 0, 0, 0],
      [1, 2, 0, 0, 0],
      [2, 3, 0, 0, 0],
    ]);
  });
  it("recusa ROM, core, protocolo ou configurações diferentes", () => {
    const a: Compatibility = {
      protocol: 4,
      rom: "a".repeat(64),
      core: "b".repeat(64),
      settings: "c".repeat(64),
    };
    expect(compatible(a, { ...a })).toBe(true);
    expect(compatibilitySchema.safeParse({ ...a, protocol: 3 }).success).toBe(
      false,
    );
    for (const key of ["rom", "core", "settings"] as const)
      expect(compatible(a, { ...a, [key]: "d".repeat(64) })).toBe(false);
  });
  it("recebe uma rajada de retorno sem descartar quadros e executa cada um uma vez", () => {
    const epoch = randomUUID();
    let n = 0;
    const core: FrameCore = {
      frame: () => n,
      step: () => ++n,
      save: () => new Uint8Array(),
      load: () => {},
    };
    const replica = new LockstepReplica(epoch, core);
    for (let f = 0; f < 600; f++)
      expect(
        replica.receive({
          type: "commit",
          epoch,
          frame: f,
          masks: [0, 0, 0, 0, 0],
        }),
      ).toBe(true);
    expect(
      replica.receive({
        type: "commit",
        epoch,
        frame: 1025,
        masks: [0, 0, 0, 0, 0],
      }),
    ).toBe(false);
    while (replica.advance()) {}
    expect(n).toBe(600);
    expect(replica.buffered).toBe(0);
    expect(
      replica.receive({
        type: "commit",
        epoch,
        frame: 0,
        masks: [0, 0, 0, 0, 0],
      }),
    ).toBe(false);
  });
});
