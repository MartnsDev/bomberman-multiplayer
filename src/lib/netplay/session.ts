import { z } from "zod";
import {
  LockstepCoordinator,
  LockstepReplica,
  inputPacket,
  type FrameCore,
} from "./lockstep";
import {
  compatibilitySchema,
  compatible,
  frameInputSchema,
  type Compatibility,
} from "./protocol";
import { sha256 } from "./local-rom";
import {
  packSnapshot,
  unpackSnapshot,
  type SnapshotEncoding,
} from "./snapshot";
const epoch = z.string().uuid(),
  frame = z.number().int().min(0).max(2147483647),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const FRAME_MS = 1000 / 60.0988;
const MAX_DELAY = 24;
const wire = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("hello"),
      compatibility: compatibilitySchema,
      gzip: z.boolean(),
    })
    .strict(),
  frameInputSchema,
  z
    .object({
      type: z.literal("commit"),
      epoch,
      frame,
      masks: z.tuple([
        z.number().int().min(0).max(4095),
        z.number().int().min(0).max(4095),
        z.number().int().min(0).max(4095),
        z.number().int().min(0).max(4095),
        z.number().int().min(0).max(4095),
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("snapshot"),
      epoch,
      frame,
      size: z.number().int().min(1).max(2097152),
      rawSize: z.number().int().min(1).max(2097152),
      encoding: z.enum(["raw", "gzip"]),
      hash,
      corrections: z.number().int().min(0).max(3),
      joining: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("snapshot-end"), epoch }).strict(),
  z.object({ type: z.literal("resync-request"), epoch }).strict(),
  z.object({ type: z.literal("ack"), epoch, frame, hash }).strict(),
  z
    .object({
      type: z.literal("start"),
      epoch,
      frame,
      delay: z.number().int().min(2).max(MAX_DELAY),
      automatic: z.boolean(),
      activeSlots: z.array(z.number().int().min(0).max(4)).max(5),
    })
    .strict(),
  z
    .object({
      type: z.literal("delay"),
      epoch,
      frame,
      delay: z.number().int().min(2).max(MAX_DELAY),
    })
    .strict(),
  z.object({ type: z.literal("hash"), epoch, frame, hash }).strict(),
  z.object({ type: z.literal("verified"), epoch, frame }).strict(),
  z.object({ type: z.literal("pause"), message: z.string().max(200) }).strict(),
  z
    .object({
      type: z.literal("ping"),
      time: z.number().finite().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("pong"),
      time: z.number().finite().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("roster"),
      slots: z.array(z.number().int().min(0).max(4)).max(5),
      activeSlots: z.array(z.number().int().min(0).max(4)).max(5),
    })
    .strict(),
]);
export interface NetplayStatus {
  phase: "connecting" | "preparing" | "ready" | "running" | "paused";
  message: string;
  frame: number;
  fps: number;
  rtt: number;
  corrections: number;
  verifiedFrame: number;
  readySlots: number[];
  inputDelay: number;
  automaticDelay: boolean;
  activeSlots: number[];
}
type Link = {
  send: (data: string | Uint8Array) => void;
  ready: boolean;
  ack?: string;
  rtt: number;
  ping?: number;
  activeFrom?: number;
  lastInput: number;
  validated: boolean;
  gzip: boolean;
  joining?: { frame: number; hash?: string; buffer: unknown[]; sent: boolean };
};
export class NetplaySession {
  private links = new Map<number, Link>();
  private coordinator?: LockstepCoordinator;
  private replica?: LockstepReplica;
  private epoch = "";
  private held = 0;
  private pendingPress = 0;
  private delay = 6;
  private automaticDelay = true;
  private pendingDelay?: { frame: number; delay: number };
  private submittedFrame = -1;
  private lowLatencySince?: number;
  private running = false;
  private checking = false;
  private hashes = new Map<number, Map<number, string>>();
  private canonicalHash = "";
  private resumePrepared = false;
  private reception?: {
    epoch: string;
    frame: number;
    size: number;
    rawSize: number;
    encoding: SnapshotEncoding;
    hash: string;
    chunks: Uint8Array[];
    received: number;
  };
  private generation = 0;
  private remoteReadySlots?: number[];
  private stopped = false;
  private hasStarted = false;
  private remoteActive?: number[];
  private firstCommitted = false;
  private startDeadline = 0;
  private raf = 0;
  private heartbeat: ReturnType<typeof setInterval>;
  private nextDue = 0;
  private lastStep = performance.now();
  private lastElection = -Infinity;
  private metricTime = performance.now();
  private metricFrames = 0;
  private status: NetplayStatus = {
    phase: "connecting",
    message: "Aguardando a instalação local de todos…",
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
  constructor(
    private options: {
      host: boolean;
      slot: number;
      slots: number[];
      core: FrameCore;
      compatibility: Compatibility;
      update: (status: NetplayStatus) => void;
      resumeOnReady?: boolean;
      corrections?: number;
      coordinatorStalled?: () => void;
    },
  ) {
    this.hasStarted = !!options.resumeOnReady;
    this.status.frame = options.core.frame();
    this.status.corrections = options.corrections ?? 0;
    this.publish();
    this.raf = requestAnimationFrame(this.tick);
    this.heartbeat = setInterval(() => {
      for (const link of this.links.values()) {
        if (!link.ready || link.joining) continue;
        const now = performance.now();
        if (link.ping === undefined || now - link.ping > 6000) {
          link.ping = now;
          this.send(link, { type: "ping", time: now });
        }
      }
    }, 2000);
  }
  get canPrepare() {
    return (
      this.options.host &&
      (this.hasStarted ? this.activeSlots() : this.options.slots)
        .filter((s) => s !== this.options.slot)
        .every((s) => this.links.get(s)?.ready)
    );
  }
  get canStart() {
    return this.status.phase === "ready";
  }
  get frame() {
    return this.options.core.frame();
  }
  private send(link: Link, message: unknown) {
    link.send(JSON.stringify(message));
  }
  private broadcast(message: unknown) {
    for (const link of this.links.values()) {
      if (
        link.joining &&
        !link.joining.sent &&
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "commit"
      ) {
        if (link.joining.buffer.length < 256) link.joining.buffer.push(message);
        continue;
      }
      this.send(link, message);
    }
  }
  private publish(message?: string, phase?: NetplayStatus["phase"]) {
    if (message) this.status.message = message;
    if (phase) this.status.phase = phase;
    this.status.readySlots =
      this.remoteReadySlots ??
      [
        this.options.slot,
        ...[...this.links].filter(([, l]) => l.ready).map(([s]) => s),
      ].sort();
    this.status.frame = this.frame;
    this.status.activeSlots = this.options.host
      ? this.activeSlots(Infinity)
      : (this.remoteActive ?? []);
    this.status.inputDelay = this.delay;
    this.status.automaticDelay = this.automaticDelay;
    this.status.rtt = Math.max(
      0,
      ...[...this.links.values()].map((l) => l.rtt),
    );
    if (!this.stopped)
      this.options.update({
        ...this.status,
        readySlots: [...this.status.readySlots],
      });
  }
  attach(slot: number, send: Link["send"]) {
    if (!this.options.slots.includes(slot) || slot === this.options.slot)
      throw Error("Participante sem posição válida.");
    const link: Link = {
      send,
      ready: false,
      rtt: 0,
      lastInput: performance.now(),
      validated: false,
      gzip: false,
    };
    this.links.set(slot, link);
    this.send(link, {
      type: "hello",
      compatibility: this.options.compatibility,
      gzip: typeof DecompressionStream !== "undefined",
    });
  }
  disconnect(slot: number) {
    // Guests have a single link, to the coordinator. A different guest leaving
    // must not pause this replica or tear down its healthy coordinator channel.
    if (!this.options.host && !this.links.has(slot)) return;
    this.links.delete(slot);
    if (this.options.host) {
      this.coordinator?.deactivate(slot);
      this.roster();
    } else
      this.pause(
        "Reconectando ao coordenador. Os demais continuam jogando.",
        false,
      );
  }
  private activeSlots(number = this.frame) {
    return [
      this.options.slot,
      ...[...this.links]
        .filter(([, l]) => l.activeFrom !== undefined && l.activeFrom <= number)
        .map(([slot]) => slot),
    ].sort();
  }
  private roster() {
    this.publish();
    this.broadcast({
      type: "roster",
      slots: this.status.readySlots,
      activeSlots: this.activeSlots(Infinity),
    });
  }
  setMembers(slots: number[]) {
    for (const slot of this.options.slots)
      if (!slots.includes(slot) && slot !== this.options.slot)
        this.disconnect(slot);
    this.options.slots = [...slots];
    this.coordinator?.setSlots(slots);
    if (!this.hasStarted) {
      if (this.canPrepare) void this.prepare().catch((e) => this.fail(e));
      else {
        this.generation++;
        this.publish(
          "Aguardando a instalação dos jogadores conectados…",
          "connecting",
        );
      }
    }
  }
  private async join(slot: number) {
    const link = this.links.get(slot);
    if (!link?.ready || !this.running || link.joining) return;
    this.coordinator?.deactivate(slot);
    link.activeFrom = undefined;
    link.validated = false;
    // Loading a snapshot serializes messages on the returning channel. Never
    // count that local work as network RTT for the rest of the room.
    link.ping = undefined;
    link.rtt = 0;
    const joining = {
      frame: this.frame,
      buffer: [] as unknown[],
      hash: undefined as string | undefined,
      sent: false,
    };
    link.joining = joining;
    const snapshot = this.options.core.save(),
      currentEpoch = this.epoch;
    const [digest, packed] = await Promise.all([
      sha256(snapshot),
      packSnapshot(snapshot, link.gzip),
    ]);
    joining.hash = digest;
    if (
      this.stopped ||
      this.links.get(slot) !== link ||
      currentEpoch !== this.epoch ||
      link.joining !== joining
    )
      return;
    this.send(link, {
      type: "snapshot",
      epoch: this.epoch,
      frame: joining.frame,
      size: packed.bytes.length,
      rawSize: snapshot.length,
      encoding: packed.encoding,
      hash: joining.hash,
      corrections: this.status.corrections,
      joining: true,
    });
    for (let at = 0; at < packed.bytes.length; at += 16384)
      link.send(packed.bytes.subarray(at, at + 16384));
    this.send(link, { type: "snapshot-end", epoch: this.epoch });
    this.send(link, {
      type: "start",
      epoch: this.epoch,
      frame: joining.frame,
      delay: this.delay,
      automatic: this.automaticDelay,
      activeSlots: this.activeSlots(),
    });
    // The returning peer may have missed an adjustment while paused. Replay it
    // after START and before commits, so its input window cannot remain stale.
    if (this.pendingDelay)
      this.send(link, {
        type: "delay",
        epoch: this.epoch,
        ...this.pendingDelay,
      });
    for (const commit of joining.buffer) this.send(link, commit);
    joining.buffer = [];
    joining.sent = true;
    this.roster();
  }
  setButtons(buttons: number[]) {
    const next = buttons.reduce(
      (m, b) => (Number.isInteger(b) && b >= 0 && b < 12 ? m | (1 << b) : m),
      0,
    );
    // Preserve brief action taps even if down/up both arrive before a frame.
    // Directions always use their latest state, without latching opposites.
    if (this.running) this.pendingPress |= next & ~this.held & ~0xf0;
    this.held = next;
  }
  private sampleButtons() {
    const mask = this.held | this.pendingPress;
    this.pendingPress = 0;
    return mask;
  }
  private submitThrough(last: number) {
    for (let f = this.submittedFrame + 1; f <= last; f++)
      this.submit(f, this.sampleButtons());
  }
  setDelay(delay: number | "auto") {
    if (
      this.running ||
      (delay !== "auto" &&
        (!Number.isInteger(delay) || delay < 2 || delay > MAX_DELAY))
    )
      throw Error("Escolha automático ou de 2 a 24 quadros antes de iniciar.");
    this.automaticDelay = delay === "auto";
    this.delay = delay === "auto" ? 6 : delay;
    this.publish();
  }
  private desiredDelay() {
    const rtt = Math.max(
      0,
      ...[...this.links.values()]
        .filter(
          (link) =>
            link.ready &&
            !link.joining &&
            (!this.hasStarted ||
              link.activeFrom !== undefined ||
              performance.now() - link.lastInput < 1000),
        )
        .map((link) => link.rtt),
    );
    return Math.min(MAX_DELAY, Math.max(6, Math.ceil(rtt / FRAME_MS) + 3));
  }
  private adaptDelay() {
    if (
      !this.options.host ||
      !this.running ||
      !this.automaticDelay ||
      this.pendingDelay
    )
      return;
    const delay = this.desiredDelay();
    if (delay < this.delay - 1) {
      this.lowLatencySince ??= performance.now();
      if (performance.now() - this.lowLatencySince < 10000) return;
    } else {
      this.lowLatencySince = undefined;
      if (delay < this.delay + 2) return;
    }
    this.lowLatencySince = undefined;
    this.pendingDelay = { frame: this.frame + this.delay + 2, delay };
    this.broadcast({ type: "delay", epoch: this.epoch, ...this.pendingDelay });
  }
  async receive(slot: number, raw: string | ArrayBuffer) {
    if (this.stopped) return;
    const link = this.links.get(slot);
    if (!link) return;
    if (raw instanceof ArrayBuffer) {
      if (
        this.options.host ||
        !this.reception ||
        this.reception.received + raw.byteLength > this.reception.size
      )
        throw Error("Snapshot fora da sincronização esperada.");
      this.reception.chunks.push(new Uint8Array(raw));
      this.reception.received += raw.byteLength;
      return;
    }
    if (raw.length > 8192)
      throw Error("Mensagem de sincronização excedeu o limite.");
    const parsed = wire.safeParse(JSON.parse(raw));
    if (!parsed.success)
      throw Error(
        "Versão ou mensagem do netplay incompatível. Atualizem o site em todos os aparelhos e criem uma sala nova.",
      );
    const packet = parsed.data;
    if (packet.type === "ping") {
      this.send(link, { type: "pong", time: packet.time });
      return;
    }
    if (packet.type === "pong") {
      if (packet.time !== link.ping) return;
      link.rtt = Math.max(0, performance.now() - packet.time);
      link.ping = undefined;
      this.adaptDelay();
      return;
    }
    if (packet.type === "hello") {
      if (!compatible(this.options.compatibility, packet.compatibility)) {
        if (this.options.host && this.hasStarted) {
          this.send(link, {
            type: "pause",
            message:
              "ROM ou emulador incompatível. Atualize e confira a instalação deste aparelho.",
          });
          this.disconnect(slot);
          return;
        }
        this.pause(
          "ROM, versão do core ou configuração diferente. Instale a mesma versão em todos os aparelhos.",
          this.options.host,
        );
        return;
      }
      if (link.ready) return;
      link.ready = true;
      link.gzip = packet.gzip;
      // A channel may deliver the first HELLO just before the other peer's
      // onopen registers its link. Reply once after validation so both sides
      // complete the handshake; already-ready peers never echo duplicates.
      this.send(link, {
        type: "hello",
        compatibility: this.options.compatibility,
        gzip: typeof DecompressionStream !== "undefined",
      });
      link.ping = performance.now();
      this.send(link, { type: "ping", time: link.ping });
      if (!this.running)
        this.publish("ROM e core compatíveis. Preparando a sincronização…");
      if (this.options.host) {
        this.roster();
        if (this.running) {
          await this.join(slot);
          return;
        }
        if (this.canPrepare)
          await this.prepare(
            undefined,
            this.frame,
            !!this.options.resumeOnReady,
          );
      }
      return;
    }
    if (!link.ready)
      throw Error("Participante ainda não validou a ROM e o core.");
    if (packet.type === "pause") {
      if (this.options.host && this.running) {
        await this.join(slot);
        return;
      }
      this.pause(packet.message, false);
      return;
    }
    if (packet.type === "roster") {
      // Presence and RTC use different transports: a valid, older roster may
      // still mention a slot just removed by a newer presence event. These are
      // display hints from the authenticated coordinator, not pad bindings.
      if (this.options.host) throw Error("Lista de controles inválida.");
      this.remoteActive = packet.activeSlots;
      this.remoteReadySlots = packet.slots;
      this.publish();
      return;
    }
    if (packet.type === "snapshot") {
      if (this.options.host)
        throw Error("Somente o anfitrião pode fornecer o estado canônico.");
      this.running = false;
      this.checking = false;
      this.generation++;
      this.reception = { ...packet, chunks: [], received: 0 };
      this.status.corrections = packet.corrections;
      this.publish("Recebendo estado da partida…", "preparing");
      return;
    }
    if (packet.type === "snapshot-end") {
      const r = this.reception;
      if (
        this.options.host ||
        !r ||
        r.epoch !== packet.epoch ||
        r.received !== r.size
      )
        throw Error("Snapshot incompleto. Partida pausada.");
      const bytes = new Uint8Array(r.size);
      let offset = 0;
      for (const chunk of r.chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const raw = await unpackSnapshot(bytes, r.encoding, r.rawSize);
      if ((await sha256(raw)) !== r.hash)
        throw Error(
          "O estado recebido não passou na verificação de integridade.",
        );
      if (this.stopped) return;
      this.options.core.load(raw, r.frame);
      this.epoch = r.epoch;
      this.status.verifiedFrame = r.frame;
      this.reception = undefined;
      const digest = await sha256(this.options.core.save());
      this.send(link, {
        type: "ack",
        epoch: this.epoch,
        frame: this.frame,
        hash: digest,
      });
      this.publish(
        "Estado local sincronizado. Aguardando o anfitrião.",
        "ready",
      );
      return;
    }
    if (packet.type === "ack") {
      if (!this.options.host || packet.epoch !== this.epoch) return;
      if (link.joining) {
        if (
          packet.frame !== link.joining.frame ||
          packet.hash !== link.joining.hash
        ) {
          this.disconnect(slot);
          return;
        }
        link.validated = true;
        link.joining = undefined;
        link.ping = performance.now();
        this.send(link, { type: "ping", time: link.ping });
        return;
      }
      if (packet.frame !== this.frame) return;
      if (packet.hash !== this.canonicalHash) {
        this.pause(
          "O core não restaurou o mesmo estado. Partida pausada.",
          true,
        );
        return;
      }
      link.ack = packet.epoch;
      link.validated = true;
      if (
        this.canPrepare &&
        [...this.links.values()].every((l) => l.ack === this.epoch)
      ) {
        this.status.verifiedFrame = this.frame;
        this.publish("Todos prontos. Emulação local sincronizada.", "ready");
        if (this.resumePrepared) this.start();
      }
      return;
    }
    if (packet.type === "start") {
      if (
        this.options.host ||
        packet.epoch !== this.epoch ||
        packet.frame !== this.frame
      )
        return;
      this.remoteActive = packet.activeSlots;
      this.begin(packet.delay, packet.automatic);
      return;
    }
    if (packet.epoch !== this.epoch) return;
    if (packet.type === "resync-request") {
      if (this.options.host && this.running) await this.join(slot);
      return;
    }
    if (packet.type === "delay") {
      if (this.options.host)
        throw Error("Somente o anfitrião ajusta o atraso da sala.");
      if (!this.running) return;
      if (
        !this.automaticDelay ||
        packet.frame < this.frame ||
        packet.delay === this.delay
      )
        throw Error("Ajuste de atraso fora do quadro esperado.");
      this.pendingDelay = { frame: packet.frame, delay: packet.delay };
    } else if (packet.type === "input") {
      if (!this.options.host)
        throw Error("Entradas devem passar pelo coordenador.");
      if (!this.running || !link.validated) return;
      if (packet.slot !== slot)
        throw Error("Entrada de outro controle ou quadro inválido.");
      link.lastInput = performance.now();
      if (packet.frame < this.frame) return;
      const result = this.coordinator?.receive(slot, packet);
      if (result === "accepted" && link.activeFrom === undefined) {
        link.activeFrom = packet.frame;
        this.coordinator?.activate(slot, packet.frame);
        this.roster();
      }
      if (result === "rejected" && packet.frame >= this.frame)
        throw Error("Entrada de outro controle ou quadro inválido.");
    } else if (packet.type === "commit") {
      if (this.options.host)
        throw Error("Somente o anfitrião pode confirmar quadros.");
      if (!this.running) return;
      const accepted = this.replica?.receive(packet);
      if (!accepted && packet.frame >= this.frame) {
        this.running = false;
        this.publish(
          "Atualizando seu aparelho; os demais continuam jogando…",
          "preparing",
        );
        this.send(link, { type: "resync-request", epoch: this.epoch });
      }
      if (accepted) {
        // Input follows confirmed coordinator time, independent of rendering.
        // A slow local display must not send permanently stale controls.
        const inputFrame = packet.frame + 1;
        if (this.pendingDelay && inputFrame >= this.pendingDelay.frame) {
          this.delay = this.pendingDelay.delay;
          this.pendingDelay = undefined;
        }
        this.submitThrough(inputFrame + this.delay);
      }
    } else if (packet.type === "hash") {
      if (
        this.options.host &&
        packet.frame <= this.frame &&
        packet.frame >= this.frame - 512 &&
        packet.frame % 120 === 0
      ) {
        if (packet.frame <= this.status.verifiedFrame) return;
        const group =
          this.hashes.get(packet.frame) ?? new Map<number, string>();
        group.set(slot, packet.hash);
        this.hashes.set(packet.frame, group);
        await this.checkHashes(packet.frame);
      }
    } else if (packet.type === "verified") {
      if (
        !this.options.host &&
        packet.frame <= this.frame &&
        packet.frame > this.status.verifiedFrame
      ) {
        this.status.verifiedFrame = packet.frame;
        this.publish();
      }
    }
  }
  async prepare(
    snapshot?: Uint8Array,
    frameNumber = this.frame,
    resume = false,
  ) {
    if (!this.canPrepare || this.stopped) return;
    const generation = ++this.generation;
    this.running = false;
    this.checking = false;
    this.resumePrepared = resume;
    this.hashes.clear();
    this.epoch = crypto.randomUUID();
    this.publish(
      "Preparando estado idêntico em todos os aparelhos…",
      "preparing",
    );
    const state = snapshot ?? this.options.core.save();
    this.options.core.load(state, frameNumber);
    this.canonicalHash = await sha256(this.options.core.save());
    const digest = await sha256(state);
    const packed = await packSnapshot(
      state,
      [...this.links.values()].some((link) => link.gzip),
    );
    if (generation !== this.generation || this.stopped) return;
    for (const link of this.links.values()) {
      link.ack = undefined;
      const payload = link.gzip
        ? packed
        : { bytes: state, encoding: "raw" as const };
      this.send(link, {
        type: "snapshot",
        epoch: this.epoch,
        frame: frameNumber,
        size: payload.bytes.length,
        rawSize: state.length,
        encoding: payload.encoding,
        hash: digest,
        corrections: this.status.corrections,
        joining: false,
      });
      for (let at = 0; at < payload.bytes.length; at += 16384)
        link.send(payload.bytes.subarray(at, at + 16384));
      this.send(link, { type: "snapshot-end", epoch: this.epoch });
    }
    if (!this.links.size) {
      this.publish("Emulação local pronta.", "ready");
      if (resume) this.start();
    }
  }
  start() {
    if (!this.options.host || !this.canStart || this.stopped) return;
    const delay = this.automaticDelay ? this.desiredDelay() : this.delay;
    this.broadcast({
      type: "start",
      epoch: this.epoch,
      frame: this.frame,
      delay,
      automatic: this.automaticDelay,
      activeSlots: [
        this.options.slot,
        ...[...this.links].filter(([, l]) => l.ready).map(([s]) => s),
      ],
    });
    this.begin(delay, this.automaticDelay);
  }
  private begin(delay: number, automatic: boolean) {
    this.delay = delay;
    this.automaticDelay = automatic;
    this.hasStarted = true;
    this.firstCommitted = false;
    this.startDeadline = performance.now() + 1000;
    if (this.options.host)
      for (const link of this.links.values())
        if (link.ready) {
          link.activeFrom = this.frame;
          link.lastInput = performance.now();
        }
    this.pendingDelay = undefined;
    this.lowLatencySince = undefined;
    const first = this.frame;
    this.submittedFrame = first - 1;
    this.pendingPress = 0;
    this.coordinator = this.options.host
      ? new LockstepCoordinator(this.epoch, this.options.slots, first)
      : undefined;
    if (this.options.host)
      for (const s of this.options.slots)
        if (s !== this.options.slot && !this.links.get(s)?.ready)
          this.coordinator?.deactivate(s);
    this.replica = new LockstepReplica(this.epoch, this.options.core, first);
    this.hashes.clear();
    this.checking = false;
    this.running = true;
    this.nextDue = performance.now();
    this.lastStep = this.nextDue;
    this.metricTime = this.nextDue;
    this.metricFrames = 0;
    for (let f = first; f < first + delay; f++) this.submit(f, 0);
    this.submit(first + delay, this.sampleButtons());
    this.publish("Emulação local sincronizada.", "running");
  }
  private submit(frame: number, mask: number) {
    const packet = inputPacket(this.epoch, frame, this.options.slot, mask);
    if (this.options.host) this.coordinator?.receive(this.options.slot, packet);
    else for (const link of this.links.values()) this.send(link, packet);
    this.submittedFrame = frame;
  }
  private tick = (now: number) => {
    if (this.stopped) return;
    this.raf = requestAnimationFrame(this.tick);
    if (!this.running || this.checking || now < this.nextDue) return;
    try {
      if (this.options.host) {
        for (const s of this.coordinator?.missingSlots() ?? [])
          if (
            s !== this.options.slot &&
            (this.firstCommitted || now >= this.startDeadline)
          ) {
            const link = this.links.get(s);
            this.coordinator?.deactivate(s);
            if (link) link.activeFrom = undefined;
            this.roster();
          }
        // A departed pad becomes neutral without raising everybody's delay.
        const commit = this.coordinator?.take();
        if (commit) {
          this.firstCommitted = true;
          this.replica!.receive(commit);
          this.broadcast(commit);
        }
      }
      const catchingUp =
        // Keep the replica close to the coordinator. Using the input delay as
        // a playback buffer leaves every newly sampled input permanently late
        // once missing pads stop blocking the coordinator.
        !this.options.host && (this.replica?.buffered ?? 0) > 2;
      const budget = performance.now();
      for (let step = 0; step < (catchingUp ? 4 : 1); step++) {
        if (!this.replica?.advance()) break;
        this.lastStep = now;
        this.metricFrames++;
        this.nextDue = Math.max(
          this.nextDue + 1000 / 60.0988,
          now - 1000 / 60.0988,
        );
        if (this.pendingDelay && this.frame === this.pendingDelay.frame) {
          this.delay = this.pendingDelay.delay;
          this.pendingDelay = undefined;
          this.adaptDelay();
        }
        // Fill newly added future frames with this player's actual held input.
        // Never overwrite an existing frame or predict another player's input.
        if (this.options.host) this.submitThrough(this.frame + this.delay);
        // Capture at the exact native frame; compare asynchronously. Healthy
        // sessions never stop the game merely to wait for a checksum RTT.
        if (this.frame % 120 === 0)
          void this.checkpoint().catch((e: unknown) => this.fail(e));
        if (catchingUp) this.nextDue = now + FRAME_MS;
        if (performance.now() - budget >= 8) break;
      }
      if (now - this.metricTime >= 1000) {
        if (
          !this.options.host &&
          now - this.lastStep > 3000 &&
          now - this.lastElection > 2000
        ) {
          this.lastElection = now;
          this.options.coordinatorStalled?.();
        }
        this.status.fps = Math.round(
          (this.metricFrames * 1000) / (now - this.metricTime),
        );
        this.metricFrames = 0;
        this.metricTime = now;
        this.publish(
          now - this.lastStep > 500
            ? "Aguardando comandos de um participante…"
            : "Emulação local sincronizada.",
        );
      }
    } catch (e) {
      this.fail(e);
    }
  };
  private async checkpoint() {
    const generation = this.generation,
      number = this.frame;
    const hash = await sha256(this.options.core.save());
    if (generation !== this.generation || this.stopped) return;
    if (this.options.host) {
      const group = this.hashes.get(number) ?? new Map<number, string>();
      group.set(this.options.slot, hash);
      this.hashes.set(number, group);
      await this.checkHashes(number);
      for (const [old, values] of this.hashes)
        if (old < this.frame - 480) {
          this.hashes.delete(old);
          for (const slot of this.activeSlots(old))
            if (slot !== this.options.slot && !values.has(slot))
              void this.join(slot).catch(() => this.disconnect(slot));
        }
    } else
      for (const link of this.links.values())
        this.send(link, {
          type: "hash",
          epoch: this.epoch,
          frame: number,
          hash,
        });
  }
  private async checkHashes(number: number) {
    const group = this.hashes.get(number);
    const required = this.activeSlots(number);
    if (!group || !required.every((s) => group.has(s))) return;
    const hashes = required.map((s) => group.get(s));
    this.hashes.delete(number);
    if (hashes.every((h) => h === hashes[0])) {
      this.status.verifiedFrame = Math.max(this.status.verifiedFrame, number);
      this.broadcast({ type: "verified", epoch: this.epoch, frame: number });
      this.publish();
      return;
    }
    this.status.corrections++;
    if (this.status.corrections > 2) {
      this.pause(
        "A partida divergiu repetidamente. Todos foram pausados; reinicie a sessão.",
        true,
      );
      return;
    }
    await this.prepare(undefined, this.frame, true);
  }
  pause(message: string, broadcast = this.options.host) {
    this.running = false;
    this.pendingPress = 0;
    this.generation++;
    if (broadcast)
      this.broadcast({ type: "pause", message: message.slice(0, 200) });
    this.publish(message, "paused");
  }
  fail(error: unknown) {
    const message =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message.slice(0, 200)
        : "Falha de sincronização. Partida pausada.";
    if (!this.options.host)
      this.broadcast({ type: "pause", message: message.slice(0, 200) });
    this.pause(message);
  }
  close() {
    this.stopped = true;
    this.generation++;
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.heartbeat);
    this.links.clear();
  }
}
