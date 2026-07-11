import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "grounded-chat",
  description:
    "RAG chat with inline citations and a groundedness verifier that flags unsupported sentences.",
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
