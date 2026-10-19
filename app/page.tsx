import Link from "next/link";
import RepoSearch from "@/components/RepoSearch";
import { Chip, MetricCard, Panel } from "@/components/ui";
import { CircleDot, GitFork, Star, Users, Rocket, BarChart3 } from "lucide-react";

const features = [
  ["Live repository data", "Stars, forks, issues, and contributors straight from the GitHub API."],
  ["Commit and release history", "Weekly commit volume for the past year and the latest releases."],
  ["Explainable health signals", "Each signal states the data behind it. There is no hidden score."],
];

const steps = [
  "Paste owner/repo or a GitHub URL.",
  "RepoLens fetches public data on the server.",
  "Copy the report link and share it.",
];

export default function Home() {
  return (
    <main className="mx-auto max-w-[1280px] px-4 sm:px-6">
      <section className="flex flex-col items-center py-20 text-center sm:py-28">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
          Understand any GitHub repository at a glance.
        </h1>
        <p className="mt-5 max-w-xl text-mute">
          Explore activity, releases, contributors, and maintenance signals in one shareable
          report.
        </p>
        <div className="mt-9 flex w-full justify-center">
          <RepoSearch />
        </div>
      </section>

      <section id="features" className="grid scroll-mt-8 gap-4 pb-16 md:grid-cols-3">
        {features.map(([t, d]) => (
          <div key={t} className="panel">
            <h2 className="font-medium">{t}</h2>
            <p className="mt-2 text-sm text-mute">{d}</p>
          </div>
        ))}
      </section>

      <section id="example" className="scroll-mt-8 pb-16">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">Example report</h2>
          <span className="rounded-full border border-warn/50 px-2.5 py-0.5 text-xs font-medium text-warn">
            Example · sample data — not live GitHub data
          </span>
        </div>
        <div className="pointer-events-none space-y-4 opacity-90 select-none" aria-label="Example report preview with sample data">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elev">
                <BarChart3 className="h-6 w-6 text-mute" aria-hidden />
              </div>
              <div>
                <p className="font-mono text-lg font-semibold">acme/widget</p>
                <p className="text-sm text-mute">A sample open-source widget library.</p>
                <p className="mt-1 flex gap-2">
                  <Chip tone="info">TypeScript</Chip>
                  <Chip>MIT</Chip>
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Stars" value={1284} icon={<Star className="h-5 w-5" />} />
            <MetricCard label="Forks" value={210} icon={<GitFork className="h-5 w-5" />} />
            <MetricCard label="Open issues" value={17} icon={<CircleDot className="h-5 w-5" />} />
            <MetricCard label="Contributors" value={9} icon={<Users className="h-5 w-5" />} />
            <MetricCard label="Latest release" value={null} icon={<Rocket className="h-5 w-5" />} display="Mar 2, 2026" />
          </div>
          <Panel title="Weekly commits, last 52 weeks" subtitle="Sample values for layout illustration only.">
            <div className="flex h-40 items-end gap-1" aria-hidden>
              {[12, 18, 9, 24, 31, 20, 15, 28, 22, 35, 19, 26, 30, 14, 21, 27, 33, 16, 23, 29].map(
                (h, i) => (
                  <div key={i} className="flex-1 rounded-t bg-info/60" style={{ height: `${(h / 35) * 100}%` }} />
                ),
              )}
            </div>
            <p className="mt-3 text-xs text-mute">
              482 commits across 20 sample weeks. This preview is illustrative; run a real report
              above for live data.
            </p>
          </Panel>
        </div>
      </section>

      <section id="how" className="scroll-mt-8 pb-24">
        <h2 className="mb-4 text-xl font-semibold">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s} className="panel text-sm">
              <span className="mr-2 font-mono text-ok">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-mute">
          Want a real report now?{" "}
          <Link href="/repo/vercel/next.js" className="font-mono text-info hover:underline">
            Open the vercel/next.js report
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
