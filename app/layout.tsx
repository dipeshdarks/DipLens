import type { Metadata } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { BarChart3, Github } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diplens — GitHub repository analytics",
  description:
    "Explore activity, releases, contributors, and maintenance signals in one shareable report.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        <header className="border-b border-line">
          <nav className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <BarChart3 className="h-5 w-5 text-ok" aria-hidden />
              Diplens
            </Link>
            <div className="flex items-center gap-5 text-sm text-mute">
              <Link href="/#features" className="hover:text-ink">
                Features
              </Link>
              <Link href="/#how" className="hover:text-ink">
                How it works
              </Link>
              <a
                href="https://github.com"
                aria-label="GitHub"
                className="hover:text-ink"
                target="_blank"
                rel="noreferrer"
              >
                <Github className="h-5 w-5" />
              </a>
            </div>
          </nav>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-line">
          <div className="mx-auto max-w-[1280px] space-y-2 px-4 py-8 text-xs text-mute sm:px-6">
            <p>
              Data source:{" "}
              <a
                href="https://docs.github.com/en/rest"
                target="_blank"
                rel="noreferrer"
                className="text-info hover:underline"
              >
                GitHub REST API
              </a>
              . Public repositories only; no sign-in required.
            </p>
            <p>
              Limitations: commit statistics can lag while GitHub computes them; open-issue counts
              may include pull requests; contributor counts reflect GitHub&apos;s reported commit
              totals. Health indicators are Diplens heuristics, not official GitHub ratings.
            </p>
            <p>Diplens · Built with Next.js. Tokens stay on the server and are never exposed to the browser.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
