import { z } from "zod";
export const NETPLAY_PROTOCOL = 4;
export const MAX_FRAME_AHEAD = 256;
// Returning clients may receive several seconds of commits in one network burst.
export const MAX_BUFFERED_COMMITS = 1024;
export const MASK = 4095;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const compatibilitySchema = z
  .object({
    protocol: z.literal(NETPLAY_PROTOCOL),
    rom: hash,
    core: hash,
    settings: hash,
  })
  .strict();
export type Compatibility = z.infer<typeof compatibilitySchema>;
const frame = z.number().int().min(0).max(2147483647);
const mask = z.number().int().min(0).max(MASK);
export const frameInputSchema = z
  .object({
    type: z.literal("input"),
    epoch: z.string().uuid(),
    frame,
    slot: z.number().int().min(0).max(4),
    mask,
  })
  .strict();
export type FrameInput = z.infer<typeof frameInputSchema>;
export interface FrameCommit {
  type: "commit";
  epoch: string;
  frame: number;
  masks: [number, number, number, number, number];
}
export function compatible(a: Compatibility, b: Compatibility) {
  return (
    a.protocol === b.protocol &&
    a.rom === b.rom &&
    a.core === b.core &&
    a.settings === b.settings
  );
}
