import { Copy, UsersRound } from "lucide-react";
import type { Room } from "@/lib/protocol";
import { MAX_PLAYERS } from "@/lib/protocol";

export default function RoomInviteCard({
  room,
  onCopy,
  className = "",
}: {
  room?: Room;
  onCopy?: () => void;
  className?: string;
}) {
  const players =
    room?.players ??
    Array.from({ length: MAX_PLAYERS }, (_, slot) => ({
      id: `example-${slot}`,
      name: `Jogador ${slot + 1}`,
      slot,
      connected: true,
    }));
  return (
    <section
      className={`invite-preview ${className}`}
      aria-label={room ? "Convite da sala" : "Exemplo de sala multiplayer"}
    >
      <div className="invite-code-section">
        <p className="invite-label">
          {room ? "SUA SALA PRIVADA" : "SALA DE EXEMPLO"}
        </p>
        {room ? (
          <button
            type="button"
            className="invite-code"
            onClick={onCopy}
            aria-label="Copiar código da sala"
          >
            <span>{room.code}</span>
            <Copy size={22} aria-hidden="true" />
          </button>
        ) : (
          <div className="invite-code example-code">
            <span>7K3F9</span>
            <Copy size={22} aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="invite-players">
        <p className="invite-label">
          {room
            ? `${players.filter((p) => p.connected).length}/${room.capacity} NA SALA`
            : `2–${MAX_PLAYERS} JOGADORES`}
        </p>
        <div
          className="invite-player-icons"
          aria-label={room ? "Participantes da sala" : "Até cinco jogadores"}
        >
          {players.map((player) => (
            <span
              key={player.id}
              className={`invite-person player-color-${player.slot}`}
              data-connected={player.connected}
              title={
                room
                  ? `${player.name}${player.connected ? " · conectado" : " · reconectando"}`
                  : undefined
              }
              aria-label={room ? player.name : undefined}
            >
              <UsersRound size={30} aria-hidden="true" />
            </span>
          ))}
        </div>
        <p>
          {room
            ? "Compartilhe o código e joguem juntos."
            : "Convide seus amigos e jogue juntos"}
        </p>
      </div>
    </section>
  );
}
