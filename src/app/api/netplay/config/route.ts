import { createHash } from "node:crypto";
import manifest from "../../../../../assets/emulation-netplay/five-inputs.json";
import { NETPLAY_PROTOCOL } from "@/lib/netplay/protocol";
export const runtime = "nodejs";
export function GET() {
  const settings = {
    core: "snes9x",
    legacy: true,
    threads: false,
    persistedCoreSettings: false,
    multitap: [1, 257],
    pads: 5,
    clock: 21477272,
    frameCycles: 357366,
    audioSync: false,
    audioRateControl: false,
    videoVsync: false,
    rewind: false,
    inputScheduling: "adaptive-delay-v2",
    protocol: NETPLAY_PROTOCOL,
  };
  return Response.json(
    {
      version: manifest.id,
      protocol: NETPLAY_PROTOCOL,
      core: manifest.files["cores/snes9x-legacy-wasm.data"].sha256,
      settings: createHash("sha256")
        .update(JSON.stringify(settings))
        .digest("hex"),
      rom: process.env.ROM_SHA256 || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
