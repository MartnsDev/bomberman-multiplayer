import { afterEach, it, expect, vi } from "vitest";
import { DataPeer } from "../src/lib/netplay/peer";
class Connection {
  connectionState = "new";
  onconnectionstatechange?: () => void;
  close() {
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  vi.useFakeTimers();
  vi.stubGlobal("RTCPeerConnection", Connection);
  const disconnected = vi.fn(),
    error = vi.fn();
  const peer = new DataPeer({
    initiator: false,
    iceServers: [],
    signal: vi.fn(),
    opened: vi.fn(),
    message: async () => {},
    disconnected,
    error,
  });
  const connection = peer.pc as unknown as Connection;
  const state = (value: string) => {
    connection.connectionState = value;
    connection.onconnectionstatechange?.();
  };
  return { peer, disconnected, error, state };
}
it("preserva o canal após uma interrupção breve da rede móvel", () => {
  const h = setup();
  h.state("disconnected");
  vi.advanceTimersByTime(2000);
  h.state("connected");
  vi.advanceTimersByTime(5000);
  expect(h.disconnected).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
  h.peer.close();
  expect(h.disconnected).not.toHaveBeenCalled();
});
it("recupera queda persistente uma única vez e cancela timers ao fechar", () => {
  const h = setup();
  h.state("disconnected");
  vi.advanceTimersByTime(3001);
  expect(h.disconnected).toHaveBeenCalledOnce();
  h.state("failed");
  expect(h.disconnected).toHaveBeenCalledOnce();
  h.peer.close();
  vi.runAllTimers();
  expect(h.disconnected).toHaveBeenCalledOnce();
});
it("não espera o prazo de oscilação quando o transporte falha definitivamente", () => {
  const h = setup();
  h.state("failed");
  expect(h.disconnected).toHaveBeenCalledOnce();
  h.peer.close();
});
