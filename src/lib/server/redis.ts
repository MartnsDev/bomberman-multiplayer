import { Redis } from "@upstash/redis";
let client: Redis | undefined;
export function redis() {
  return (client ??= new Redis({
    url:
      process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "",
    token:
      process.env.KV_REST_API_TOKEN ||
      process.env.UPSTASH_REDIS_REST_TOKEN ||
      "",
    automaticDeserialization: false,
  }));
}
export async function distributedLimit(
  key: string,
  max: number,
  seconds: number,
) {
  const count = await redis().eval<unknown[], number>(
    `local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n`,
    [`bmr:rate:${key}`],
    [seconds],
  );
  return count <= max;
}
