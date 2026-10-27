import { DEFAULT_KEYS } from "../protocol";
export function bindControls(
  send: (buttons: number[]) => void,
  keys: string[] = DEFAULT_KEYS,
  touch: Set<number> = new Set(),
) {
  const keyboard = new Set<number>();
  let previous = "";
  let frame = 0;
  let enabled = true;
  const flush = () => {
    keyboard.clear();
    touch.clear();
    previous = "";
    send([]);
  };
  const onKey = (event: KeyboardEvent) => {
    if (
      (event.target as HTMLElement)?.closest?.(
        "input,textarea,select,[contenteditable]",
      )
    )
      return;
    const b = keys.indexOf(event.code);
    if (b < 0) return;
    event.preventDefault();
    if (event.type === "keydown") keyboard.add(b);
    else keyboard.delete(b);
    emit();
  };
  const forwarded = (event: Event) => {
    const { code, down } = (
      event as CustomEvent<{ code: string; down: boolean }>
    ).detail;
    const b = keys.indexOf(code);
    if (b < 0) return;
    if (down) keyboard.add(b);
    else keyboard.delete(b);
    emit();
  };
  const focus = () => {
    enabled = true;
  };
  const touched = () => {
    enabled = true;
    emit();
  };
  const blur = () => {
    enabled = false;
    flush();
  };
  const visibility = () => {
    if (document.hidden) blur();
    else focus();
  };
  const emit = () => {
    const held = new Set(enabled ? [...keyboard, ...touch] : []);
    if (enabled) {
      const pad = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);
      if (pad) {
        const map = [0, 2, 8, 9, 12, 13, 14, 15, 1, 3, 4, 5];
        map.forEach((index, b) => {
          if (pad.buttons[index]?.pressed) held.add(b);
        });
        if (pad.axes[0] < -0.4) held.add(6);
        if (pad.axes[0] > 0.4) held.add(7);
        if (pad.axes[1] < -0.4) held.add(4);
        if (pad.axes[1] > 0.4) held.add(5);
      }
    }
    const state = [...held].sort((a, b) => a - b);
    const key = state.join(",");
    if (key !== previous) {
      previous = key;
      send(state);
    }
  };
  const poll = () => {
    emit();
    frame = requestAnimationFrame(poll);
  };
  const startGamepad = () => {
    if (!frame && Array.from(navigator.getGamepads?.() ?? []).some(Boolean))
      poll();
  };
  const stopGamepad = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    flush();
    startGamepad();
  };
  window.addEventListener("bomber-touch", touched);
  window.addEventListener("gamepadconnected", startGamepad);
  window.addEventListener("bomber-key", forwarded);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  window.addEventListener("blur", blur);
  window.addEventListener("focus", focus);
  window.addEventListener("pointerdown", focus);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("gamepaddisconnected", stopGamepad);
  window.addEventListener("pagehide", blur);
  startGamepad();
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("bomber-touch", touched);
    window.removeEventListener("gamepadconnected", startGamepad);
    window.removeEventListener("bomber-key", forwarded);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKey);
    window.removeEventListener("blur", blur);
    window.removeEventListener("focus", focus);
    window.removeEventListener("pointerdown", focus);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("gamepaddisconnected", stopGamepad);
    window.removeEventListener("pagehide", blur);
    flush();
  };
}
