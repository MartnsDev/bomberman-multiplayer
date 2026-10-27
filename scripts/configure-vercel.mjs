// Run only after the owner explicitly approves transferring these credentials.
// All values travel on stdin to Vercel Secret variables, never CLI arguments/logs.
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { parse } from "dotenv";
const local = parse(await readFile(".env.local", "utf8"));
const cli = process.env.VERCEL_CLI_PATH;
if (!cli) throw Error("Defina VERCEL_CLI_PATH com o caminho do CLI instalado.");
const values = {
  APP_ORIGIN:
    process.env.DEPLOY_ORIGIN || "https://bomberman-online.vercel.app",
  OWNER_PASSWORD_HASH: local.OWNER_PASSWORD_HASH,
  SESSION_SECRET: local.SESSION_SECRET,
  ROM_SHA256: local.ROM_SHA256,
  ROM_STORAGE: "vercel-blob",
  ROOM_BACKEND: "redis",
  MAX_PLAYERS: "5",
  STUN_URL: local.STUN_URL || "stun:stun.l.google.com:19302",
};
for (const key of ["TURN_URLS", "TURN_SHARED_SECRET"])
  if (local[key]) values[key] = local[key];
for (const [key, value] of Object.entries(values)) {
  if (!value) throw Error(`Falta configurar ${key}`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, "env", "add", key, "production", "--sensitive", "--force", "--yes"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stdin.end(value);
    child.stdout.resume();
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`Não foi possível configurar ${key} (código ${code})`)),
    );
  });
  console.log(`${key}: configurado em produção`);
}
