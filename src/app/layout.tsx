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

/**
 * White-label: a deployment sits on a client's own site, and a browser tab
 * reading "grounded-chat" puts our project name in front of their customers.
 * BUSINESS_NAME names the business the widget answers for.
 */
const BUSINESS = process.env.BUSINESS_NAME;

export const metadata: Metadata = {
  title: BUSINESS ? `Ask ${BUSINESS}` : "Grounded answers",
  description: BUSINESS
    ? `Answers drawn only from what ${BUSINESS} has published, with every sentence checked against the source and anything unsupported flagged.`
    : "Answers drawn only from published pages, with every sentence checked against the source and anything unsupported flagged.",
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
