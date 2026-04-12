import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Faraday Daily Challenge",
  description: "Test your data center intelligence. Always on. Always ahead.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col bg-warm-white text-near-black font-sans">
        {/* Header Masthead */}
        <header className="bg-forest w-full py-6 px-4 md:px-6">
          <div className="max-w-7xl mx-auto flex flex-col items-center gap-1">
            <Link href="/" className="no-underline">
              <h1 className="text-3xl md:text-4xl font-serif font-bold text-gold tracking-widest">
                FARADAY
              </h1>
            </Link>
            <p className="text-sm md:text-base text-sage font-medium tracking-wide uppercase">
              Daily Challenge
            </p>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-grow w-full">
          {children}
        </main>

        {/* Footer */}
        <footer className="bg-forest w-full py-8 px-4 md:px-6 mt-16">
          <div className="max-w-7xl mx-auto text-center space-y-2">
            <p className="text-warm-white text-sm">
              © 2026 Faraday Intelligence
            </p>
            <p className="text-sage text-xs tracking-wide uppercase">
              Always on. Always ahead. Always Faraday.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
