import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";

// Fixtures are private, ordinary Snes9x saves made through the game's menus.
// No cheats, ROM modifications, or writes to game RAM are used. Reading the
// original game's coordinates proves movement, beyond merely tracing API calls.
const enabled = process.env.TEST_GAMEPLAY === "1";
const paths = ["Direita", "Esquerda", "Esquerda", "Direita", "Cima"];
const bits = [7, 6, 6, 7, 4];
async function coordinates(host: Page) {
  return host.locator("iframe").evaluate((node) => {
    const w = (node as HTMLIFrameElement).contentWindow as any;
    const state: Uint8Array = w.__bomber.save();
    const header = new TextEncoder().encode("RAM:131072:");
    let start = -1;
    outer: for (let i = 0; i < state.length - header.length; i++) {
      for (let k = 0; k < header.length; k++) if (state[i + k] !== header[k]) continue outer;
      start = i + header.length; break;
    }
    if (start < 0) throw Error("Snapshot SNES sem bloco RAM conhecido");
    return Array.from({ length: 5 }, (_, p) => ({ x: state[start + 1375 + 2 * p], y: state[start + 1471 + 2 * p] }));
  });
}
async function loop(host: Page, running: boolean) {
  await host.locator("iframe").evaluate((node, running) => {
    ((node as HTMLIFrameElement).contentWindow as any).EJS_emulator.gameManager.toggleMainLoop(running ? 1 : 0);
  }, running);
}
async function picture(host: Page) {
  return Buffer.from(await host.locator("iframe").evaluate(async (node) => {
    const g = ((node as HTMLIFrameElement).contentWindow as any).EJS_emulator.gameManager;
    try { g.FS.unlink("/screenshot.png"); } catch {}
    g.toggleMainLoop(1);
    const png = await g.screenshot();
    g.toggleMainLoop(0);
    return Array.from(png) as number[];
  }));
}
function assertMoved(before: Awaited<ReturnType<typeof coordinates>>, after: Awaited<ReturnType<typeof coordinates>>, slot: number) {
  const delta = slot === 4 ? before[slot].y - after[slot].y : (after[slot].x - before[slot].x) * (slot === 0 || slot === 3 ? 1 : -1);
  expect(delta, `personagem ${slot + 1} precisa andar na direção enviada`).toBeGreaterThanOrEqual(5);
}
async function newBombPixels(before: Buffer, after: Buffer, position: { x: number; y: number }) {
  const a = await sharp(before).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(after).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(a.info.width).toBe(256); expect(b.info.width).toBe(256);
  const blue = (data: Buffer, i: number) => data[i + 2] > 50 && data[i + 2] > data[i] + 20 && data[i + 2] > data[i + 1] + 12;
  let count = 0;
  for (let y = position.y - 20; y < position.y + 4; y++) for (let x = position.x - 8; x < position.x + 8; x++) {
    const i = (y * 256 + x) * 3;
    if (blue(b.data, i) && !blue(a.data, i)) count++;
  }
  return count;
}

