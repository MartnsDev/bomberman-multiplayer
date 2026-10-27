// Interactive private core inspection. JSON lines: [{wait:1000},{b:3,p:0,ms:100}].
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
});
const context = await browser.newContext();
const page = await context.newPage();
const res = await context.request.post("http://localhost:3000/api/auth", {
  headers: { Origin: "http://localhost:3000" },
  data: { password: await readFile(".private/local-owner-password", "utf8") },
});
if (!res.ok()) throw Error("Login recusado");
await page.goto("http://localhost:3000/emulator.html");
await page.waitForFunction(() => !!window.__bomber, {}, { timeout: 60000 });
if (process.argv.includes("--restore")) {
  const data = await readFile(".private/live.state");
  await page.evaluate(
    (s) => window.__bomber.load(new Uint8Array(s)),
    [...data],
  );
}
await page.evaluate(() => window.EJS_emulator.gameManager.toggleMainLoop(0));
console.log("Core pronto. Envie comandos JSON.");
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const commands = JSON.parse(line);
    await page.evaluate(() =>
      window.EJS_emulator.gameManager.toggleMainLoop(1),
    );
    for (const c of commands) {
      if (c.wait) {
        await page.waitForTimeout(c.wait);
        continue;
      }
      await page.evaluate((c) => window.__bomber.input(c.p ?? 0, c.b, 1), c);
      await page.waitForTimeout(c.ms ?? 120);
      await page.evaluate((c) => window.__bomber.input(c.p ?? 0, c.b, 0), c);
      await page.waitForTimeout(350);
    }
    const data = await page.evaluate(async () =>
      Array.from(await window.EJS_emulator.gameManager.screenshot()),
    );
    await page.evaluate(() =>
      window.EJS_emulator.gameManager.toggleMainLoop(0),
    );
    await writeFile(".private/live.png", Buffer.from(data));
    const state = await page.evaluate(() => Array.from(window.__bomber.save()));
    await writeFile(".private/live.state", Buffer.from(state));
    console.log("Captura privada atualizada.");
  } catch {
    console.log("Falha no comando de diagnóstico.");
  }
}
await browser.close();
