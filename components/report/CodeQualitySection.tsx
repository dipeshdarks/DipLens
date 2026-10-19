import type { DeepAnalysis } from "@/types/analysis";
import { Chip, Empty, Panel, num } from "@/components/ui";

export default function CodeQualitySection({ analysis }: { analysis: DeepAnalysis }) {
  const q = analysis.quality;
  const status = analysis.sectionStatus.quality;

  return (
    <div className="space-y-4">
      {status.note && <p className="text-xs text-warn">{status.note}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel">
          <p className="text-sm text-mute">Files inspected</p>
          <p className="text-2xl font-semibold">{num(q.inspectedFiles)}</p>
        </div>
        <div className="panel">
          <p className="text-sm text-mute">Largest inspected file</p>
          <p className="truncate text-2xl font-semibold">
            {q.largestFiles[0] ? `${(q.largestFiles[0].size / 1024).toFixed(0)} KB` : "—"}
          </p>
          {q.largestFiles[0] && <p className="truncate font-mono text-xs text-mute">{q.largestFiles[0].path}</p>}
        </div>
        <div className="panel">
          <p className="text-sm text-mute">TODO/FIXME markers</p>
          <p className="text-2xl font-semibold">
            {num(q.todoCounts.reduce((a, b) => a + b.todos, 0) || 0)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Tooling configuration" subtitle="Presence of committed configuration — not proof it is enforced.">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-mute">Linter</dt>
              <dd className="flex items-center gap-2 text-right font-mono text-xs">
                {q.lintConfig ?? <span className="text-warn">none detected</span>}
                {q.lintConfig && <Chip tone="info">found</Chip>}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-mute">Formatter</dt>
              <dd className="font-mono text-xs">{q.formatConfig ?? <span className="text-warn">none detected</span>}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-mute">Type checking</dt>
              <dd className="font-mono text-xs">{q.typeCheckConfig ?? <span className="text-warn">none detected</span>}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-mute">Strict TypeScript</dt>
              <dd className="text-xs">
                {q.strictTyping === null ? (
                  <span className="text-mute">unknown (no tsconfig retrieved)</span>
                ) : q.strictTyping ? (
                  <span className="text-ok">enabled</span>
                ) : (
                  <span className="text-warn">disabled</span>
                )}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Largest inspected files" subtitle="Only among files retrieved within the budget.">
          {q.largestFiles.length ? (
            <ul className="space-y-2 font-mono text-xs">
              {q.largestFiles.map((f) => (
                <li key={f.path} className="flex items-center justify-between gap-3">
                  <span className="truncate">{f.path}</span>
                  <span className="shrink-0 text-mute">{(f.size / 1024).toFixed(1)} KB</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No files were retrieved.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="TODO / FIXME hotspots">
        {q.todoCounts.length ? (
          <ul className="space-y-2 font-mono text-xs">
            {q.todoCounts.map((t) => (
              <li key={t.path} className="flex items-center justify-between gap-3">
                <span className="truncate">{t.path}</span>
                <span className="shrink-0 text-mute">
                  {t.todos} marker{t.todos === 1 ? "" : "s"} · first at line {t.line}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No TODO/FIXME markers in the inspected files.</Empty>
        )}
      </Panel>

      <Panel title="Methodology notes">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-mute">
          {q.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
