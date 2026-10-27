import { afterEach, expect, it, vi } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
import {
  isOwner,
  issueSession,
  verifyPassword,
  Limiter,
} from "../src/lib/server/auth";
import { validateRom } from "../src/lib/server/storage";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it("verifica senha e recusa cookie adulterado ou expirado", () => {
  const salt = randomBytes(16).toString("hex");
  vi.stubEnv(
    "OWNER_PASSWORD_HASH",
    `${salt}:${scryptSync("senha-apenas-de-teste", salt, 64).toString("hex")}`,
  );
  vi.stubEnv("SESSION_SECRET", "teste-".repeat(12));
  expect(verifyPassword("senha-apenas-de-teste")).toBe(true);
  expect(verifyPassword("errada")).toBe(false);
  const token = issueSession();
  expect(isOwner(`bomber_owner=${token}`)).toBe(true);
  expect(isOwner(`bomber_owner=${token.slice(0, -1)}x`)).toBe(false);
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 13 * 3600000);
  expect(isOwner(`bomber_owner=${token}`)).toBe(false);
});
it("limita tentativas e confere tamanho/hash da ROM", () => {
  const limiter = new Limiter(2, 1000);
  expect(limiter.allow("ip")).toBe(true);
  expect(limiter.allow("ip")).toBe(true);
  expect(limiter.allow("ip")).toBe(false);
  expect(() => validateRom(new Uint8Array(5))).toThrow();
  vi.stubEnv("ROM_SHA256", "hash-incorreto");
  expect(() => validateRom(new Uint8Array(2097152))).toThrow("SHA-256");
});
