import { z } from "zod";
export const MAX_PLAYERS = 5;
import { PRESET_AVATARS } from "./profiles";
export const avatarSchema = z.union([
  z.enum(PRESET_AVATARS),
  z
    .string()
    .max(30000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
]);
export const codeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/);
const name = z.string().trim().min(1).max(24);
export const rtcSignalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("description"),
    description: z.object({
      type: z.enum(["offer", "answer"]),
      sdp: z.string().max(60000),
    }),
  }),
  z.object({
    kind: z.literal("candidate"),
    candidate: z.object({
      candidate: z.string().max(3000),
      sdpMid: z.string().nullable().optional(),
      sdpMLineIndex: z.number().int().nullable().optional(),
      usernameFragment: z.string().nullable().optional(),
    }),
  }),
]);
export type RTCSignal = z.infer<typeof rtcSignalSchema>;
export const signalSchema = z.union([
  rtcSignalSchema,
  z
    .object({ kind: z.literal("netplay-ready"), generation: z.string().uuid() })
    .strict(),
  z
    .object({
      kind: z.literal("netplay"),
      connection: z.string().uuid(),
      generation: z.string().uuid(),
      targetGeneration: z.string().uuid(),
      signal: rtcSignalSchema,
    })
    .strict(),
]);
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    name,
    avatar: avatarSchema.optional(),
  }),
  z.object({
    type: z.literal("join"),
    code: codeSchema,
    name,
    avatar: avatarSchema.optional(),
  }),
  z.object({
    type: z.literal("resume"),
    code: codeSchema,
    token: z.string().max(128),
  }),
  z.object({
    type: z.literal("signal"),
    target: z.string().uuid(),
    signal: signalSchema,
  }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("game-ready") }),
  z.object({ type: z.literal("game-away") }),
  z.object({ type: z.literal("yield-host") }),
  z.object({ type: z.literal("elect-host"), hostId: z.string().uuid() }),
  z.object({ type: z.literal("leave") }),
  z.object({ type: z.literal("ping") }),
]);
export const inputSchema = z
  .object({
    type: z.literal("input"),
    buttons: z.array(z.number().int().min(0).max(11)).max(12),
    seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export interface Player {
  id: string;
  name: string;
  avatar?: string;
  slot: number;
  connected: boolean;
}
export interface Room {
  code: string;
  hostId: string;
  players: Player[];
  started: boolean;
  capacity: number;
}
export type Signal = z.infer<typeof signalSchema>;
export type Command = z.infer<typeof commandSchema>;
export type ServerEvent =
  | { type: "welcome"; resumableHost: boolean }
  | { type: "room"; room: Room; selfId?: string; token?: string }
  | { type: "signal"; from: string; signal: Signal }
  | { type: "error"; message: string }
  | { type: "closed"; message: string }
  | { type: "pong" };
export const BUTTONS = [
  "B",
  "Y",
  "Select",
  "Start",
  "↑",
  "↓",
  "←",
  "→",
  "A",
  "X",
  "L",
  "R",
] as const;
export const DEFAULT_KEYS = [
  "KeyZ",
  "KeyA",
  "ShiftRight",
  "Enter",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyX",
  "KeyS",
  "KeyQ",
  "KeyW",
];
