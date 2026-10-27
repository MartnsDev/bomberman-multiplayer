import "./src/lib/server/environment";
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { commandSchema } from "./src/lib/protocol";
import { isOwner, Limiter, sameOrigin } from "./src/lib/server/auth";
import { rooms, type Client } from "./src/lib/server/rooms";
const dev = process.env.NODE_ENV !== "production";
if (
  !process.env.APP_ORIGIN ||
  !process.env.SESSION_SECRET ||
  !process.env.OWNER_PASSWORD_HASH
)
  throw Error("Execute npm run setup:owner antes de iniciar.");
const localTest = process.env.BOMBER_LOCAL_TEST === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.APP_ORIGIN);
if (!dev && !localTest && !process.env.APP_ORIGIN.startsWith("https://"))
  throw Error("HTTPS é obrigatório em produção.");
// Next owns only framework upgrades; the local game socket must not also be
// handled as an App Router /signal request (which would end its connection).
const frameworkUpgrades = createServer();
const app = next({
  dev,
  httpServer: frameworkUpgrades,
  hostname: localTest ? "127.0.0.1" : "0.0.0.0",
  port: Number(process.env.PORT) || 3000,
});
await app.prepare();
const handler = app.getRequestHandler();
const server = createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), display-capture=()",
  );
  void handler(req, res);
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
const attempts = new Limiter(40, 60000);
const joins = new Limiter(12, 60000);
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/signal") {
    if (dev && req.url?.startsWith("/_next/"))
      frameworkUpgrades.emit("upgrade", req, socket, head);
    else socket.destroy();
    return;
  }
  const ip = req.socket.remoteAddress ?? "unknown";
  if (
    !sameOrigin(req.headers.origin) ||
    !attempts.allow(ip) ||
    wss.clients.size >= 200
  ) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    let alive = true;
    const budget = new Limiter(240, 1000);
    const c: Client = {
      owner: isOwner(req.headers.cookie),
      send: (event) => {
        if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1048576)
          ws.send(JSON.stringify(event));
      },
    };
    c.send({type:"welcome",resumableHost:true});
    ws.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 20000).unref();
    ws.on("message", (data, binary) => {
      try {
        if (binary || !budget.allow("socket"))
          throw Error("Limite de mensagens excedido.");
        const msg = commandSchema.parse(JSON.parse(data.toString()));
        if (
          (msg.type === "join" ||
            msg.type === "create" ||
            msg.type === "resume") &&
          !joins.allow(ip)
        )
          throw Error("Muitas tentativas. Aguarde um minuto.");
        c.owner = isOwner(req.headers.cookie);
        rooms.handle(c, msg);
      } catch (e) {
        c.send({
          type: "error",
          message:
            e instanceof Error && !("issues" in e)
              ? e.message
              : "Mensagem inválida.",
        });
      }
    });
    ws.on("close", () => {
      clearInterval(heartbeat);
      rooms.leave(c);
    });
    ws.on("error", () => {});
  });
});
server.listen(Number(process.env.PORT) || 3000, localTest ? "127.0.0.1" : "0.0.0.0", () =>
  console.log(`Bomberman Online: ${process.env.APP_ORIGIN}`),
);
