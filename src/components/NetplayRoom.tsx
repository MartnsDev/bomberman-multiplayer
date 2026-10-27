"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { get, set } from "idb-keyval";
import type { Command, Room, Signal } from "@/lib/protocol";
import { BUTTONS } from "@/lib/protocol";
import { bindControls } from "@/lib/remote/controls";
import type { FrameCore } from "@/lib/netplay/lockstep";
import { DataPeer } from "@/lib/netplay/peer";
import { NetplaySession, type NetplayStatus } from "@/lib/netplay/session";
import { NETPLAY_PROTOCOL, type Compatibility } from "@/lib/netplay/protocol";
import type { LocalRom } from "@/lib/netplay/local-rom";
import LocalRomInstall from "./LocalRomInstall";
import PlayerAvatar from "./PlayerAvatar";
import TouchControls, { type TouchMode, type TouchSize } from "./TouchControls";
interface NativeNetplay extends FrameCore {
  version: string;
  reset: () => Promise<void>;
  volume: (v: number) => void;
  resumeAudio: () => Promise<void>;
}
interface CoreConfig {
  version: string;
  protocol: typeof NETPLAY_PROTOCOL;
  core: string;
  settings: string;
  rom: string | null;
}
declare global {
  interface Window {
    __bomberNetplayRom?: Uint8Array;
  }
}
const initialStatus: NetplayStatus = {
  phase: "connecting",
  message: "Instale o jogo para preparar a emulação local.",
  frame: 0,
  fps: 0,
  rtt: 0,
  corrections: 0,
  verifiedFrame: 0,
  readySlots: [],
  inputDelay: 6,
  automaticDelay: true,
  activeSlots: [],
};
export default function NetplayRoom({
  room,
  selfId,
  owner,
  send,
  listener,
  pending,
  iceServers,
  keys,
  disabled,
  touchMode,
  touchSize,
  volume,
  setVolume,
  controls,
  notice,
  canStart,
}: {
  room: Room;
  selfId: string;
  owner: boolean;
  send: (command: Command) => void;
  listener: RefObject<((from: string, signal: Signal) => void) | undefined>;
  pending: RefObject<{ from: string; signal: Signal }[]>;
  iceServers: RTCIceServer[];
  keys: string[];
  disabled: boolean;
  touchMode: TouchMode;
  touchSize: TouchSize;
  volume: number;
  setVolume: (volume: number) => void;
  controls: () => void;
  notice: (message: string) => void;
  canStart: (ready: boolean) => void;
}) {
  const [config, setConfig] = useState<CoreConfig>();
  const [rom, setRom] = useState<LocalRom>();
  const [core, setCore] = useState<NativeNetplay>();
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState("");
  const [pressed, setPressed] = useState<number[]>([]);
  const [delay, setDelay] = useState<number | "auto">("auto");
  const [expanded, setExpanded] = useState(false);
  const [reconnection, setReconnection] = useState(0);
  const [operation, setOperation] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null),
    screen = useRef<HTMLDivElement>(null);
  const session = useRef<NetplaySession>(undefined);
  const touch = useRef(new Set<number>());
  const heldButtons = useRef<number[]>([]);
  const openedMobileGame = useRef(false);
  const corrections = useRef(0);
  const started = useRef(room.started);
  const canonicalReady = useRef(!room.started);
  if (status.phase === "ready" || status.phase === "running")
    canonicalReady.current = true;
  started.current = room.started;
  const host = room.hostId === selfId;
  const slot = room.players.find((p) => p.id === selfId)?.slot ?? 0;
  const members = room.players;
  const membersRef = useRef(members);
  membersRef.current = members;
  const transport = useRef<{ update: () => void }>(undefined);
  const memberKey = members
    .map((p) => `${p.id}:${p.slot}:${p.connected}`)
    .sort()
    .join("|");
  const installed = useCallback((value: LocalRom) => {
    window.__bomberNetplayRom = value.bytes;
    setCore(undefined);
    setRom(value);
    setError("");
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/netplay/config", {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok)
          throw Error("Não foi possível verificar a versão do netplay.");
        const value = (await r.json()) as CoreConfig;
        if (value.protocol !== NETPLAY_PROTOCOL)
          throw Error("Atualize o site para carregar a mesma versão da sala.");
        setConfig(value);
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "Falha de configuração.");
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const ready = () => {
      const value = (
        iframe.current?.contentWindow as
          (Window & { __bomberNetplay?: NativeNetplay }) | null
      )?.__bomberNetplay;
      if (value && value.version === config?.version) setCore(value);
      else if (value)
        setError(
          "O core está desatualizado. Saia da sala e atualize a página.",
        );
    };
    window.addEventListener("bomber-netplay-ready", ready);
    const failure = () =>
      setError(
        "Não foi possível iniciar o emulador local. Atualize a página e confira sua instalação.",
      );
    window.addEventListener("bomber-netplay-error", failure);
    return () => {
      window.removeEventListener("bomber-netplay-ready", ready);
      window.removeEventListener("bomber-netplay-error", failure);
    };
  }, [config?.version]);
  useEffect(() => {
    core?.volume(volume);
  }, [core, volume]);
  useEffect(() => {
    if (!core || !config || !rom) return;
    const generation = crypto.randomUUID();
    const peers = new Map<
      string,
      { peer: DataPeer; id: string; remoteGeneration: string; slot: number }
    >();
    const remoteReady = new Map<string, string>();
    const earlyCandidates = new Map<string, Signal[]>();
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const compatibility: Compatibility = {
      protocol: NETPLAY_PROTOCOL,
      core: config.core,
      settings: config.settings,
      rom: rom.sha256,
    };
    const game = new NetplaySession({
      host,
      slot,
      slots: members.map((p) => p.slot),
      core,
      compatibility,
      resumeOnReady: started.current,
      corrections: corrections.current,
      coordinatorStalled: () =>
        send({ type: "elect-host", hostId: room.hostId }),
      update: (value) => {
        corrections.current = value.corrections;
        setStatus(value);
      },
    });
    game.setDelay(delay);
    game.setButtons(heldButtons.current);
    session.current = game;
    const signal = (target: string, value: Signal) => {
      if (
        !stopped &&
        membersRef.current.some((p) => p.id === target && p.connected)
      )
        send({ type: "signal", target, signal: value });
    };
    const recoverPeer = (id: string, peer: DataPeer, message?: string) => {
      const entry = peers.get(id);
      if (stopped || entry?.peer !== peer) return;
      peers.delete(id);
      remoteReady.delete(id);
      earlyCandidates.delete(entry.id);
      game.disconnect(entry.slot);
      peer.close();
      if (!host && !reconnectTimer) {
        if (started.current) send({ type: "elect-host", hostId: room.hostId });
        reconnectTimer = setTimeout(() => {
          if (!stopped) setReconnection((n) => n + 1);
        }, 1500);
      }
      if (message?.includes("incompatível")) setError(message);
    };
    const make = (
      id: string,
      remoteGeneration: string,
      connection = crypto.randomUUID(),
    ) => {
      const member = membersRef.current.find((p) => p.id === id);
      if (
        !member ||
        !member.connected ||
        member.id === selfId ||
        (!host && member.id !== room.hostId)
      )
        return;
      const previous = peers.get(id);
      if (previous?.id === connection) return previous.peer;
      if (previous) {
        previous.peer.close();
        game.disconnect(member.slot);
      }
      const peer: DataPeer = new DataPeer({
        initiator: host,
        iceServers,
        signal: (value) =>
          signal(id, {
            kind: "netplay",
            connection,
            generation,
            targetGeneration: remoteGeneration,
            signal: value,
          }),
        opened: () => {
          if (stopped || peers.get(id)?.peer !== peer) return;
          game.attach(member.slot, (data) => peer.send(data));
          if (
            [...peers.values()].every(
              (entry) => entry.peer.pc.connectionState === "connected",
            )
          ) {
            clearTimeout(reconnectTimer);
            reconnectTimer = undefined;
          }
        },
        message: (data) =>
          peers.get(id)?.peer === peer
            ? game.receive(member.slot, data)
            : Promise.resolve(),
        disconnected: () => recoverPeer(id, peer),
        error: (message) => recoverPeer(id, peer, message),
      });
      peers.set(id, {
        peer,
        id: connection,
        remoteGeneration,
        slot: member.slot,
      });
      return peer;
    };
    const receive = (from: string, value: Signal) => {
      if (
        stopped ||
        !membersRef.current.some((p) => p.id === from) ||
        (!host && from !== room.hostId)
      )
        return;
      if (value.kind === "netplay-ready") {
        const previous = remoteReady.get(from);
        remoteReady.set(from, value.generation);
        if (previous !== value.generation || !peers.has(from))
          signal(from, { kind: "netplay-ready", generation });
        if (host && previous !== value.generation) {
          const peer = make(from, value.generation);
          if (peer) void peer.offer().catch(() => recoverPeer(from, peer));
        }
      } else if (
        value.kind === "netplay" &&
        value.targetGeneration === generation
      ) {
        if (remoteReady.get(from) !== value.generation) return;
        let entry = peers.get(from);
        if (
          entry?.id !== value.connection &&
          value.signal.kind === "candidate"
        ) {
          if (
            !earlyCandidates.has(value.connection) &&
            earlyCandidates.size >= 8
          )
            earlyCandidates.delete(earlyCandidates.keys().next().value!);
          const queue = earlyCandidates.get(value.connection) ?? [];
          if (queue.length < 64) queue.push(value);
          earlyCandidates.set(value.connection, queue);
          return;
        }
        if (
          entry?.id !== value.connection &&
          value.signal.kind === "description" &&
          value.signal.description.type === "offer" &&
          !host
        ) {
          make(from, value.generation, value.connection);
          entry = peers.get(from);
        }
        if (entry?.id === value.connection) {
          const peer = entry.peer;
          for (const item of earlyCandidates.get(value.connection) ?? [])
            if (item.kind === "netplay")
              void peer
                .accept(item.signal)
                .catch(() => recoverPeer(from, peer));
          earlyCandidates.delete(value.connection);
          void peer.accept(value.signal).catch(() => recoverPeer(from, peer));
        }
      }
    };
    listener.current = receive;
    for (const item of pending.current.splice(0))
      receive(item.from, item.signal);
    for (const member of membersRef.current)
      if (
        member.connected &&
        member.id !== selfId &&
        (host || member.id === room.hostId)
      )
        signal(member.id, { kind: "netplay-ready", generation });
    const announce = setInterval(() => {
      for (const member of membersRef.current)
        if (
          member.connected &&
          member.id !== selfId &&
          (host || member.id === room.hostId) &&
          peers.get(member.id)?.peer.pc.connectionState !== "connected"
        )
          signal(member.id, { kind: "netplay-ready", generation });
    }, 2000);
    const update = () => {
      const roster = membersRef.current;
      for (const [id, entry] of peers)
        if (!roster.some((p) => p.id === id)) {
          entry.peer.close();
          peers.delete(id);
          game.disconnect(entry.slot);
        }
      game.setMembers(
        // Reserved offline slots remain valid protocol positions. Presence can
        // reach each browser before its RTC close event; it must not invalidate
        // another peer's roster while that channel is still closing.
        roster.map((p) => p.slot),
      );
      for (const member of roster)
        if (
          member.connected &&
          member.id !== selfId &&
          (host || member.id === room.hostId) &&
          !peers.has(member.id)
        )
          signal(member.id, { kind: "netplay-ready", generation });
    };
    transport.current = { update };
    update();
    if (host && started.current)
      void game.prepare(undefined, core.frame(), true);
    return () => {
      stopped = true;
      transport.current = undefined;
      listener.current = undefined;
      clearTimeout(reconnectTimer);
      clearInterval(announce);
      game.close();
      for (const entry of peers.values()) entry.peer.close();
      if (session.current === game) session.current = undefined;
    };
    // Membership updates preserve the running transport. Only a coordinator
    // change or a local reconnect creates a new session generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    core,
    config,
    rom?.sha256,
    host,
    room.hostId,
    selfId,
    slot,
    send,
    iceServers,
    listener,
    pending,
    reconnection,
  ]);
  useEffect(() => {
    transport.current?.update();
  }, [memberKey]);
  useEffect(() => {
    if (core)
      send({
        type:
          document.hidden || !canonicalReady.current
            ? "game-away"
            : "game-ready",
      });
  }, [core, send, room.players, status.phase]);
  useEffect(() => {
    const hidden = () => {
      if (!core) return;
      send({
        type:
          document.hidden || !canonicalReady.current
            ? "game-away"
            : "game-ready",
      });
      if (host && room.started && document.hidden) send({ type: "yield-host" });
    };
    hidden();
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [core, host, room.started, send]);
  useEffect(() => {
    if (!core || !host) return;
    const save = () => {
      try {
        void set("bomber.netplay.snes9x.v1", core.save()).catch(() => {});
      } catch {
        /* Preserve the previous save if the core has already closed. */
      }
    };
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [core, host]);
  useEffect(() => {
    canStart(host && status.phase === "ready");
    if (host && room.started && status.phase === "ready")
      session.current?.start();
  }, [host, room.started, status.phase, canStart]);
  useEffect(() => {
    if (disabled) return;
    return bindControls(
      (buttons) => {
        heldButtons.current = buttons;
        setPressed(buttons);
        session.current?.setButtons(buttons);
      },
      keys,
      touch.current,
    );
  }, [disabled, keys]);
  const updateTouch = useCallback((buttons: number[]) => {
    touch.current.clear();
    for (const b of buttons) touch.current.add(b);
    window.dispatchEvent(new Event("bomber-touch"));
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const leave = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", leave);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", leave);
    };
  }, [expanded]);
  useEffect(() => {
    if (!room.started) {
      openedMobileGame.current = false;
      return;
    }
    if (status.phase === "paused") {
      setExpanded(false);
      return;
    }
    if (core && status.phase === "running" && !openedMobileGame.current) {
      openedMobileGame.current = true;
      if (matchMedia("(any-pointer: coarse)").matches) setExpanded(true);
    }
  }, [room.started, core, status.phase]);
  useEffect(
    () => () => {
      canStart(false);
    },
    [canStart],
  );
  async function restore() {
    if (operation) return;
    setOperation(true);
    try {
      const state =
        (await get<Uint8Array>("bomber.netplay.snes9x.v1")) ??
        (await get<Uint8Array>("bomber.snes9x.4.2.3"));
      if (!state) throw Error("Nenhum save local encontrado.");
      await session.current?.prepare(state, 0, room.started);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível restaurar o progresso.",
      );
    } finally {
      setOperation(false);
    }
  }
  return (
    <section className="session-layout" aria-label="Partida com emulação local">
      <div className="game-area">
        {config && (
          <LocalRomInstall
            expectedHash={config.rom ?? undefined}
            owner={owner}
            installed={installed}
          />
        )}
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        {!room.started && (
          <div className="lobby netplay-lobby">
            <h2>O jogo roda no aparelho de cada um.</h2>
            <p>
              Instalem a mesma ROM e aguardem a validação de todos. Imagem e
              áudio são produzidos localmente.
            </p>
          </div>
        )}
        <div
          ref={screen}
          className={room.started ? "play-surface" : "netplay-preload"}
          data-expanded={expanded}
          data-touch-mode={touchMode}
          data-touch-size={touchSize}
        >
          <div className="screen">
            {rom && config && (
              <iframe
                key={rom.sha256}
                ref={iframe}
                src="/netplay-emulator.html"
                title="Super Bomberman 5 local"
                allow="autoplay; fullscreen"
              />
            )}
            {room.started && !core && (
              <div className="screen-wait">
                Prepare sua instalação local para continuar.
              </div>
            )}
          </div>
          {room.started && (
            <TouchControls
              mode={touchMode}
              size={touchSize}
              disabled={disabled}
              onChange={updateTouch}
            />
          )}
          {room.started && (
            <div className="fullscreen-tools">
              <button
                onClick={() =>
                  void core
                    ?.resumeAudio()
                    .catch(() =>
                      setError("Toque novamente para ativar o áudio."),
                    )
                }
              >
                Ativar áudio
              </button>
              <button onClick={() => setExpanded(false)}>
                Sair da tela cheia
              </button>
            </div>
          )}
          {expanded && status.phase !== "running" && (
            <div className="game-connection-note" role="status">
              {status.message}
            </div>
          )}
        </div>
        <div
          className="netplay-status"
          role="status"
          data-frame={status.frame}
          data-verified-frame={status.verifiedFrame}
          data-corrections={status.corrections}
          data-fps={status.fps}
          data-phase={status.phase}
          data-input-delay={status.inputDelay}
        >
          <span className={status.phase === "running" ? "online" : ""}>
            {status.message}
          </span>
          <small>
            {status.fps} FPS local · {Math.round(status.rtt)} ms de latência ·
            Quadro {status.frame} · {status.corrections} ressincronizações
            {" · "}
            {status.automaticDelay
              ? "Atraso automático"
              : "Atraso de entrada"}: {status.inputDelay} quadros
          </small>
        </div>
        {room.started && (
          <div className="toolbar">
            <span>Controle {slot + 1} · Emulação local</span>
            <label>
              Volume
              <input
                aria-label="Volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </label>
            <button onClick={() => setExpanded(true)}>Tela cheia</button>
            <button
              onClick={() =>
                void core
                  ?.resumeAudio()
                  .catch(() => setError("Toque novamente para ativar o áudio."))
              }
            >
              Ativar áudio
            </button>
            <button onClick={controls}>Controles</button>
          </div>
        )}
        {host && (
          <div className="host-tools">
            {!room.started && (
              <label>
                Atraso de entrada{" "}
                <select
                  aria-label="Atraso de entrada"
                  value={delay}
                  onChange={(e) => {
                    const value =
                      e.target.value === "auto"
                        ? "auto"
                        : Number(e.target.value);
                    setDelay(value);
                    session.current?.setDelay(value);
                  }}
                >
                  <option value="auto">
                    Automático (recomendado no celular)
                  </option>
                  {[2, 3, 4, 6, 8, 10, 12, 16, 20, 24].map((v) => (
                    <option key={v} value={v}>
                      {v} quadros
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              disabled={!core}
              onClick={() => {
                if (core)
                  void set("bomber.netplay.snes9x.v1", core.save())
                    .then(() => notice("Progresso salvo neste navegador."))
                    .catch(() => setError("Não foi possível salvar."));
              }}
            >
              Salvar progresso
            </button>
            <button
              disabled={
                operation ||
                status.phase === "preparing" ||
                !session.current?.canPrepare
              }
              onClick={() => void restore()}
            >
              Restaurar para todos
            </button>
            <button
              disabled={
                operation ||
                status.phase === "preparing" ||
                !core ||
                !session.current?.canPrepare
              }
              onClick={() => {
                if (!core || operation) return;
                setOperation(true);
                session.current?.pause("Reiniciando a partida para todos…");
                void core
                  .reset()
                  .then(() =>
                    session.current?.prepare(undefined, 0, room.started),
                  )
                  .catch((e) =>
                    setError(
                      e instanceof Error ? e.message : "Falha ao reiniciar.",
                    ),
                  )
                  .finally(() => setOperation(false));
              }}
            >
              Reiniciar jogo para todos
            </button>
            {status.phase === "paused" && (
              <button
                onClick={() =>
                  void session.current?.prepare(
                    undefined,
                    session.current.frame,
                    room.started,
                  )
                }
              >
                Ressincronizar
              </button>
            )}
          </div>
        )}
        {status.phase === "paused" && (
          <button onClick={() => setReconnection((n) => n + 1)}>
            Reconectar controles
          </button>
        )}
        <div className="control-test">
          <p className="eyebrow">TESTE SEU CONTROLE</p>
          <div className="buttons-test">
            {BUTTONS.map((b, i) => (
              <span key={b} className={pressed.includes(i) ? "pressed" : ""}>
                {b}
              </span>
            ))}
          </div>
          <small>Setas para mover · X para bomba · Enter para Start</small>
        </div>
      </div>
      <aside className="players">
        <p className="eyebrow">
          NA SALA · {room.players.length}/{room.capacity}
        </p>
        {room.players.map((p) => (
          <article key={p.id}>
            <span className="player-portrait">
              <PlayerAvatar name={p.name} avatar={p.avatar} />
              <span className={`slot-badge p${p.slot}`}>{p.slot + 1}</span>
            </span>
            <div>
              <strong>
                {p.name}
                {p.id === selfId ? " (você)" : ""}
              </strong>
              <small>
                {p.id === room.hostId ? "Coordenador" : "Jogador"} · Controle{" "}
                {p.slot + 1}
              </small>
              <small
                className={status.readySlots.includes(p.slot) ? "online" : ""}
              >
                {!p.connected
                  ? "Reconectando…"
                  : room.started && !status.activeSlots.includes(p.slot)
                    ? "Controle inativo · os demais continuam"
                    : status.readySlots.includes(p.slot)
                      ? "ROM e core prontos"
                      : "Preparando instalação local…"}
              </small>
            </div>
          </article>
        ))}
        <p className="aside-note">
          Cada aparelho executa o jogo. A conexão transmite comandos e
          verificações de sincronização.
        </p>
        {host && (
          <p className="aside-note">
            <strong>Antes da batalha</strong>
            <br />
            Em PLAYER SELECT, use ↑↓ e ←→ para colocar MAN nos controles{" "}
            {room.players
              .map((p) => p.slot + 1)
              .sort()
              .join(", ")}
            . Os demais podem ficar como COM ou OFF. Cada jogador confirma seu
            personagem com Start.
          </p>
        )}
      </aside>
    </section>
  );
}
