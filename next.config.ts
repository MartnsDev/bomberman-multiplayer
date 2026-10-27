import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  // Allow automated tests to run beside an existing developer server.
  distDir: process.env.BOMBER_BUILD_DIR || ".next",
  async headers() {
    return ["/sw.js", "/client-assets.json", "/emulator.html", "/netplay-emulator.html"].map(
      (source) => ({
        source,
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      }),
    );
  },
};
export default config;
