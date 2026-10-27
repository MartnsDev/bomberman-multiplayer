"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { get, set } from "idb-keyval";
import { BUTTONS, DEFAULT_KEYS } from "@/lib/protocol";
import { bindControls } from "@/lib/remote/controls";
import { bridge } from "@/lib/emulation/adapter";
import Home from "./Home";
import DeviceInstall from "./DeviceInstall";
import RoomInviteCard from "./RoomInviteCard";
import {
  ChevronRight,
  CircleDot,
  Gamepad2,
  Settings,
  UsersRound,
  Plus,
  Link2,
} from "lucide-react";
import ProfilePicker from "./ProfilePicker";
import PlayerAvatar from "./PlayerAvatar";
import InputDiagnostics from "./InputDiagnostics";
import NetplayRoom from "./NetplayRoom";
import TouchControls, { type TouchMode, type TouchSize } from "./TouchControls";
import { useSession } from "./useSession";
import { usePreparation } from "./usePreparation";
import { installLocalRom } from "@/lib/netplay/local-rom";
const statusLabel = (status: string) =>
  ({
    new: "Aguardando conexão",
    connecting: "Conectando",
    connected: "Conectado",
    disconnected: "Desconectado",
    failed: "Falha na conexão",
    closed: "Conexão encerrada",
  })[status] ?? status;
