import { CircleDot, GitBranch, GitFork, ExternalLink, Rocket, Star, Users } from "lucide-react";
import type { DeepAnalysis } from "@/types/analysis";
import type { Report } from "@/types/report";
import { Chip, Empty, MetricCard, Panel, date } from "@/components/ui";
import ChartPanel from "@/components/ChartPanel";
import { StatusChip } from "@/components/report/StatusBits";
import { summarizeWeeks } from "@/lib/health";

export default function OverviewSection({
  report,
  analysis,
}: {
  report: Report;
  analysis: DeepAnalysis | null;
}) {
  const { repo } = report;
  const latestRelease = report.releases?.find((x) => x.publishedAt) ?? null;
  const weekSummary = summarizeWeeks(report.weeks);
  const checked = new Date(report.checkedAt);

  return (
    <div className="space-y-4">
      <p className="text-xs text-mute" data-testid="data-freshness">
        Data checked{" "}
        {checked.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at{" "}
        {checked.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · Source: GitHub REST API
        {analysis && ` · Analysis ${new Date(analysis.analyzedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Stars" value={repo.stars} icon={<Star className="h-5 w-5" />} />
        <MetricCard label="Forks" value={repo.forks} icon={<GitFork className="h-5 w-5" />} />
        <MetricCard
          label="Open issues"
          value={repo.openIssues}
          icon={<CircleDot className="h-5 w-5" />}
          hint="GitHub's open issue count; may include pull requests."
        />
        <MetricCard label="Contributors" value={report.contributorCount} icon={<Users className="h-5 w-5" />} />
        <MetricCard
          label="Latest release"
          value={null}
          icon={<Rocket className="h-5 w-5" />}
          display={latestRelease?.publishedAt ? date(latestRelease.publishedAt) : "—"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Weekly commits, last 52 weeks" subtitle="Trailing 52 weeks from GitHub commit activity statistics.">
          {report.weeks ? (
            <ChartPanel weeks={report.weeks} summary={weekSummary} />
          ) : (
            <Empty>
              {report.statsPending
                ? "GitHub is still computing commit statistics. Reload in a few seconds."
                : "Commit activity is unavailable for this repository."}
            </Empty>
          )}
        </Panel>

        <Panel
          title="Languages"
          subtitle={
            report.languages
              ? "Share of bytes by language, from the GitHub languages endpoint."
              : undefined
          }
        >
          {report.languages && report.languages.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {report.languages.slice(0, 8).map((l) => (
                <li key={l.name}>
                  <Chip tone="info">
                    {l.name} · {l.percent}%
                  </Chip>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{report.sectionErrors.languages ?? "Language data is unavailable."}</Empty>
          )}
        </Panel>
      </div>

      {analysis ? (
        <Panel
          title="Health indicators"
          subtitle="Explainable indicators per category. Missing data is shown as unknown — never scored down automatically."
        >
          <ul className="space-y-3">
            {analysis.indicators.map((ind) => (
              <li key={ind.name} className="flex flex-wrap items-start justify-between gap-2 border-t border-line pt-3 first:border-0 first:pt-0">
                <div>
                  <p className="text-sm">{ind.name}</p>
                  <p className="text-xs text-mute">{ind.detail}</p>
                  {ind.basis && <p className="mt-0.5 text-[11px] text-mute/80">basis: {ind.basis}</p>}
                </div>
                <StatusChip status={ind.status} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-mute">
            Indicators are Diplens heuristics from the data shown in this report — not official GitHub ratings.
          </p>
        </Panel>
      ) : (
        <Panel title="Health indicators">
          <Empty>Deep analysis is unavailable, so the extended health model was not computed.</Empty>
        </Panel>
      )}

      <Panel title="Repository identity">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-mute">Default branch</dt>
            <dd className="flex items-center gap-1 font-mono">
              <GitBranch className="h-3.5 w-3.5 text-mute" aria-hidden />
              {repo.defaultBranch}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Head commit (analysis time)</dt>
            <dd className="font-mono">{analysis?.discovery.commitSha?.slice(0, 10) ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Ecosystems detected</dt>
            <dd className="flex flex-wrap gap-1.5 pt-1">
              {analysis?.discovery.ecosystems.length ? (
                analysis.discovery.ecosystems.map((e) => <Chip key={e}>{e}</Chip>)
              ) : (
                <span className="text-mute">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-mute">GitHub</dt>
            <dd>
              <a
                href={repo.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-info"
              >
                {repo.fullName} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </dd>
          </div>
        </dl>
      </Panel>
    </div>
  );
}