for (const count of [3, 4, 5]) test(`${count} humanos na arena: movimento e bombas pelo WebRTC, independência e simultaneidade`, async ({ browser, baseURL }, info) => {
  test.skip(!enabled, "TEST_GAMEPLAY=1 usa ROM original e checkpoints privados obtidos pelos menus.");
  test.setTimeout(240000);
  const fixturePath = `.private/multitap/battle${count}.state`;
  await access(fixturePath);
  const metadata = JSON.parse(await readFile(".private/multitap/fixtures.json", "utf8"));
  expect(createHash("sha256").update(await readFile(process.env.TEST_ROM_PATH!)).digest("hex")).toBe(metadata.romSha256);
  const fixture = [...await readFile(fixturePath)];
  const contexts: BrowserContext[] = [];
  try {
    const hc = await browser.newContext({ hasTouch: true, viewport: { width: 900, height: 900 } }); contexts.push(hc);
    await hc.addInitScript(() => localStorage.setItem("bomber.touch", "on"));
    const auth = await hc.request.post(`${baseURL}/api/auth`, { headers: { Origin: baseURL! }, data: { password: await readFile(".private/local-owner-password", "utf8") } });
    expect(auth.ok()).toBe(true);
    const host = await hc.newPage(); await host.goto("/");
    await host.getByRole("button", { name: "M Proprietário Acesso privado", exact: true }).click();
    await expect(host.getByText("Importar ROM (.sfc, 2 MB)")).toBeVisible();
    await host.getByRole("button", { name: "Fechar janela", exact: true }).click();
    await host.getByRole("button", { name: "＋ Criar sala", exact: true }).click();
    await host.getByRole("button", { name: "Jogar como Matheus", exact: true }).click();
    await host.getByRole("button", { name: "Criar e receber código", exact: true }).click();
    const code = (await host.locator("button.code").innerText()).slice(0, 6);
    const pages = [host];
    for (let slot = 1; slot < count; slot++) {
      const context = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } }); contexts.push(context);
      const page = await context.newPage(); pages.push(page);
      await page.goto(`/?sala=${code}`);
      await page.getByLabel("Seu apelido", { exact: true }).fill(`Teste ${slot + 1}`);
      await page.getByRole("button", { name: "Entrar na sala", exact: true }).click();
    }
    await expect(host.getByText(`NA SALA · ${count}/5`)).toBeVisible();
    await host.getByRole("button", { name: "Iniciar partida", exact: true }).click();
    await host.waitForFunction(() => !!(document.querySelector("iframe")?.contentWindow as any)?.__bomber, {}, { timeout: 60000 });
    await loop(host, false);
    await host.locator("iframe").evaluate((node) => {
      const w = (node as HTMLIFrameElement).contentWindow as any;
      w.__gameplayMasks = [0, 0, 0, 0, 0];
      const original = w.__bomber.input;
      w.__bomber.input = (p: number, b: number, v: number) => {
        w.__gameplayMasks[p] = v ? w.__gameplayMasks[p] | (1 << b) : w.__gameplayMasks[p] & ~(1 << b);
        original(p, b, v);
      };
    });
    for (const page of pages.slice(1)) await expect(page.getByText(/controles conectados|Conectado/, { exact: false }).first()).toBeVisible({ timeout: 30000 });
    const sessions = await Promise.all(pages.map((p) => p.context().newCDPSession(p)));
    const points: { x: number; y: number }[][] = [];
    for (const [slot, page] of pages.entries()) {
      const root = page.getByRole("group", { name: "Controle de toque", exact: true });
      await root.scrollIntoViewIfNeeded();
      const xy = [];
      for (const label of [paths[slot], "A"]) {
        const box = await root.getByRole("button", { name: label, exact: true }).boundingBox();
        expect(box).not.toBeNull(); xy.push({ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
      }
      points.push(xy);
    }
    const masks = () => host.locator("iframe").evaluate((node) => ((node as HTMLIFrameElement).contentWindow as any).__gameplayMasks as number[]);
    const start = (slot: number) => sessions[slot].send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points[slot].map((p, id) => ({ id, ...p })) });
    const end = (slot: number) => sessions[slot].send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const reset = async () => {
      await loop(host, false);
      await host.locator("iframe").evaluate((node, data) => ((node as HTMLIFrameElement).contentWindow as any).__bomber.load(new Uint8Array(data)), fixture);
    };
    const trials: unknown[] = [];
    for (let slot = 0; slot < count; slot++) {
      await reset();
      const before = await coordinates(host), beforeImage = await picture(host);
      await start(slot);
      await expect.poll(async () => (await masks())[slot]).toBe((1 << bits[slot]) | (1 << 8));
      await loop(host, true); await host.waitForTimeout(250); await loop(host, false);
      await end(slot); await expect.poll(async () => (await masks())[slot]).toBe(0);
      const after = await coordinates(host), afterImage = await picture(host);
      await info.attach(`controle-${slot + 1}`, { body: afterImage, contentType: "image/png" });
      assertMoved(before, after, slot);
      for (let other = 0; other < count; other++) if (other !== slot) expect(after[other], `controle ${slot + 1} não move ${other + 1}`).toEqual(before[other]);
      const bombPixels = await newBombPixels(beforeImage, afterImage, before[slot]);
      expect(bombPixels, `bomba visível no local de origem do personagem ${slot + 1}`).toBeGreaterThanOrEqual(8);
      trials.push({ slot, before: before.slice(0, count), after: after.slice(0, count), bombPixels });
    }
    await reset(); const before = await coordinates(host), beforeImage = await picture(host);
    for (let slot = 0; slot < count; slot++) await start(slot);
    await expect.poll(async () => (await masks()).slice(0, count)).toEqual(bits.slice(0, count).map((bit) => (1 << bit) | (1 << 8)));
    await loop(host, true); await host.waitForTimeout(250); await loop(host, false);
    for (let slot = 0; slot < count; slot++) await end(slot);
    await expect.poll(async () => (await masks()).slice(0, count)).toEqual(Array(count).fill(0));
    const after = await coordinates(host), afterImage = await picture(host);
    for (let slot = 0; slot < count; slot++) {
      assertMoved(before, after, slot);
      expect(await newBombPixels(beforeImage, afterImage, before[slot])).toBeGreaterThanOrEqual(8);
    }
    await loop(host, true); await host.waitForTimeout(250); await loop(host, false);
    expect((await coordinates(host)).slice(0, count)).toEqual(after.slice(0, count));
    await info.attach("simultâneos", { body: afterImage, contentType: "image/png" });
    await info.attach("movimentos-observados", { body: JSON.stringify({ count, trials, simultaneous: { before, after } }, null, 2), contentType: "application/json" });
  } finally { await Promise.allSettled(contexts.map((c) => c.close())); }
});
