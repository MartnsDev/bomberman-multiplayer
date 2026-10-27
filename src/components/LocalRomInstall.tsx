"use client";
import { useEffect, useState } from "react";
import { PUBLIC_ROM_URL, PUBLIC_ROM_SHA256 } from "@/lib/netplay/public-rom";
import {
  installLocalRom,
  readLocalRom,
  type LocalRom,
} from "@/lib/netplay/local-rom";
export default function LocalRomInstall({
  expectedHash,
  owner,
  installed,
}: {
  expectedHash?: string;
  owner: boolean;
  installed: (rom: LocalRom) => void;
}) {
  const [state, setState] = useState("Verificando instalação local…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stopped = false;
    void readLocalRom(expectedHash)
      .then((rom) => {
        if (stopped) return;
        if (rom) {
          installed(rom);
          setReady(true);
          setState("Jogo instalado neste aparelho.");
        } else
          setState("Instale sua cópia do jogo neste aparelho para participar.");
      })
      .catch((e: unknown) => {
        if (!stopped)
          setError(
            e instanceof Error ? e.message : "Falha no armazenamento local.",
          );
      })
      .finally(() => {
        if (!stopped) setBusy(false);
      });
    return () => {
      stopped = true;
    };
  }, [expectedHash, installed]);
  async function install(blob: Blob, requiredHash = expectedHash) {
    setBusy(true);
    setError("");
    try {
      const rom = await installLocalRom(blob, requiredHash);
      installed(rom);
      setReady(true);
      setState(
        "Jogo instalado e verificado. Nas próximas partidas, ele será carregado deste aparelho.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível instalar o jogo.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="local-install"
      role="region"
      aria-label="Instalação local do jogo"
    >
      <p className="eyebrow">
        {ready ? "JOGO INSTALADO" : "SEU JOGO, NESTE APARELHO"}
      </p>
      <p role="status">{busy ? "Verificando e preparando o jogo…" : state}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {ready && (
        <button onClick={() => setReady(false)}>Usar outra cópia local</button>
      )}
      {!ready && (
        <>
          {(!expectedHash || expectedHash === PUBLIC_ROM_SHA256) && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void fetch(PUBLIC_ROM_URL, {
                  cache: "force-cache",
                  credentials: "omit",
                })
                  .then(async (r) => {
                    if (!r.ok)
                      throw Error(
                        "Não foi possível baixar o jogo. Tente novamente ou importe o arquivo local.",
                      );
                    await install(await r.blob(), PUBLIC_ROM_SHA256);
                  })
                  .catch((e: unknown) => {
                    setBusy(false);
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Falha ao baixar o jogo.",
                    );
                  });
              }}
            >
              Instalar jogo neste aparelho
            </button>
          )}
          <label className="rom-import">
            Importar minha ROM (.sfc ou .smc)
            <input
              type="file"
              accept=".sfc,.smc"
              disabled={busy}
              aria-label="Importar ROM local"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) void install(file);
                e.currentTarget.value = "";
              }}
            />
          </label>
          {owner && (
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void fetch("/api/rom", { cache: "no-store" })
                  .then(async (r) => {
                    if (!r.ok)
                      throw Error(
                        "Importe sua ROM na área do proprietário primeiro.",
                      );
                    await install(await r.blob());
                  })
                  .catch((e: unknown) => {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Não foi possível acessar sua biblioteca.",
                    );
                    setBusy(false);
                  });
              }}
            >
              Instalar minha cópia da biblioteca privada
            </button>
          )}
          <small>
            A instalação usa a cópia disponibilizada pelo proprietário no
            GitHub. Você também pode importar sua própria cópia da mesma versão.
            O jogo fica salvo neste navegador para as próximas partidas.
          </small>
        </>
      )}
    </div>
  );
}
