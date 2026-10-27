import {
  frameInputSchema,
  MAX_FRAME_AHEAD,
  MAX_BUFFERED_COMMITS,
  type FrameCommit,
  type FrameInput,
} from "./protocol";

/** Coordinator owns the slot binding. A packet can never select another pad. */
export class LockstepCoordinator {
  private inputs = new Map<number, Map<number, number>>();
  private nextFrame: number;
  private allowed: number[];
  private activeFrom = new Map<number, number>();
  get slots(): readonly number[] {
    return this.allowed;
  }
  constructor(
    readonly epoch: string,
    slots: readonly number[],
    firstFrame = 0,
  ) {
    if (
      !slots.length ||
      slots.length > 5 ||
      new Set(slots).size !== slots.length ||
      slots.some((s) => !Number.isInteger(s) || s < 0 || s > 4)
    )
      throw Error("Posições de controle inválidas");
    this.allowed = [...slots];
    for (const slot of slots) this.activeFrom.set(slot, firstFrame);
    this.nextFrame = firstFrame;
  }
  get frame() {
    return this.nextFrame;
  }
  requiredSlots(number = this.nextFrame) {
    return this.allowed.filter(
      (slot) => (this.activeFrom.get(slot) ?? Infinity) <= number,
    );
  }
  missingSlots() {
    const inputs = this.inputs.get(this.nextFrame);
    return this.requiredSlots().filter((s) => !inputs?.has(s));
  }
  setSlots(slots: number[]) {
    if (
      !slots.length ||
      new Set(slots).size !== slots.length ||
      slots.some((s) => !Number.isInteger(s) || s < 0 || s > 4)
    )
      throw Error("Posições inválidas.");
    for (const slot of this.allowed)
      if (!slots.includes(slot)) this.deactivate(slot);
    this.allowed = [...slots];
  }
  deactivate(slot: number) {
    this.activeFrom.delete(slot);
    for (const inputs of this.inputs.values()) inputs.delete(slot);
  }
  activate(slot: number, from: number) {
    if (this.allowed.includes(slot))
      this.activeFrom.set(slot, Math.max(this.nextFrame, from));
  }
  receive(
    boundSlot: number,
    raw: unknown,
  ): "accepted" | "duplicate" | "rejected" {
    const parsed = frameInputSchema.safeParse(raw);
    if (!parsed.success) return "rejected";
    const packet = parsed.data;
    if (
      packet.epoch !== this.epoch ||
      packet.slot !== boundSlot ||
      !this.slots.includes(boundSlot) ||
      packet.frame < this.nextFrame ||
      packet.frame > this.nextFrame + MAX_FRAME_AHEAD
    )
      return "rejected";
    let inputs = this.inputs.get(packet.frame);
    if (!inputs) this.inputs.set(packet.frame, (inputs = new Map()));
    if (inputs.has(boundSlot))
      return inputs.get(boundSlot) === packet.mask ? "duplicate" : "rejected";
    inputs.set(boundSlot, packet.mask);
    return "accepted";
  }
  /** Returns nothing if anyone's input is missing. Never invent remote input. */
  take(): FrameCommit | undefined {
    const inputs = this.inputs.get(this.nextFrame);
    const required = this.requiredSlots();
    if (!inputs || required.some((s) => !inputs.has(s))) return;
    const masks: FrameCommit["masks"] = [0, 0, 0, 0, 0];
    for (const slot of required) masks[slot] = inputs.get(slot)!;
    const commit: FrameCommit = {
      type: "commit",
      epoch: this.epoch,
      frame: this.nextFrame,
      masks,
    };
    this.inputs.delete(this.nextFrame++);
    return commit;
  }
}

export interface FrameCore {
  step(masks: number[]): number;
  frame(): number;
  save(): Uint8Array;
  load(state: Uint8Array, frame: number): void;
}
/** Executes only contiguous coordinator commits; each call advances the native core once. */
export class LockstepReplica {
  private pending = new Map<number, FrameCommit>();
  private nextFrame: number;
  constructor(
    readonly epoch: string,
    private core: FrameCore,
    firstFrame = 0,
  ) {
    this.nextFrame = firstFrame;
  }
  get frame() {
    return this.nextFrame;
  }
  get buffered() {
    return this.pending.size;
  }
  receive(commit: FrameCommit) {
    if (
      commit.epoch !== this.epoch ||
      !Number.isInteger(commit.frame) ||
      commit.frame < this.nextFrame ||
      commit.frame > this.nextFrame + MAX_BUFFERED_COMMITS ||
      commit.masks.length !== 5 ||
      commit.masks.some((m) => !Number.isInteger(m) || m < 0 || m > 4095)
    )
      return false;
    const previous = this.pending.get(commit.frame);
    if (previous) return previous.masks.every((m, i) => m === commit.masks[i]);
    this.pending.set(commit.frame, { ...commit, masks: [...commit.masks] });
    return true;
  }
  advance() {
    const commit = this.pending.get(this.nextFrame);
    if (!commit) return false;
    if (this.core.frame() !== this.nextFrame)
      throw Error("O quadro local divergiu do protocolo. Partida pausada.");
    const result = this.core.step(commit.masks);
    if (result !== this.nextFrame + 1)
      throw Error("O core não avançou exatamente um quadro. Partida pausada.");
    this.pending.delete(this.nextFrame++);
    return true;
  }
}
export function inputPacket(
  epoch: string,
  frame: number,
  slot: number,
  mask: number,
): FrameInput {
  return frameInputSchema.parse({ type: "input", epoch, frame, slot, mask });
}
