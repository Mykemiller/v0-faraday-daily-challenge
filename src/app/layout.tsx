import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Faraday — Your unfair advantage",
  description:
    "Faraday reads the AI data center market every day and tells you what it means. Specific. Sourced. Ahead.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* IBM Plex Serif (display) · Bricolage Grotesque (body/UI) · IBM Plex Mono (labels/data) */}
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Bricolage+Grotesque:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      {/* Each public surface (/, /challenge) renders its own masthead + footer to
          match its reference build, so the root layout stays chrome-free. */}
      <body className="min-h-full bg-warm-white text-near-black font-sans">
        {children}
      </body>
    </html>
  );
}
