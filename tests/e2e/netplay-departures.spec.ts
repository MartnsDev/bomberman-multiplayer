import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { readFile } from "node:fs/promises";
const rom = process.env.TEST_ROM_PATH;
const frame = (p: Page) =>
  p
    .locator("iframe")
    .evaluate(
      (el) =>
        (
          (el as HTMLIFrameElement).contentWindow as any
        ).__bomberNetplay.frame() as number,
    );
const running = (p: Page) =>
  expect(
    p.getByText("Emulação local sincronizada.", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
const verified = (p: Page) =>
  p.locator(".netplay-status").getAttribute("data-verified-frame").then(Number);

async function press(p: Page, cdp: CDPSession, down: boolean) {
  if (!down) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    return;
  }
  const b = p
    .locator(".touch-controls")
    .getByRole("button", { name: "Cima", exact: true });
  await b.scrollIntoViewIfNeeded();
  const box = await b.boundingBox();
  if (!box) throw Error("Direcional ausente");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 },
    ],
  });
  await expect(b).toHaveAttribute("aria-pressed", "true");
}
async function received(p: Page, slot: number, mask: number) {
  const start = await frame(p);
  await expect.poll(() => frame(p)).toBeGreaterThan(start + 45);
  await expect
    .poll(() =>
      p.evaluate(
        ({ slot, mask }) => {
          const samples = (window as any).__controlSamples as number[][];
          return (
            samples.length >= 10 &&
            samples.slice(-10).every((m) => m[slot] === mask)
          );
        },
        { slot, mask },
      ),
    )
    .toBe(true);
}
async function probeControls(p: Page, cdp: CDPSession, slot: number) {
  await press(p, cdp, true);
  await received(p, slot, 16);
  await press(p, cdp, false);
  await received(p, slot, 0);
}

