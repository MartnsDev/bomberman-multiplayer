import { test, expect, type Page } from "@playwright/test";
import { PUBLIC_ROM_URL } from "../../src/lib/netplay/public-rom";
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

test("três visitantes criam, instalam, iniciam e retomam sem senha; administração fica privada", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180000);
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
  const errors: string[] = [],
    loginRequests: string[] = [],
    privateDownloads: string[] = [];
  try {
    for (const p of pages) {
      await (
        await p.context().newCDPSession(p)
      ).send("Emulation.setFocusEmulationEnabled", { enabled: true });
      p.on("pageerror", (e) => {
        if (!e.message.includes("Wake Lock")) errors.push(e.message);
      });
      p.on("request", (r) => {
        if (r.url().endsWith("/api/auth") && r.method() === "POST")
          loginRequests.push(r.url());
        if (r.url().endsWith("/api/rom")) privateDownloads.push(r.url());
      });
    }
    const [h, g, t] = pages;
    await h.goto("/");
    expect(
      (await (await contexts[0].request.get(`${baseURL}/api/auth`)).json())
        .owner,
    ).toBe(false);
    await h.getByRole("button", { name: "＋ Criar sala", exact: true }).click();
    await expect(h.getByLabel("Senha administrativa")).toHaveCount(0);
    await h.getByLabel("Seu apelido", { exact: true }).fill("Visitante 1");
    await h
      .getByRole("button", { name: "Criar e receber código", exact: true })
      .click();
    const code = (await h.locator("button.code").innerText()).slice(0, 6);
    for (const [i, p] of [g, t].entries()) {
      await p.goto(`/?sala=${code}`);
      await p
        .getByLabel("Seu apelido", { exact: true })
        .fill(`Visitante ${i + 2}`);
      await p
        .getByRole("button", { name: "Entrar na sala", exact: true })
        .click();
      await expect(h.getByText(`NA SALA · ${i + 2}/5`)).toBeVisible();
    }
    for (const p of pages) {
      const download = p.waitForResponse(
        (r) => r.url() === PUBLIC_ROM_URL && r.ok(),
      );
      await p
        .getByRole("button", {
          name: "Instalar jogo neste aparelho",
          exact: true,
        })
        .click();
      expect((await download).status()).toBe(200);
      await expect(p.getByText(/Jogo instalado e verificado/)).toBeVisible();
      await expect(p.getByLabel("Senha administrativa")).toHaveCount(0);
    }
    await expect(
      h.getByRole("button", { name: "Iniciar partida", exact: true }),
    ).toBeEnabled({ timeout: 90000 });
    await h
      .getByRole("button", { name: "Iniciar partida", exact: true })
      .click();
    for (const p of pages) await running(p);
    await expect.poll(() => frame(h), { timeout: 30000 }).toBeGreaterThan(180);
    const before = await frame(g);
    await h.reload();
    await expect
      .poll(() => frame(g), { timeout: 15000 })
      .toBeGreaterThan(before + 150);
    for (const p of pages) await running(p);
    await expect(
      g.getByRole("button", { name: "Salvar progresso", exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          Number(
            await g
              .locator(".netplay-status")
              .getAttribute("data-verified-frame"),
          ),
        { timeout: 30000 },
      )
      .toBeGreaterThan(0);
    for (const c of contexts) {
      expect(
        (await (await c.request.get(`${baseURL}/api/auth`)).json()).owner,
      ).toBe(false);
      expect((await c.request.get(`${baseURL}/api/rom`)).status()).toBe(401);
      expect(
        (
          await c.request.put(`${baseURL}/api/rom`, {
            headers: { Origin: baseURL! },
            data: "unauthorized",
          })
        ).status(),
      ).toBe(403);
    }
    expect(loginRequests).toEqual([]);
    expect(privateDownloads).toEqual([]);
    expect(errors).toEqual([]);
    for (const p of pages)
      expect(
        await p.locator(".netplay-status").getAttribute("data-corrections"),
      ).toBe("0");
    await info.attach("partida-sem-senha", {
      body: await g.screenshot(),
      contentType: "image/png",
    });
  } catch (e) {
    for (const [i, p] of pages.entries())
      console.log(
        "PUBLIC_PLAY_FAILURE",
        i,
        (await p.locator("body").innerText()).slice(-5500),
      );
    throw e;
  } finally {
    for (const c of contexts) await c.close();
  }
});

test("jogar sozinho instala uma vez e inicia sem login", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    }),
    p = await c.newPage();
  let downloads = 0,
    logins = 0;
  p.on("request", (r) => {
    if (r.url() === PUBLIC_ROM_URL) downloads++;
    if (r.url().endsWith("/api/auth") && r.method() === "POST") logins++;
  });
  try {
    await p.goto("/");
    await p
      .getByRole("button", { name: "▷ Jogar sozinho", exact: true })
      .click();
    await expect(
      p.getByRole("dialog", { name: "Jogar sozinho", exact: true }),
    ).toBeVisible();
    await expect(p.getByLabel("Senha administrativa")).toHaveCount(0);
    await p.getByLabel("Seu apelido", { exact: true }).fill("Visitante solo");
    await p
      .getByRole("button", { name: "Começar a jogar", exact: true })
      .click();
    await p
      .getByRole("button", {
        name: "Instalar jogo neste aparelho",
        exact: true,
      })
      .click();
    await running(p);
    await expect.poll(() => frame(p), { timeout: 30000 }).toBeGreaterThan(120);
    await p.reload();
    await running(p);
    await expect.poll(() => frame(p), { timeout: 30000 }).toBeGreaterThan(120);
    expect(downloads).toBe(1);
    expect(logins).toBe(0);
    expect(
      (await (await c.request.get(`${baseURL}/api/auth`)).json()).owner,
    ).toBe(false);
    await info.attach("solo-sem-senha", {
      body: await p.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await c.close();
  }
});
