import { randomBytes, scryptSync, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question(
  "Defina uma senha exclusiva (mínimo 12 caracteres; entrada visível neste terminal): ",
);
rl.close();
if (password.length < 12) throw Error("Senha muito curta");
const salt = randomBytes(16).toString("hex");
let env = await readFile(".env.example", "utf8");
env = env
  .replace(
    "OWNER_PASSWORD_HASH=",
    `OWNER_PASSWORD_HASH=${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  )
  .replace(
    "SESSION_SECRET=",
    `SESSION_SECRET=${randomBytes(48).toString("hex")}`,
  );
let rom;
if (process.argv[2]) {
  rom = await readFile(process.argv[2]);
  if (![2097152, 2097664].includes(rom.length))
    throw Error("A ROM precisa ter 2 MB, com cabeçalho opcional de 512 bytes.");
  env = env.replace(
    "ROM_SHA256=",
    `ROM_SHA256=${createHash("sha256").update(rom).digest("hex")}`,
  );
}
await writeFile(".env.local", env, { flag: "wx", mode: 0o600 });
await mkdir(".private", { recursive: true, mode: 0o700 });
await writeFile(".private/local-owner-password", password, { mode: 0o600 });
await chmod(".private/local-owner-password", 0o600);
if (rom)
  await writeFile(".private/super-bomberman-5.sfc", rom, { mode: 0o600 });
console.log(
  ".env.local criado. Senha salva somente em .private/local-owner-password.",
);
console.log(
  rom
    ? "Biblioteca local do proprietário preparada."
    : "Importe a ROM pela administração.",
);
