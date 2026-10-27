export interface PlayerProfile {
  id: string;
  name: string;
  avatar?: string;
}
export const PRESET_PROFILES: readonly PlayerProfile[] = [
  { id: "matheus", name: "Matheus", avatar: "/avatars/matheus.png" },
  { id: "gabi", name: "Gabi", avatar: "/avatars/gabi.png" },
  { id: "helo", name: "Helo" },
  { id: "gu", name: "Gu", avatar: "/avatars/gu.png" },
];
export const PRESET_AVATARS = [
  "/avatars/matheus.png",
  "/avatars/gabi.png",
  "/avatars/gu.png",
] as const;
