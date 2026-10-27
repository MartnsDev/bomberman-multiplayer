export interface EmulatorBridge {
  resumeAudio: () => Promise<void>;
  input: (player: number, button: number, value: number) => void;
  restart: () => void;
  save: () => Uint8Array;
  load: (state: Uint8Array) => void;
  volume: (value: number) => void;
  stream: (fps: number) => MediaStream;
  frame: () => number;
}
export function bridge(
  frame: HTMLIFrameElement | null,
): EmulatorBridge | undefined {
  return (
    frame?.contentWindow as (Window & { __bomber?: EmulatorBridge }) | null
  )?.__bomber;
}
export function release(emu: EmulatorBridge | undefined, slot: number) {
  for (let b = 0; b < 12; b++) emu?.input(slot, b, 0);
}
