import type { Metadata } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { BarChart3, Github } from "lucide-react";
import HeaderActions from "@/components/docs/HeaderActions";
import { APP_VERSION } from "@/lib/docs/registry";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diplens — GitHub repository analytics",
  description:
    "Explore activity, releases, contributors, and maintenance signals in one shareable report.",
};

const THEME_INIT = `(function(){try{if(localStorage.getItem("diplens-theme")==="light"){document.documentElement.classList.add("light");}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        <header className="border-b border-line">
          <nav className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-5">
              <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
                <BarChart3 className="h-5 w-5 text-ok" aria-hidden />
                Diplens
              </Link>
              <span className="hidden rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-mute sm:inline">
                v{APP_VERSION}
              </span>
              <div className="hidden items-center gap-5 text-sm text-mute sm:flex">
                <Link href="/#features" className="hover:text-ink">
                  Features
                </Link>
                <Link href="/#how" className="hover:text-ink">
                  How it works
                </Link>
                <Link href="/docs" className="hover:text-ink">
                  Docs
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <HeaderActions />
              <a
                href="https://github.com/dipeshdarks/DipAi"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-sm text-mute transition-colors duration-150 hover:border-info/40 hover:text-ink"
              >
                <Github className="h-4 w-4" aria-hidden />
                <span className="hidden md:inline">View on GitHub</span>
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
            <p>
              Diplens · Built with Next.js. Tokens stay on the server and are never exposed to the
              browser.{" "}
              <a
                href="https://github.com/dipeshdarks/DipAi"
                target="_blank"
                rel="noreferrer"
                className="text-info hover:underline"
              >
                Source on GitHub
              </a>
              {" · "}
              <Link href="/docs" className="text-info hover:underline">
                Docs
              </Link>
              .
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
