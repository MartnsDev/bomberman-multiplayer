"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { padButtons } from "@/lib/remote/touch";

export type TouchMode = "auto" | "on" | "off";
export type TouchSize = "normal" | "large";
const directions = [
  { label: "Cima e esquerda", glyph: "↖", buttons: [4, 6] },
  { label: "Cima", glyph: "↑", buttons: [4] },
  { label: "Cima e direita", glyph: "↗", buttons: [4, 7] },
  { label: "Esquerda", glyph: "←", buttons: [6] },
  { label: "Direita", glyph: "→", buttons: [7] },
  { label: "Baixo e esquerda", glyph: "↙", buttons: [5, 6] },
  { label: "Baixo", glyph: "↓", buttons: [5] },
  { label: "Baixo e direita", glyph: "↘", buttons: [5, 7] },
];

export default function TouchControls({
  onChange,
  mode,
  size = "normal",
  disabled = false,
}: {
  onChange: (buttons: number[]) => void;
  mode: TouchMode;
  size?: TouchSize;
  disabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pad = useRef<HTMLDivElement>(null);
  const directionPointers = useRef(new Set<number>());
  const previous = useRef("");
  // Each finger owns its buttons; lifting one must not release another finger.
  const pointers = useRef(new Map<number, number[]>());
  const [pressed, setPressed] = useState<number[]>([]);
  const publish = useCallback(() => {
    const next = [...new Set([...pointers.current.values()].flat())].sort(
      (a, b) => a - b,
    );
    const key = next.join(",");
    if (key === previous.current) return;
    previous.current = key;
    setPressed(next);
    onChange(next);
  }, [onChange]);
  const clear = useCallback(() => {
    pointers.current.clear();
    directionPointers.current.clear();
    setPressed([]);
    publish();
  }, [publish]);

  useEffect(() => {
    clear();
    let width = window.innerWidth;
    const resize = () => {
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        clear();
      }
    };
    const releasePointer = (event: PointerEvent) => {
      if (!pointers.current.delete(event.pointerId)) return;
      directionPointers.current.delete(event.pointerId);
      publish();
    };
    const visibility = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("blur", clear);
    window.addEventListener("resize", resize);
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    window.addEventListener("pagehide", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", clear);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", releasePointer);
      window.removeEventListener("pagehide", clear);
      document.removeEventListener("visibilitychange", visibility);
      pointers.current.clear();
      directionPointers.current.clear();
      previous.current = "";
      onChange([]);
    };
  }, [clear, onChange, mode, size, disabled]);

  function update(event: ReactPointerEvent<HTMLDivElement>, start: boolean) {
    if (
      disabled ||
      mode === "off" ||
      (event.pointerType === "mouse" && event.button !== 0 && start)
    )
      return;
    if (!start && !pointers.current.has(event.pointerId)) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest<HTMLButtonElement>("[data-game-buttons]");
    const onPad = !!element && !!pad.current?.contains(element);
    if (start && !onPad && (!target || !root.current?.contains(target))) return;
    event.preventDefault();
    if (start) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (error) {
        // A cancelled OS gesture has no active pointer left to release later.
        if (error instanceof DOMException && error.name === "NotFoundError")
          return;
        // Older engines without capture still have window release listeners.
      }
      if (onPad) directionPointers.current.add(event.pointerId);
    }
    const buttons =
      directionPointers.current.has(event.pointerId) && pad.current
        ? padButtons(
            event.clientX,
            event.clientY,
            pad.current.getBoundingClientRect(),
          )
        : target &&
            root.current?.contains(target) &&
            !pad.current?.contains(target)
          ? target.dataset.gameButtons!.split(",").map(Number)
          : [];
    pointers.current.set(event.pointerId, buttons);
    publish();
  }
  function release(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    directionPointers.current.delete(event.pointerId);
    if (event.cancelable) event.preventDefault();
    publish();
  }
  function button(
    label: string,
    buttons: number[],
    glyph = label,
    className = "",
  ) {
    return (
      <button
        key={label}
        type="button"
        className={`touch-button ${className}`}
        aria-label={label}
        data-game-buttons={buttons.join(",")}
        aria-pressed={buttons.every((b) => pressed.includes(b))}
        disabled={disabled}
        tabIndex={-1}
        title={
          label === "A"
            ? "Bomba / confirmar"
            : label === "B"
              ? "Voltar / ação B"
              : label
        }
        onClick={(event) => event.preventDefault()}
      >
        <span aria-hidden="true">{glyph}</span>
        {label === "A" && <small aria-hidden="true">Bomba</small>}
      </button>
    );
  }
  return (
    <div
      ref={root}
      className="touch-controls"
      data-mode={mode}
      data-size={size}
      role="group"
      aria-label="Controle de toque"
      onPointerDown={(event) => update(event, true)}
      onPointerMove={(event) => update(event, false)}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="touch-shoulders">
        {button("L", [10])}
        {button("R", [11])}
      </div>
      <div ref={pad} className="touch-pad" role="group" aria-label="Direcional">
        {directions.map((direction, index) => (
          <span
            key={direction.label}
            style={{
              gridArea: `${Math.floor((index < 4 ? index : index + 1) / 3) + 1} / ${((index < 4 ? index : index + 1) % 3) + 1}`,
            }}
          >
            {button(
              direction.label,
              direction.buttons,
              direction.glyph,
              direction.buttons.length === 2 ? "touch-diagonal" : "",
            )}
          </span>
        ))}
        <span className="touch-pad-center" aria-hidden="true">
          ✦
        </span>
      </div>
      <div className="touch-actions" role="group" aria-label="Botões de ação">
        {button("X", [9], "X", "touch-x")}
        {button("Y", [1], "Y", "touch-y")}
        {button("A", [8], "A", "touch-a")}
        {button("B", [0], "B", "touch-b")}
      </div>
      <div className="touch-system">
        {button("Select", [2])}
        {button("Start", [3])}
      </div>
    </div>
  );
}
