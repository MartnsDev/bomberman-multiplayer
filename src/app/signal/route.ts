import { upgradeWebSocket, waitUntil } from "@vercel/functions";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { WebSocket } from "ws";
import { commandSchema, type ServerEvent } from "@/lib/protocol";
import { isOwner, Limiter, sameOrigin } from "@/lib/server/auth";
import { distributedLimit } from "@/lib/server/redis";
import {
  RoomClosedError,
  distributedRooms,
  type DistributedClient,
} from "@/lib/server/distributed-rooms";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (process.env.ROOM_BACKEND !== "redis")
    return new Response("Use o servidor Node local.", { status: 426 });
  if (!sameOrigin(req.headers.get("origin")))
    return new Response(null, { status: 403 });
  const ip =
    req.headers.get("x-vercel-forwarded-for") ??
    req.headers.get("x-forwarded-for")?.split(",")[0] ??
    "unknown";
  if (!(await distributedLimit(`connect:${ip}`, 40, 60)))
    return new Response(null, { status: 429 });
  return upgradeWebSocket(
    (ws) => {
      const rooms = distributedRooms();
      let stopped = false;
      let queue = Promise.resolve();
      const budget = new Limiter(120, 1000);
      const send = (event: ServerEvent) => {
        if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1048576)
          ws.send(JSON.stringify(event));
      };
      const client: DistributedClient = {
        owner: isOwner(req.headers.get("cookie")),
        connection: randomUUID(),
        send,
        cursor: "0-0",
      };
      send({ type: "welcome", resumableHost: true });
      ws.on("message", (data, binary) => {
        if (binary || !budget.allow("messages")) {
          ws.close(1008, "Limite de mensagens");
          return;
        }
        queue = queue.then(async () => {
          try {
            const msg = commandSchema.parse(JSON.parse(data.toString()));
            if (msg.type === "signal" && (!client.code || !client.ready))
              return;
            if (
              ["join", "create", "resume"].includes(msg.type) &&
              !(await distributedLimit(`join:${ip}`, 20, 60))
            )
              throw Error("Muitas tentativas. Aguarde um minuto.");
            client.owner = isOwner(req.headers.get("cookie"));
            await rooms.handle(client, msg);
          } catch (error) {
            if (error instanceof RoomClosedError) {
              client.ready = false;
              client.code = undefined;
              client.id = undefined;
              send({ type: "closed", message: error.message });
              return;
            }
            send({
              type: "error",
              message:
                error instanceof Error && !("issues" in error)
                  ? error.message
                  : "Mensagem inválida.",
            });
          }
        });
      });
      const poll = async () => {
        if (stopped) return;
        try {
          await rooms.poll(client);
        } catch {
          send({
            type: "error",
            message: "Falha temporária na sinalização. Reconectando…",
          });
          ws.close(1012, "Tente novamente");
        }
        if (!stopped) timer = setTimeout(poll, 1000);
      };
      let timer = setTimeout(poll, 500);
      const heartbeat = setInterval(() => {
        queue = queue
          .then(() => rooms.heartbeat(client))
          .catch(() => {
            send({
              type: "closed",
              message: "A sala expirou ou o anfitrião se desconectou.",
            });
            ws.close(1000);
          });
      }, 10000);
      ws.on("close", () => {
        stopped = true;
        clearTimeout(timer);
        clearInterval(heartbeat);
        waitUntil(queue.then(() => rooms.disconnect(client)).catch(() => {}));
      });
      ws.on("error", () => {});
    },
    { maxPayload: 65536 },
  );
}
