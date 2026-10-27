import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
const romPath = process.env.TEST_ROM_PATH;
const publicHost = process.env.TEST_PUBLIC_HOST === "1";
const directions = ["Direita", "Esquerda", "Esquerda", "Direita", "Cima"];
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
async function newBombPixels(
  before: Buffer,
  after: Buffer,
  position: { x: number; y: number },
) {
  const a = await sharp(before).removeAlpha().raw().toBuffer(),
    b = await sharp(after).removeAlpha().raw().toBuffer();
  const blue = (data: Buffer, i: number) =>
    data[i + 2] > 50 &&
    data[i + 2] > data[i] + 20 &&
    data[i + 2] > data[i + 1] + 12;
  let changed = 0;
  for (let y = position.y - 20; y < position.y + 4; y++)
    for (let x = position.x - 8; x < position.x + 8; x++) {
      const i = (y * 256 + x) * 3;
      if (blue(b, i) && !blue(a, i)) changed++;
    }
  return changed;
}
async function frame(p: Page) {
  return p
    .locator("iframe")
    .evaluate(
      (el) =>
        (
          (el as HTMLIFrameElement).contentWindow as any
        ).__bomberNetplay.frame() as number,
    );
}
async function positions(p: Page) {
  return p.locator("iframe").evaluate((el) => {
    const b: Uint8Array = (
      (el as HTMLIFrameElement).contentWindow as any
    ).__bomberNetplay.save();
    const marker = new TextEncoder().encode("RAM:131072:");
    let at = -1;
    for (let i = 0; i < b.length - marker.length; i++) {
      if (marker.every((v, n) => v === b[i + n])) {
        at = i + marker.length;
        break;
      }
    }
    if (at < 0) throw Error("RAM block missing");
    return Array.from({ length: 5 }, (_, i) => ({
      x: b[at + 1375 + i * 2],
      y: b[at + 1471 + i * 2],
    }));
  });
}
async function touch(p: Page, cdp: CDPSession, labels: string[]) {
  if (!labels.length) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    return;
  }
  await p.locator(".touch-controls").scrollIntoViewIfNeeded();
  const points = [];
  for (const [id, label] of labels.entries()) {
    const b = await p
      .locator(".touch-controls")
      .getByRole("button", { name: label, exact: true })
      .boundingBox();
    if (!b) throw Error("Touch control invisible");
    points.push({ id: id + 1, x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points,
  });
}
for (const count of [2, 3, 4, 5])
  test(`${count} participantes: personagens exclusivos e bombas por toque em emuladores locais`, async ({
    browser,
    baseURL,
  }, info) => {
    test.skip(!romPath, "Forneça a ROM original privada.");
    test.setTimeout(240000);
    const contexts = [],
      pages: Page[] = [],
      cdps: CDPSession[] = [];
    const failures: string[] = [];
    const diagnostics = await browser.newBrowserCDPSession();
    await diagnostics.send("Target.setDiscoverTargets", { discover: true });
    diagnostics.on("Target.targetCrashed", (data) =>
      console.log("NATIVE_CRASH", data),
    );
    try {
      for (let i = 0; i < count; i++) {
        const c = await browser.newContext({
          viewport: {
            width: i === 0 ? 1000 : 390,
            height: i === 0 ? 950 : 844,
          },
          hasTouch: true,
          isMobile: i !== 0,
        });
        contexts.push(c);
        await c.addInitScript(() => {
          try {
            localStorage.setItem("bomber.touch", "on");
          } catch {}
          const Native = window.RTCPeerConnection;
          (window as any).__netplayPCs = [];
          window.RTCPeerConnection = class extends Native {
            constructor(config?: RTCConfiguration) {
              super(config);
              (window as any).__netplayPCs.push(this);
            }
          };
        });
        if (i === 0 && !publicHost) {
          const r = await c.request.post(`${baseURL}/api/auth`, {
            headers: { Origin: baseURL! },
            data: {
              password: (
                await readFile(".private/local-owner-password", "utf8")
              ).trim(),
            },
          });
          expect(r.status()).toBe(200);
        }
        const p = await c.newPage();
        pages.push(p);
        const device = await c.newCDPSession(p);
        // These contexts represent separate physical devices, each with its
        // own foreground window; they must not compete for one desktop focus.
        await device.send("Emulation.setFocusEmulationEnabled", {
          enabled: true,
        });
        cdps.push(device);
        p.on("pageerror", (e) => {
          if (!e.message.includes("Wake Lock")) failures.push(e.message);
        });
      }
      const h = pages[0];
      await h.goto("/netplay-lab");
      await expect(
        h.getByRole("button", {
          name: publicHost
            ? "Área do proprietário Entrar na administração"
            : "M Proprietário Acesso privado",
          exact: true,
        }),
      ).toBeVisible();
      await h
        .getByRole("button", { name: "＋ Criar sala", exact: true })
        .click();
      await h.getByLabel("Seu apelido", { exact: true }).fill("Matheus");
      await h
        .getByRole("button", { name: "Criar e receber código", exact: true })
        .click();
      const code = (await h.locator("button.code").innerText()).slice(0, 6);
      // All participants join before installing: membership stabilizes first.
      for (let i = 1; i < count; i++) {
        const p = pages[i];
        await p.goto(`/netplay-lab?sala=${code}`);
        await p
          .getByLabel("Seu apelido", { exact: true })
          .fill(["Matheus", "Gabi", "Gu", "Helo", "Amigo"][i]);
        await p
          .getByRole("button", { name: "Entrar na sala", exact: true })
          .click();
        await expect(h.getByText(`NA SALA · ${i + 1}/5`)).toBeVisible();
      }
      for (const p of pages)
        await p
          .getByLabel("Importar ROM local", { exact: true })
          .setInputFiles(romPath!);
      await expect(
        h.getByRole("button", { name: "Iniciar partida", exact: true }),
      ).toBeEnabled({ timeout: 90000 });
      await h
        .getByRole("button", { name: "Iniciar partida", exact: true })
        .click();
      for (const p of pages)
        await expect(
          p.getByText("Emulação local sincronizada.", { exact: true }),
        ).toBeVisible({ timeout: 30000 });
      const fixture = (
        await readFile(".private/multitap/battle5.state")
      ).toString("base64");
      const restore = async () => {
        if (
          (await h.locator(".play-surface").getAttribute("data-expanded")) ===
          "true"
        )
          await h
            .getByRole("button", { name: "Sair da tela cheia", exact: true })
            .click();
        await h.evaluate(async (encoded) => {
          const text = atob(encoded),
            b = new Uint8Array(text.length);
          for (let i = 0; i < b.length; i++) b[i] = text.charCodeAt(i);
          await new Promise<void>((resolve, reject) => {
            const r = indexedDB.open("keyval-store");
            r.onsuccess = () => {
              const db = r.result,
                tx = db.transaction("keyval", "readwrite");
              tx.objectStore("keyval").put(b, "bomber.netplay.snes9x.v1");
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => reject(tx.error);
            };
            r.onerror = () => reject(r.error);
          });
        }, fixture);
        await h
          .getByRole("button", { name: "Restaurar para todos", exact: true })
          .click();
        for (const p of pages)
          await expect(
            p.getByText("Emulação local sincronizada.", { exact: true }),
          ).toBeVisible({ timeout: 30000 });
        await expect.poll(() => frame(h)).toBeGreaterThan(10);
      };
      const trials = [];
      if (count === 3 && process.env.TEST_MOBILE_CONTROLS === "1") {
        const p = pages[2],
          cdp = cdps[2];
        if (
          (await p.locator(".play-surface").getAttribute("data-expanded")) ===
          "true"
        )
          await p
            .getByRole("button", { name: "Sair da tela cheia", exact: true })
            .click();
        for (const [width, height] of [
          [320, 568],
          [390, 844],
          [844, 390],
        ]) {
          await p.setViewportSize({ width, height });
          await p
            .locator(".toolbar")
            .getByRole("button", { name: "Tela cheia", exact: true })
            .click();
          await expect(p.locator(".play-surface")).toHaveAttribute(
            "data-expanded",
            "true",
          );
          expect(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          ).toBe(true);
          for (const button of await p.locator(".touch-button").all()) {
            const box = await button.boundingBox();
            expect(box!.width).toBeGreaterThanOrEqual(43.9);
            expect(box!.height).toBeGreaterThanOrEqual(43.9);
            expect(box!.x).toBeGreaterThanOrEqual(-1);
            expect(box!.y).toBeGreaterThanOrEqual(-1);
            expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
            expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
          }
          const ratio = await p.locator("iframe").evaluate((el) => {
            const r = (el as HTMLIFrameElement)
              .contentDocument!.querySelector("canvas[data-local-snes]")!
              .getBoundingClientRect();
            return r.width / r.height;
          });
          expect(ratio).toBeCloseTo(4 / 3, 2);
          if (width > height) {
            const iframe = await p.locator("iframe").boundingBox(),
              system = await p.locator(".touch-system").boundingBox();
            const bottom = await p
              .locator("iframe")
              .evaluate(
                (el) =>
                  (el as HTMLIFrameElement)
                    .contentDocument!.querySelector("canvas[data-local-snes]")!
                    .getBoundingClientRect().bottom,
              );
            expect(iframe!.y + bottom).toBeLessThanOrEqual(system!.y + 1);
          }
          await touch(p, cdp, ["Direita", "A"]);
          await expect(p.locator(".touch-a")).toHaveAttribute(
            "aria-pressed",
            "true",
          );
          await expect(
            p.getByRole("button", { name: "Direita", exact: true }),
          ).toHaveAttribute("aria-pressed", "true");
          await p.evaluate(() => window.dispatchEvent(new Event("resize")));
          await expect(p.locator(".touch-a")).toHaveAttribute(
            "aria-pressed",
            "true",
          );
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchCancel",
            touchPoints: [],
          });
          await expect(
            p.locator('.touch-button[aria-pressed="true"]'),
          ).toHaveCount(0);
          const screen = await p.locator(".screen").boundingBox(),
            x = screen!.x + screen!.width / 2,
            y = screen!.y + screen!.height / 2;
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
              { id: 1, x: x - 20, y },
              { id: 2, x: x + 20, y },
            ],
          });
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
              { id: 1, x: x - 60, y },
              { id: 2, x: x + 60, y },
            ],
          });
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          expect(await p.evaluate(() => visualViewport?.scale ?? 1)).toBe(1);
          await p.screenshot({
            path: `test-results/mobile-controls-${width}.png`,
          });
          await p
            .getByRole("button", { name: "Sair da tela cheia", exact: true })
            .click();
        }
        await p.setViewportSize({ width: 390, height: 844 });
        await p.evaluate(() => {
          (window as any).__capture = HTMLElement.prototype.setPointerCapture;
          HTMLElement.prototype.setPointerCapture = () => {
            throw new DOMException("Cancelled pointer", "NotFoundError");
          };
        });
        await touch(p, cdp, ["A"]);
        await touch(p, cdp, []);
        await expect(
          p.locator('.touch-button[aria-pressed="true"]'),
        ).toHaveCount(0);
        await p.evaluate(() => {
          HTMLElement.prototype.setPointerCapture = (window as any).__capture;
        });
        await touch(p, cdp, ["A"]);
        await expect(p.locator(".touch-a")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await touch(p, cdp, []);
      }
      for (let slot = 0; slot < count; slot++) {
        await restore();
        const before = await positions(h);
        await touch(pages[slot], cdps[slot], [directions[slot]]);
        await expect(
          pages[slot]
            .locator(".touch-controls")
            .getByRole("button", { name: directions[slot], exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        if (slot === 1) {
          await pages[slot]
            .locator("iframe")
            .evaluate((el) =>
              (el as HTMLIFrameElement).contentWindow!.dispatchEvent(
                new Event("blur"),
              ),
            );
          await expect(
            pages[slot]
              .locator(".touch-controls")
              .getByRole("button", { name: directions[slot], exact: true }),
          ).toHaveAttribute("aria-pressed", "true");
        }
        // Count the hold after the gesture has actually started. Scrolling and
        // dispatching it can itself take many frames with five emulators.
        const f = await frame(h);
        await expect.poll(() => frame(h)).toBeGreaterThan(f + 28);
        await touch(pages[slot], cdps[slot], []);
        const released = await frame(h);
        await expect.poll(() => frame(h)).toBeGreaterThan(released + 10);
        const after = await positions(h);
        for (let s = 0; s < 5; s++) {
          const delta =
            Math.abs(after[s].x - before[s].x) +
            Math.abs(after[s].y - before[s].y);
          if (s === slot)
            expect(delta, `P${s + 1} precisa se mover`).toBeGreaterThanOrEqual(
              5,
            );
          else
            expect(
              delta,
              `P${s + 1} não pode responder ao controle ${slot + 1}`,
            ).toBe(0);
        }
        trials.push({ slot: slot + 1, before, after });
      }
      await restore();
      const before = await positions(h),
        f = await frame(h),
        beforePicture = await picture(h);
      if (count === 3)
        await pages[2].locator("iframe").evaluate((el) => {
          const w = (el as HTMLIFrameElement).contentWindow as any;
          w.__earlierNetplaySnapshot = w.__bomberNetplay.save();
        });
      await Promise.all(
        pages.map((p, s) => touch(p, cdps[s], [directions[s], "A"])),
      );
      await expect.poll(() => frame(h)).toBeGreaterThan(f + 30);
      await Promise.all(pages.map((p, s) => touch(p, cdps[s], [])));
      const after = await positions(h);
      for (let s = 0; s < count; s++)
        expect(
          Math.abs(after[s].x - before[s].x) +
            Math.abs(after[s].y - before[s].y),
        ).toBeGreaterThanOrEqual(5);
      const afterPicture = await picture(h),
        bombPixels = [];
      for (let s = 0; s < count; s++) {
        const pixels = await newBombPixels(
          beforePicture,
          afterPicture,
          before[s],
        );
        expect(pixels, `Bomba visível do P${s + 1}`).toBeGreaterThan(3);
        bombPixels.push(pixels);
      }
      for (const [i, p] of pages.entries()) {
        await expect(p.locator("video")).toHaveCount(0);
        expect(
          await p.evaluate(() =>
            (window as any).__netplayPCs
              .filter(
                (pc: RTCPeerConnection) => pc.connectionState === "connected",
              )
              .every((pc: RTCPeerConnection) => pc.getSenders().length === 0),
          ),
        ).toBe(true);
        const png = await p
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
          );
        await info.attach(`arena-local-P${i + 1}`, {
          body: Buffer.from(png, "base64"),
          contentType: "image/png",
        });
        await mkdir(".private/netplay", { recursive: true });
        await writeFile(
          `.private/netplay/network-${count}-P${i + 1}.png`,
          Buffer.from(png, "base64"),
        );
      }
      await expect
        .poll(
          async () =>
            Number(
              await h
                .locator(".netplay-status")
                .getAttribute("data-verified-frame"),
            ),
          { timeout: 30000 },
        )
        .toBeGreaterThanOrEqual(240);
      for (const p of pages)
        expect(
          await p.locator(".netplay-status").getAttribute("data-corrections"),
        ).toBe("0");
      if (count === 3 && process.env.TEST_MOBILE_CONTROLS === "1") {
        await pages[2].locator("iframe").evaluate(async (el) => {
          await (
            (el as HTMLIFrameElement).contentWindow as any
          ).EJS_emulator.Module.AL.currentCtx.audioCtx.suspend();
        });
        const muted = await frame(h);
        await expect.poll(() => frame(h)).toBeGreaterThan(muted + 150);
        for (const p of pages)
          expect(
            await p.locator(".netplay-status").getAttribute("data-corrections"),
          ).toBe("0");
      }
      for (const p of pages) {
        await p
          .locator(
            (await p.locator(".play-surface").getAttribute("data-expanded")) ===
              "true"
              ? ".fullscreen-tools"
              : ".toolbar",
          )
          .getByRole("button", { name: "Ativar áudio", exact: true })
          .click();
        await expect
          .poll(
            () =>
              p.locator("iframe").evaluate((el) => {
                const al = ((el as HTMLIFrameElement).contentWindow as any)
                  .EJS_emulator.Module.AL;
                const peak = Math.max(
                  0,
                  ...Object.values(al.buffers).map((entry: any) => {
                    if (!entry.audioBuf) return 0;
                    const pcm = entry.audioBuf.getChannelData(0);
                    let peak = 0;
                    for (let i = 0; i < pcm.length; i++)
                      peak = Math.max(peak, Math.abs(pcm[i]));
                    return peak;
                  }),
                );
                return (
                  al.currentCtx.audioCtx.state === "running" && peak > 0.001
                );
              }),
            { timeout: 10000 },
          )
          .toBe(true);
      }
      const metrics = await Promise.all(
        pages.map((p) => p.locator(".netplay-status").innerText()),
      );
      await writeFile(
        `.private/netplay/network-${count}.json`,
        JSON.stringify(
          {
            participants: count,
            transport: "actual WebRTC ordered DataChannel, no media",
            arena: "original save, five MAN; unused pads remain idle",
            input: "real CDP touch events",
            trials,
            simultaneous: { before, after, bombPixels },
            localAudio: true,
            metrics,
          },
          null,
          2,
        ),
      );
      if (count === 3 && process.env.TEST_NETPLAY_RESILIENCE === "1") {
        const guest = pages[2];
        const deliveryDelay =
          process.env.TEST_MOBILE_NETWORK === "1" ? 160 : 40;
        // Emulate an ordered reliable channel's delayed delivery/retransmission;
        // this does not claim to drop real UDP packets at the network interface.
        await guest.evaluate((deliveryDelay) => {
          (window as any).__netplayDeliveryDelay = deliveryDelay;
          const original = RTCDataChannel.prototype.send;
          let nextDue = 0,
            loss = true;
          RTCDataChannel.prototype.send = function (data: any) {
            const now = performance.now(),
              isInput =
                typeof data === "string" && JSON.parse(data).type === "input";
            const extra = loss && isInput ? 220 : 0;
            if (extra) loss = false;
            nextDue = Math.max(
              now + (window as any).__netplayDeliveryDelay + extra,
              nextDue,
            );
            setTimeout(() => {
              if (this.readyState === "open") original.call(this, data);
            }, nextDue - now);
          };
        }, deliveryDelay);
        const delayedStart = await frame(h);
        await expect
          .poll(() => frame(h), { timeout: 30000 })
          .toBeGreaterThan(
            delayedStart +
              (process.env.TEST_MOBILE_NETWORK === "1" ? 480 : 240),
          );
        if (process.env.TEST_MOBILE_NETWORK === "1") {
          for (const p of pages)
            await expect
              .poll(async () =>
                Number(
                  (await p.locator(".netplay-status").innerText()).match(
                    /Atraso automático: (\d+)/,
                  )?.[1] ?? 0,
                ),
              )
              .toBeGreaterThanOrEqual(12);
          await expect
            .poll(async () =>
              Number(
                await h.locator(".netplay-status").getAttribute("data-fps"),
              ),
            )
            .toBeGreaterThanOrEqual(50);
        }
        expect(
          await h.locator(".netplay-status").getAttribute("data-corrections"),
        ).toBe("0");
        await guest.locator("iframe").evaluate((el) => {
          const w = (el as HTMLIFrameElement).contentWindow as any;
          w.__bomberNetplay.load(
            w.__earlierNetplaySnapshot,
            w.__bomberNetplay.frame(),
          );
        });
        await expect
          .poll(
            async () =>
              Number(
                await h
                  .locator(".netplay-status")
                  .getAttribute("data-corrections"),
              ),
            { timeout: 30000 },
          )
          .toBe(1);
        for (const p of pages)
          await expect
            .poll(async () =>
              Number(
                await p
                  .locator(".netplay-status")
                  .getAttribute("data-corrections"),
              ),
            )
            .toBe(1);
        const synced = await frame(h);
        await expect
          .poll(
            async () =>
              Number(
                await h
                  .locator(".netplay-status")
                  .getAttribute("data-verified-frame"),
              ),
            { timeout: 30000 },
          )
          .toBeGreaterThan(synced + 120);
        const oldConnections = await guest.evaluate(
          () => (window as any).__netplayPCs.length,
        );
        await guest.evaluate(() =>
          (window as any).__netplayPCs
            .filter(
              (pc: RTCPeerConnection) => pc.connectionState === "connected",
            )
            .forEach((pc: RTCPeerConnection) => pc.close()),
        );
        await expect
          .poll(
            () => guest.evaluate(() => (window as any).__netplayPCs.length),
            { timeout: 30000 },
          )
          .toBeGreaterThan(oldConnections);
        for (const p of pages)
          await expect(
            p.getByText("Emulação local sincronizada.", { exact: true }),
          ).toBeVisible({ timeout: 30000 });
        const reconnected = await frame(h);
        await expect
          .poll(
            async () =>
              Number(
                await h
                  .locator(".netplay-status")
                  .getAttribute("data-verified-frame"),
              ),
            { timeout: 30000 },
          )
          .toBeGreaterThan(reconnected + 120);
        if (process.env.TEST_MOBILE_NETWORK === "1") {
          await guest.evaluate(() => {
            (window as any).__netplayDeliveryDelay = 0;
          });
          for (const p of pages)
            await expect
              .poll(
                async () =>
                  Number(
                    (await p.locator(".netplay-status").innerText()).match(
                      /Atraso automático: (\d+)/,
                    )?.[1] ?? 0,
                  ),
                { timeout: 30000 },
              )
              .toBe(6);
          const recovered = await frame(h);
          await expect
            .poll(async () =>
              Number(
                await h
                  .locator(".netplay-status")
                  .getAttribute("data-verified-frame"),
              ),
            )
            .toBeGreaterThan(recovered + 120);
        }
        await writeFile(
          ".private/netplay/resilience-3.json",
          JSON.stringify(
            {
              deliveryDelayMs: deliveryDelay,
              retransmittedInputDelayMs: 220,
              desync:
                "loaded an earlier legitimate snapshot at the current protocol frame; no RAM edits",
              corrections: 1,
              reconnected: true,
              adaptiveRecovery: process.env.TEST_MOBILE_NETWORK === "1",
              status: await Promise.all(
                pages.map((p) => p.locator(".netplay-status").innerText()),
              ),
            },
            null,
            2,
          ),
        );
      }
      expect(failures).toEqual([]);
    } catch (e) {
      for (const [i, p] of pages.entries())
        console.log(
          "GAMEPLAY_FAILURE",
          count,
          i,
          await p
            .locator(".netplay-status")
            .innerText()
            .catch(() => ""),
        );
      throw e;
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
