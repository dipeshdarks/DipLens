import type { DeepAnalysis } from "@/types/analysis";
import { Chip, Empty, Panel } from "@/components/ui";

export default function DependenciesSection({ analysis }: { analysis: DeepAnalysis }) {
  const d = analysis.dependencies;
  const status = analysis.sectionStatus.dependencies;

  return (
    <div className="space-y-4">
      {status.note && <p className="text-xs text-warn">{status.note}</p>}

      {d.sets.length === 0 ? (
        <Panel title="Dependency manifests">
          <Empty>
            No package manifest (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml…)
            was retrieved within the analysis budget.
          </Empty>
        </Panel>
      ) : (
        d.sets.map((set) => (
          <Panel
            key={set.manifestPath}
            title={`${set.ecosystem} — ${set.manifestPath}`}
            subtitle={
              <>
                {set.direct.length} direct dependenc{set.direct.length === 1 ? "y" : "ies"} ·{" "}
                {set.lockfilePath ? (
                  <span className="text-ok">lockfile {set.lockfilePath}</span>
                ) : (
                  <span className="text-warn">no lockfile found</span>
                )}
                {set.packageManager && <> · {set.packageManager}</>}
              </>
            }
          >
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(set.runtimes).map(([k, v]) => (
                <Chip key={k} tone="info">
                  {k} {v}
                </Chip>
              ))}
              {set.unconstrainedCount > 0 && (
                <Chip tone="warn">{set.unconstrainedCount} unpinned</Chip>
              )}
            </div>

            {set.direct.length ? (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-card text-xs text-mute">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Package</th>
                      <th className="pb-2 pr-3 font-medium">Constraint</th>
                      <th className="pb-2 font-medium">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {set.direct.map((dep) => (
                      <tr key={`${set.manifestPath}:${dep.name}:${dep.dev}`}>
                        <td className="py-1.5 pr-3 font-mono text-xs">{dep.name}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-mute">{dep.range || "(none)"}</td>
                        <td className="py-1.5 text-xs text-mute">{dep.dev ? "dev" : "runtime"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No direct dependencies declared in this manifest.</Empty>
            )}

            {Object.keys(set.scripts).length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-xs text-mute hover:text-ink">Scripts ({Object.keys(set.scripts).length})</summary>
                <ul className="mt-2 space-y-1 font-mono text-xs text-mute">
                  {Object.entries(set.scripts).map(([name, cmd]) => (
                    <li key={name}>
                      <span className="text-ink">{name}</span>: {cmd}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Panel>
        ))
      )}

      <Panel title="How to read this section">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-mute">
          {d.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
