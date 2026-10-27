// Reproducible, hash-guarded extension of EmulatorJS's four-controller input
// driver. This changes frontend input bookkeeping, never the ROM/game memory.
// Rebuild: npm install --prefix /tmp/bomber-wabt wabt@1.0.39
// WABT_MODULE=/tmp/bomber-wabt/node_modules/wabt/index.js node scripts/build-five-player-core.mjs
// Requires 7z. Production builds use the checked, prebuilt archives instead.
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { fiveInputPatch } from "./wasm-input-patch.mjs";
const wabt = await (await import(process.env.WABT_MODULE || "wabt")).default();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const lock = JSON.parse(
  await readFile("scripts/emulator-assets.lock.json", "utf8"),
);
const destination = resolve("assets/emulation");
await mkdir(destination, { recursive: true });
const manifest = { id: "ejs-4.2.3-snes9x-five-inputs-v2", files: {} };
for (const variant of ["snes9x-wasm", "snes9x-legacy-wasm"]) {
  const file = `${variant}.data`;
  const original = await readFile(
    `${process.env.CORE_INPUT_DIR || "public/emulatorjs/cores"}/${file}`,
  );
  assert.equal(
    sha(original),
    lock[`cores/${file}`],
    "Rebuild requires the unmodified official core",
  );
  const dir = await mkdtemp(join(tmpdir(), "bomber-five-core-"));
  const archive = join(dir, "original.data");
  await writeFile(archive, original);
  execFileSync("7z", ["x", archive, `-o${dir}/core`, "-y"], {
    stdio: "ignore",
  });
  const core = join(dir, "core");
  const js = await readFile(join(core, "snes9x_libretro.js"), "utf8");
  const exported = (name) => {
    const match = js.match(
      new RegExp(`Module\\["_${name}"\\]=wasmExports\\["([^"]+)"\\]`),
    );
    assert.ok(match, `Missing native export ${name}`);
    return match[1];
  };
  const inputName = exported("simulate_input");
  const clearName = exported("ejs_set_keyboard_enabled");
  const originalWasm = await readFile(join(core, "snes9x_libretro.wasm"));
  console.log(`${variant}: decoding`);
  const module = wabt.readWasm(originalWasm, { readDebugNames: true });
  module.generateNames();
  module.applyNames();
  let wat = module.toText({ foldExprs: false, inlineExport: false });
  module.destroy();
  console.log(`${variant}: locating driver`);
  const functions = [...wat.matchAll(/^  \(func \$(\S+) [\s\S]*?(?=^  \()/gm)];
  const setter = functions.find((f) => f[1] === inputName);
  assert.ok(setter);
  assert.match(
    setter[0],
    /i32\.const 3\s+i32\.gt_u/,
    "Expected four-player upstream guard",
  );
  const keymap = setter[0].match(/i32\.const (\d+)\s+i32\.load/)[1];
  const getters = functions.filter(
    (f) =>
      f[0]
        .split("\n")[0]
        .includes("(param $p0 i32) (param $p1 i32) (result i32)") &&
      f[0].includes(`i32.const ${keymap}\n`),
  );
  assert.equal(getters.length, 1, "Ambiguous input-state function");
  const getter = getters[0];
  assert.match(getter[1], /^f\d+$/);
  const originalModule = await WebAssembly.compile(originalWasm);
  const stubs = {};
  for (const entry of WebAssembly.Module.imports(originalModule))
    (stubs[entry.module] ||= {})[entry.name] = () => 0;
  const originalInstance = await WebAssembly.instantiate(originalModule, stubs);
  const memory = Object.values(originalInstance.exports).find(
    (e) => e instanceof WebAssembly.Memory,
  );
  const messageAddress = Buffer.from(memory.buffer).indexOf(
    "Invalid device (%d).",
  );
  assert.ok(messageAddress > 0);
  const controllers = functions.filter(
    (f) =>
      f[0].includes(`i32.const ${messageAddress}\n`) &&
      f[0].includes("i32.const 257\n"),
  );
  assert.equal(
    controllers.length,
    1,
    "Ambiguous standard libretro controller API",
  );
  assert.match(
    controllers[0][0].split("\n")[0],
    /\(param \$p0 i32\) \(param \$p1 i32\)$/,
  );
  const { patched, testBytes } = fiveInputPatch(
    originalWasm,
    { input: inputName, clear: clearName },
    Number(getter[1].slice(1)),
    Number(controllers[0][1].slice(1)),
  );
  console.log(`${variant}: testing native input`);
  const nativeModule = await WebAssembly.compile(testBytes);
  const imports = {};
  for (const entry of WebAssembly.Module.imports(nativeModule)) {
    assert.equal(entry.kind, "function", "Unexpected native import kind");
    (imports[entry.module] ||= {})[entry.name] = () => 0;
  }
  const { exports: e } = await WebAssembly.instantiate(nativeModule, imports);
  const input = e[inputName],
    state = e.test_input_state;
  console.log(`${variant}: instantiated`);
  for (let p = 0; p < 5; p++)
    for (let b = 0; b < 12; b++) {
      input(p, b, 1);
      for (let other = 0; other < 5; other++)
        assert.equal(state(other, b), other === p ? 1 : 0);
      input(p, b, 0);
      assert.equal(state(p, b), 0);
    }
  for (let p = 0; p < 5; p++) {
    input(p, 0, 1);
    input(p, 7, 1);
  }
  for (let p = 0; p < 5; p++) {
    assert.equal(state(p, 0), 1);
    assert.equal(state(p, 7), 1);
  }
  input(4, 7, 0);
  assert.equal(state(4, 0), 1);
  assert.equal(state(3, 7), 1);
  input(5, 0, 1);
  input(4, 24, 1);
  input(4, -1, 1);
  assert.equal(state(5, 0), 0);
  assert.equal(state(4, 24), 0);
  e[clearName](0);
  for (let p = 0; p < 5; p++)
    for (let b = 0; b < 12; b++) assert.equal(state(p, b), 0);
  console.log(`${variant}: packing`);
  await writeFile(join(core, "snes9x_libretro.wasm"), patched);
  // Expose the existing, unmodified standard libretro device API to the adapter.
  const marker = `var _simulate_input=Module["_simulate_input"]=wasmExports["${inputName}"];`;
  assert.ok(js.includes(marker));
  await writeFile(
    join(core, "snes9x_libretro.js"),
    js.replace(
      marker,
      marker +
        'Module["_retro_set_controller_port_device"]=wasmExports["bomber_set_controller_port_device"];',
    ),
  );
  // Deterministic archive: no timestamps/creation/access dates stored.
  const output = join(destination, file);
  const temporary = join(dir, "patched.data");
  execFileSync(
    "7z",
    [
      "a",
      "-t7z",
      "-mx=9",
      "-mtm=off",
      "-mta=off",
      "-mtc=off",
      temporary,
      "build.json",
      "core.json",
      "license.txt",
      "snes9x_libretro.js",
      "snes9x_libretro.wasm",
    ],
    { cwd: core, stdio: "ignore" },
  );
  const packed = await readFile(temporary);
  await writeFile(output, packed);
  manifest.files[`cores/${file}`] = {
    upstream: sha(original),
    sha256: sha(packed),
    wasm: sha(patched),
    originalWasm: sha(originalWasm),
  };
  console.log(
    `${file}: native tests passed for 5 independent controls; ${packed.length} bytes`,
  );
}
await writeFile(
  join(destination, "five-inputs.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
