import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const romPath = process.env.TEST_ROM_PATH;
test("dois emuladores locais: instalação, canal sem mídia, quadros iguais e sincronização de save", async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    !romPath,
    "Use a ROM privada original do proprietário para validar emulação real.",
  );
  test.setTimeout(180000);
  const hc = await browser.newContext({
      viewport: { width: 1000, height: 850 },
    }),
    gc = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
  const debugPages: Page[] = [];
  try {
    const auth = await hc.request.post(`${baseURL}/api/auth`, {
      headers: { Origin: baseURL! },
      data: {
        password: (
          await readFile(".private/local-owner-password", "utf8")
        ).trim(),
      },
    });
    expect(auth.status()).toBe(200);
    expect(
      (await (await hc.request.get(`${baseURL}/api/auth`)).json()).owner,
    ).toBe(true);
    const h = await hc.newPage(),
      g = await gc.newPage();
    debugPages.push(h, g);
    const failures: string[] = [];
    for (const page of [h, g]) {
      page.on("pageerror", (e) => {
        if (!e.message.includes("Wake Lock")) failures.push(e.message);
      });
      await page.addInitScript(() => {
        const Native = window.RTCPeerConnection;
        (window as any).__netplayPCs = [];
        window.RTCPeerConnection = class extends Native {
          constructor(config?: RTCConfiguration) {
            super(config);
            (window as any).__netplayPCs.push(this);
          }
        };
        (window as any).__mediaRequests = [];
      });
    }
    const guestRequests: string[] = [];
    g.on("request", (r) => guestRequests.push(r.url()));
    await h.goto("/netplay-lab");
    await expect(
      h.getByRole("button", {
        name: "M Proprietário Acesso privado",
        exact: true,
      }),
    ).toBeVisible();
    await h.getByRole("button", { name: "＋ Criar sala", exact: true }).click();
    await h
      .getByRole("button", { name: "Jogar como Matheus", exact: true })
      .click();
    await h
      .getByRole("button", { name: "Criar e receber código", exact: true })
      .click();
    const code = (await h.locator("button.code").innerText()).slice(0, 6);
    await g.goto(`/netplay-lab?sala=${code}`);
    await g
      .getByRole("button", { name: "Jogar como Gabi", exact: true })
      .click();
    await g
      .getByRole("button", { name: "Entrar na sala", exact: true })
      .click();
    await expect(h.getByText("NA SALA · 2/5")).toBeVisible();
    const start = h.getByRole("button", {
      name: "Iniciar partida",
      exact: true,
    });
    await expect(start).toBeDisabled();
    await h
      .getByLabel("Importar ROM local", { exact: true })
      .setInputFiles(romPath!);
    await expect(
      h
        .getByText("Jogo instalado neste aparelho.")
        .or(h.getByText(/Jogo instalado e verificado/)),
    ).toBeVisible();
    await expect(start).toBeDisabled();
    await g
      .getByLabel("Importar ROM local", { exact: true })
      .setInputFiles(romPath!);
    await expect(start).toBeEnabled({ timeout: 60000 });
    await expect(h.locator("iframe")).toHaveCount(1);
    await expect(g.locator("iframe")).toHaveCount(1);
    await expect(h.locator("video")).toHaveCount(0);
    await expect(g.locator("video")).toHaveCount(0);
    for (const page of [h, g])
      expect(
        await page.evaluate(() =>
          (window as any).__netplayPCs.map(
            (p: RTCPeerConnection) => p.getSenders().length,
          ),
        ),
      ).toEqual([0]);
    await start.click();
    await expect(
      h.getByText("Emulação local sincronizada.", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      g.getByText("Emulação local sincronizada.", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const frame = (page: Page) =>
      page
        .locator("iframe")
        .evaluate(
          (node) =>
            (
              (node as HTMLIFrameElement).contentWindow as any
            ).__bomberNetplay.frame() as number,
        );
    await expect
      .poll(() => frame(h), { timeout: 30000 })
      .toBeGreaterThanOrEqual(240);
    await h
      .getByRole("button", { name: "Salvar progresso", exact: true })
      .click();
    await h
      .getByRole("button", { name: "Restaurar para todos", exact: true })
      .click();
    await expect(
      h.getByText("Emulação local sincronizada.", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect.poll(() => frame(g), { timeout: 30000 }).toBeGreaterThan(120);
    expect(guestRequests.some((url) => url.includes("/api/rom"))).toBe(false);
    expect(failures).toEqual([]);
    await info.attach("host-local", {
      body: await h.screenshot(),
      contentType: "image/png",
    });
    await info.attach("celular-local", {
      body: await g.screenshot(),
      contentType: "image/png",
    });
  } catch (error) {
    for (const [i, p] of debugPages.entries()) {
      console.log(
        "NETPLAY_FAILURE",
        i,
        await p
          .locator(".netplay-status")
          .allTextContents()
          .catch(() => []),
        await p
          .evaluate(() =>
            (window as any).__netplayPCs?.map((p: RTCPeerConnection) => ({
              state: p.connectionState,
              ice: p.iceConnectionState,
              signaling: p.signalingState,
            })),
          )
          .catch(() => []),
      );
      await p
        .screenshot({
          path: `test-results/netplay-failure-${i}.png`,
          timeout: 5000,
        })
        .catch(() => {});
    }
    throw error;
  } finally {
    await Promise.all([hc.close(), gc.close()]);
  }
});
