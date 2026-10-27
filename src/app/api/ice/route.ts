import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { isOwner } from "@/lib/server/auth";
import { distributedRooms } from "@/lib/server/distributed-rooms";
import { rooms } from "@/lib/server/rooms";
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (
    !isOwner(req.headers.get("cookie")) &&
    !(process.env.ROOM_BACKEND === "redis"
      ? await distributedRooms().hasToken(token)
      : rooms.hasToken(token))
  )
    return new Response("Não autorizado", { status: 401 });
  const iceServers: RTCIceServer[] = [
    { urls: process.env.STUN_URL || "stun:stun.l.google.com:19302" },
  ];
  if (process.env.TURN_URLS && process.env.TURN_SHARED_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:bomber`;
    const credential = createHmac("sha1", process.env.TURN_SHARED_SECRET)
      .update(username)
      .digest("base64");
    iceServers.push({
      urls: process.env.TURN_URLS.split(","),
      username,
      credential,
    });
  }
  return Response.json(
    { iceServers },
    { headers: { "Cache-Control": "no-store" } },
  );
}
