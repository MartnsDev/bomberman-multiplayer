/* global VERSION, ASSETS */
const CACHE = `bomber-assets-${VERSION}`;
const downloads = new Map();
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE)),
);
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("bomber-assets-") && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});
async function download(path, cache, signal) {
  const saved = await cache.match(path);
  if (saved) return saved;
  const response = await fetch(path, {
    cache: "no-cache",
    credentials: "omit",
    signal,
  });
  if (!response.ok) throw Error(`Não foi possível preparar ${path}`);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await response.clone().arrayBuffer(),
  );
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== ASSETS[path].sha256)
    throw Error(
      "Arquivos atualizados. Recarregue para preparar a nova versão.",
    );
  await cache.put(path, response.clone());
  return response;
}
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") {
    self.skipWaiting();
    return;
  }
  const id = event.source?.id;
  if (event.data?.type === "PAUSE_DOWNLOADS") {
    downloads.get(id)?.abort();
    return;
  }
  if (event.data?.type !== "PREPARE" || !event.ports[0]) return;
  const port = event.ports[0];
  const group = ["host", "netplay"].includes(event.data.group) ? event.data.group : "common";
  const controller = new AbortController();
  downloads.get(id)?.abort();
  downloads.set(id, controller);
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        const paths = Object.keys(ASSETS).filter(
          (p) => ASSETS[p].group === group,
        );
        let done = 0,
          next = 0;
        // Limit concurrency so opening the site does not saturate a phone's connection.
        await Promise.all(
          Array.from({ length: 2 }, async () => {
            while (next < paths.length) {
              const path = paths[next++];
              if (controller.signal.aborted)
                throw Error("Preparação pausada durante a partida.");
              await download(path, cache, controller.signal);
              port.postMessage({
                type: "progress",
                done: ++done,
                total: paths.length,
              });
            }
          }),
        );
        port.postMessage({ type: "ready", version: VERSION });
      } catch (e) {
        controller.abort();
        port.postMessage({ type: "error", message: e.message });
      } finally {
        if (downloads.get(id) === controller) downloads.delete(id);
        port.close();
      }
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never intercept documents, ROMs, auth, signalling, ICE, or other private APIs.
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !ASSETS[url.pathname]
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        return await download(url.pathname, cache);
      } catch {
        return fetch(event.request);
      }
    })(),
  );
});
