import { notFound } from "next/navigation";
import { ExternalLink, GitBranch, Archive } from "lucide-react";
import { GitHubError, getReport } from "@/lib/github";
import { getHealthRadar } from "@/lib/health-radar/fetch";
import { parseRepo } from "@/lib/validation";
import { Chip, date } from "@/components/ui";
import ShareReportButton from "@/components/ShareReportButton";
import ReportShell from "@/components/report/ReportShell";
import { runDeepAnalysis } from "@/lib/analysis/run";
import { DEFAULT_BUDGET } from "@/lib/analysis/budgets";
import type { DeepAnalysis } from "@/types/analysis";
import type { HealthRadar } from "@/types/health";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: { owner: string; repo: string };
}) {
  const p = parseRepo(`${params.owner}/${params.repo}`);
  if (!p) notFound();

  let r;
  try {
    r = await getReport(p.owner, p.repo);
  } catch (e) {
    if (e instanceof GitHubError && e.kind === "not_found") notFound();
    throw e;
  }

  let analysis: DeepAnalysis | null = null;
  let analysisError: string | null = null;
  try {
    analysis = await runDeepAnalysis(r, { budget: DEFAULT_BUDGET });
  } catch (e) {
    analysisError =
      e instanceof Error ? e.message : "The analysis pipeline failed unexpectedly.";
  }

  // Health radar reuses the report above (no duplicate base fetches) and never
  // throws for supporting endpoints — worst case the tab shows its empty state.
  let radar: HealthRadar | null = null;
  try {
    radar = (await getHealthRadar(p.owner, p.repo, r)).radar;
  } catch {
    radar = null;
  }

  const { repo } = r;

  return (
    <main className="mx-auto max-w-[1280px] space-y-4 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={repo.avatarUrl} alt="" width={48} height={48} className="rounded-full" />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 font-mono text-xl font-semibold">
              <span className="truncate">{repo.fullName}</span>
              {repo.archived && (
                <span className="inline-flex items-center gap-1 rounded-full border border-warn/50 px-2 py-0.5 text-xs font-normal text-warn">
                  <Archive className="h-3 w-3" aria-hidden /> Archived
                </span>
              )}
            </h1>
            <p className="text-sm text-mute">{repo.description ?? "No description provided."}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mute">
              {repo.primaryLanguage && <Chip tone="info">{repo.primaryLanguage}</Chip>}
              {repo.licenseSpdx && <Chip>{repo.licenseSpdx}</Chip>}
              <Chip>
                <GitBranch className="mr-1 h-3 w-3" aria-hidden />
                {repo.defaultBranch}
              </Chip>
              <span>
                Created {date(repo.createdAt)} · Last pushed {repo.pushedAt ? date(repo.pushedAt) : "—"}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={repo.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-line bg-elev px-3 py-2 text-sm transition duration-150 hover:border-info"
          >
            <ExternalLink className="h-4 w-4" /> View on GitHub
          </a>
          <ShareReportButton />
        </div>
      </header>

      <ReportShell report={r} analysis={analysis} analysisError={analysisError} radar={radar} />
    </main>
  );
}
