import { distributedLimit, redis } from "@/lib/server/redis";
import { NextRequest, NextResponse } from "next/server";
import {
  COOKIE,
  isOwner,
  issueSession,
  Limiter,
  sameOrigin,
  verifyPassword,
} from "@/lib/server/auth";
const limiter = new Limiter(8, 15 * 60000);
export async function GET(req: NextRequest) {
  return NextResponse.json(
    { owner: isOwner(req.headers.get("cookie")) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: NextRequest) {
  if (!sameOrigin(req.headers.get("origin")))
    return new Response("Origem recusada", { status: 403 });
  const allowed =
    process.env.ROOM_BACKEND === "redis"
      ? await distributedLimit("owner-login", 8, 900)
      : limiter.allow("owner-login");
  if (!allowed)
    return new Response("Muitas tentativas. Aguarde 15 minutos.", {
      status: 429,
    });
  try {
    const { password } = await req.json();
    if (
      typeof password !== "string" ||
      password.length > 256 ||
      !verifyPassword(password)
    )
      return new Response("Senha inválida", { status: 401 });
    limiter.reset("owner-login");
    if (process.env.ROOM_BACKEND === "redis")
      await redis().del("bmr:rate:owner-login");
    const res = NextResponse.json({ owner: true });
    res.cookies.set(COOKIE, issueSession(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 43200,
      path: "/",
    });
    return res;
  } catch {
    return new Response("Configure a autenticação no servidor.", {
      status: 503,
    });
  }
}
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req.headers.get("origin")))
    return new Response(null, { status: 403 });
  const res = NextResponse.json({ owner: false });
  res.cookies.delete(COOKIE);
  return res;
}
