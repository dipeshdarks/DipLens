import type { DeepAnalysis } from "@/types/analysis";
import type { Report } from "@/types/report";
import { Chip, Empty, Panel, date } from "@/components/ui";
import ChartPanel from "@/components/ChartPanel";
import { summarizeWeeks } from "@/lib/health";

export default function GitActivitySection({
  report,
  analysis,
}: {
  report: Report;
  analysis: DeepAnalysis | null;
}) {
  const a = analysis?.activity ?? null;
  const weekSummary = summarizeWeeks(report.weeks);

  return (
    <div className="space-y-4">
      <Panel title="Weekly commits, last 52 weeks" subtitle="From GitHub's commit activity statistics endpoint.">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Recent commits"
          subtitle={a ? `Sample window: ${a.recentCommits.length} most recent commit(s) on ${analysis?.discovery.defaultBranch}.` : "Deep analysis unavailable."}
        >
          {a && a.recentCommits.length ? (
            <ul className="space-y-2.5">
              {a.recentCommits.slice(0, 15).map((c) => (
                <li key={c.sha}>
                  <a
                    href={c.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-sm hover:text-info"
                  >
                    <span className="font-mono text-xs text-mute">{c.sha.slice(0, 7)}</span>{" "}
                    {c.message}
                  </a>
                  <p className="text-xs text-mute">
                    {c.author ?? "unknown author"} · {c.date ? date(c.date) : "—"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{analysis?.sectionStatus.activity.note ?? "Commit history is unavailable."}</Empty>
          )}
        </Panel>

        <Panel title="Tags & branches">
          {a ? (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm text-mute">
                  Branches: <span className="text-ink">{a.branchCount ?? "—"}</span>
                </p>
                {a.tags.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {a.tags.map((t) => (
                      <li key={t}>
                        <Chip>{t}</Chip>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-mute">No tags returned in the first page.</p>
                )}
              </div>
              <p className="text-xs text-mute">{a.observationNote}</p>
            </div>
          ) : (
            <Empty>Tag and branch data requires the deep analysis run.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="Releases">
        {report.releases?.length ? (
          <ul className="space-y-3">
            {report.releases.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 text-sm">
                <a href={x.htmlUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-info">
                  <span className="font-mono">{x.tagName}</span>
                  {x.title && x.title !== x.tagName && <span className="text-mute"> {x.title}</span>}
                </a>
                <span className="flex shrink-0 items-center gap-2 text-xs text-mute">
                  {x.prerelease && <span className="rounded-full border border-warn px-2 py-0.5 text-warn">Prerelease</span>}
                  {date(x.publishedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            {report.releases ? "This repository has no releases." : (report.sectionErrors.releases ?? "Release data is unavailable.")}
          </Empty>
        )}
      </Panel>

      {a && (
        <p className="text-xs text-mute">
          Commit counts describe repository activity, not productivity or code quality.
        </p>
      )}
    </div>
  );
}
