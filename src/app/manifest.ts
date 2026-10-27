import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bomberman Online",
    short_name: "Bomberman",
    description: "Sua turma e seu jogo instalado neste aparelho.",
    start_url: "/",
    display: "standalone",
    background_color: "#030712",
    theme_color: "#0a1529",
    lang: "pt-BR",
    icons: [192, 512].map((size) => ({
      src: `/optimized/app-${size}.png`,
      sizes: `${size}x${size}`,
      type: "image/png",
      purpose: "any",
    })),
  };
}
