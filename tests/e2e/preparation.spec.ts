import { test, expect } from "@playwright/test";

test("prepara os arquivos públicos, reutiliza offline e mantém APIs fora do cache", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Emulador preparado", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(page.locator(".update-banner")).toHaveCount(0);
  const paths = await page.evaluate(async () => {
    const paths = [];
    for (const name of await caches.keys())
      if (name.startsWith("bomber-assets-"))
        for (const r of await (await caches.open(name)).keys())
          paths.push(new URL(r.url).pathname);
    return paths;
  });
  expect(paths).toContain("/optimized/bomberman-logo.webp");
  expect(paths.some((path) => path.startsWith("/_next/"))).toBe(false);
  expect(paths).toContain("/optimized/avatars/gabi.webp");
  expect(paths).toContain("/netplay-emulatorjs/cores/snes9x-legacy-wasm.data");
  expect(
    paths.some((p) => p.startsWith("/api/") || p.startsWith("/emulatorjs/")),
  ).toBe(false);
  await context.setOffline(true);
  try {
    expect(
      await page.evaluate(
        async () => (await fetch("/optimized/avatars/gabi.webp")).ok,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(async () => {
        try {
          await fetch("/api/rom");
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
  } finally {
    await context.setOffline(false);
  }
});
