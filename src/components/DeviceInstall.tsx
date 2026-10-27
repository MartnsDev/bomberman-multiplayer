"use client";
import { useCallback, useEffect, useState } from "react";
import LocalRomInstall from "./LocalRomInstall";
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export default function DeviceInstall({ owner }: { owner: boolean }) {
  const [hash, setHash] = useState<string | null>(),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [prompt, setPrompt] = useState<InstallPrompt>();
  const installed = useCallback(() => setReady(true), []);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/netplay/config", {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error("Não foi possível verificar a instalação.");
        setHash((await r.json()).rom ?? null);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    const offer = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", offer);
    return () => {
      abort.abort();
      window.removeEventListener("beforeinstallprompt", offer);
    };
  }, []);
  return (
    <details className="device-install">
      <summary>
        {ready
          ? "Jogo instalado neste aparelho"
          : "Instalar o jogo neste aparelho"}
      </summary>
      <p>
        Prepare uma vez. Sua cópia fica salva neste navegador e é reutilizada ao
        entrar nas próximas salas.
      </p>
      {hash !== undefined && (
        <LocalRomInstall
          owner={owner}
          expectedHash={hash ?? undefined}
          installed={installed}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {prompt ? (
        <button
          onClick={() =>
            void prompt
              .prompt()
              .then(() => prompt.userChoice)
              .then(() => setPrompt(undefined))
          }
        >
          Adicionar Bomberman à tela inicial
        </button>
      ) : (
        <small>
          Você também pode usar o menu do navegador → Adicionar à tela inicial
          para abrir o site como aplicativo.
        </small>
      )}
    </details>
  );
}
