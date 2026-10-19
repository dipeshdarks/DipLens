"use client";

import type { DeepAnalysis } from "@/types/analysis";
import { Chip, Empty, Panel } from "@/components/ui";
import { StatusChip } from "@/components/report/StatusBits";

export default function CoverageSection({ analysis }: { analysis: DeepAnalysis }) {
  const c = analysis.coverage;

  return (
    <div className="space-y-4">
      <Panel title="Analysis coverage" subtitle={c.disclosure}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-line bg-elev p-3">
            <p className="text-xs text-mute">Tree status</p>
            <p className="mt-1">
              <StatusChip status={c.treeStatus} />
            </p>
            <p className="mt-1 text-[11px] text-mute">
              {c.treeEntries.toLocaleString("en-US")} entries
              {c.treeTruncated ? " (truncated by GitHub)" : ""}
            </p>
          </div>
          <div className="rounded-md border border-line bg-elev p-3">
            <p className="text-xs text-mute">Files inspected</p>
            <p className="mt-1 text-2xl font-semibold">{c.filesInspected.length}</p>
            <p className="text-[11px] text-mute">{c.filesSkipped.length} skipped</p>
          </div>
          <div className="rounded-md border border-line bg-elev p-3">
            <p className="text-xs text-mute">API requests used</p>
            <p className="mt-1 text-2xl font-semibold">{c.apiRequestsUsed}</p>
            <p className="text-[11px] text-mute">limit {c.budget.maxFiles} files</p>
          </div>
          <div className="rounded-md border border-line bg-elev p-3">
            <p className="text-xs text-mute">Analyzed at</p>
            <p className="mt-1 text-sm font-medium">
              {new Date(analysis.analyzedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
            <p className="text-[11px] text-mute">
              commit {analysis.discovery.commitSha?.slice(0, 10) ?? "unknown"}
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        title="Coverage by analysis category"
        subtitle="complete = full data for this section · partial = some data missing · unavailable = no data retrieved."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-mute">
              <tr>
                <th className="pb-2 pr-3 font-medium">Category</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 pr-3 font-medium">Inspected</th>
                <th className="pb-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {c.categories.map((cat) => (
                <tr key={cat.category}>
                  <td className="py-2 pr-3 font-mono text-xs">{cat.category}</td>
                  <td className="py-2 pr-3">
                    <StatusChip status={cat.status} />
                  </td>
                  <td className="py-2 pr-3 text-xs">{cat.inspected}</td>
                  <td className="py-2 text-xs text-mute">{cat.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Files inspected" subtitle={`${c.filesInspected.length} file(s) retrieved and analyzed.`}>
          {c.filesInspected.length ? (
            <ul className="max-h-72 space-y-1 overflow-y-auto font-mono text-xs">
              {c.filesInspected.map((p) => (
                <li key={p} className="truncate text-mute">
                  <span className="text-ok">✓</span> {p}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No files were retrieved for analysis.</Empty>
          )}
        </Panel>

        <Panel
          title="Files skipped"
          subtitle="A skipped file was never analyzed — it is not 'clean', it is 'not inspected'."
        >
          {c.filesSkipped.length ? (
            <ul className="max-h-72 space-y-1 overflow-y-auto font-mono text-xs">
              {c.filesSkipped.slice(0, 200).map((s) => (
                <li key={`${s.path}:${s.reason}`} className="truncate">
                  <Chip tone={s.reason === "too-large" ? "warn" : "default"}>{s.reason}</Chip>{" "}
                  <span className="text-mute">{s.path}</span>
                </li>
              ))}
              {c.filesSkipped.length > 200 && (
                <li className="text-mute">…and {c.filesSkipped.length - 200} more</li>
              )}
            </ul>
          ) : (
            <Empty>Nothing was skipped — every discovered file was retrieved.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="Budget limits applied to this run">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-mute">Max files</dt>
            <dd className="font-mono">{c.budget.maxFiles}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Max file bytes</dt>
            <dd className="font-mono">{(c.budget.maxFileBytes / 1024).toFixed(0)} KB</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Max total chars</dt>
            <dd className="font-mono">{(c.budget.maxTotalChars / 1000).toFixed(0)}K</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Max tree entries</dt>
            <dd className="font-mono">{c.budget.maxTreeEntries.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Max depth</dt>
            <dd className="font-mono">{c.budget.maxDepth}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-mute">
          Budgets bound how much of a repository one run can inspect. Exceeding a budget yields a partial
          report, never a silently truncated one.
        </p>
      </Panel>

      <Panel title="Methodology & confidence definitions">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-mute">
          <li>
            <strong className="text-ink">verified</strong> — established directly from retrieved source or
            reliable metadata.
          </li>
          <li>
            <strong className="text-ink">heuristic</strong> — inferred from patterns; strong signal but not
            proven without execution.
          </li>
          <li>
            <strong className="text-ink">unavailable</strong> — required data could not be retrieved; the
            section reports what is missing rather than guessing.
          </li>
          <li>Diplens never executes repository code. All analysis is static.</li>
          <li>Repository content is treated as untrusted data and never followed as instructions.</li>
        </ul>
      </Panel>
    </div>
  );
}
