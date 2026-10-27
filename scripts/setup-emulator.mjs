import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = "https://cdn.emulatorjs.org/4.2.3/data/";
const files = [
  "loader.js",
  "emulator.min.js",
  "emulator.min.css",
  "cores/snes9x-wasm.data",
  "cores/snes9x-legacy-wasm.data",
  "compression/extract7z.js",
  "cores/reports/snes9x.json",
  "localization/pt-BR.json",
];
const expected = JSON.parse(
  await readFile(
    new URL("./emulator-assets.lock.json", import.meta.url),
    "utf8",
  ),
);
const manifest = {};
const patch = JSON.parse(
  await readFile("assets/emulation/five-inputs.json", "utf8"),
);
for (const path of files) {
  const res = await fetch(base + path);
  if (!res.ok) throw Error(`${path}: ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const hash = createHash("sha256").update(data).digest("hex");
  if (hash !== expected[path])
    throw Error(
      `Checksum divergente: ${path}. Nenhum arquivo será executado; confira a distribuição oficial antes de atualizar o lock.`,
    );
  await mkdir(
    `public/emulatorjs/${path.substring(0, path.lastIndexOf("/") + 1)}`,
    { recursive: true },
  );
  let installed = data;
  if (patch.files[path]) {
    if (patch.files[path].upstream !== hash)
      throw Error(`Base incompatível: ${path}`);
    installed = await readFile(`assets/emulation/${path.split("/").at(-1)}`);
    if (
      createHash("sha256").update(installed).digest("hex") !==
      patch.files[path].sha256
    )
      throw Error(`Patch de controles corrompido: ${path}`);
  } else if (path === "cores/reports/snes9x.json") {
    // EmulatorJS's own IndexedDB cache is separate from our service worker.
    // Its revision is buildStart: invalidate official four-input cached cores.
    const report = JSON.parse(data.toString("utf8"));
    installed = Buffer.from(JSON.stringify({ ...report,
      upstreamBuildStart: report.buildStart,
      buildStart: `${report.buildStart}#${patch.id}`,
      inputDriverPatch: patch.id,
    }));
  }
  await writeFile(`public/emulatorjs/${path}`, installed);
  manifest[path] = createHash("sha256").update(installed).digest("hex");
  console.log(`Instalado: ${path} (${installed.length} bytes)`);
}
await mkdir("public/emulatorjs/source", { recursive: true });
for (const name of [
  "build-five-player-core.mjs",
  "wasm-input-patch.mjs",
  "emulator-assets.lock.json",
])
  await writeFile(
    `public/emulatorjs/source/${name}`,
    await readFile(`scripts/${name}`),
  );
await writeFile(
  "public/emulatorjs/source/README.md",
  await readFile("assets/emulation/README.md"),
);
await writeFile(
  "public/emulatorjs/source/five-inputs.json",
  JSON.stringify(patch, null, 2),
);
await writeFile(
  "public/emulatorjs/manifest.json",
  JSON.stringify(
    { version: "4.2.3", inputDriverPatch: patch.id, sha256: manifest },
    null,
    2,
  ),
);
