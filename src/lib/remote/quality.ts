// Keep four simultaneous uploads affordable. These are ceilings, not reserved bandwidth.
export const VIDEO_PROFILES = [
  { name: "Econômico", maxBitrate: 180_000, maxFramerate: 24 },
  { name: "Estável", maxBitrate: 320_000, maxFramerate: 30 },
  { name: "Fluido", maxBitrate: 550_000, maxFramerate: 60 },
] as const;
export interface NetworkSample {
  rtt?: number;
  loss?: number;
  availableBitrate?: number;
  encodeSecondsPerFrame?: number;
}
export class AdaptiveQuality {
  private level = 1;
  private good = 0;
  private bad = 0;
  constructor(private economy = false) {}
  get profile() {
    return VIDEO_PROFILES[this.economy ? 0 : this.level];
  }
  setEconomy(value: boolean) {
    this.economy = value;
    this.level = 1;
    this.good = this.bad = 0;
  }
  sample(s: NetworkSample) {
    if (this.economy) return;
    const congested =
      (s.loss ?? 0) > 0.05 ||
      (s.rtt ?? 0) > 0.22 ||
      (s.encodeSecondsPerFrame ?? 0) > 0.018 ||
      (s.availableBitrate !== undefined &&
        s.availableBitrate < this.profile.maxBitrate * 0.85);
    const healthy =
      !congested &&
      s.rtt !== undefined &&
      s.rtt < 0.12 &&
      (s.loss ?? 0) < 0.015 &&
      (s.encodeSecondsPerFrame ?? 0) < 0.01 &&
      (s.availableBitrate === undefined ||
        s.availableBitrate >
          VIDEO_PROFILES[Math.min(2, this.level + 1)].maxBitrate * 1.4);
    this.bad = congested ? this.bad + 1 : 0;
    this.good = healthy ? this.good + 1 : 0;
    if (this.bad >= 2) {
      this.level = Math.max(0, this.level - 1);
      this.bad = this.good = 0;
    }
    // Recover slowly to avoid repeatedly filling the sender queue on weak Wi-Fi.
    if (this.good >= 6) {
      this.level = Math.min(2, this.level + 1);
      this.bad = this.good = 0;
    }
  }
}

export function videoScale(settings: { width?: number; height?: number }) {
  return Math.max(
    1,
    (settings.width ?? 384) / 384,
    (settings.height ?? 288) / 288,
  );
}
