import { FlaskConical } from "lucide-react";
import type { DeepAnalysis } from "@/types/analysis";
import { Chip, Empty, Panel, num } from "@/components/ui";
import { StatusChip } from "@/components/report/StatusBits";

export default function TestsCiSection({ analysis }: { analysis: DeepAnalysis }) {
  const t = analysis.testsCi;
  const status = analysis.sectionStatus.testing;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-info/30 bg-info/5 px-4 py-3 text-sm text-mute">
        <FlaskConical className="mb-1 h-4 w-4 text-info" aria-hidden />
        Diplens performs <span className="text-ink">static inspection only</span>. No repository code is
        executed here, so this report never claims that tests pass, that coverage was measured, or that a
        build succeeded — only what files and configuration were observed.
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel">
          <p className="text-sm text-mute">Test files detected</p>
          <p className="text-2xl font-semibold">{num(t.testFileCount)}</p>
          {t.testFileSampleLimited && <p className="text-xs text-warn">list truncated for display</p>}
        </div>
        <div className="panel">
          <p className="text-sm text-mute">CI workflows (retrieved)</p>
          <p className="text-2xl font-semibold">{t.workflows.length}</p>
        </div>
        <div className="panel">
          <p className="text-sm text-mute">Build verified by execution</p>
          <p className="text-2xl font-semibold text-mute">No</p>
          <p className="text-xs text-mute">by design — static analysis only</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Test configuration">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-mute">Runner config</dt>
              <dd className="truncate font-mono text-xs">{t.runnerConfig ?? <span className="text-warn">none detected</span>}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-mute">Coverage config</dt>
              <dd className="truncate font-mono text-xs">{t.coverageConfig ?? <span className="text-warn">none detected</span>}</dd>
            </div>
          </dl>
          {t.testScripts.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs text-mute">Package scripts that look like tests</p>
              <ul className="space-y-1 font-mono text-xs">
                {t.testScripts.map((s) => (
                  <li key={s.name}>
                    <span className="text-ink">{s.name}</span>
                    <span className="text-mute">: {s.command}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Workflow test steps" subtitle="Commands inside run: steps that matched test-tooling patterns.">
          {t.workflows.length ? (
            <ul className="space-y-3">
              {t.workflows.map((w) => (
                <li key={w.path} className="border-t border-line pt-3 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs">{w.path}</p>
                    {w.triggers.map((trg) => (
                      <Chip key={trg}>{trg}</Chip>
                    ))}
                  </div>
                  {w.testSteps.length ? (
                    <ul className="mt-1.5 space-y-1 font-mono text-xs text-mute">
                      {w.testSteps.map((s) => (
                        <li key={s}>$ {s}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-xs text-mute">No test-like run steps detected in this file.</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>
              {status.note ?? "No workflow files were retrieved within the analysis budget."}
            </Empty>
          )}
        </Panel>
      </div>

      <Panel title="Test files" subtitle="Paths matching common test naming conventions in the repository tree.">
        {t.testFiles.length ? (
          <ul className="max-h-72 overflow-y-auto font-mono text-xs">
            {t.testFiles.slice(0, 60).map((p) => (
              <li key={p} className="truncate py-0.5 text-mute">{p}</li>
            ))}
          </ul>
        ) : (
          <Empty>No files matching test naming conventions were found in the inspected tree.</Empty>
        )}
      </Panel>

      <Panel title="Notes">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-mute">
          {t.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
