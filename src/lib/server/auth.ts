import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export const COOKIE = "bomber_owner";
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32)
    throw Error("Configure SESSION_SECRET com pelo menos 32 caracteres");
  return s;
}
export function verifyPassword(password: string) {
  const [salt, hash] = (process.env.OWNER_PASSWORD_HASH ?? "").split(":");
  if (!salt || !hash || hash.length !== 128) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}
export function issueSession() {
  const data = `${Date.now() + 12 * 3600000}.${randomBytes(16).toString("hex")}`;
  return `${data}.${createHmac("sha256", secret()).update(data).digest("hex")}`;
}
export function isOwner(cookie: string | undefined | null) {
  try {
    const token = cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(COOKIE + "="))
      ?.slice(COOKIE.length + 1);
    if (!token) return false;
    const [exp, nonce, sig] = token.split(".");
    const expected = createHmac("sha256", secret())
      .update(`${exp}.${nonce}`)
      .digest("hex");
    return (
      Number(exp) > Date.now() &&
      sig?.length === expected.length &&
      timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}
export function sameOrigin(origin: string | null | undefined) {
  if (origin === process.env.APP_ORIGIN) return true;
  return (
    process.env.VERCEL === "1" &&
    !!origin &&
    [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].some(
      (host) => host && origin === `https://${host}`,
    )
  );
}
export class Limiter {
  private hits = new Map<string, { n: number; end: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  reset(key: string) {
    this.hits.delete(key);
  }
  allow(key: string) {
    const now = Date.now();
    if (this.hits.size > 10000)
      for (const [k, v] of this.hits) if (v.end < now) this.hits.delete(k);
    const hit = this.hits.get(key);
    if (!hit || hit.end < now) {
      if (this.hits.size > 20000) return false;
      this.hits.set(key, { n: 1, end: now + this.windowMs });
      return true;
    }
    return ++hit.n <= this.max;
  }
}
