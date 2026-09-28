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
      <head>
        <meta name="theme-color" content="#131510" />
        <link rel="preload" href="/fonts/space-grotesk-400-v1.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/space-grotesk-700-v1.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="stylesheet" href="/fonts/fonts-v2.css" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
