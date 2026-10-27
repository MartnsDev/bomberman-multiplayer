import { describe, it, expect } from "vitest";
import { AdaptiveQuality, videoScale } from "../src/lib/remote/quality";

describe("qualidade adaptativa por convidado", () => {
  it("começa com carga moderada e só aumenta após estabilidade sustentada", () => {
    const q = new AdaptiveQuality();
    expect(q.profile.maxBitrate).toBe(320000);
    for (let i = 0; i < 5; i++)
      q.sample({ rtt: 0.03, loss: 0, availableBitrate: 2000000 });
    expect(q.profile.maxFramerate).toBe(30);
    q.sample({ rtt: 0.03, loss: 0, availableBitrate: 2000000 });
    expect(q.profile.maxFramerate).toBe(60);
    expect(q.profile.maxBitrate * 4).toBeLessThanOrEqual(2200000);
  });
  it("reduz sob perda, atraso, upload baixo ou CPU sobrecarregada, sem afetar outro peer", () => {
    for (const sample of [
      { loss: 0.1 },
      { rtt: 0.4 },
      { availableBitrate: 100000 },
      { encodeSecondsPerFrame: 0.025 },
    ]) {
      const q = new AdaptiveQuality(),
        other = new AdaptiveQuality();
      q.sample(sample);
      expect(q.profile.maxFramerate).toBe(30);
      q.sample(sample);
      expect(q.profile.maxFramerate).toBe(24);
      expect(other.profile.maxFramerate).toBe(30);
      for (let i = 0; i < 10; i++) q.sample(sample);
      expect(q.profile.maxBitrate).toBe(180000);
    }
  });
  it("ignora picos isolados, recupera gradualmente e aplica economia durante a partida", () => {
    const q = new AdaptiveQuality();
    q.sample({ loss: 0.2 });
    q.sample({ rtt: 0.02 });
    q.sample({ loss: 0.2 });
    expect(q.profile.maxFramerate).toBe(30);
    q.setEconomy(true);
    for (let i = 0; i < 20; i++) q.sample({ rtt: 0.02 });
    expect(q.profile.maxFramerate).toBe(24);
    q.setEconomy(false);
    expect(q.profile.maxFramerate).toBe(30);
    // No usable network sample must not increase quality just because loss defaults to zero.
    for (let i = 0; i < 20; i++) q.sample({});
    expect(q.profile.maxFramerate).toBe(30);
  });
});

it("limita a imagem enviada preservando a proporção e sem ampliar telas pequenas", () => {
  expect(videoScale({ width: 871, height: 538 })).toBeCloseTo(871 / 384);
  expect(videoScale({ width: 1080, height: 1920 })).toBeCloseTo(1920 / 288);
  expect(videoScale({ width: 256, height: 224 })).toBe(1);
  expect(videoScale({})).toBe(1);
});
