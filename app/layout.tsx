import type { Metadata } from "next";
import "./globals.css";
import "./widgets.css";

export const metadata: Metadata = {
  title: "GRAILSHOT — Hold. Aim. Win.",
  description: "Live PvP Pokémon card battles. Creator fees fund the packs. Your aim wins the grail.",
  ...(process.env.NODE_ENV === 'development' ? { other: { "codex-preview": "development" } } : {}),
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head><link rel="stylesheet" href="/fonts/fonts.css" /></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
