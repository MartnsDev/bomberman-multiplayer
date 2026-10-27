import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./redesign.css";
import localFont from "next/font/local";
const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "400 800",
});
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
export const metadata: Metadata = {
  title: "Bomberman Online",
  icons: { icon: "/optimized/icon.png", apple: "/optimized/icon.png" },
  description: "Sua sala privada. O clássico de volta, com seus amigos.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
