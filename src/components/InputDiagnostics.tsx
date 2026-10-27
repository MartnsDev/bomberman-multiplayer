"use client";
import { useEffect, useState, type RefObject } from "react";
import { BUTTONS } from "@/lib/protocol";
export type InputSlot = {
  mask: number;
  source: "local" | "webrtc";
  at: number;
};
export default function InputDiagnostics({
  slots,
  enabled,
}: {
  slots: RefObject<InputSlot[]>;
  enabled: RefObject<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<InputSlot[]>([]);
  useEffect(() => {
    enabled.current = open;
    if (!open) return;
    const update = () => setSnapshot(slots.current.map((s) => ({ ...s })));
    update();
    const timer = setInterval(update, 150);
    return () => {
      clearInterval(timer);
      enabled.current = false;
    };
  }, [open, slots, enabled]);
  return (
    <details
      className="input-diagnostics"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Diagnóstico dos controles</summary>
      {open && (
        <>
          <p>
            Comandos encaminhados ao emulador. No jogo, cada participante
            precisa estar como MAN.
          </p>
          {snapshot.map((slot, i) => (
            <div key={i} data-input-slot={i}>
              <strong>Controle {i + 1}</strong>
              <small>
                índice {i} · {slot.source === "local" ? "local" : "WebRTC"}
              </small>
              <span>
                {BUTTONS.filter((_, b) => slot.mask & (1 << b)).join(" + ") ||
                  "Solto"}
              </span>
            </div>
          ))}
        </>
      )}
    </details>
  );
}
