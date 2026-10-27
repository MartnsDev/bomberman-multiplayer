import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("redesign de referência: capturas desktop e responsivas com navegação real", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1672, height: 941 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/");
    await expect(
      page.getByText("Emulador preparado", { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.locator(".connection")).toContainText(
      "Sinalização conectada",
    );
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".console-screen img")).toBeVisible();
    expect(
      await page
        .locator(".console-screen img")
        .evaluate(
          (i) =>
            (i as HTMLImageElement).complete &&
            (i as HTMLImageElement).naturalWidth > 600,
        ),
    ).toBe(true);
    await expect(page.locator(".feature-grid article")).toHaveCount(4);
    await expect(page.locator(".how-it-works li")).toHaveCount(3);
    await expect(
      page.getByText("SALA DE EXEMPLO", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("2–5 JOGADORES", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".example-code button")).toHaveCount(0);
    await mkdir("docs/design/screenshots", { recursive: true });
    for (const [width, height] of [
      [1672, 941],
      [1440, 900],
      [1024, 900],
      [768, 1024],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
      for (const selector of [
        ".hero-copy",
        ".feature-grid",
        ".how-it-works",
        ".service-status",
      ]) {
        const box = await page.locator(selector).boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
      await page.screenshot({
        path: `docs/design/screenshots/home-${width}.png`,
        fullPage: width < 1100,
      });
    }
    await page.getByRole("button", { name: "Salas", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Salas", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Entrar com código", exact: true })
      .click();
    await expect(page.getByLabel("Código da sala")).toBeVisible();
    await page.getByRole("button", { name: "Fechar janela" }).click();
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await expect(page.getByLabel("Controle na tela")).toBeVisible();
    await page.getByRole("button", { name: "Fechar janela" }).click();
    await page
      .getByRole("button", { name: "＋ Criar sala", exact: true })
      .click();
    await expect(page.getByLabel("Senha administrativa")).toBeVisible();
    await page.getByRole("button", { name: "Fechar janela" }).click();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
