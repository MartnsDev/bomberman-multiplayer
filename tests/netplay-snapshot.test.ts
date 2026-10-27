import { afterEach, it, expect, vi } from "vitest";
import {
  packSnapshot,
  unpackSnapshot,
  MAX_SNAPSHOT_BYTES,
} from "../src/lib/netplay/snapshot";
afterEach(() => vi.unstubAllGlobals());
const state = () => {
  const b = new Uint8Array(131072);
  for (let i = 0; i < b.length; i += 100) b[i] = i % 255;
  return b;
};
it("reduz o estado transmitido e restaura exatamente os mesmos bytes", async () => {
  const raw = state(),
    packed = await packSnapshot(raw, true);
  expect(packed.encoding).toBe("gzip");
  expect(packed.bytes.length).toBeLessThan(raw.length / 4);
  expect(
    await unpackSnapshot(packed.bytes, packed.encoding, raw.length),
  ).toEqual(raw);
});
it("mantém transporte original quando o outro aparelho não suporta compressão", async () => {
  const raw = state(),
    fallback = await packSnapshot(raw, false);
  expect(fallback.encoding).toBe("raw");
  expect(await unpackSnapshot(fallback.bytes, "raw", raw.length)).toEqual(raw);
  vi.stubGlobal("CompressionStream", undefined);
  expect((await packSnapshot(raw, true)).encoding).toBe("raw");
});
it("recusa estado corrompido ou incompleto antes de restaurar o emulador", async () => {
  const raw = state(),
    packed = await packSnapshot(raw, true),
    damaged = new Uint8Array(packed.bytes);
  damaged[damaged.length - 4] ^= 255;
  await expect(unpackSnapshot(damaged, "gzip", raw.length)).rejects.toThrow();
  await expect(unpackSnapshot(new Uint8Array(8), "raw", 9)).rejects.toThrow(
    "incompleto",
  );
});
it("limita a descompressão ao tamanho declarado do estado", async () => {
  const raw = state(),
    packed = await packSnapshot(raw, true);
  await expect(unpackSnapshot(packed.bytes, "gzip", 1024)).rejects.toThrow(
    "tamanho esperado",
  );
  await expect(
    unpackSnapshot(new Uint8Array(1), "raw", MAX_SNAPSHOT_BYTES + 1),
  ).rejects.toThrow("inválido");
});
