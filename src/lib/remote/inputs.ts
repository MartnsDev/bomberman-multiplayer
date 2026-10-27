import { inputSchema } from "../protocol";
// Slot is bound to the authenticated signaling peer, never supplied by a packet.
export class RemoteInput {
  private lastSeq = -1;
  private pressed = new Set<number>();
  private lastSeen = 0;
  private count = 0;
  private since = 0;
  constructor(
    readonly slot: number,
    private inject: (slot: number, button: number, value: number) => void,
  ) {}
  receive(raw: unknown, now = performance.now()) {
    if (typeof raw !== "string" || raw.length > 512) return false;
    if (now - this.since > 1000) {
      this.count = 0;
      this.since = now;
    }
    if (++this.count > 150) return false;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return false;
    }
    const parsed = inputSchema.safeParse(data);
    if (!parsed.success || parsed.data.seq <= this.lastSeq) return false;
    this.lastSeq = parsed.data.seq;
    this.lastSeen = now;
    const next = new Set(parsed.data.buttons);
    for (let b = 0; b < 12; b++)
      if (next.has(b) !== this.pressed.has(b))
        this.inject(this.slot, b, next.has(b) ? 1 : 0);
    this.pressed = next;
    return true;
  }
  expire(now = performance.now()) {
    if (this.pressed.size && now - this.lastSeen > 700) this.clear();
  }
  clear() {
    for (const b of this.pressed) this.inject(this.slot, b, 0);
    this.pressed.clear();
  }
}