type Panel = "admin" | "join" | "create" | "settings" | "rooms" | null;
export default function Console({ netplay = false }: { netplay?: boolean }) {
  const s = useSession();
  const [owner, setOwner] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string>();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [volume, setVolume] = useState(0.7);
  const [keys, setKeys] = useState([...DEFAULT_KEYS]);
  const [mapping, setMapping] = useState<number>();
  const [pressed, setPressed] = useState<number[]>([]);
  const [low, setLow] = useState(false);
  const [touchMode, setTouchMode] = useState<TouchMode>("auto");
  const [touchSize, setTouchSize] = useState<TouchSize>("normal");
  const [expanded, setExpanded] = useState(false);
  const [netplayCanStart, setNetplayCanStart] = useState(false);
  const touch = useRef(new Set<number>());
  const updateTouch = useCallback((buttons: number[]) => {
    touch.current.clear();
    for (const button of buttons) touch.current.add(button);
    window.dispatchEvent(new Event("bomber-touch"));
  }, []);
  const host = s.room?.hostId === s.selfId;
  const playing = s.solo || !!s.room?.started;
  const local = owner && (s.solo || (host && !!s.room?.started));
  const preparation = usePreparation(owner, playing, !!s.room, netplay);
  useEffect(() => {
    void fetch("/api/auth")
      .then((r) => r.json())
      .then((x) => setOwner((prev) => prev || x.owner))
      .catch(() =>
        setNotice(
          "Não foi possível verificar o acesso. Confira sua conexão e tente novamente.",
        ),
      );
    const savedTouch = localStorage.getItem("bomber.touch");
    if (savedTouch === "auto" || savedTouch === "on" || savedTouch === "off")
      setTouchMode(savedTouch);
    if (
      localStorage.getItem("bomber.touch.size") === "large" ||
      (!localStorage.getItem("bomber.touch.size") &&
        matchMedia("(any-pointer: coarse)").matches)
    )
      setTouchSize("large");
    const saved = localStorage.getItem("bomber.keys");
    try {
      const value = JSON.parse(saved ?? "null");
      if (
        Array.isArray(value) &&
        value.length === 12 &&
        value.every((x) => typeof x === "string")
      )
        setKeys(value);
    } catch {}
    const invite = new URLSearchParams(location.search).get("sala");
    if (invite) {
      setCode(invite.toUpperCase());
      setPanel("join");
    }
  }, []);
  useEffect(() => {
    if (s.room)
      setPanel((value) =>
        value === "join" || value === "create" ? null : value,
      );
  }, [s.room?.code]);
  useEffect(() => {
    if (panel || (!s.room && !s.solo) || (netplay && s.room)) return;
    return bindControls(
      (buttons) => {
        setPressed(buttons);
        s.controls(buttons);
      },
      keys,
      touch.current,
    );
  }, [keys, panel, s.controls, !!s.room, s.solo, netplay]);
  useEffect(() => {
    if (!playing) setExpanded(false);
  }, [playing]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    const exit = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    window.addEventListener("keydown", escape);
    document.addEventListener("fullscreenchange", exit);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", escape);
      document.removeEventListener("fullscreenchange", exit);
    };
  }, [expanded]);
  useEffect(() => {
    if (!playing) return;
    let lock: WakeLockSentinel | undefined;
    let stopped = false;
    const wake = async () => {
      if (document.hidden) return;
      try {
        if (!lock || lock.released) {
          const next = await navigator.wakeLock?.request("screen");
          if (stopped) await next?.release();
          else lock = next;
        }
      } catch {
        /* Battery saving and older browsers may refuse a screen lock. */
      }
      if (!local && s.video.current?.srcObject)
        void s.video.current.play().catch(() => {});
    };
    void wake();
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true;
      void lock?.release().catch(() => {});
      document.removeEventListener("visibilitychange", wake);
    };
  }, [playing, local, s.video]);
  useEffect(() => {
    if (mapping === undefined) return;
    const listener = (event: KeyboardEvent) => {
      event.preventDefault();
      setKeys((prev) => {
        const next = prev.map((key, i) =>
          i === mapping ? event.code : key === event.code ? "" : key,
        );
        localStorage.setItem("bomber.keys", JSON.stringify(next));
        return next;
      });
      setMapping(undefined);
    };
    window.addEventListener("keydown", listener, { once: true });
    return () => window.removeEventListener("keydown", listener);
  }, [mapping]);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw Error(await res.text());
      setOwner(true);
      s.reconnect();
      setPassword("");
      setNotice("Administração desbloqueada.");
    } catch (e) {
      s.setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function importRom(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const res = await fetch("/api/rom", { method: "PUT", body: file });
      if (!res.ok) throw Error(await res.text());
      if (netplay) await installLocalRom(file);
      else preparation.invalidateRom();
      setNotice("ROM importada no armazenamento privado. Pronta para jogar.");
    } catch (e) {
      s.setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    try {
      const data = bridge(s.iframe.current)?.save();
      if (!data?.length) throw Error("O core não disponibilizou um save.");
      await set("bomber.snes9x.4.2.3", data);
      setNotice("Progresso salvo neste navegador.");
    } catch (e) {
      s.setError(String(e));
    }
  }
  async function restore() {
    try {
      const data = await get<Uint8Array>("bomber.snes9x.4.2.3");
      if (!data) throw Error("Nenhum save local encontrado.");
      bridge(s.iframe.current)?.load(data);
      setNotice("Progresso restaurado.");
    } catch (e) {
      s.setError(String(e));
    }
  }
  const activateAudio = () => {
    if (local) {
      void bridge(s.iframe.current)
        ?.resumeAudio()
        .catch(() => s.setError("Toque novamente para ativar o áudio."));
    } else if (s.video.current) {
      s.video.current.muted = false;
      void s.video.current
        .play()
        .catch(() => s.setError("Reprodução bloqueada pelo navegador."));
    }
  };
  const openCreate = () => {
    if (owner) setPanel("create");
    else {
      setPanel("admin");
      setNotice("Entre como proprietário para criar uma sala.");
    }
  };
  const roomsActive =
    panel === "rooms" ||
    panel === "join" ||
    panel === "create" ||
    (!panel && !!s.room && !playing);
  const copy = async (link = false) => {
    try {
      await navigator.clipboard.writeText(
        link
          ? `${location.origin}${location.pathname}?sala=${s.room!.code}`
          : s.room!.code,
      );
      setNotice(link ? "Link copiado." : "Código copiado.");
    } catch {
      s.setError("Não foi possível copiar. Selecione o código manualmente.");
    }
  };
  return (
    <>
      <div className="site-ambient" data-playing={playing} aria-hidden="true">
        <img src="/optimized/icon.png" alt="" width={200} height={200} />
        <span className="ambient-beam" />
        <span className="ambient-tile tile-one" />
        <span className="ambient-tile tile-two" />
        <span className="ambient-tile tile-three" />
      </div>
      <main className={!playing && !s.room ? "home-page" : "session-page"}>
        <header className="topbar">
          <a className="brand" href="/" aria-label="Bomberman Online início">
            <img
              className="brand-logo"
              src="/optimized/icon.png"
              alt=""
              width="64"
              height="64"
            />
            <span>
              BOMBERMAN <b>ONLINE</b>
            </span>
          </a>
          <nav aria-label="Navegação principal">
            <button
              className={!panel && (!s.room || playing) ? "nav active" : "nav"}
              aria-current={!panel && (!s.room || playing) ? "page" : undefined}
              onClick={() => setPanel(null)}
            >
              <Gamepad2 size={25} aria-hidden="true" />
              <span>Jogar</span>
            </button>
            <button
              className={roomsActive ? "nav active" : "nav"}
              aria-current={roomsActive ? "page" : undefined}
              onClick={() => setPanel("rooms")}
            >
              <UsersRound size={25} aria-hidden="true" />
              <span>Salas</span>
            </button>
            <button
              className={panel === "settings" ? "nav active" : "nav"}
              aria-current={panel === "settings" ? "page" : undefined}
              onClick={() => setPanel("settings")}
            >
              <Settings size={25} aria-hidden="true" />
              <span>Configurações</span>
            </button>
          </nav>
          <button
            className="profile"
            onClick={() => setPanel("admin")}
            aria-label={
              owner
                ? "M Proprietário Acesso privado"
                : "Área do proprietário Entrar na administração"
            }
          >
            <span className="avatar" aria-hidden="true">
              <CircleDot size={27} />
            </span>
            <span className="owner-label">
              {owner ? "Proprietário" : "Área do proprietário"}
              <small>
                {owner ? "Acesso privado" : "Entrar na administração"}
              </small>
            </span>
            <ChevronRight
              className="owner-chevron"
              size={21}
              aria-hidden="true"
            />
          </button>
        </header>
        <div className="service-status" aria-label="Estado dos serviços">
          <div
            className="connection status-pill"
            role="status"
            aria-live="polite"
            data-state={
              s.network === "Sinalização conectada" ? "ready" : "waiting"
            }
          >
            <span className="status-dot" />
            {s.network}
          </div>
          <div
            className="preparation status-pill"
            role="status"
            aria-live="polite"
            data-state={
              preparation.ready
                ? "ready"
                : preparation.error
                  ? "error"
                  : "waiting"
            }
          >
            <span className="status-dot" />
            {preparation.ready
              ? netplay
                ? "Emulador preparado"
                : "Arquivos prontos para jogar"
              : preparation.error ||
                preparation.progress ||
                "Preparando arquivos antes da partida…"}
            {preparation.error && (
              <button onClick={preparation.retry}>Tentar novamente</button>
            )}
          </div>
        </div>
        {preparation.update && (
          <div className="update-banner" role="status">
            Nova versão disponível.{" "}
            {playing || s.room
              ? "Saia da sala para atualizar."
              : "Atualizando os arquivos…"}
            {!playing && !s.room && (
              <button onClick={preparation.applyUpdate}>Atualizar agora</button>
            )}
          </div>
        )}
        {s.error && !panel && (
          <div className="message error" role="alert">
            {s.error}
            <button onClick={() => s.setError("")}>Fechar</button>
          </div>
        )}
        {notice && !panel && (
          <div className="message" role="status">
            {notice}
            <button onClick={() => setNotice("")}>Fechar</button>
          </div>
        )}
        {!playing && !s.room && (
          <Home
            netplay={netplay}
            onCreate={openCreate}
            onJoin={() => setPanel("join")}
            onSolo={() => {
              if (owner && preparation.ready && !preparation.update)
                s.setSolo(true);
              else if (owner)
                setNotice(
                  "Aguarde a preparação dos arquivos antes de iniciar.",
                );
              else setPanel("admin");
            }}
          />
        )}
        {netplay && !playing && !s.room && <DeviceInstall owner={owner} />}
        {s.room && (
          <section className="room-bar">
            <div>
              <p className="eyebrow">
                {s.room.started ? "PARTIDA EM ANDAMENTO" : "SALA DE ESPERA"}
              </p>
              <h2>
                Sala{" "}
                <button
                  className="code"
                  onClick={() => void copy()}
                  title="Copiar código"
                >
                  {s.room.code} ⧉
                </button>
              </h2>
            </div>
            <div className="actions">
              <button onClick={() => void copy(true)}>Copiar convite</button>
              {host && !playing && (
                <button
                  className="primary"
                  disabled={
                    netplay
                      ? !netplayCanStart || preparation.update
                      : !preparation.ready || preparation.update
                  }
                  onClick={() => s.send({ type: "start" })}
                >
                  Iniciar partida
                </button>
              )}
              <button
                className="danger"
                onClick={() => {
                  s.leave();
                  setNotice("Você saiu da sala.");
                }}
              >
                {host && owner ? "Encerrar sala" : "Sair da sala"}
              </button>
            </div>
          </section>
        )}
        {netplay && s.room ? (
          <NetplayRoom
            room={s.room}
            selfId={s.selfId}
            owner={owner}
            send={s.send}
            listener={s.netplayListener}
            pending={s.netplaySignals}
            iceServers={s.ice.current}
            keys={keys}
            disabled={!!panel}
            touchMode={touchMode}
            touchSize={touchSize}
            volume={volume}
            setVolume={setVolume}
            controls={() => setPanel("settings")}
            notice={setNotice}
            canStart={setNetplayCanStart}
          />
        ) : (
          (playing || s.room) && (
            <section className="session-layout">
              <div className="game-area">
                {playing ? (
                  <>
                    <div
                      className="play-surface"
                      id="screen"
                      data-touch-mode={touchMode}
                      data-touch-size={touchSize}
                      data-expanded={expanded}
                    >
                      <div className="screen">
                        {local ? (
                          <iframe
                            ref={s.iframe}
                            src="/emulator.html"
                            title="Super Bomberman 5"
                            allow="autoplay; fullscreen"
                          />
                        ) : (
                          <video
                            ref={s.video}
                            autoPlay
                            muted
                            playsInline
                            controls={false}
                            aria-label="Transmissão do anfitrião"
                          />
                        )}
                        {!local &&
                          !Object.values(s.status).some(
                            (x) =>
                              x === "connected" || x === "controles conectados",
                          ) && (
                            <div className="screen-wait">
                              Aguardando transmissão do anfitrião…
                            </div>
                          )}
                      </div>
                      <TouchControls
                        mode={touchMode}
                        size={touchSize}
                        disabled={!!panel}
                        onChange={updateTouch}
                      />
                      <div className="fullscreen-tools">
                        <button
                          onClick={activateAudio}
                          aria-label="Áudio na tela cheia"
                        >
                          Ativar áudio
                        </button>
                        <button
                          className="fullscreen-exit"
                          onClick={() => {
                            setExpanded(false);
                            if (document.fullscreenElement)
                              void document.exitFullscreen().catch(() => {});
                          }}
                        >
                          Sair da tela cheia
                        </button>
                      </div>
                    </div>
                    <div className="toolbar">
                      <span className="dot" />
                      <span>
                        {s.solo
                          ? "Modo solo"
                          : `Controle ${(s.room?.players.find((p) => p.id === s.selfId)?.slot ?? 0) + 1}`}
                      </span>
                      <label>
                        Volume{" "}
                        <input
                          aria-label="Volume"
                          type="range"
                          min="0"
                          max="1"
                          step=".05"
                          value={volume}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setVolume(v);
                            bridge(s.iframe.current)?.volume(v);
                            if (s.video.current) s.video.current.volume = v;
                          }}
                        />
                      </label>
                      <button
                        onClick={async () => {
                          const surface = document.getElementById("screen");
                          setExpanded(true);
                          try {
                            await surface?.requestFullscreen?.();
                          } catch {
                            /* The page-based expanded view stays usable. */
                          }
                        }}
                      >
                        Tela cheia
                      </button>
                      <button onClick={activateAudio}>Ativar áudio</button>
                      {!local && (
                        <button onClick={() => s.reconnect()}>
                          Reconectar
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setExpanded(false);
                          setPanel("settings");
                        }}
                      >
                        Controles
                      </button>
                    </div>
                    <p className="touch-help">
                      Arraste no direcional e use os botões com o outro dedo.
                      Para aproveitar a tela, jogue na horizontal.
                    </p>
                    {local && (
                      <div className="host-tools">
                        <button disabled={!s.ready} onClick={() => void save()}>
                          Salvar progresso
                        </button>
                        <button
                          disabled={!s.ready}
                          onClick={() => void restore()}
                        >
                          Restaurar
                        </button>
                        <button
                          disabled={!s.ready}
                          onClick={() => bridge(s.iframe.current)?.restart()}
                        >
                          Reiniciar jogo
                        </button>
                        {s.solo && (
                          <button className="danger" onClick={() => s.leave()}>
                            Sair do jogo
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="lobby">
                    <span className="lobby-symbol">
                      <UsersRound size={52} aria-hidden="true" />
                    </span>
                    <h2>A turma está chegando.</h2>
                    <p>Compartilhe o convite e teste seu controle abaixo.</p>
                    <RoomInviteCard
                      room={s.room}
                      onCopy={() => void copy()}
                      className="lobby-invite"
                    />
                    <p className="subtle">
                      {host
                        ? "Quando estiver pronto, inicie a partida."
                        : "O anfitrião vai iniciar a partida."}
                    </p>
                  </div>
                )}
                <div className="control-test">
                  <p className="eyebrow">TESTE SEU CONTROLE</p>
                  <div className="buttons-test">
                    {BUTTONS.map((b, i) => (
                      <span
                        key={b}
                        className={pressed.includes(i) ? "pressed" : ""}
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                  <small>
                    Setas para mover · Z / X para ações · Enter para Start
                  </small>
                </div>
                {local && s.ready && (
                  <InputDiagnostics
                    slots={s.inputSlots}
                    enabled={s.inputDebug}
                  />
                )}
              </div>
              <aside className="players">
                <p className="eyebrow">
                  NA SALA · {s.room?.players.length ?? 1}/
                  {s.room?.capacity ?? 1}
                </p>
                {(
                  s.room?.players ?? [
                    {
                      id: "solo",
                      name: name || "Você",
                      avatar,
                      slot: 0,
                      connected: true,
                    },
                  ]
                ).map((p) => (
                  <article key={p.id}>
                    <span className="player-portrait">
                      <PlayerAvatar name={p.name} avatar={p.avatar} />
                      <span className={`slot-badge p${p.slot}`}>
                        {p.slot + 1}
                      </span>
                    </span>
                    <div>
                      <strong>
                        {p.name} {p.id === s.selfId ? "(você)" : ""}
                      </strong>
                      <small>
                        {p.slot === 0 ? "Anfitrião" : "Convidado"} · Controle{" "}
                        {p.slot + 1}
                      </small>
                      <small className={p.connected ? "online" : ""}>
                        {p.connected
                          ? statusLabel(s.status[p.id] ?? "Na sala")
                          : "Reconectando…"}
                      </small>
                      {s.diagnostics[p.id] && (
                        <small>{s.diagnostics[p.id]}</small>
                      )}
                    </div>
                  </article>
                ))}
                <p className="aside-note">
                  {host
                    ? "Você executa o jogo e transmite imagem e áudio. Mantenha esta aba aberta."
                    : "Seu controle é enviado diretamente ao anfitrião por WebRTC."}
                </p>
                {host && s.room?.started && (
                  <p className="aside-note">
                    <strong>Antes da batalha</strong>
                    <br />
                    Em PLAYER SELECT, use ↑↓ para escolher a posição e ←→ para
                    alternar MAN, COM e OFF. Coloque MAN nos controles{" "}
                    {s.room.players
                      .map((p) => p.slot + 1)
                      .sort()
                      .join(", ")}
                    . COM é o computador; OFF deixa a posição fora da batalha.
                    Na seleção de personagens, cada jogador confirma com Start.
                    <br />
                    Se um save antigo bloquear MAN nos controles extras, use
                    Reiniciar jogo e entre novamente em BATTLE GAME.
                  </p>
                )}
              </aside>
            </section>
          )
        )}
        <footer>
          <span>FEITO PARA JOGAR JUNTO.</span>
          <span>
            <a
              href="https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3"
              target="_blank"
              rel="noreferrer"
            >
              EmulatorJS
            </a>{" "}
            ·{" "}
            <a href="/licenses/EmulatorJS.txt" target="_blank">
              Licença
            </a>{" "}
            ·{" "}
            <a href="/licenses/Snes9x.txt" target="_blank">
              Snes9x
            </a>{" "}
            <span className="footer-dot">•</span> Biblioteca privada
          </span>
        </footer>
        {panel && (
          <div className="modal-backdrop">
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label={
                panel === "rooms"
                  ? "Salas"
                  : panel === "settings"
                    ? "Configurações"
                    : panel === "admin"
                      ? "Administração"
                      : panel === "join"
                        ? "Entrar em sala"
                        : "Criar sala"
              }
            >
              <button
                className="close"
                aria-label="Fechar janela"
                onClick={() => {
                  setPanel(null);
                  setMapping(undefined);
                }}
              >
                ×
              </button>
              {s.error && (
                <div className="form-feedback error" role="alert">
                  {s.error}
                  <button onClick={() => s.setError("")}>Fechar</button>
                </div>
              )}
              {notice && (
                <div className="form-feedback" role="status">
                  {notice}
                  <button onClick={() => setNotice("")}>Fechar</button>
                </div>
              )}
              {panel === "rooms" && (
                <>
                  <p className="eyebrow">SUA TURMA. SUA SALA.</p>
                  <h2>
                    {s.room ? "Sua sala está aqui." : "Vamos jogar juntos?"}
                  </h2>
                  {s.room ? (
                    <>
                      <RoomInviteCard
                        room={s.room}
                        onCopy={() => void copy()}
                        className="modal-invite"
                      />
                      <p className="subtle">
                        {s.room.started
                          ? "A partida continua em andamento."
                          : "Convide sua turma para começar."}{" "}
                        Cada pessoa tem seu próprio controle.
                      </p>
                      <button
                        className="primary room-return"
                        onClick={() => setPanel(null)}
                      >
                        {s.room.started
                          ? "Voltar para a partida"
                          : "Voltar para a sala"}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="subtle">
                        As salas são privadas. Crie uma para seus amigos ou
                        entre com o código que recebeu.
                      </p>
                      <div className="room-choices">
                        <button className="primary" onClick={openCreate}>
                          <Plus size={21} aria-hidden="true" />
                          Criar sala
                        </button>
                        <button onClick={() => setPanel("join")}>
                          <Link2 size={21} aria-hidden="true" />
                          Entrar com código
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
              {panel === "admin" && (
                <>
                  <p className="eyebrow">ACESSO EXCLUSIVO</p>
                  <h2>Área do proprietário</h2>
                  {!owner ? (
                    <form onSubmit={login}>
                      <label>
                        Senha administrativa
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                        />
                      </label>
                      <button disabled={busy} className="primary">
                        {busy ? "Entrando…" : "Entrar"}
                      </button>
                      <p className="subtle">
                        Primeiro acesso? Execute{" "}
                        <code>npm run setup:owner</code> no servidor.
                      </p>
                    </form>
                  ) : (
                    <>
                      <p className="subtle">
                        Envie o seu arquivo original. O armazenamento e o acesso
                        são privados.
                      </p>
                      <label className="upload">
                        Importar ROM (.sfc, 2 MB)
                        <input
                          disabled={busy}
                          type="file"
                          accept=".sfc,.smc"
                          onChange={(e) => void importRom(e.target.files?.[0])}
                        />
                      </label>
                      <button
                        onClick={() => {
                          s.leave();
                          void fetch("/api/auth", { method: "DELETE" }).then(
                            () => {
                              setOwner(false);
                              setPanel(null);
                            },
                          );
                        }}
                      >
                        Sair da administração
                      </button>
                    </>
                  )}
                </>
              )}
              {(panel === "join" || panel === "create") && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    s.setError("");
                    s.send(
                      panel === "join"
                        ? { type: "join", name, code, avatar }
                        : { type: "create", name, avatar },
                    );
                    setPanel(null);
                  }}
                >
                  <p className="eyebrow">A DIVERSÃO COMEÇA AQUI</p>
                  <h2>
                    {panel === "join" ? "Entrar em sala" : "Criar sala privada"}
                  </h2>
                  <ProfilePicker
                    name={name}
                    avatar={avatar}
                    onSelect={(profile) => {
                      setName(profile.name);
                      setAvatar(profile.avatar);
                    }}
                  />
                  <label>
                    Seu apelido
                    <input
                      autoComplete="nickname"
                      enterKeyHint={panel === "join" ? "next" : "done"}
                      value={name}
                      maxLength={24}
                      onChange={(e) => {
                        setName(e.target.value);
                        setAvatar(undefined);
                      }}
                      placeholder="Como seus amigos te chamam?"
                      required
                    />
                  </label>
                  {panel === "join" && (
                    <label>
                      Código da sala
                      <input
                        value={code}
                        onChange={(e) =>
                          setCode(
                            e.target.value
                              .toUpperCase()
                              .replace(/[^A-Z2-9]/g, ""),
                          )
                        }
                        minLength={6}
                        maxLength={6}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        enterKeyHint="go"
                        placeholder="ABC234"
                        required
                      />
                    </label>
                  )}
                  <button
                    className="primary"
                    disabled={
                      s.network !== "Sinalização conectada" ||
                      (!netplay && !preparation.ready) ||
                      preparation.update
                    }
                  >
                    {panel === "join"
                      ? "Entrar na sala"
                      : "Criar e receber código"}
                  </button>
                  {!netplay && !preparation.ready && (
                    <p className="subtle" role="status">
                      {preparation.error ||
                        preparation.progress ||
                        "Preparando arquivos para jogar…"}
                    </p>
                  )}
                  {!netplay && !preparation.ready && preparation.error && (
                    <button type="button" onClick={preparation.retry}>
                      Tentar novamente
                    </button>
                  )}
                  {s.network !== "Sinalização conectada" && (
                    <p className="subtle" role="status">
                      Aguardando conexão com a sala…
                    </p>
                  )}
                </form>
              )}
              {panel === "settings" && (
                <>
                  <p className="eyebrow">DO SEU JEITO</p>
                  <h2>Configurações</h2>
                  <p className="subtle">
                    Clique em uma tecla para remapear. As preferências ficam
                    neste navegador.
                  </p>
                  <label className="touch-setting">
                    Controle na tela
                    <select
                      value={touchMode}
                      onChange={(event) => {
                        const mode = event.target.value as TouchMode;
                        setTouchMode(mode);
                        localStorage.setItem("bomber.touch", mode);
                      }}
                    >
                      <option value="auto">Automático no celular</option>
                      <option value="on">Sempre mostrar</option>
                      <option value="off">Ocultar</option>
                    </select>
                  </label>
                  <p className="subtle">
                    No celular, use o direcional e os botões ao mesmo tempo.
                    Você pode arrastar o dedo para mudar de direção.
                  </p>
                  <label className="touch-setting">
                    Tamanho dos botões
                    <select
                      value={touchSize}
                      onChange={(event) => {
                        const size = event.target.value as TouchSize;
                        setTouchSize(size);
                        localStorage.setItem("bomber.touch.size", size);
                      }}
                    >
                      <option value="normal">Padrão</option>
                      <option value="large">Grande</option>
                    </select>
                  </label>
                  <div className="key-grid">
                    {BUTTONS.map((b, i) => (
                      <button key={b} onClick={() => setMapping(i)}>
                        <span>{b}</span>
                        <kbd>
                          {mapping === i
                            ? "Pressione…"
                            : keys[i] || "Sem tecla"}
                        </kbd>
                      </button>
                    ))}
                  </div>
                  {owner && !netplay && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={low}
                        onChange={(e) => {
                          setLow(e.target.checked);
                          s.setEconomy(e.target.checked);
                        }}
                      />
                      Transmissão econômica (menos dados e menor carga)
                    </label>
                  )}
                  <p className="subtle">
                    {netplay
                      ? "Imagem e áudio são produzidos neste aparelho. A sala sincroniza os controles com atraso de entrada configurável. "
                      : "A qualidade se ajusta automaticamente para cada conexão. O anfitrião pode ativar a economia durante a partida. "}
                    Controles físicos usam o mapeamento padrão da Gamepad API.
                    Na batalha, configure os participantes como humanos no menu
                    do jogo.
                  </p>
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </>
  );
}
