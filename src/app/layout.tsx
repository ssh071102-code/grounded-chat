import type { Metadata } from "next";
// Self-hosted fonts (offline, deterministic builds - no build-time network).
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/500.css";
import "@fontsource/newsreader/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "grounded-chat",
  description:
    "A RAG chat app that refuses to make things up - streaming answers with inline citations and a groundedness verifier that flags any sentence the sources do not support.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