test("instalação prévia, convidado recarrega e coordenador sai sem encerrar a partida", async ({
  browser,
  baseURL,
}, info) => {
  test.skip(!rom, "Requer cópia privada do jogo.");
  test.setTimeout(240000);
  const contexts = await Promise.all(
    [0, 1, 2].map((i) =>
      browser.newContext({
        viewport: { width: i ? 390 : 1100, height: 900 },
        hasTouch: true,
        isMobile: !!i,
      }),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const devices: CDPSession[] = [];
  const requests: string[] = [],
    errors: string[] = [];
  for (const p of pages) {
    const device = await p.context().newCDPSession(p);
    devices.push(device);
    await device.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await p.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        raf(function resume(now) {
          if ((window as any).__freezeGame) {
            raf(resume);
            return;
          }
          callback(now);
        });
      window.addEventListener("bomber-netplay-ready", () => {
        const core = (document.querySelector("iframe") as HTMLIFrameElement)
          .contentWindow as any;
        const original = core.__bomberNetplay.step.bind(core.__bomberNetplay);
        (window as any).__controlSamples = [];
        core.__bomberNetplay.step = (masks: number[]) => {
          const result = original(masks);
          const samples = (window as any).__controlSamples as number[][];
          samples.push([...masks]);
          if (samples.length > 120) samples.shift();
          return result;
        };
      });
      const Native = window.RTCPeerConnection;
      (window as any).__departurePCs = [];
      window.RTCPeerConnection = class extends Native {
        constructor(config?: RTCConfiguration) {
          super(config);
          (window as any).__departurePCs.push(this);
        }
      };
    });
    p.on("pageerror", (e) => {
      if (!e.message.includes("Wake Lock")) errors.push(e.message);
    });
    p.on("request", (r) => {
      if (r.url().includes("/api/rom")) requests.push(r.url());
    });
  }
  const [h, g, t] = pages;
  try {
    if (process.env.TEST_PUBLIC_HOST !== "1")
      expect(
        (
          await contexts[0].request.post(`${baseURL}/api/auth`, {
            headers: { Origin: baseURL! },
            data: {
              password: (
                await readFile(".private/local-owner-password", "utf8")
              ).trim(),
            },
          })
        ).status(),
      ).toBe(200);
    const manifest = await (
      await contexts[1].request.get(`${baseURL}/manifest.webmanifest`)
    ).json();
    expect(manifest.display).toBe("standalone");
    for (const icon of manifest.icons)
      expect(
        (await contexts[1].request.get(`${baseURL}${icon.src}`)).status(),
      ).toBe(200);
    // Install before entering any room, then reload: no second file selection.
    for (const p of pages) {
      await p.goto("/");
      await p
        .getByText("Instalar o jogo neste aparelho", { exact: true })
        .click();
      await p
        .getByLabel("Importar ROM local", { exact: true })
        .setInputFiles(rom!);
      await expect(
        p.getByText("Jogo instalado e verificado.", { exact: false }),
      ).toBeVisible();
      await p.reload();
      await expect(
        p.getByText("Jogo instalado neste aparelho", { exact: true }),
      ).toBeVisible();
    }
    await h.getByRole("button", { name: "＋ Criar sala", exact: true }).click();
    await h.getByLabel("Seu apelido", { exact: true }).fill("Matheus");
    await h
      .getByRole("button", { name: "Criar e receber código", exact: true })
      .click();
    const code = (await h.locator("button.code").innerText()).slice(0, 6);
    for (const [i, p] of [g, t].entries()) {
      await p.goto(`/?sala=${code}`);
      await p
        .getByLabel("Seu apelido", { exact: true })
        .fill(i ? "Gu" : "Gabi");
      await p
        .getByRole("button", { name: "Entrar na sala", exact: true })
        .click();
      await expect(h.getByText(`NA SALA · ${i + 2}/5`)).toBeVisible();
    }
    await expect(
      h.getByRole("button", { name: "Iniciar partida", exact: true }),
    ).toBeEnabled({ timeout: 90000 });
    await h
      .getByRole("button", { name: "Iniciar partida", exact: true })
      .click();
    for (const p of pages) await running(p);
    await expect
      .poll(() => verified(h), { timeout: 30000 })
      .toBeGreaterThanOrEqual(120);
    // Detect any reset or new preparation in survivors while the third reloads.
    for (const p of [h, g])
      await p.evaluate(() => {
        (window as any).__survivorPaused = false;
        new MutationObserver(() => {
          const text = document.querySelector(
            ".netplay-status > span",
          )?.textContent;
          if (text && text !== "Emulação local sincronizada.")
            (window as any).__survivorPaused = true;
        }).observe(document.querySelector(".netplay-status")!, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
    const before = await frame(h);
    await t.reload();
    await expect
      .poll(() => frame(h), { timeout: 15000 })
      .toBeGreaterThan(before + 150);
    await running(t);
    const joined = await frame(t);
    await expect
      .poll(() => verified(h), { timeout: 30000 })
      .toBeGreaterThan(joined);
    for (const p of [h, g])
      expect(await p.evaluate(() => (window as any).__survivorPaused)).toBe(
        false,
      );
    for (const p of pages)
      expect(
        await p.locator(".netplay-status").getAttribute("data-corrections"),
      ).toBe("0");
    const backgroundGuest = await frame(h);
    await t.evaluate(() => {
      (window as any).__freezeGame = true;
    });
    const parkedGuest = await frame(t);
    await expect
      .poll(() => frame(h), { timeout: 15000 })
      .toBeGreaterThan(backgroundGuest + 150);
    expect(await frame(t)).toBe(parkedGuest);
    await t.evaluate(() => {
      (window as any).__freezeGame = false;
    });
    await running(t);
    await expect
      .poll(() => verified(h), { timeout: 30000 })
      .toBeGreaterThan(await frame(t));
    // An explicit leave removes the reserved slot immediately. The other guest
    // must keep its existing channel and continue with the original coordinator.
    if (
      (await t.locator(".play-surface").getAttribute("data-expanded")) ===
      "true"
    )
      await t
        .getByRole("button", { name: "Sair da tela cheia", exact: true })
        .click();
    const explicitLeave = await frame(g);
    await t.getByRole("button", { name: "Sair da sala", exact: true }).click();
    await expect
      .poll(() => frame(g), { timeout: 15000 })
      .toBeGreaterThan(explicitLeave + 150);
    for (const p of [h, g])
      expect(await p.evaluate(() => (window as any).__survivorPaused)).toBe(
        false,
      );
    await probeControls(g, devices[1], 1);
    await t
      .getByRole("button", { name: "Entrar em sala ↗", exact: true })
      .click();
    await t.getByLabel("Seu apelido", { exact: true }).fill("Gu");
    await t
      .getByRole("button", { name: "Entrar na sala", exact: true })
      .click();
    await running(t);
    await expect
      .poll(() => verified(h), { timeout: 30000 })
      .toBeGreaterThan(await frame(t));
    // Close the original coordinator. The next player keeps its original pad.
    await press(g, devices[1], true);
    await received(g, 1, 16);
    const handoff = await frame(g);
    await h.close();
    await expect(
      g.getByRole("button", { name: "Salvar progresso", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    for (const p of [g, t]) await running(p);
    await expect
      .poll(() => frame(g), { timeout: 30000 })
      .toBeGreaterThan(handoff + 180);
    await expect
      .poll(() => verified(g), { timeout: 30000 })
      .toBeGreaterThan(handoff + 120);
    await expect(
      g.getByText("Controle 2 · Emulação local", { exact: true }),
    ).toBeVisible();
    await expect(
      t.getByText("Controle 3 · Emulação local", { exact: true }),
    ).toBeVisible();
    expect((await contexts[1].request.get(`${baseURL}/api/rom`)).status()).toBe(
      401,
    );
    await received(g, 1, 16);
    await received(t, 1, 16);
    await press(g, devices[1], false);
    await received(t, 1, 0);
    await probeControls(g, devices[1], 1);
    await probeControls(t, devices[2], 2);
    // Announced backgrounding yields the coordinator before the browser freezes.
    await g.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await g.evaluate(() => {
      (window as any).__freezeGame = true;
    });
    await expect(
      t.getByRole("button", { name: "Salvar progresso", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const backgroundHost = await frame(t);
    await expect
      .poll(() => frame(t), { timeout: 15000 })
      .toBeGreaterThan(backgroundHost + 150);
    await g.evaluate(() => {
      (window as any).__freezeGame = false;
      delete (document as any).hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await running(g);
    await expect
      .poll(() => verified(t), { timeout: 30000 })
      .toBeGreaterThan(await frame(g));
    await probeControls(g, devices[1], 1);
    await probeControls(t, devices[2], 2);
    // An abrupt freeze keeps RTC open: healthy peers must still elect a host.
    const frozenCoordinator = await frame(g);
    await t.evaluate(() => {
      (window as any).__freezeGame = true;
    });
    await expect(
      g.getByRole("button", { name: "Salvar progresso", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => frame(g), { timeout: 15000 })
      .toBeGreaterThan(frozenCoordinator + 150);
    await t.evaluate(() => {
      (window as any).__freezeGame = false;
    });
    await running(t);
    await expect
      .poll(async () => Math.abs((await frame(g)) - (await frame(t))), {
        timeout: 30000,
      })
      .toBeLessThanOrEqual(4);
    await expect
      .poll(() => verified(g), { timeout: 30000 })
      .toBeGreaterThan(await frame(t));
    // Losing only RTC must also elect a coordinator while WebSockets stay up.
    const rtcHandoff = await frame(t);
    await g.evaluate(() => {
      for (const pc of (window as any).__departurePCs as RTCPeerConnection[])
        if (pc.connectionState === "connected") pc.close();
    });
    await expect(
      t.getByRole("button", { name: "Salvar progresso", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    for (const p of [g, t]) await running(p);
    await expect
      .poll(() => verified(t), { timeout: 30000 })
      .toBeGreaterThan(rtcHandoff + 120);
    await probeControls(g, devices[1], 1);
    await probeControls(t, devices[2], 2);
    // An ordinary leave also releases its pad; the remaining player advances.
    if (
      (await g.locator(".play-surface").getAttribute("data-expanded")) ===
      "true"
    )
      await g
        .getByRole("button", { name: "Sair da tela cheia", exact: true })
        .click();
    const leaveFrame = await frame(t);
    await g.getByRole("button", { name: "Sair da sala", exact: true }).click();
    await expect
      .poll(() => frame(t), { timeout: 15000 })
      .toBeGreaterThan(leaveFrame + 150);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    await info.attach("coordenacao-transferida", {
      body: await g.screenshot(),
      contentType: "image/png",
    });
    await info.attach("terceiro-continua", {
      body: await t.screenshot(),
      contentType: "image/png",
    });
    console.log("DEPARTURES_OK", {
      before,
      joined,
      handoff,
      backgroundGuest,
      backgroundHost,
      frozenCoordinator,
      rtcHandoff,
      touchPressReleaseAfterHandoffs: true,
      heldTouchSurvivedCreatorExit: true,
      final: await frame(t),
      verified: await verified(t),
    });
  } catch (e) {
    for (const [i, p] of pages.entries())
      if (!p.isClosed())
        console.log(
          "DEPARTURE_FAILURE",
          i,
          (await p.locator("body").innerText()).slice(-6500),
        );
    throw e;
  } finally {
    for (const c of contexts) await c.close();
  }
});
