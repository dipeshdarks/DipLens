import { ArrowRight } from "lucide-react";
import type { DeepAnalysis } from "@/types/analysis";
import { Chip, Empty, Panel } from "@/components/ui";

export default function ArchitectureSection({ analysis }: { analysis: DeepAnalysis }) {
  const a = analysis.architecture;
  const status = analysis.sectionStatus.architecture;

  return (
    <div className="space-y-4">
      {status.note && <p className="text-xs text-warn">{status.note}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Application shape">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-mute">Type (inferred)</dt>
              <dd className="pt-0.5">
                {a.appType} <span className="text-xs text-mute">· {a.appTypeConfidence} confidence</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-mute">Frameworks</dt>
              <dd className="flex flex-wrap gap-1.5 pt-1">
                {a.frameworks.length ? a.frameworks.map((f) => <Chip key={f} tone="info">{f}</Chip>) : <span className="text-mute">None detected in retrieved manifests.</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-mute">Languages (GitHub stats)</dt>
              <dd className="flex flex-wrap gap-1.5 pt-1">
                {a.languages.length ? a.languages.slice(0, 6).map((l) => <Chip key={l}>{l}</Chip>) : <span className="text-mute">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-mute">External integrations (from dependencies)</dt>
              <dd className="flex flex-wrap gap-1.5 pt-1">
                {a.integrations.length ? a.integrations.map((i) => <Chip key={i}>{i}</Chip>) : <span className="text-mute">None detected.</span>}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Entry points" subtitle="Based on manifest fields and conventional filenames present in the tree.">
          {a.entryPoints.length ? (
            <ul className="space-y-2 text-sm">
              {a.entryPoints.map((e) => (
                <li key={e.path + e.basis}>
                  <p className="font-mono text-xs text-info">{e.path}</p>
                  <p className="text-xs text-mute">{e.basis}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No conventional entry-point files were identified in the inspected tree.</Empty>
          )}
        </Panel>
      </div>

      <Panel
        title="Module map"
        subtitle={`Import graph extracted from ${analysis.quality.inspectedFiles} retrieved source file(s). External package imports are excluded; only relative imports between repository files produce edges.`}
      >
        {a.edges.length ? (
          <>
            <p className="mb-3 text-xs text-mute">
              {a.nodes.length} nodes · {a.edges.length} edges (top 40 shown)
            </p>
            <ul className="space-y-1.5 font-mono text-xs">
              {a.edges.slice(0, 40).map((e) => (
                <li key={`${e.from}→${e.to}`} className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-ink" title={e.from}>{e.from}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-mute" aria-hidden />
                  <span className="truncate text-info" title={e.to}>{e.to}</span>
                  <span className="text-mute">×{e.count}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Empty>
            No import edges could be resolved among the retrieved files. Either no source files were
            retrieved within the budget, or the project has no relative imports between inspected files.
          </Empty>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Layers" subtitle="Directory-based grouping (heuristic).">
          {a.layers.length ? (
            <ul className="space-y-3">
              {a.layers.map((layer) => (
                <li key={layer.name}>
                  <p className="text-sm font-medium">{layer.name}</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {layer.paths.slice(0, 8).map((p) => (
                      <li key={p}>
                        <Chip>{p}</Chip>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Layer classification needs a fuller tree than was available.</Empty>
          )}
        </Panel>

        <Panel title="Data flow" subtitle="Inferred from app type — not traced through executed requests.">
          <ul className="list-disc space-y-2 pl-5 text-sm text-mute">
            {a.dataFlows.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Uncertainties" subtitle="Every architectural conclusion that is not fully verified.">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-mute">
          {a.uncertainties.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
