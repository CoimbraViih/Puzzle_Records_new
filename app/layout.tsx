import type { Metadata } from "next";
import { Barlow_Condensed, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Trio tipográfico da marca (Design.md §2): Barlow Condensed para
// títulos/hero numbers, Public Sans para corpo/UI, IBM Plex Mono para
// relógio, IDs e números tabulares.
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Puzzle Records",
  description: "Automação de posts para Instagram — Puzzle Records",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${barlowCondensed.variable} ${publicSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
