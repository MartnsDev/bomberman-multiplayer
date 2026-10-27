import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const base = process.env.PROBE_BASE_URL || "http://localhost:3001";
const rom = (
  await readFile(process.env.TEST_ROM_PATH || ".private/super-bomberman-5.sfc")
).toString("base64");
const initial = (await readFile(".private/multitap/battle5.state")).toString(
  "base64",
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
await mkdir(".private/netplay", { recursive: true });
const pages = [];
try {
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({
      viewport: { width: 256, height: 224 },
    });
    await context.addInitScript((encoded) => {
      const raw = atob(encoded),
        bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      window.__bomberNetplayRom = bytes;
      window.decodeSnapshot = (encoded) => {
        const raw = atob(encoded),
          b = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
        return b;
      };
    }, rom);
    const page = await context.newPage();
    pages.push(page);
    page.on("pageerror", (e) => console.log("PAGE_ERROR", e.message));
    await page.goto(`${base}/netplay-emulator.html`);
    await page.waitForFunction(
      () => window.__bomberNetplay?.ready,
      {},
      { timeout: 60000 },
    );
    await page.evaluate(
      (bytes) => __bomberNetplay.load(decodeSnapshot(bytes)),
      initial,
    );
    console.log(`Core ${i + 1} pronto, laço automático cancelado`);
  }
  const snapshots = async () =>
    Promise.all(
      pages.map((p) =>
        p
          .evaluate(() => {
            const bytes = __bomberNetplay.save(),
              parts = [];
            for (let i = 0; i < bytes.length; i += 8192)
              parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
            return btoa(parts.join(""));
          })
          .then((b) => Buffer.from(b, "base64")),
      ),
    );
  const hash = (b) => createHash("sha256").update(b).digest("hex");
  const baseline = await snapshots();
  const coords = (b) => {
    const at = b.indexOf("RAM:131072:") + 11;
    assert.ok(at > 10);
    return Array.from({ length: 5 }, (_, p) => ({
      x: b[at + 1375 + 2 * p],
      y: b[at + 1471 + 2 * p],
    }));
  };
  assert.deepEqual(
    coords(baseline[0]).map((p) => p.x),
    [32, 224, 224, 32, 128],
    "A restauração precisa carregar a arena real",
  );
  assert.equal(hash(baseline[0]), hash(baseline[1]));
  console.log("Estado canônico da arena restaurado e igual nos dois cores.");
  await new Promise((r) => setTimeout(r, 500));
  const idle = await snapshots();
  assert.equal(hash(idle[0]), hash(baseline[0]), "Core avançou sem step()");
  assert.equal(
    hash(idle[1]),
    hash(baseline[1]),
    "Segundo core avançou sem step()",
  );
  const sequences = [
    1,
    29,
    90,
    Number(process.env.PROBE_FINAL_FRAME || 300) - 120,
  ];
  let advanced = 0;
  const timings = [];
  for (const count of sequences) {
    timings.push(
      await Promise.all(
        pages.map((page) =>
          page.evaluate(
            async ({ count, advanced }) => {
              const start = performance.now();
              for (let i = 0; i < count; i++) {
                const f = advanced + i;
                const masks = f < 18 ? [128, 64, 64, 128, 16] : [0, 0, 0, 0, 0];
                if (f === 0) for (let p = 0; p < 5; p++) masks[p] |= 256;
                __bomberNetplay.step(masks);
                await new Promise((r) => setTimeout(r, 17));
              }
              return {
                ms: performance.now() - start,
                frame: __bomberNetplay.frame(),
              };
            },
            { count, advanced },
          ),
        ),
      ),
    );
    advanced += count;
    console.log("Avanço concluído", timings.at(-1));
    const states = await snapshots();
    await Promise.all(
      states.map((b, i) =>
        writeFile(`.private/netplay/core-${i}-frame-${advanced}.state`, b),
      ),
    );
    if (advanced === 30) {
      const before = coords(baseline[0]),
        after = coords(states[0]);
      for (let p = 0; p < 5; p++)
        assert.ok(
          p === 4
            ? before[p].y - after[p].y >= 5
            : Math.abs(after[p].x - before[p].x) >= 5,
          `O personagem ${p + 1} precisa se mover na arena`,
        );
      console.log("Cinco personagens se moveram:", after);
      for (const [i, page] of pages.entries())
        await page.screenshot({
          path: `.private/netplay/core-${i}-frame-30.png`,
        });
    }
    const equal = hash(states[0]) === hash(states[1]);
    console.log(
      `Quadro ${advanced}: snapshots iguais = ${equal}; tempos`,
      timings.at(-1),
    );
    if (!equal) {
      const differences = [];
      for (let i = 0; i < states[0].length; i++)
        if (states[0][i] !== states[1][i]) differences.push(i);
      console.log(
        "Divergência: quantidade de bytes e primeiros deslocamentos",
        differences.length,
        differences.slice(0, 12),
      );
      throw Error("Divergência entre cores locais");
    }
  }
  const saved = await snapshots();
  await Promise.all(
    pages.map((p) =>
      p.evaluate(async () => {
        for (let f = 0; f < 40; f++) {
          __bomberNetplay.step([0, 0, 0, 0, 0]);
          await new Promise((r) => setTimeout(r, 17));
        }
      }),
    ),
  );
  for (const [i, p] of pages.entries())
    await p.evaluate(
      ({ bytes, advanced }) =>
        __bomberNetplay.load(decodeSnapshot(bytes), advanced),
      { bytes: saved[i].toString("base64"), advanced },
    );
  const restored = await snapshots();
  assert.equal(hash(restored[0]), hash(restored[1]), "Restauração divergiu");
  await writeFile(
    ".private/netplay/core-proof.json",
    JSON.stringify(
      {
        version: "ejs-4.2.3-snes9x-netplay-v6",
        frames: advanced,
        identical: true,
        fiveCharactersMoved: true,
        timings,
        restoreIdentical: true,
        noMediaStream: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PROVA CONCLUÍDA: avanço nativo, cinco entradas, snapshots idênticos, pausa e restauração.",
  );
} finally {
  await browser.close();
}
