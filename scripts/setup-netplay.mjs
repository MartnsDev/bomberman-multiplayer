import { cp, readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const manifest = JSON.parse(
  await readFile("assets/emulation-netplay/five-inputs.json", "utf8"),
);
await cp("public/emulatorjs", "public/netplay-emulatorjs", { recursive: true });
for (const [path, entry] of Object.entries(manifest.files)) {
  const data = await readFile(
    `assets/emulation-netplay/${path.split("/").at(-1)}`,
  );
  if (createHash("sha256").update(data).digest("hex") !== entry.sha256)
    throw Error(`Core netplay corrompido: ${path}`);
  await writeFile(`public/netplay-emulatorjs/${path}`, data);
}
const report = JSON.parse(
  await readFile("public/netplay-emulatorjs/cores/reports/snes9x.json", "utf8"),
);
report.buildStart = `${manifest.id}#${manifest.files["cores/snes9x-legacy-wasm.data"].sha256}`;
await writeFile(
  "public/netplay-emulatorjs/cores/reports/snes9x.json",
  JSON.stringify(report),
);
await mkdir("public/netplay-emulatorjs/source", { recursive: true });
for (const file of [
  "build-five-player-core.mjs",
  "wasm-input-patch.mjs",
  "emulator-assets.lock.json",
])
  await cp(`scripts/${file}`, `public/netplay-emulatorjs/source/${file}`);
await cp(
  "assets/emulation-netplay/README.md",
  "public/netplay-emulatorjs/source/README.md",
);
await writeFile(
  "public/netplay-emulatorjs/manifest.json",
  JSON.stringify(manifest),
);
console.log(`Core netplay instalado: ${manifest.id}`);
