import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const romPath = process.env.TEST_ROM_PATH;
async function login(page: import("@playwright/test").Page) {
  const password = await readFile(".private/local-owner-password", "utf8");
  await page.goto("/");
  await page.getByRole("button", { name: "Área do proprietário" }).click();
  await page.getByLabel("Senha administrativa").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("Importar ROM (.sfc, 2 MB)")).toBeVisible();
}
test("ROM privada, sala, segundo contexto, mídia e entradas independentes no celular", async ({
  browser,
}) => {
  test.skip(
    !romPath,
    "Defina TEST_ROM_PATH para testar com a ROM privada do proprietário.",
  );
  const hc = await browser.newContext(),
    gc = await browser.newContext({
      isMobile: true,
      hasTouch: true,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
  if (process.env.TEST_DISTRIBUTED === "1")
    await hc.addInitScript(() => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          (window as Window & { __testSignal?: WebSocket }).__testSignal = this;
          this.addEventListener("message", (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === "room" && data.selfId) {
                const w = window as Window & { __testAck?: number };
                w.__testAck = (w.__testAck ?? 0) + 1;
              }
            } catch {}
          });
        }
      };
    });
  const h = await hc.newPage(),
    g = await gc.newPage();
  const guestRequests: string[] = [];
  g.on("request", (r) => guestRequests.push(r.url()));
  await login(h);
  await h.locator("input[type=file]").setInputFiles(romPath!);
  await expect(
    h.getByText("ROM importada no armazenamento privado. Pronta para jogar."),
  ).toBeVisible();
  await h.getByRole("button", { name: "Fechar janela" }).click();
  const forbidden = await gc.request.get("/api/rom");
  expect(forbidden.status()).toBe(401);
  await h.getByRole("button", { name: "＋ Criar sala" }).click();
  await h
    .getByRole("button", { name: "Jogar como Matheus", exact: true })
    .click();
  await expect(h.getByLabel("Seu apelido")).toHaveValue("Matheus");
  await h.getByRole("button", { name: "Criar e receber código" }).click();
  const code = (await h.locator("button.code").innerText()).slice(0, 6);
  await h.getByRole("button", { name: "Salas", exact: true }).click();
  await expect(h.locator(".modal-invite .invite-code")).toContainText(code);
  await expect(h.locator(".modal-invite")).toContainText("1/5 NA SALA");
  await h
    .getByRole("button", { name: "Voltar para a sala", exact: true })
    .click();
  await g.goto("/?sala=AAAAAA");
  await g.getByRole("button", { name: "Jogar como Gabi", exact: true }).click();
  await g.getByRole("button", { name: "Entrar na sala", exact: true }).click();
  await expect(g.locator(".message.error")).toContainText(
    "Sala não encontrada",
  );
  await g.getByRole("button", { name: "Entrar em sala ↗" }).click();
  await g.getByLabel("Código da sala").fill(code);
  await g.getByRole("button", { name: "Entrar na sala", exact: true }).click();
  await expect(h.getByText("Gabi", { exact: true })).toBeVisible();
  await expect(g.getByText("Convidado · Controle 2")).toBeVisible();
  const extraContexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const extraPages = await Promise.all(
    extraContexts.map((context) => context.newPage()),
  );
  for (const [i, label] of ["Helo", "Gu", "Jogador 5"].entries()) {
    const page = extraPages[i];
    page.on("request", (request) => guestRequests.push(request.url()));
    await page.goto(`/?sala=${code}`);
    if (i < 2)
      await page
        .getByRole("button", { name: `Jogar como ${label}`, exact: true })
        .click();
    else await page.getByLabel("Seu apelido", { exact: true }).fill(label);
    await page
      .getByRole("button", { name: "Entrar na sala", exact: true })
      .click();
    await expect(h.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(h.getByText("NA SALA · 5/5")).toBeVisible();
  await expect(h.locator(".players img")).toHaveCount(3);
  await h.getByRole("button", { name: "Iniciar partida", exact: true }).click();
  await h.waitForFunction(
    () =>
      !!(
        document.querySelector("iframe")?.contentWindow as Window & {
          __bomber?: unknown;
        }
      )?.__bomber,
    {},
    { timeout: 60000 },
  );
  const coreConfig = await h.evaluate(() => {
    const e = (
      document.querySelector("iframe")!.contentWindow as unknown as {
        EJS_emulator: {
          gameManager: {
            FS: {
              readFile: (path: string, options: { encoding: string }) => string;
            };
          };
        };
      }
    ).EJS_emulator;
    return e.gameManager.FS.readFile(
      "/home/web_user/.config/retroarch/retroarch.cfg",
      { encoding: "utf8" },
    );
  });
  expect(coreConfig).toContain('input_libretro_device_p2 = "257"');
  expect(coreConfig).toContain('input_max_users = "5"');
  await g.waitForFunction(
    () => {
      const v = document.querySelector("video");
      return !!v && v.videoWidth > 0 && !!v.srcObject;
    },
    {},
    { timeout: 60000 },
  );
  await expect
    .poll(
      () =>
        g.locator("video").evaluate((v) => (v as HTMLVideoElement).videoWidth),
      { timeout: 30000 },
    )
    .toBeGreaterThan(200);
  const media = await g.locator("video").evaluate((node) => {
    const v = node as HTMLVideoElement;
    return {
      width: v.videoWidth,
      height: v.videoHeight,
      audio: (v.srcObject as MediaStream).getAudioTracks().length,
      video: (v.srcObject as MediaStream).getVideoTracks().length,
    };
  });
  expect(media.audio).toBe(1);
  expect(media.video).toBe(1);
  expect(media.width).toBeGreaterThan(200);
  // Decode real media: dimensions and track presence alone could accept black/silent streams.
  await expect
    .poll(
      () =>
        g.locator("video").evaluate((node) => {
          const canvas = document.createElement("canvas");
          canvas.width = 32;
          canvas.height = 28;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(node as HTMLVideoElement, 0, 0, 32, 28);
          return ctx
            .getImageData(0, 0, 32, 28)
            .data.some((value, i) => i % 4 !== 3 && value > 40);
        }),
      { timeout: 30000 },
    )
    .toBe(true)
    .catch(async (error) => {
      await h.screenshot({ path: "test-results/host-media-failure.png" });
      await g.screenshot({ path: "test-results/guest-media-failure.png" });
      console.log(
        "MEDIA_FAILURE",
        await h.evaluate(() => {
          const w = document.querySelector("iframe")!.contentWindow as any;
          return {
            frame: w.__bomber.frame(),
            width: w.EJS_emulator.canvas.width,
            height: w.EJS_emulator.canvas.height,
          };
        }),
      );
      throw error;
    });
  const energy = await g.locator("video").evaluate(async (node) => {
    const audio = new AudioContext();
    await audio.resume();
    const source = audio.createMediaStreamSource(
      (node as HTMLVideoElement).srcObject as MediaStream,
    );
    const analyser = audio.createAnalyser();
    source.connect(analyser);
    const sink = audio.createGain();
    sink.gain.value = 0;
    analyser.connect(sink);
    sink.connect(audio.destination);
    const data = new Float32Array(analyser.fftSize);
    let peak = 0;
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 200));
      analyser.getFloatTimeDomainData(data);
      peak = Math.max(peak, ...data.map(Math.abs));
      if (peak > 0.001) break;
    }
    source.disconnect();
    await audio.close();
    return peak;
  });
  expect(energy).toBeGreaterThan(0.001);
  await g
    .locator("video")
    .screenshot({ path: "test-results/guest-real-video.png" });
  // Instrument the actual WASM bridge, preserving calls into the real core.
  await h.evaluate(() => {
    const w = document.querySelector("iframe")!.contentWindow as Window & {
      __bomber: { input: (p: number, b: number, v: number) => void };
      __calls: number[][];
    };
    w.__calls = [];
    const original = w.__bomber.input;
    w.__bomber.input = (...args) => {
      w.__calls.push(args);
      original(...args);
    };
  });
  await g.bringToFront();
  await g.locator("h2").first().click();
  await g.keyboard.down("ArrowRight");
  await g.keyboard.down("KeyX");
  await expect
    .poll(() =>
      h.evaluate(() =>
        (
          document.querySelector("iframe")!.contentWindow as unknown as {
            __calls: number[][];
          }
        ).__calls
          .filter((c) => c[0] === 1 && c[2] === 1)
          .map((c) => c[1]),
      ),
    )
    .toEqual(expect.arrayContaining([7, 8]));
  await g.keyboard.up("KeyX");
  await g.keyboard.up("ArrowRight");
  await expect
    .poll(() =>
      h.evaluate(() =>
        (
          document.querySelector("iframe")!.contentWindow as unknown as {
            __calls: number[][];
          }
        ).__calls.some((c) => c[0] === 1 && c[1] === 7 && c[2] === 0),
      ),
    )
    .toBe(true);
  expect(
    await h.evaluate(() =>
      (
        document.querySelector("iframe")!.contentWindow as unknown as {
          __calls: number[][];
        }
      ).__calls.some((c) => c[0] === 0 && c[2] === 1),
    ),
  ).toBe(false);
  // Real multitouch events in a phone viewport use the same P2 DataChannel.
  const controls = g.getByRole("group", {
    name: "Controle de toque",
    exact: true,
  });
  await expect(controls).toBeVisible();
  for (const message of [
    g.locator(".message.error"),
    g.locator(".message[role=status]"),
  ])
    if (await message.isVisible())
      await message
        .getByRole("button", { name: "Fechar", exact: true })
        .click();
  await controls.scrollIntoViewIfNeeded();
  const center = async (label: string) => {
    const rect = await controls
      .getByRole("button", { name: label, exact: true })
      .boundingBox();
    expect(rect).not.toBeNull();
    return { x: rect!.x + rect!.width / 2, y: rect!.y + rect!.height / 2 };
  };
  const diagonal = await center("Cima e direita"),
    right = await center("Direita"),
    action = await center("B");
  const cdp = await gc.newCDPSession(g);
  const remotePressed = () =>
    h.evaluate(() => {
      const calls = (
        document.querySelector("iframe")!.contentWindow as unknown as {
          __calls: number[][];
        }
      ).__calls;
      const held = new Set<number>();
      for (const [p, b, v] of calls)
        if (p === 1) {
          if (v) held.add(b);
          else held.delete(b);
        }
      return [...held].sort((a, b) => a - b);
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, ...diagonal },
      { id: 2, ...action },
    ],
  });
  await expect.poll(remotePressed).toEqual([0, 4, 7]);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 1, ...right },
      { id: 2, ...action },
    ],
  });
  await expect.poll(remotePressed).toEqual([0, 7]);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [{ id: 1, ...right }],
  });
  await expect.poll(remotePressed).toEqual([0]);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect.poll(remotePressed).toEqual([]);
  // A captured direction follows the finger through gaps and beyond the pad;
  // returning to the neutral centre releases only movement, preserving action.
  const padBox = await controls
    .getByRole("group", { name: "Direcional", exact: true })
    .boundingBox();
  expect(padBox).not.toBeNull();
  const neutral = {
    x: padBox!.x + padBox!.width / 2,
    y: padBox!.y + padBox!.height / 2,
  };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 10, ...right },
      { id: 11, ...action },
    ],
  });
  await expect.poll(remotePressed).toEqual([0, 7]);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 10, x: padBox!.x + padBox!.width + 12, y: neutral.y },
      { id: 11, ...action },
    ],
  });
  await expect.poll(remotePressed).toEqual([0, 7]);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 10, ...neutral },
      { id: 11, ...action },
    ],
  });
  await expect.poll(remotePressed).toEqual([0]);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect.poll(remotePressed).toEqual([]);
  const a = await center("A");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 3, x: a.x - 4, y: a.y },
      { id: 4, x: a.x + 4, y: a.y },
    ],
  });
  await expect.poll(remotePressed).toEqual([8]);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [{ id: 3, x: a.x - 4, y: a.y }],
  });
  await expect.poll(remotePressed).toEqual([8]);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect.poll(remotePressed).toEqual([]);
  expect(
    await h.evaluate(() =>
      (
        document.querySelector("iframe")!.contentWindow as unknown as {
          __calls: number[][];
        }
      ).__calls.some((c) => c[0] === 0 && c[2] === 1),
    ),
  ).toBe(false);
  await g.setViewportSize({ width: 844, height: 390 });
  await g.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect
    .poll(() => g.evaluate(() => document.fullscreenElement?.id))
    .toBe("screen");
  for (const label of [
    "Cima",
    "Direita",
    "A",
    "B",
    "L",
    "R",
    "Start",
    "Select",
  ]) {
    const box = await controls
      .getByRole("button", { name: label, exact: true })
      .boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(845);
    expect(box!.y + box!.height).toBeLessThanOrEqual(391);
  }
  await g.screenshot({ path: "test-results/mobile-landscape.png" });
  await g
    .getByRole("button", { name: "Sair da tela cheia", exact: true })
    .click();
  // Simulate a phone without native fullscreen and test every control at its edges.
  await g.evaluate(() =>
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    }),
  );
  await g.getByRole("button", { name: "Configurações", exact: true }).click();
  await g.getByLabel("Tamanho dos botões").selectOption("large");
  await g.getByRole("button", { name: "Fechar janela" }).click();
  await g.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect(g.locator("#screen")).toHaveAttribute("data-expanded", "true");
  expect(await g.evaluate(() => document.fullscreenElement)).toBeNull();
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [568, 320],
    [667, 375],
    [844, 390],
  ]) {
    await g.setViewportSize({ width, height });
    for (const label of [
      "Cima",
      "Direita",
      "A",
      "B",
      "L",
      "R",
      "Start",
      "Select",
    ]) {
      const box = await controls
        .getByRole("button", { name: label, exact: true })
        .boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(43.9);
      expect(box!.height).toBeGreaterThanOrEqual(43.9);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(
        box!.x + box!.width,
        `${width}x${height}: ${label}`,
      ).toBeLessThanOrEqual(width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
    }
    const videoBox = await g.locator("video").boundingBox();
    expect(videoBox!.width).toBeGreaterThan(150);
    expect(videoBox!.height).toBeGreaterThan(100);
  }
  await g
    .getByRole("button", { name: "Áudio na tela cheia", exact: true })
    .click();
  expect(
    await g.locator("video").evaluate((v) => (v as HTMLVideoElement).muted),
  ).toBe(false);
  await g.screenshot({ path: "test-results/mobile-game-large-controls.png" });
  await g
    .getByRole("button", { name: "Sair da tela cheia", exact: true })
    .click();
  await expect(g.locator("#screen")).toHaveAttribute("data-expanded", "false");
  await g.setViewportSize({ width: 390, height: 844 });
  expect(
    await g.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await g.keyboard.down("ArrowLeft");
  await expect
    .poll(() =>
      h.evaluate(() =>
        (
          document.querySelector("iframe")!.contentWindow as unknown as {
            __calls: number[][];
          }
        ).__calls.some((c) => c[0] === 1 && c[1] === 6 && c[2] === 1),
      ),
    )
    .toBe(true);
  await g.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect
    .poll(() =>
      h.evaluate(() =>
        (
          document.querySelector("iframe")!.contentWindow as unknown as {
            __calls: number[][];
          }
        ).__calls.some((c) => c[0] === 1 && c[1] === 6 && c[2] === 0),
      ),
    )
    .toBe(true);
  await g.keyboard.up("ArrowLeft");
  await g.locator("video").evaluate((node) => {
    (
      window as Window & { __previousTrack?: MediaStreamTrack }
    ).__previousTrack = (
      (node as HTMLVideoElement).srcObject as MediaStream
    ).getVideoTracks()[0];
  });
  await g.getByRole("button", { name: "Reconectar", exact: true }).click();
  await expect
    .poll(() =>
      g
        .locator("video")
        .evaluate(
          (node) =>
            (
              (node as HTMLVideoElement).srcObject as MediaStream
            )?.getVideoTracks()[0] !==
            (window as Window & { __previousTrack?: MediaStreamTrack })
              .__previousTrack,
        ),
    )
    .toBe(process.env.TEST_DISTRIBUTED !== "1");
  await expect(g.getByText("Convidado · Controle 2")).toBeVisible();
  await expect
    .poll(() =>
      g
        .locator("video")
        .evaluate((node) => (node as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(2);
  expect(
    guestRequests.some(
      (url) =>
        url.includes("/api/rom") ||
        url.includes("/emulatorjs/") ||
        url.includes("/emulator.html"),
    ),
  ).toBe(false);
  for (const [i, page] of extraPages.entries()) {
    await page.waitForFunction(
      () => {
        const v = document.querySelector("video");
        return !!v && v.videoWidth > 0;
      },
      {},
      { timeout: 30000 },
    );
    const slot = i + 2;
    await h.evaluate(() => {
      (
        document.querySelector("iframe")!.contentWindow as unknown as {
          __calls: number[][];
        }
      ).__calls = [];
    });
    await page.bringToFront();
    await page.locator("h2").first().click();
    await page.keyboard.down("ArrowUp");
    await expect
      .poll(() =>
        h.evaluate(() =>
          (
            document.querySelector("iframe")!.contentWindow as unknown as {
              __calls: number[][];
            }
          ).__calls
            .filter((c) => c[2] === 1)
            .map((c) => c[0]),
        ),
      )
      .toEqual(expect.arrayContaining([slot]));
    expect(
      await h.evaluate(
        (expected) =>
          (
            document.querySelector("iframe")!.contentWindow as unknown as {
              __calls: number[][];
            }
          ).__calls.some((c) => c[2] === 1 && c[0] !== expected),
        slot,
      ),
    ).toBe(false);
    await page.keyboard.up("ArrowUp");
  }
  if (process.env.TEST_DISTRIBUTED === "1") {
    const before = await h.evaluate(
      () => (window as Window & { __testAck?: number }).__testAck ?? 0,
    );
    await h.evaluate(() =>
      (window as Window & { __testSignal?: WebSocket }).__testSignal?.close(),
    );
    await expect
      .poll(() =>
        h.evaluate(
          () => (window as Window & { __testAck?: number }).__testAck ?? 0,
        ),
      )
      .toBeGreaterThan(before);
    await expect(h.locator(".connection")).toContainText(
      "Sinalização conectada",
    );
    await expect(h.locator("iframe")).toHaveCount(1);
    await g.bringToFront();
    await g.locator("h2").first().click();
    await g.keyboard.down("KeyX");
    await expect
      .poll(() =>
        h.evaluate(() =>
          (
            document.querySelector("iframe")!.contentWindow as unknown as {
              __calls: number[][];
            }
          ).__calls.some((c) => c[0] === 1 && c[1] === 8 && c[2] === 1),
        ),
      )
      .toBe(true);
    await g.keyboard.up("KeyX");
  }
  await h.getByRole("button", { name: "Salvar progresso" }).click();
  await expect(h.getByText("Progresso salvo neste navegador.")).toBeVisible();
  await h.getByRole("button", { name: "Restaurar", exact: true }).click();
  await expect(h.getByText("Progresso restaurado.")).toBeVisible();
  await h.getByRole("button", { name: "Encerrar sala", exact: true }).click();
  await expect(g.locator(".message.error")).toContainText("anfitrião encerrou");
  await h.getByRole("button", { name: "＋ Criar sala" }).click();
  await h.getByRole("button", { name: "Criar e receber código" }).click();
  await expect(h.locator("button.code")).toBeVisible();
  await h.getByRole("button", { name: "Encerrar sala", exact: true }).click();
  await Promise.all(extraContexts.map((context) => context.close()));
  await hc.close();
  await gc.close();
});
test("início responsivo e controles configuráveis", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /A próxima partida/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page.getByRole("button", { name: "B KeyZ", exact: true }).click();
  await page.keyboard.press("KeyC");
  await expect(
    page.getByRole("button", { name: "B KeyC", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fechar janela" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("perfis pré-configurados, nova pessoa com foto e preferência local", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".brand-logo")).toHaveAttribute(
    "src",
    "/optimized/icon.png",
  );
  await page.getByRole("button", { name: "Entrar em sala ↗" }).click();
  for (const name of ["Matheus", "Gabi", "Helo", "Gu"])
    await expect(
      page.getByRole("button", { name: `Jogar como ${name}`, exact: true }),
    ).toBeVisible();
  await page
    .getByRole("button", { name: "Jogar como Gu", exact: true })
    .click();
  await expect(page.getByLabel("Seu apelido")).toHaveValue("Gu");
  await expect(
    page.getByRole("button", { name: "Jogar como Gu", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Adicionar pessoa", exact: true })
    .click();
  await page.getByLabel("Nome da pessoa", { exact: true }).fill("Amiga nova");
  await page
    .getByLabel("Foto (opcional)", { exact: true })
    .setInputFiles("public/avatars/gabi.png");
  await page
    .getByRole("button", { name: "Salvar e selecionar", exact: true })
    .click();
  await expect(page.getByLabel("Seu apelido")).toHaveValue("Amiga nova");
  await expect(
    page
      .getByRole("button", { name: "Jogar como Amiga nova", exact: true })
      .locator("img"),
  ).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  await page.reload();
  await page.getByRole("button", { name: "Entrar em sala ↗" }).click();
  await expect(
    page.getByRole("button", { name: "Jogar como Amiga nova", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/profile-picker-mobile.png" });
});
