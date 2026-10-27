import type { RTCSignal as Signal } from "../protocol";
import { RemoteInput } from "./inputs";
import { AdaptiveQuality, videoScale, type NetworkSample } from "./quality";
export interface PeerOptions {
  host: boolean;
  slot: number;
  iceServers: RTCIceServer[];
  stream?: MediaStream;
  signal: (s: Signal) => void;
  inject: (p: number, b: number, v: number) => void;
  onStream: (s: MediaStream) => void;
  onStatus: (s: string) => void;
  low: boolean;
}
export class RemotePeer {
  readonly pc: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private input: RemoteInput;
  private candidates: RTCIceCandidateInit[] = [];
  private seq = 0;
  private buttons: number[] = [];
  private clock: ReturnType<typeof setInterval>;
  private stopped = false;
  private recovery?: ReturnType<typeof setTimeout>;
  private restartAttempts = 0;
  private quality: AdaptiveQuality;
  private parameters = Promise.resolve();
  private appliedProfile = "";
  private previous?: {
    packetsLost: number;
    packetsReceived: number;
    framesEncoded: number;
    totalEncodeTime: number;
  };

  constructor(private opts: PeerOptions) {
    this.quality = new AdaptiveQuality(opts.low);
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers });
    this.input = new RemoteInput(opts.slot, opts.inject);
    this.pc.onicecandidate = (e) => {
      if (e.candidate)
        opts.signal({
          kind: "candidate",
          candidate: {
            ...e.candidate.toJSON(),
            candidate: e.candidate.candidate,
          },
        });
    };
    this.pc.onconnectionstatechange = () => {
      opts.onStatus(this.pc.connectionState);
      if (
        ["failed", "closed", "disconnected"].includes(this.pc.connectionState)
      )
        this.input.clear();
      if (this.pc.connectionState === "connected") {
        clearTimeout(this.recovery);
        this.restartAttempts = 0;
      } else if (
        opts.host &&
        ["failed", "disconnected"].includes(this.pc.connectionState)
      )
        this.scheduleRecovery();
    };
    this.pc.ontrack = (e) => {
      // Give mobile playback a short target instead of building a long video queue.
      try {
        if ("jitterBufferTarget" in e.receiver)
          e.receiver.jitterBufferTarget = 40;
      } catch {
        /* Older Safari/Firefox use their own receiver defaults. */
      }
      if (e.streams[0]) opts.onStream(e.streams[0]);
    };
    this.pc.ondatachannel = (e) => this.attach(e.channel);
    if (opts.host) {
      if (!opts.stream) throw Error("Transmissão ausente");
      for (const track of opts.stream.getTracks()) {
        this.pc.addTrack(track, opts.stream);
      }
      // Prefer codecs readily decoded by phones; keep the browser's fallbacks.
      const codecs = RTCRtpSender.getCapabilities?.("video")?.codecs;
      if (codecs)
        for (const transceiver of this.pc.getTransceivers()) {
          if (
            transceiver.sender.track?.kind !== "video" ||
            !transceiver.setCodecPreferences
          )
            continue;
          const rank = (c: RTCRtpCodec) =>
            c.mimeType.toLowerCase() === "video/h264" &&
            /profile-level-id=42/i.test(c.sdpFmtpLine ?? "")
              ? 0
              : c.mimeType.toLowerCase() === "video/vp8"
                ? 1
                : 2;
          try {
            transceiver.setCodecPreferences(
              [...codecs].sort((a, b) => rank(a) - rank(b)),
            );
          } catch {}
        }
      this.attach(
        this.pc.createDataChannel("controls", {
          ordered: false,
          maxRetransmits: 0,
        }),
      );
    }
    this.clock = setInterval(() => {
      this.input.expire();
      if (!opts.host) this.transmit();
    }, 50);
  }
  private attach(dc: RTCDataChannel) {
    if (this.dc) {
      dc.close();
      return;
    }
    this.dc = dc;
    dc.onmessage = (e) => {
      if (this.opts.host) this.input.receive(e.data);
    };
    dc.onclose = () => {
      this.input.clear();
      this.opts.onStatus("canal fechado");
    };
    dc.onerror = () => this.opts.onStatus("erro no canal");
    dc.onopen = () => this.opts.onStatus("controles conectados");
  }
  private scheduleRecovery() {
    clearTimeout(this.recovery);
    if (this.stopped || this.restartAttempts >= 3) return;
    this.recovery = setTimeout(
      () => {
        if (this.stopped || this.pc.connectionState === "connected") return;
        if (this.pc.signalingState === "stable") {
          this.restartAttempts++;
          void this.offer(true).catch(() => {});
        } else this.restartAttempts++;
        this.scheduleRecovery();
      },
      3000 * (this.restartAttempts + 1),
    );
  }
  async offer(iceRestart = false) {
    if (this.stopped) return;
    await this.pc.setLocalDescription(
      await this.pc.createOffer({ iceRestart }),
    );
    await this.configureSenders(true);
    this.opts.signal({
      kind: "description",
      description: { type: "offer", sdp: this.pc.localDescription!.sdp },
    });
  }
  async accept(signal: Signal) {
    if (this.stopped) return;
    if (signal.kind === "candidate") {
      if (!this.pc.remoteDescription) this.candidates.push(signal.candidate);
      else await this.pc.addIceCandidate(signal.candidate);
      return;
    }
    await this.pc.setRemoteDescription(signal.description);
    if (this.opts.host) await this.configureSenders(true);
    for (const c of this.candidates) await this.pc.addIceCandidate(c);
    this.candidates = [];
    if (signal.description.type === "offer" && !this.opts.host) {
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      this.opts.signal({
        kind: "description",
        description: { type: "answer", sdp: this.pc.localDescription!.sdp },
      });
    }
  }
  setButtons(buttons: number[]) {
    this.buttons = buttons;
    this.transmit();
  }
  private transmit() {
    if (this.dc?.readyState === "open" && this.dc.bufferedAmount < 4096)
      this.dc.send(
        JSON.stringify({
          type: "input",
          buttons: this.buttons,
          seq: ++this.seq,
        }),
      );
  }
  setEconomy(value: boolean) {
    this.quality.setEconomy(value);
    void this.configureSenders(true);
  }
  private configureSenders(force = false) {
    this.parameters = this.parameters
      .then(async () => {
        if (this.stopped) return;
        const profile = this.quality.profile;
        const video = this.pc
          .getSenders()
          .find((sender) => sender.track?.kind === "video");
        const scale = videoScale(video?.track?.getSettings() ?? {});
        const key = `${profile.name}/${scale}`;
        if (!force && this.appliedProfile === key) return;
        let applied = true;
        for (const sender of this.pc.getSenders()) {
          if (!sender.track) continue;
          const p = sender.getParameters();
          // Preserve negotiated encodings; replacing this array before negotiation can fail silently.
          if (!p.encodings?.length) {
            applied = false;
            continue;
          }
          for (const encoding of p.encodings) {
            encoding.maxBitrate =
              sender.track.kind === "video" ? profile.maxBitrate : 48_000;
            if (sender.track.kind === "video") {
              encoding.maxFramerate = profile.maxFramerate;
              encoding.scaleResolutionDownBy = scale;
            }
          }
          if (sender.track.kind === "video")
            p.degradationPreference = "maintain-framerate";
          try {
            await sender.setParameters(p);
          } catch {
            // Older browsers may reject the optional hint while supporting bitrate limits.
            delete p.degradationPreference;
            try {
              await sender.setParameters(p);
            } catch {
              applied = false;
            }
          }
        }
        if (applied) this.appliedProfile = key;
      })
      .catch(() => {});
    return this.parameters;
  }
  async diagnostics() {
    if (this.stopped) return "Conexão encerrada";
    const stats = await this.pc.getStats();
    let text = "ICE: aguardando";
    let fps: number | undefined;
    const network: NetworkSample = {};
    let totals = {
      packetsLost: 0,
      packetsReceived: 0,
      framesEncoded: 0,
      totalEncodeTime: 0,
    };
    stats.forEach((s) => {
      if (
        s.type === "candidate-pair" &&
        s.state === "succeeded" &&
        s.nominated
      ) {
        const local = stats.get(s.localCandidateId);
        const remote = stats.get(s.remoteCandidateId);
        network.rtt = s.currentRoundTripTime;
        network.availableBitrate = s.availableOutgoingBitrate;
        text = `${Math.round((s.currentRoundTripTime ?? 0) * 1000)} ms · ${local?.candidateType ?? "?"} ↔ ${remote?.candidateType ?? "?"}`;
      }
      if (s.type === "remote-inbound-rtp" && s.kind === "video") {
        totals.packetsLost = s.packetsLost ?? 0;
        totals.packetsReceived = s.packetsReceived ?? 0;
        network.rtt = s.roundTripTime ?? network.rtt;
      }
      if (s.type === "outbound-rtp" && s.kind === "video") {
        totals.framesEncoded = s.framesEncoded ?? 0;
        totals.totalEncodeTime = s.totalEncodeTime ?? 0;
        fps = s.framesPerSecond;
      }
      if (s.type === "inbound-rtp" && s.kind === "video")
        fps = s.framesPerSecond;
    });
    if (this.opts.host && this.pc.connectionState === "connected") {
      const previous = this.previous;
      if (previous) {
        const lost = Math.max(0, totals.packetsLost - previous.packetsLost);
        const received = Math.max(
          0,
          totals.packetsReceived - previous.packetsReceived,
        );
        if (lost + received > 0) network.loss = lost / (lost + received);
        const frames = totals.framesEncoded - previous.framesEncoded;
        if (frames > 0)
          network.encodeSecondsPerFrame =
            Math.max(0, totals.totalEncodeTime - previous.totalEncodeTime) /
            frames;
        this.quality.sample(network);
        await this.configureSenders();
      }
      this.previous = totals;
      text += ` · ${this.quality.profile.name}`;
    }
    if (fps !== undefined) text += ` · ${Math.round(fps)} fps`;
    return text;
  }
  close() {
    this.setButtons([]);
    this.stopped = true;
    clearInterval(this.clock);
    clearTimeout(this.recovery);
    this.input.clear();
    this.dc?.close();
    this.pc.close();
  }
}
