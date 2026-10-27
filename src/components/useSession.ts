"use client";
import { set as persist } from "idb-keyval";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_PLAYERS } from "@/lib/protocol";
import type { Room, ServerEvent, Command, Signal } from "@/lib/protocol";
import { bridge, release } from "@/lib/emulation/adapter";
import { RemotePeer } from "@/lib/remote/peer";
import type { InputSlot } from "./InputDiagnostics";
export function useSession() {
  const [room, setRoom] = useState<Room>();
  const roomRef = useRef<Room>(undefined);
  const [selfId, setSelf] = useState("");
  const self = useRef("");
  const [error, setError] = useState("");
  const [network, setNetwork] = useState("Desconectado");
  const [ready, setReady] = useState(false);
  const [solo, setSolo] = useState(false);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [diagnostics, setDiagnostics] = useState<Record<string, string>>({});
  const iframe = useRef<HTMLIFrameElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const socket = useRef<WebSocket>(null);
  const peers = useRef(new Map<string, RemotePeer>());
  const stream = useRef<MediaStream>(undefined);
  const resume = useRef<{ code: string; token: string }>(undefined);
  const ice = useRef<RTCIceServer[]>([]);
  const low = useRef(false);
  const resumableHost = useRef(false);
  const netplaySignals = useRef<{ from: string; signal: Signal }[]>([]);
  const netplayListener = useRef<
    ((from: string, signal: Signal) => void) | undefined
  >(undefined);
  const inputDebug = useRef(false);
  const inputSlots = useRef<InputSlot[]>(
    Array.from({ length: MAX_PLAYERS }, (_, slot) => ({
      mask: 0,
      source: slot === 0 ? "local" : "webrtc",
      at: 0,
    })),
  );
  const inject = useCallback(
    (
      slot: number,
      button: number,
      value: number,
      source: "local" | "webrtc",
    ) => {
      const emu = bridge(iframe.current);
      if (!emu || slot < 0 || slot >= MAX_PLAYERS || button < 0 || button >= 12)
        return;
      const previous = inputSlots.current[slot];
      const mask = value
        ? previous.mask | (1 << button)
        : previous.mask & ~(1 << button);
      emu.input(slot, button, value);
      if (mask !== previous.mask) {
        inputSlots.current[slot] = { mask, source, at: performance.now() };
        // Opt-in, development only; never log room IDs, names, tokens or ROM data.
        if (process.env.NODE_ENV === "development" && inputDebug.current)
          console.debug("[input]", {
            source,
            assignedSlot: slot,
            coreIndex: slot,
            button,
            down: !!value,
          });
      }
    },
    [],
  );
  const dispose = useCallback(() => {
    try {
      const data = bridge(iframe.current)?.save();
      if (data?.length)
        void persist("bomber.snes9x.4.2.3", data).catch(() => {});
    } catch {}
    for (const p of peers.current.values()) p.close();
    peers.current.clear();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = undefined;
    for (let i = 0; i < MAX_PLAYERS; i++) release(bridge(iframe.current), i);
    inputSlots.current = inputSlots.current.map((s) => ({ ...s, mask: 0 }));
    setReady(false);
    setSolo(false);
    setStatus({});
    setDiagnostics({});
    if (video.current) video.current.srcObject = null;
  }, []);
  const send = useCallback((message: Command) => {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setError("Sinalização desconectada. Aguarde ou entre novamente.");
      return;
    }
    socket.current.send(JSON.stringify(message));
  }, []);
  const getIce = useCallback(async () => {
    const res = await fetch("/api/ice", {
      headers: resume.current
        ? { Authorization: `Bearer ${resume.current.token}` }
        : {},
    });
    if (!res.ok) throw Error("Não foi possível obter configuração ICE.");
    ice.current = (await res.json()).iceServers;
  }, []);
  const makePeer = useCallback(
    (id: string, host: boolean, slot: number) => {
      const p = new RemotePeer({
        host,
        slot,
        iceServers: ice.current,
        stream: stream.current,
        low: low.current,
        signal: (signal) => send({ type: "signal", target: id, signal }),
        inject: (p, b, v) => inject(p, b, v, "webrtc"),
        onStream: (s) => {
          if (video.current) {
            video.current.muted = true;
            video.current.srcObject = s;
            void video.current.play().catch(() => {
              if (roomRef.current?.started && peers.current.has(id))
                setError(
                  "Clique em Ativar áudio para reproduzir a transmissão.",
                );
            });
          }
        },
        onStatus: (s) => setStatus((prev) => ({ ...prev, [id]: s })),
      });
      peers.current.set(id, p);
      return p;
    },
    [send, inject],
  );
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let queue = Promise.resolve();
    let resuming = false;
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("bomber.room.v1") ?? "null",
      );
      if (
        saved &&
        /^[A-HJ-NP-Z2-9]{6}$/.test(saved.code) &&
        /^[a-f0-9]{64}$/.test(saved.token)
      )
        resume.current = saved;
    } catch {}
    const connect = () => {
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/signal`,
      );
      socket.current = ws;
      setNetwork("Conectando…");
      ws.onopen = () => {
        setNetwork("Sinalização conectada");
        if (resume.current) {
          resuming = true;
          ws.send(JSON.stringify({ type: "resume", ...resume.current }));
        }
      };
      ws.onmessage = (event) => {
        queue = queue
          .then(async () => {
            const data: ServerEvent = JSON.parse(event.data);
            if (data.type === "welcome") {
              resumableHost.current = data.resumableHost;
              return;
            }
            if (data.type === "error") {
              if (resuming) {
                resuming = false;
                resume.current = undefined;
                try {
                  sessionStorage.removeItem("bomber.room.v1");
                } catch {}
                roomRef.current = undefined;
                setRoom(undefined);
                dispose();
              }
              setError(data.message);
              return;
            }
            if (data.type === "closed") {
              resume.current = undefined;
              try {
                sessionStorage.removeItem("bomber.room.v1");
              } catch {}
              roomRef.current = undefined;
              setRoom(undefined);
              dispose();
              setError(data.message);
              return;
            }
            if (data.type === "room") {
              if (data.selfId) {
                resuming = false;
                self.current = data.selfId;
                setSelf(data.selfId);
                resume.current = { code: data.room.code, token: data.token! };
                try {
                  sessionStorage.setItem(
                    "bomber.room.v1",
                    JSON.stringify(resume.current),
                  );
                } catch {}
                await getIce();
              }
              roomRef.current = data.room;
              setRoom(data.room);
              for (const [id, p] of peers.current)
                if (
                  !data.room.players.some((m) => m.id === id && m.connected)
                ) {
                  p.close();
                  peers.current.delete(id);
                }
              return;
            }
            if (data.type === "signal") {
              const r = roomRef.current;
              if (
                !r ||
                !r.players.some((p) => p.id === data.from && p.connected)
              )
                return;
              if (
                data.signal.kind === "netplay-ready" ||
                data.signal.kind === "netplay"
              ) {
                if (netplayListener.current)
                  netplayListener.current(data.from, data.signal);
                else if (netplaySignals.current.length < 256)
                  netplaySignals.current.push({
                    from: data.from,
                    signal: data.signal,
                  });
                return;
              }
              let peer = peers.current.get(data.from);
              if (!peer && r.hostId === data.from)
                peer = makePeer(
                  data.from,
                  false,
                  r.players.find((p) => p.id === self.current)!.slot,
                );
              if (peer) await peer.accept(data.signal);
            }
          })
          .catch((e) =>
            setError(e instanceof Error ? e.message : "Falha de conexão."),
          );
      };
      ws.onclose = () => {
        setNetwork("Conexão perdida");
        if (!resumableHost.current) {
          for (const p of peers.current.values()) p.close();
          peers.current.clear();
        }
        const r = roomRef.current;
        if (r?.hostId === self.current && !resumableHost.current) {
          resume.current = undefined;
          try {
            sessionStorage.removeItem("bomber.room.v1");
          } catch {}
          roomRef.current = undefined;
          setRoom(undefined);
          dispose();
          setError(
            "A conexão do anfitrião caiu. A sala foi encerrada; seus saves continuam locais.",
          );
        }
        if (!stopped) timer = setTimeout(connect, 2000);
      };
      ws.onerror = () => setNetwork("Falha na sinalização");
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket.current?.close();
      dispose();
    };
  }, [dispose, getIce, makePeer]);
  useEffect(() => {
    const onReady = () => {
      setReady(true);
      setError("");
    };
    const onError = () =>
      setError(
        "Falha no emulador. Verifique a ROM importada e execute npm run setup:emulator.",
      );
    window.addEventListener("bomber-ready", onReady);
    window.addEventListener("bomber-error", onError);
    return () => {
      window.removeEventListener("bomber-ready", onReady);
      window.removeEventListener("bomber-error", onError);
    };
  }, []);
  useEffect(() => {
    if (!ready || !room || room.hostId !== selfId || !room.started) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const negotiate = async () => {
      try {
        if (!stream.current) {
          const capture = bridge(iframe.current)?.stream(60);
          if (!capture || !capture.getAudioTracks().length) {
            capture?.getTracks().forEach((t) => t.stop());
            throw Error("Aguardando áudio do core…");
          }
          stream.current = capture;
        }
        for (const member of room.players) {
          if (
            member.id === selfId ||
            !member.connected ||
            peers.current.has(member.id)
          )
            continue;
          const peer = makePeer(member.id, true, member.slot);
          await peer.offer();
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Falha de transmissão");
          timer = setTimeout(() => void negotiate(), 1500);
        }
      }
    };
    void negotiate();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, room, selfId, makePeer]);
  useEffect(() => {
    let stopped = false;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      const snapshot = [...peers.current];
      void Promise.all(
        snapshot.map(async ([id, peer]) => {
          try {
            return { id, peer, value: await peer.diagnostics() };
          } catch {
            return { id, peer, value: "" };
          }
        }),
      )
        .then((results) => {
          if (stopped) return;
          const next = Object.fromEntries(
            results
              .filter(({ id, peer }) => peers.current.get(id) === peer)
              .map(({ id, value }) => [id, value]),
          );
          setDiagnostics((previous) =>
            Object.keys(previous).length === Object.keys(next).length &&
            Object.entries(next).every(([id, value]) => previous[id] === value)
              ? previous
              : next,
          );
        })
        .finally(() => {
          pending = false;
        });
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  const controls = useCallback(
    (buttons: number[]) => {
      const r = roomRef.current;
      if (!r || r.hostId === self.current) {
        for (let b = 0; b < 12; b++)
          inject(0, b, buttons.includes(b) ? 1 : 0, "local");
      } else peers.current.get(r.hostId)?.setButtons(buttons);
    },
    [inject],
  );
  const setEconomy = useCallback((value: boolean) => {
    low.current = value;
    for (const peer of peers.current.values()) peer.setEconomy(value);
  }, []);
  const leave = useCallback(() => {
    send({ type: "leave" });
    resume.current = undefined;
    try {
      sessionStorage.removeItem("bomber.room.v1");
    } catch {}
    roomRef.current = undefined;
    setRoom(undefined);
    dispose();
  }, [dispose, send]);
  return {
    reconnect: () => {
      setNetwork("Reconectando…");
      socket.current?.close();
    },
    room,
    selfId,
    error,
    setError,
    network,
    ready,
    solo,
    setSolo,
    iframe,
    video,
    status,
    diagnostics,
    inputSlots,
    inputDebug,
    controls,
    send,
    leave,
    low,
    setEconomy,
    ice,
    netplayListener,
    netplaySignals,
  };
}
