import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
const source = readFileSync("scripts/service-worker.js", "utf8");
function harness(
  fetchImpl = async (path: string, _options: RequestInit) => new Response(path),
) {
  const listeners: Record<string, (event: any) => void> = {};
  const entries = new Map<string, Map<string, Response>>();
  const paths = ["/a.js", "/b.css", "/c.png", "/emulatorjs/core.data"];
  const assets = Object.fromEntries(
    paths.map((path) => [
      path,
      {
        group: path.includes("emulatorjs") ? "host" : "common",
        sha256: createHash("sha256").update(path).digest("hex"),
      },
    ]),
  );
  const fetch = vi.fn(fetchImpl);
  const self = {
    addEventListener: (type: string, cb: (e: any) => void) => {
      listeners[type] = cb;
    },
    location: { origin: "https://game.test" },
    clients: { claim: vi.fn() },
    skipWaiting: vi.fn(),
  };
  const caches = {
    open: async (name: string) => {
      if (!entries.has(name)) entries.set(name, new Map());
      const cache = entries.get(name)!;
      return {
        match: async (path: string) => cache.get(path)?.clone(),
        put: async (path: string, response: Response) => {
          cache.set(path, response);
        },
      };
    },
    keys: async () => [...entries.keys()],
    delete: vi.fn(async (name: string) => entries.delete(name)),
  };
  runInNewContext(source, {
    VERSION: "test-version",
    ASSETS: assets,
    self,
    caches,
    crypto: webcrypto,
    fetch,
    URL,
    Uint8Array,
    AbortController,
  });
  async function message(type: string, group = "common") {
    let work: Promise<unknown> = Promise.resolve();
    const port = { postMessage: vi.fn(), close: vi.fn() };
    listeners.message({
      data: { type, group },
      source: { id: "phone" },
      ports: [port],
      waitUntil: (p: Promise<unknown>) => {
        work = p;
      },
    });
    await work;
    return port;
  }
  return { listeners, self, caches, entries, message, fetch };
}
describe("pré-download versionado", () => {
  it("prepara os arquivos públicos uma vez, com duas transferências e sem ROM para convidados", async () => {
    let parallel = 0,
      peak = 0;
    const h = harness(async (path) => {
      parallel++;
      peak = Math.max(peak, parallel);
      await new Promise((r) => setTimeout(r, 4));
      parallel--;
      return new Response(path);
    });
    const port = await h.message("PREPARE");
    expect(peak).toBe(2);
    expect(h.fetch).toHaveBeenCalledTimes(3);
    expect(
      h.fetch.mock.calls.every(
        ([path, options]) =>
          !path.includes("emulatorjs") && options.credentials === "omit",
      ),
    ).toBe(true);
    expect(port.postMessage).toHaveBeenLastCalledWith({
      type: "ready",
      version: "test-version",
    });
    await h.message("PREPARE");
    expect(h.fetch).toHaveBeenCalledTimes(3);
    await h.message("PREPARE", "host");
    expect(h.fetch).toHaveBeenCalledTimes(4);
  });
  it("não intercepta documentos, APIs, ROMs, escritas ou origens externas", () => {
    const h = harness();
    for (const [path, method] of [
      ["/", "GET"],
      ["/emulator.html", "GET"],
      ["/api/rom", "GET"],
      ["/api/auth", "GET"],
      ["/signal", "GET"],
      ["/a.js", "POST"],
      ["https://other.test/a.js", "GET"],
    ]) {
      const respondWith = vi.fn();
      h.listeners.fetch({
        request: new Request(new URL(path, "https://game.test"), { method }),
        respondWith,
      });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
  it("recusa arquivos divergentes da versão e só ativa uma atualização quando solicitado", async () => {
    const h = harness(async () => new Response("arquivo de outra versão"));
    const port = await h.message("PREPARE");
    expect(port.postMessage.mock.calls.at(-1)?.[0].type).toBe("error");
    expect(h.entries.get("bomber-assets-test-version")?.size).toBe(0);
    expect(h.self.skipWaiting).not.toHaveBeenCalled();
    await h.message("ACTIVATE_UPDATE");
    expect(h.self.skipWaiting).toHaveBeenCalledOnce();
  });
  it("entrega arquivos já preparados quando a rede cai", async () => {
    const h = harness();
    await h.message("PREPARE");
    h.fetch.mockRejectedValue(Error("offline"));
    let result: Promise<Response> | undefined;
    h.listeners.fetch({
      request: new Request("https://game.test/a.js"),
      respondWith: (p: Promise<Response>) => {
        result = p;
      },
    });
    expect(await (await result)!.text()).toBe("/a.js");
  });
});
