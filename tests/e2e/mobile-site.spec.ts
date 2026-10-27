import { test, expect } from "@playwright/test";

test("site e formulários em celulares pequenos, paisagem, tablet e desktop", async ({
  browser,
}) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/");
    for (const [width, height] of [
      [320, 568],
      [360, 740],
      [390, 844],
      [412, 915],
      [568, 320],
      [667, 375],
      [844, 390],
      [768, 1024],
      [1440, 900],
    ]) {
      await page.setViewportSize({ width, height });
      await expect(
        page.getByRole("heading", { name: /A próxima partida/ }),
      ).toBeVisible();
      for (const button of await page.locator(".topbar button").all()) {
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(43.9);
        expect(box!.height).toBeGreaterThanOrEqual(43.9);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: "Entrar em sala ↗" }).click();
      await expect(
        page.getByRole("button", { name: "Jogar como Gabi", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Jogar como Gabi", exact: true })
        .click();
      await expect(page.getByLabel("Seu apelido")).toHaveValue("Gabi");
      expect(
        await page
          .locator(".modal")
          .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      ).toBe(true);
      await page.getByRole("button", { name: "Fechar janela" }).click();
      await page
        .getByRole("button", { name: "Configurações", exact: true })
        .click();
      await page.getByLabel("Tamanho dos botões").selectOption("large");
      await page.getByLabel("Controle na tela").selectOption("on");
      await page.getByRole("button", { name: "Fechar janela" }).click();
    }
    await page.reload();
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await expect(page.getByLabel("Tamanho dos botões")).toHaveValue("large");
    await expect(page.getByLabel("Controle na tela")).toHaveValue("on");
    await page.getByRole("button", { name: "Fechar janela" }).click();
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/mobile-home-reviewed.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
