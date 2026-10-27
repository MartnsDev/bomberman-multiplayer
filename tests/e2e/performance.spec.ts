import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("transmissão para quatro celulares: resolução, limites e quadros decodificados", async ({
  browser,
}) => {
  test.skip(
    !process.env.TEST_PERFORMANCE,
    "Defina TEST_PERFORMANCE=1 para medir o core real.",
  );
  test.setTimeout(180000);
  const contexts = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      browser.newContext(
        i
          ? {
              isMobile: true,
              hasTouch: true,
              viewport: { width: 390, height: 844 },
            }
          : {},
      ),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  for (const context of contexts)
    await context.addInitScript(() => {
      const Native = window.RTCPeerConnection;
      (window as any).__peers = [];
      window.RTCPeerConnection = class extends Native {
        constructor(config?: RTCConfiguration) {
          super(config);
          (window as any).__peers.push(this);
        }
      };
    });
  const [host, ...guests] = pages;
  try {
    await host.goto("/");
    await host.getByRole("button", { name: "Área do proprietário" }).click();
    await host
      .getByLabel("Senha administrativa")
      .fill(await readFile(".private/local-owner-password", "utf8"));
    await host.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(host.getByText("Importar ROM (.sfc, 2 MB)")).toBeVisible();
    await host.reload();
    await expect(
      host.getByRole("button", { name: "M Proprietário Acesso privado" }),
    ).toBeVisible();
    await expect(
      host.getByText("Arquivos prontos para jogar", { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await expect(host.locator(".connection")).toContainText(
      "Sinalização conectada",
    );
    await host.getByRole("button", { name: "＋ Criar sala" }).click();
    await host
      .getByLabel("Seu apelido", { exact: true })
      .fill("Teste desempenho");
    await host.getByRole("button", { name: "Criar e receber código" }).click();
    const code = (await host.locator("button.code").innerText()).slice(0, 6);
    for (const [i, guest] of guests.entries()) {
      await guest.goto(`/?sala=${code}`);
      await guest
        .getByLabel("Seu apelido", { exact: true })
        .fill(`Celular ${i + 1}`);
      await guest
        .getByRole("button", { name: "Entrar na sala", exact: true })
        .click();
      await expect(
        guest.getByText(`Convidado · Controle ${i + 2}`),
      ).toBeVisible();
    }
    await host
      .getByRole("button", { name: "Iniciar partida", exact: true })
      .click();
    for (const guest of guests)
      await guest.waitForFunction(
        () => (document.querySelector("video")?.videoWidth ?? 0) > 0,
        {},
        { timeout: 60000 },
      );
    const sample = async () => ({
      host: await host.evaluate(async () => {
        const w = document.querySelector("iframe")!.contentWindow as any;
        const data = [];
        for (const pc of (window as any).__peers as RTCPeerConnection[]) {
          const reports: any[] = [];
          (await pc.getStats()).forEach((s: any) => {
            if (s.type === "outbound-rtp" && s.kind === "video")
              reports.push(s);
          });
          data.push({
            reports,
            parameters: pc
              .getSenders()
              .filter((s) => s.track?.kind === "video")
              .map((s) => s.getParameters()),
          });
        }
        return {
          width: w.EJS_emulator.canvas.width,
          height: w.EJS_emulator.canvas.height,
          frame: w.__bomber.frame(),
          data,
        };
      }),
      guests: await Promise.all(
        guests.map((g) =>
          g.evaluate(async () => {
            const video = document.querySelector("video")!;
            const stats: any[] = [];
            for (const pc of (window as any).__peers as RTCPeerConnection[])
              (await pc.getStats()).forEach((s: any) => {
                if (s.type === "inbound-rtp" && s.kind === "video")
                  stats.push(s);
              });
            return {
              width: video.videoWidth,
              height: video.videoHeight,
              stats,
              quality: video.getVideoPlaybackQuality().totalVideoFrames,
            };
          }),
        ),
      ),
    });
    const first = await sample();
    await host.keyboard.press("Enter");
    // Sampling window, not an idle delay: captures decoded frame deltas for every recipient.
    await expect
      .poll(async () => (await sample()).host.frame - first.host.frame, {
        timeout: 20000,
      })
      .toBeGreaterThan(300);
    const last = await sample();
    await test.info().attach("media-statistics", {
      body: JSON.stringify({ first, last }, null, 2),
      contentType: "application/json",
    });
    console.log(
      "PERFORMANCE",
      JSON.stringify({
        source: [last.host.width, last.host.height],
        guests: last.guests.map((g, i) => ({
          width: g.width,
          height: g.height,
          decodedFrames: g.quality - first.guests[i].quality,
          fps: g.stats[0]?.framesPerSecond,
          freezes:
            (g.stats[0]?.freezeCount ?? 0) -
            (first.guests[i].stats[0]?.freezeCount ?? 0),
        })),
        limits: last.host.data.map((p) => p.parameters.map((x) => x.encodings)),
      }),
    );
    for (const [i, g] of last.guests.entries()) {
      expect(g.quality - first.guests[i].quality).toBeGreaterThan(20);
      if (!process.env.PERF_BASELINE) {
        expect(g.width).toBeLessThanOrEqual(512);
        expect(g.height).toBeLessThanOrEqual(448);
      }
    }
    if (!process.env.PERF_BASELINE)
      for (const p of last.host.data)
        for (const params of p.parameters) {
          expect(params.encodings[0].maxBitrate).toBeLessThanOrEqual(600000);
          expect(params.encodings[0].maxFramerate).toBeLessThanOrEqual(60);
        }
    if (!process.env.PERF_BASELINE) {
      expect(
        await host.evaluate(() => window.__bomberPreparedRom?.byteLength),
      ).toBeGreaterThan(2000000);
      const cached = await host.evaluate(async () => {
        const paths = [];
        for (const name of await caches.keys())
          if (name.startsWith("bomber-assets-"))
            for (const r of await (await caches.open(name)).keys())
              paths.push(new URL(r.url).pathname);
        return paths;
      });
      expect(cached).toContain("/emulatorjs/cores/snes9x-wasm.data");
      expect(cached.some((p) => p.startsWith("/api/"))).toBe(false);
      await host
        .getByRole("button", { name: "Configurações", exact: true })
        .click();
      await host
        .getByLabel("Transmissão econômica (menos dados e menor carga)")
        .check();
      await host.getByRole("button", { name: "Fechar janela" }).click();
      await expect
        .poll(() =>
          host.evaluate(() =>
            (window as any).__peers.every((pc: RTCPeerConnection) =>
              pc
                .getSenders()
                .filter((s) => s.track?.kind === "video")
                .every(
                  (s) => s.getParameters().encodings[0].maxBitrate === 180000,
                ),
            ),
          ),
        )
        .toBe(true);
      for (const [i, guest] of guests.entries())
        await expect
          .poll(() =>
            guest
              .locator("video")
              .evaluate(
                (v) =>
                  (v as HTMLVideoElement).getVideoPlaybackQuality()
                    .totalVideoFrames,
              ),
          )
          .toBeGreaterThan(last.guests[i].quality + 20);
    }
  } finally {
    if (
      await host
        .getByRole("button", { name: "Encerrar sala", exact: true })
        .isVisible()
    )
      await host
        .getByRole("button", { name: "Encerrar sala", exact: true })
        .click();
    await Promise.all(contexts.map((c) => c.close()));
  }
});
