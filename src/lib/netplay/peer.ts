import type { RTCSignal as Signal } from "../protocol";
export class DataPeer {
  readonly pc: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private outgoing: (string | Uint8Array<ArrayBuffer>)[] = [];
  private bytes = 0;
  private incoming = Promise.resolve();
  private closed = false;
  private candidates: RTCIceCandidateInit[] = [];
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private disconnected = false;
  private lostConnection = () => {
    if (this.closed || this.disconnected) return;
    this.disconnected = true;
    clearTimeout(this.disconnectTimer);
    this.options.disconnected();
  };
  constructor(
    private options: {
      initiator: boolean;
      iceServers: RTCIceServer[];
      signal: (signal: Signal) => void;
      opened: () => void;
      message: (data: string | ArrayBuffer) => Promise<void>;
      disconnected: () => void;
      error: (message: string) => void;
    },
  ) {
    this.pc = new RTCPeerConnection({ iceServers: options.iceServers });
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate && !this.closed)
        options.signal({
          kind: "candidate",
          candidate: { ...candidate.toJSON(), candidate: candidate.candidate },
        });
    };
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      clearTimeout(this.disconnectTimer);
      if (this.pc.connectionState === "disconnected") {
        // A brief mobile handoff can recover with the same reliable channel.
        // The missing pad is neutral while the same channel can still recover.
        this.disconnectTimer = setTimeout(() => {
          if (this.pc.connectionState === "disconnected") this.lostConnection();
        }, 3000);
      } else if (["failed", "closed"].includes(this.pc.connectionState))
        this.lostConnection();
    };
    this.pc.ondatachannel = ({ channel }) => this.attach(channel);
    // Reliable, ordered input delivery. There are no media tracks/transceivers.
    if (options.initiator)
      this.attach(this.pc.createDataChannel("netplay-v1", { ordered: true }));
  }
  private attach(channel: RTCDataChannel) {
    if (this.channel) {
      channel.close();
      return;
    }
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 65536;
    channel.onbufferedamountlow = () => this.flush();
    channel.onopen = () => {
      if (this.closed) return;
      this.options.opened();
      this.flush();
    };
    channel.onclose = () => {
      this.lostConnection();
    };
    channel.onerror = () => {
      if (this.closed) return;
      this.options.error("Conexão interrompida. Reconectando os controles…");
      this.lostConnection();
    };
    channel.onmessage = ({ data }: MessageEvent<string | ArrayBuffer>) => {
      if (this.closed) return;
      if (
        (typeof data === "string" && data.length > 8192) ||
        (data instanceof ArrayBuffer && data.byteLength > 16384)
      ) {
        this.options.error("Mensagem de netplay inválida.");
        return;
      }
      this.incoming = this.incoming
        .then(() => (this.closed ? undefined : this.options.message(data)))
        .catch((e: unknown) => {
          if (!this.closed)
            this.options.error(
              e instanceof Error ? e.message : "Falha de sincronização.",
            );
        });
    };
  }
  send(data: string | Uint8Array) {
    if (this.closed) return;
    const value = typeof data === "string" ? data : new Uint8Array(data);
    this.bytes += typeof value === "string" ? value.length : value.byteLength;
    if (this.bytes > 8388608) {
      this.options.error(
        "A conexão não está acompanhando a sincronização. Partida pausada.",
      );
      return;
    }
    this.outgoing.push(value);
    this.flush();
  }
  private flush() {
    const channel = this.channel;
    if (channel?.readyState !== "open") return;
    while (this.outgoing.length && channel.bufferedAmount < 131072) {
      const value = this.outgoing.shift()!;
      this.bytes -= typeof value === "string" ? value.length : value.byteLength;
      try {
        if (typeof value === "string") channel.send(value);
        else channel.send(value);
      } catch {
        this.lostConnection();
        return;
      }
    }
  }
  async offer() {
    if (this.closed) return;
    try {
      const description = await this.pc.createOffer();
      if (this.closed) return;
      await this.pc.setLocalDescription(description);
      if (this.closed) return;
      this.options.signal({
        kind: "description",
        description: { type: "offer", sdp: this.pc.localDescription!.sdp },
      });
    } catch (error) {
      if (!this.closed) throw error;
    }
  }
  async accept(signal: Signal) {
    if (this.closed) return;
    try {
      if (signal.kind === "candidate") {
        if (this.pc.remoteDescription)
          await this.pc.addIceCandidate(signal.candidate);
        else this.candidates.push(signal.candidate);
        return;
      }
      await this.pc.setRemoteDescription(signal.description);
      if (this.closed) return;
      for (const candidate of this.candidates.splice(0)) {
        if (this.closed) return;
        await this.pc.addIceCandidate(candidate);
      }
      if (signal.description.type === "offer") {
        const answer = await this.pc.createAnswer();
        if (this.closed) return;
        await this.pc.setLocalDescription(answer);
        if (this.closed) return;
        this.options.signal({
          kind: "description",
          description: { type: "answer", sdp: this.pc.localDescription!.sdp },
        });
      }
    } catch (error) {
      if (!this.closed) throw error;
    }
  }
  close() {
    this.closed = true;
    clearTimeout(this.disconnectTimer);
    this.outgoing = [];
    this.bytes = 0;
    this.channel?.close();
    this.pc.close();
  }
}
