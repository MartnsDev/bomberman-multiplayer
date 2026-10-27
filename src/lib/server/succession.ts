/** Room-authoritative elections; transport reports alone never create two hosts. */
export interface Candidate {
  id: string;
  slot: number;
  connected: boolean;
  gameReady?: boolean;
  lastSeen?: number;
  voteHost?: string;
  voteAt?: number;
}
export function successor(
  players: Candidate[],
  hostId: string,
  now = Date.now(),
) {
  const live = players.filter(
    (p) =>
      p.id !== hostId &&
      p.connected &&
      (p.lastSeen === undefined || now - p.lastSeen < 45000),
  );
  const ready = live.filter((p) => p.gameReady);
  return [...(ready.length ? ready : live)].sort((a, b) => a.slot - b.slot)[0];
}
export function election(
  players: Candidate[],
  hostId: string,
  now = Date.now(),
) {
  const eligible = players.filter(
    (p) =>
      p.id !== hostId &&
      p.connected &&
      p.gameReady &&
      (p.lastSeen === undefined || now - p.lastSeen < 45000),
  );
  const votes = eligible.filter(
    (p) => p.voteHost === hostId && now - (p.voteAt ?? 0) < 10000,
  );
  if (!eligible.length || votes.length < Math.floor(eligible.length / 2) + 1)
    return;
  return [...eligible].sort((a, b) => a.slot - b.slot)[0];
}
