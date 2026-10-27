// Private technical probe; no ROM or screenshots are written to public/.
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext();
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log(m.text().slice(0, 250));
});
page.on("pageerror", (e) => console.log(e.message));
const res = await context.request.post("http://localhost:3000/api/auth", {
  headers: { Origin: "http://localhost:3000" },
  data: { password: await readFile(".private/local-owner-password", "utf8") },
});
if (!res.ok()) throw Error("Login recusado");
await page.goto("http://localhost:3000/emulator.html");
await page.waitForFunction(() => !!window.__bomber, {}, { timeout: 60000 });
if (process.argv.includes("--restore")) {
  const state = await readFile(".private/probe.state");
  await page.evaluate(
    (s) => window.__bomber.load(new Uint8Array(s)),
    [...state],
  );
}
let stage = 0;
for (const spec of process.argv.slice(2).filter((s) => !s.startsWith("--"))) {
  const [button, ms = "120", player = "0"] = spec.split(":");
  if (button === "wait") {
    await page.waitForTimeout(Number(ms));
    const shot = await page.evaluate(async () =>
      Array.from(await window.EJS_emulator.gameManager.screenshot()),
    );
    await writeFile(`.private/stage-${stage++}.png`, Buffer.from(shot));
    continue;
  }
  await page.evaluate(
    ([p, b]) => window.__bomber.input(p, b, 1),
    [Number(player), Number(button)],
  );
  await page.waitForTimeout(Number(ms));
  await page.evaluate(
    ([p, b]) => window.__bomber.input(p, b, 0),
    [Number(player), Number(button)],
  );
  await page.waitForTimeout(500);
  const shot = await page.evaluate(async () =>
    Array.from(await window.EJS_emulator.gameManager.screenshot()),
  );
  await writeFile(`.private/stage-${stage++}.png`, Buffer.from(shot));
}
await page.waitForTimeout(Number(process.env.PROBE_WAIT_MS) || 2000);
await page.screenshot({ path: ".private/probe.png" });
const shot = await page.evaluate(async () =>
  Array.from(await window.EJS_emulator.gameManager.screenshot()),
);
await writeFile(".private/core.png", Buffer.from(shot));
const state = await page.evaluate(() => Array.from(window.__bomber.save()));
await writeFile(".private/probe.state", Buffer.from(state));
console.log(
  await page.evaluate(() => ({
    frame: window.__bomber.frame(),
    canvas: !!document.querySelector("canvas"),
    audio: window.__bomber.stream(30).getAudioTracks().length,
  })),
);
await browser.close();
