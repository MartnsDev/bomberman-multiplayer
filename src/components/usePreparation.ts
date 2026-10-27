"use client";
import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    __bomberPreparedRom?: Uint8Array;
  }
}
function prepare(
  worker: ServiceWorker,
  group: "common" | "host" | "netplay",
  onProgress: (done: number, total: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(Error("A preparação demorou. Tente novamente."));
    }, 90000);
    channel.port1.onmessage = (event) => {
      const data = event.data;
      if (data.type === "progress") onProgress(data.done, data.total);
      else {
        clearTimeout(timer);
        channel.port1.close();
        if (data.type === "ready") resolve();
        else
          reject(
            Error(data.message || "Não foi possível preparar os arquivos."),
          );
      }
    };
    worker.postMessage({ type: "PREPARE", group }, [channel.port2]);
  });
}
export function usePreparation(
  owner: boolean,
  playing: boolean,
  inRoom: boolean,
  netplay = false,
) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [commonReady, setCommonReady] = useState(false);
  const [hostReady, setHostReady] = useState(false);
  const [romReady, setRomReady] = useState(false);
  const [update, setUpdate] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const active = useRef(playing || inRoom);
  active.current = playing || inRoom;
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setCommonReady(true);
      setHostReady(true);
      return;
    }
    let stopped = false;
    let knownController = navigator.serviceWorker.controller;
    const changed = () => {
      if (knownController && !active.current) location.reload();
      else if (knownController) setUpdate(true);
      else setUpdate(false);
      knownController = navigator.serviceWorker.controller;
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then(async (reg) => {
        if (stopped) return;
        const check = () => {
          if (
            reg.waiting &&
            reg.active?.state === "activated" &&
            navigator.serviceWorker.controller
          )
            setUpdate(true);
        };
        reg.addEventListener("updatefound", () =>
          reg.installing?.addEventListener("statechange", check),
        );
        check();
        const ready = await navigator.serviceWorker.ready;
        if (!stopped) setRegistration(ready);
      })
      .catch(() => {
        // Browsers with service workers disabled can still play using normal HTTP caching.
        if (!stopped) {
          setCommonReady(true);
          setHostReady(true);
        }
      });
    return () => {
      stopped = true;
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
    };
  }, []);
  useEffect(() => {
    if (!registration || playing) return;
    const check = () => {
      void registration.update().catch(() => {});
    };
    check();
    const timer = setInterval(check, 60000);
    const visible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [registration, playing]);
  useEffect(() => {
    if (update && registration?.waiting && !playing && !inRoom)
      registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
  }, [update, registration, playing, inRoom]);
  useEffect(() => {
    if (!owner) {
      delete window.__bomberPreparedRom;
      setRomReady(false);
      return;
    }
    // Netplay installs a legally owned copy explicitly in the room. Never
    // redownload the owner's private ROM simply by reopening the homepage.
    if (netplay || playing || romReady) return;
    const controller = new AbortController();
    void fetch("/api/rom", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok)
          throw Error(
            res.status === 404
              ? "Importe sua ROM na área do proprietário."
              : "Não foi possível preparar o jogo.",
          );
        const data = new Uint8Array(await res.arrayBuffer());
        if (controller.signal.aborted) return;
        window.__bomberPreparedRom = data;
        setRomReady(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [owner, playing, romReady, attempt, netplay]);
  useEffect(() => {
    const worker = registration?.active;
    if (!worker) return;
    if (playing) {
      worker.postMessage({ type: "PAUSE_DOWNLOADS" });
      return;
    }
    let stopped = false;
    void (async () => {
      try {
        if (!commonReady) {
          await prepare(worker, "common", (done, total) => {
            if (!stopped) setProgress(`Preparando arquivos: ${done}/${total}`);
          });
          if (!stopped) setCommonReady(true);
        }
        if ((owner || netplay) && !hostReady && !stopped) {
          await prepare(worker, netplay ? "netplay" : "host", (done, total) => {
            if (!stopped) setProgress(`Preparando emulador: ${done}/${total}`);
          });
          if (!stopped) setHostReady(true);
        }
        if (!stopped) setProgress("");
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof Error ? e.message : "Falha ao preparar arquivos.",
          );
      }
    })();
    return () => {
      stopped = true;
      worker.postMessage({ type: "PAUSE_DOWNLOADS" });
    };
    // Readiness changes are results of this queue, not a reason to restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registration, owner, playing, attempt, netplay]);
  const retry = useCallback(() => {
    setError("");
    setAttempt((n) => n + 1);
  }, []);
  const invalidateRom = useCallback(() => {
    delete window.__bomberPreparedRom;
    setRomReady(false);
    retry();
  }, [retry]);
  return {
    ready:
      commonReady && (netplay ? hostReady : !owner || (hostReady && romReady)),
    progress,
    error,
    update,
    retry,
    invalidateRom,
    applyUpdate: () => {
      if (active.current) return;
      if (registration?.waiting)
        registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
      else location.reload();
    },
  };
}
