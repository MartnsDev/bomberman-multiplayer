import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
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
  expect(p.locator(".netplay-status")).toHaveAttribute(
    "data-phase",
    "running",
    { timeout: 60000 },
  );
async function touch(p: Page, cdp: CDPSession, label?: string) {
  if (!label) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    return;
  }
  const button = p
    .locator(".touch-controls")
    .getByRole("button", { name: label, exact: true });
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw Error("Controle ausente");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 },
    ],
  });
  await expect(button).toHaveAttribute("aria-pressed", "true");
}
async function picture(p: Page) {
  return Buffer.from(
    await p
      .locator("iframe")
      .evaluate(
        (el) =>
          (
            (el as HTMLIFrameElement).contentDocument!.querySelector(
              "canvas[data-local-snes]",
            ) as HTMLCanvasElement
          )
            .toDataURL()
            .split(",")[1],
      ),
    "base64",
  );
}
async function newBombPixels(before: Buffer, after: Buffer) {
  const a = await sharp(before).removeAlpha().raw().toBuffer(),
    b = await sharp(after).removeAlpha().raw().toBuffer();
  const blue = (v: Buffer, i: number) =>
    v[i + 2] > 50 && v[i + 2] > v[i] + 20 && v[i + 2] > v[i + 1] + 12;
  let changed = 0;
  for (let y = 184; y < 208; y++)
    for (let x = 216; x < 232; x++) {
      const i = (y * 256 + x) * 3;
      if (blue(b, i) && !blue(a, i)) changed++;
    }
  return changed;
}
test("arena real: saída durante negociação não pausa os demais e não solta o controle mantido", async ({
  browser,
}, info) => {
  test.skip(!process.env.TEST_ROM_PATH, "Forneça a cópia do jogo");
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
  const devices: CDPSession[] = [],
    errors: string[] = [];
  try {
    for (const p of pages) {
      const cdp = await p.context().newCDPSession(p);
      devices.push(cdp);
      await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await p.addInitScript(() => {
        (window as any).__offerFailures = 0;
        (window as any).__pendingOffers = 0;
        (window as any).__snapshots = [];
        window.addEventListener(
          "pointerdown",
          (e) => {
            (window as any).__pointerId = e.pointerId;
          },
          true,
        );
        const Native = window.RTCPeerConnection;
        const offer = Native.prototype.createOffer as (
          options?: RTCOfferOptions,
        ) => Promise<RTCSessionDescriptionInit>;
        Native.prototype.createOffer = async function (
          this: RTCPeerConnection,
          options?: RTCOfferOptions,
        ) {
          const description = await offer.call(this, options);
          if ((window as any).__failNextOffer) {
            (window as any).__failNextOffer = false;
            (window as any).__offerFailures++;
            throw new DOMException(
              "Injected negotiation interruption",
              "InvalidStateError",
            );
          }
          if ((window as any).__delayNextOffer) {
            (window as any).__delayNextOffer = false;
            (window as any).__pendingOffers++;
            await new Promise((r) => setTimeout(r, 2000));
            (window as any).__pendingOffers--;
            if (this.signalingState === "closed")
              throw new DOMException(
                "Closed during negotiation",
                "InvalidStateError",
              );
          }
          return description;
        } as typeof Native.prototype.createOffer;
        const original = RTCDataChannel.prototype.send;
        RTCDataChannel.prototype.send = function (data: any) {
          if (
            typeof data === "string" &&
            data.startsWith('{"type":"snapshot",')
          ) {
            const p = JSON.parse(data);
            (window as any).__snapshots.push({
              size: p.size,
              rawSize: p.rawSize,
              encoding: p.encoding,
            });
          }
          const probe = (window as any).__flow;
          if (probe && typeof data === "string") {
            const p = JSON.parse(data);
            if (p.type === "commit" && probe.masks.at(-1)?.frame !== p.frame) {
              probe.masks.push({ frame: p.frame, masks: p.masks });
              if (probe.masks.length > 300) probe.masks.shift();
            }
          }
          return original.call(this, data);
        };
        function watch(now: number) {
          const probe = (window as any).__flow,
            core = (
              document.querySelector("iframe") as HTMLIFrameElement | null
            )?.contentWindow as any;
          if (probe && core?.__bomberNetplay) {
            const f = core.__bomberNetplay.frame();
            if (f < probe.previous) probe.regressions++;
            if (f !== probe.previous) {
              probe.maxGap = Math.max(probe.maxGap, now - probe.last);
              probe.last = now;
              probe.previous = f;
            }
            const phase = (
              document.querySelector(".netplay-status") as HTMLElement | null
            )?.dataset.phase;
            if (phase && phase !== "running" && !probe.phases.includes(phase))
              probe.phases.push(phase);
          }
          requestAnimationFrame(watch);
        }
        requestAnimationFrame(watch);
      });
      p.on("pageerror", (e) => {
        if (!e.message.includes("Wake Lock")) errors.push(e.message);
      });
    }
    const [h, g, t] = pages;
    await h.goto("/");
    await h.getByRole("button", { name: "＋ Criar sala", exact: true }).click();
    await h.getByLabel("Seu apelido", { exact: true }).fill("Anfitrião");
    await h
      .getByRole("button", { name: "Criar e receber código", exact: true })
      .click();
    const code = (await h.locator("button.code").innerText()).slice(0, 6);
    for (const [i, p] of [g, t].entries()) {
      await p.goto(`/?sala=${code}`);
      await p.getByLabel("Seu apelido", { exact: true }).fill(`Amigo ${i + 1}`);
      await p
        .getByRole("button", { name: "Entrar na sala", exact: true })
        .click();
      await expect(h.getByText(`NA SALA · ${i + 2}/5`)).toBeVisible();
    }
    for (const p of pages)
      await p
        .getByLabel("Importar ROM local", { exact: true })
        .setInputFiles(process.env.TEST_ROM_PATH!);
    await expect(
      h.getByRole("button", { name: "Iniciar partida", exact: true }),
    ).toBeEnabled({ timeout: 90000 });
    await h
      .getByRole("button", { name: "Iniciar partida", exact: true })
      .click();
    for (const p of pages) await running(p);
    if (
      (await h.locator(".play-surface").getAttribute("data-expanded")) ===
      "true"
    )
      await h
        .getByRole("button", { name: "Sair da tela cheia", exact: true })
        .click();
    const state = (await readFile("tests/fixtures/battle5.state")).toString(
      "base64",
    );
    const restore = async () => {
      await h.evaluate(async (encoded) => {
        const raw = atob(encoded),
          bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("keyval-store");
          open.onsuccess = () => {
            const db = open.result,
              tx = db.transaction("keyval", "readwrite");
            tx.objectStore("keyval").put(bytes, "bomber.netplay.snes9x.v1");
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        });
      }, state);
      await h
        .getByRole("button", { name: "Restaurar para todos", exact: true })
        .click();
      for (const p of pages) await running(p);
      await expect.poll(() => frame(h)).toBeGreaterThan(20);
    };
    // Both edges in one task reproduce taps queued during a busy animation frame.
    for (let trial = 0; trial < 3; trial++) {
      await restore();
      const before = await picture(h);
      await g.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyX" }));
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyX" }));
        window.dispatchEvent(
          new KeyboardEvent("keydown", { code: "ArrowLeft" }),
        );
      });
      const start = await frame(h);
      await expect.poll(() => frame(h)).toBeGreaterThan(start + 45);
      await g.evaluate(() =>
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowLeft" })),
      );
      expect(
        await newBombPixels(before, await picture(h)),
        `bomba rápida ${trial}`,
      ).toBeGreaterThan(5);
    }
    await restore();
    await touch(g, devices[1], "Esquerda");
    // Simulate the bubbling loss from the child while capture is on the pad root.
    expect(
      await g.evaluate(() =>
        document
          .querySelector(".touch-controls")!
          .hasPointerCapture((window as any).__pointerId),
      ),
    ).toBe(true);
    await g
      .locator(".touch-controls")
      .getByRole("button", { name: "Esquerda", exact: true })
      .evaluate((el) =>
        el.dispatchEvent(
          new PointerEvent("lostpointercapture", {
            pointerId: (window as any).__pointerId,
            bubbles: true,
          }),
        ),
      );
    await expect(
      g.getByRole("button", { name: "Esquerda", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await g.evaluate(() => {
      const native = navigator.getGamepads.bind(navigator);
      (window as any).__restorePads = native;
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => [
          {
            buttons: Array.from({ length: 16 }, (_, i) => ({
              pressed: i === 0,
            })),
            axes: [0, 0],
          },
        ],
      });
      window.dispatchEvent(new Event("gamepadconnected"));
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => [],
      });
      window.dispatchEvent(new Event("gamepaddisconnected"));
    });
    const settled = await frame(h);
    await expect.poll(() => frame(h)).toBeGreaterThan(settled + 35);
    const delay = await h
      .locator(".netplay-status")
      .getAttribute("data-input-delay");
    for (const p of [h, g])
      await p.evaluate(() => {
        const core = (document.querySelector("iframe") as HTMLIFrameElement)
          .contentWindow as any;
        (window as any).__flow = {
          previous: core.__bomberNetplay.frame(),
          last: performance.now(),
          maxGap: 0,
          regressions: 0,
          phases: [],
          masks: [],
        };
      });
    await h.evaluate(() => {
      (window as any).__failNextOffer = true;
    });
    await t.reload();
    await expect
      .poll(() => h.evaluate(() => (window as any).__offerFailures))
      .toBe(1);
    await running(t);
    await h.evaluate(() => {
      (window as any).__delayNextOffer = true;
    });
    await t.reload();
    await expect
      .poll(() => h.evaluate(() => (window as any).__pendingOffers), {
        timeout: 30000,
      })
      .toBeGreaterThan(0);
    await t.getByRole("button", { name: "Sair da sala", exact: true }).click();
    await expect
      .poll(() => h.evaluate(() => (window as any).__pendingOffers))
      .toBe(0);
    await t
      .getByRole("button", { name: "Entrar em sala ↗", exact: true })
      .click();
    await t.getByLabel("Seu apelido", { exact: true }).fill("Amigo 2");
    await t
      .getByRole("button", { name: "Entrar na sala", exact: true })
      .click();
    await running(t);
    const leaving = await frame(h);
    await t.close();
    await expect
      .poll(() => frame(h), { timeout: 15000 })
      .toBeGreaterThan(leaving + 160);
    const metrics = [];
    for (const p of [h, g]) {
      const probe = await p.evaluate(() => (window as any).__flow);
      metrics.push({
        maxGap: probe.maxGap,
        regressions: probe.regressions,
        phases: probe.phases,
      });
      expect(probe.maxGap).toBeLessThan(250);
      expect(probe.regressions).toBe(0);
      expect(probe.phases).toEqual([]);
      await running(p);
      expect(
        await p.locator(".netplay-status").getAttribute("data-corrections"),
      ).toBe("0");
    }
    const masks = await h.evaluate(() => (window as any).__flow.masks);
    expect(masks.length).toBeGreaterThan(120);
    expect(masks.every((p: any) => p.masks[1] === 64)).toBe(true);
    expect(
      await h.locator(".netplay-status").getAttribute("data-input-delay"),
    ).toBe(delay);
    await touch(g, devices[1]);
    const release = await frame(h);
    await expect.poll(() => frame(h)).toBeGreaterThan(release + 40);
    expect(
      await h.evaluate(() =>
        (window as any).__flow.masks
          .slice(-15)
          .every((p: any) => p.masks[1] === 0),
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    const snapshots = await h.evaluate(() => (window as any).__snapshots);
    expect(
      snapshots.some(
        (s: any) => s.encoding === "gzip" && s.size < s.rawSize / 2,
      ),
    ).toBe(true);
    console.log(
      "ISOLATION_METRICS",
      JSON.stringify({ frames: metrics, snapshots }),
    );
    await info.attach("arena-sem-pausa", {
      body: await h.screenshot(),
      contentType: "image/png",
    });
  } catch (error) {
    for (const [i, p] of pages.entries())
      if (!p.isClosed())
        console.log(
          "ISOLATION_FAILURE",
          i,
          (await p.locator("body").innerText()).slice(-5000),
        );
    throw error;
  } finally {
    for (const c of contexts) await c.close();
  }
});
