import sharp from "sharp";
import { mkdir, stat } from "node:fs/promises";
await mkdir("public/optimized/avatars", { recursive: true });
const jobs = [
  ...[192, 512].map((size) => ({
    input: "assets/design/bomberman-head.png",
    output: `public/optimized/app-${size}.png`,
    width: size,
    height: size,
  })),
  {
    input: "assets/design/bomberman-battle-wide.png",
    output: "public/optimized/bomberman-battle.webp",
    width: 1200,
  },
  ...["gu", "gabi", "matheus"].map((name) => ({
    input: `public/avatars/${name}.png`,
    output: `public/optimized/avatars/${name}.webp`,
    width: 112,
    height: 112,
  })),
  {
    input: "public/bomberman-logo.png",
    output: "public/optimized/bomberman-logo.webp",
    width: 600,
  },
  {
    input: "assets/design/bomberman-head.png",
    output: "public/optimized/icon.png",
    width: 128,
  },
];
let before = 0,
  after = 0;
for (const job of jobs) {
  const pipeline = sharp(job.input).rotate().resize({
    width: job.width,
    height: job.height,
    fit: "cover",
    withoutEnlargement: true,
  });
  await (
    job.output.endsWith(".png")
      ? pipeline.png({ compressionLevel: 9 })
      : pipeline.webp({ quality: 78, effort: 5 })
  ).toFile(job.output);
  before += (await stat(job.input)).size;
  after += (await stat(job.output)).size;
}
console.log(
  `Imagens da interface: ${Math.round(after / 1024)} KB (fontes: ${Math.round(before / 1024)} KB; originais preservados)`,
);
