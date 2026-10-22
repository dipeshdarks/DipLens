import type { Metadata } from "next";
import Link from "next/link";
import {
  Github,
  ArrowRight,
  Search,
  FileCode2,
  ShieldCheck,
  BarChart3,
  Link2,
  Terminal,
} from "lucide-react";
import { Panel } from "@/components/ui";
import { NAV, DOC_PAGES, GITHUB, docPage } from "@/lib/docs/registry";

export const metadata: Metadata = {
  title: "Docs — Diplens",
  description:
    "Understand DipAi. Install it. Build with it. Guides, concepts, and reference for the Diplens repository analyzer.",
};

const QUICK_SLUGS = ["getting-started", "installation", "quick-start"] as const;

const FEATURES = [
  {
    icon: <Search className="h-4 w-4" aria-hidden />,
    title: "Repository search",
    body: "Accepts owner/repo or a github.com URL. Invalid input is rejected before any network call.",
  },
  {
    icon: <BarChart3 className="h-4 w-4" aria-hidden />,
    title: "Shareable reports",
    body: "Every repository gets a canonical /repo/{owner}/{repo} URL rendered server-side. No account required.",
  },
  {
    icon: <FileCode2 className="h-4 w-4" aria-hidden />,
    title: "Static deep analysis",
    body: "tree-sitter WASM parsers build symbols, call graphs, execution paths, and taint candidates. Repository code is never executed.",
  },
  {
    icon: <ShieldCheck className="h-4 w-4" aria-hidden />,
    title: "Explainable health signals",
    body: "Four heuristics with visible rules and evidence — not an invented score. Missing data shows Unknown, never a guess.",
  },
] as const;

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-[900px] px-4 py-12 sm:px-6">
      {/* Hero */}
      <header className="mb-12 border-b border-line pb-10">
        <p className="text-xs font-medium uppercase tracking-widest text-info">Documentation</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Diplens Documentation
        </h1>
        <p className="mt-4 max-w-xl text-lg text-mute">
          Understand DipAi. Install it. Build with it. Everything here is written against the real
          source code — no invented commands, APIs, or file paths.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/docs/getting-started"
            className="inline-flex items-center gap-2 rounded-md bg-info/15 px-4 py-2 text-sm font-medium text-info ring-1 ring-inset ring-info/30 hover:bg-info/25"
          >
            Get Started
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <a
            href={GITHUB.repo}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-line bg-elev px-4 py-2 text-sm text-ink hover:border-info/40"
          >
            <Github className="h-4 w-4" aria-hidden />
            View on GitHub
            <span aria-hidden>↗</span>
          </a>
        </div>
      </header>

      {/* Quick links from the registry (keeps titles in sync with pages.json) */}
      <section aria-labelledby="quick-links" className="mb-12">
        <h2 id="quick-links" className="text-lg font-semibold text-ink">
          Start here
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {QUICK_SLUGS.map((slug) => {
            const page = docPage(slug);
            if (!page) return null;
            return (
              <Link
                key={slug}
                href={`/docs/${slug}`}
                className="group rounded-lg border border-line bg-card p-4 transition hover:border-info/40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink group-hover:text-info">
                    {page.title}
                  </span>
                  <ArrowRight
                    className="h-4 w-4 text-mute transition group-hover:translate-x-0.5 group-hover:text-info"
                    aria-hidden
                  />
                </div>
                <p className="mt-1.5 text-sm text-mute">{page.description}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Feature overview */}
      <section aria-labelledby="features" className="mb-12">
        <h2 id="features" className="text-lg font-semibold text-ink">
          What&apos;s inside
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <Panel
              key={f.title}
              title={
                <span className="inline-flex items-center gap-2">
                  {f.icon}
                  {f.title}
                </span>
              }
            >
              <p className="text-sm text-mute">{f.body}</p>
            </Panel>
          ))}
        </div>
      </section>

      {/* Verified quick example */}
      <section aria-labelledby="quick-example" className="mb-12">
        <h2 id="quick-example" className="text-lg font-semibold text-ink">
          Quick example
        </h2>
        <p className="mt-2 text-sm text-mute">
          Clone, install, and run — the shortest verified path from a clean checkout to a live
          report.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-card p-4 text-sm text-ink">
          <code>{`git clone https://github.com/dipeshdarks/DipAi.git
cd DipAi
npm install
npm run dev`}</code>
        </pre>
        <p className="mt-3 text-sm text-mute">
          Open{" "}
          <a
            href="http://localhost:3000"
            className="font-mono text-info hover:underline"
            rel="noreferrer"
          >
            http://localhost:3000
          </a>
          , search <code className="rounded bg-elev px-1 py-0.5 font-mono text-ink">owner/repo</code>,
          and share the resulting{" "}
          <code className="rounded bg-elev px-1 py-0.5 font-mono text-ink">/repo/&#123;owner&#125;/&#123;repo&#125;</code>{" "}
          link.
        </p>
      </section>

      {/* Full nav */}
      <section aria-labelledby="all-pages" className="mb-12">
        <h2 id="all-pages" className="text-lg font-semibold text-ink">
          All pages
        </h2>
        <div className="mt-4 space-y-6">
          {NAV.map((group) => (
            <div key={group.label}>
              <h3 className="text-xs font-medium uppercase tracking-widest text-mute">
                {group.label}
              </h3>
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                {group.slugs.map((slug) => {
                  const page = DOC_PAGES.find((p) => p.slug === slug);
                  if (!page) return null;
                  return (
                    <li key={slug}>
                      <Link
                        href={`/docs/${slug}`}
                        className="group flex items-baseline justify-between gap-4 px-4 py-3 hover:bg-elev"
                      >
                        <span className="text-sm font-medium text-ink group-hover:text-info">
                          {page.title}
                        </span>
                        <span className="text-right text-sm text-mute">{page.description}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Repo section */}
      <section aria-labelledby="repo-links" className="border-t border-line pt-10">
        <h2 id="repo-links" className="text-lg font-semibold text-ink">
          Repository & links
        </h2>
        <ul className="mt-4 space-y-2.5 text-sm">
          <li className="flex items-start gap-2">
            <Github className="mt-0.5 h-4 w-4 shrink-0 text-mute" aria-hidden />
            <a
              href={GITHUB.repo}
              target="_blank"
              rel="noreferrer"
              className="text-info hover:underline"
            >
              github.com/dipeshdarks/DipAi
            </a>
            <span className="text-mute">— main repository (this site&apos;s source).</span>
          </li>
          <li className="flex items-start gap-2">
            <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-mute" aria-hidden />
            <Link href="/docs/installation" className="text-info hover:underline">
              Installation
            </Link>
            <span className="text-mute">
              — prerequisites, env vars, and first run.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-mute" aria-hidden />
            <a
              href={GITHUB.issues}
              target="_blank"
              rel="noreferrer"
              className="text-info hover:underline"
            >
              Issues
            </a>
            <span className="text-mute">— bug reports and feature requests. Docs gaps count too.</span>
          </li>
          <li className="flex items-start gap-2">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-mute" aria-hidden />
            <a
              href="https://docs.github.com/en/rest"
              target="_blank"
              rel="noreferrer"
              className="text-info hover:underline"
            >
              GitHub REST API docs
            </a>
            <span className="text-mute">— the data source Diplens queries.</span>
          </li>
        </ul>
      </section>
    </main>
  );
}
