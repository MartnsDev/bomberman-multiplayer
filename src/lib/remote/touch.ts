export interface PadBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
// Eight directions with a neutral centre. Coordinates can extend beyond the pad
// while a captured finger drags, so its direction does not disappear in a gap.
export function padButtons(x: number, y: number, rect: PadBounds): number[] {
  const dx = (x - rect.left - rect.width / 2) / (rect.width / 2);
  const dy = (y - rect.top - rect.height / 2) / (rect.height / 2);
  if (Math.hypot(dx, dy) < 0.24) return [];
  const angle = Math.atan2(dy, dx);
  const sector = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
  return [[7], [5, 7], [5], [5, 6], [6], [4, 6], [4], [4, 7]][sector];
}
