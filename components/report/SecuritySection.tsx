import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { DeepAnalysis } from "@/types/analysis";
import { Chip, Empty, Panel } from "@/components/ui";
import { SeverityBadge } from "@/components/report/StatusBits";

export default function SecuritySection({ analysis }: { analysis: DeepAnalysis }) {
  const s = analysis.security;
  const status = analysis.sectionStatus.security;
  const securityFindings = analysis.findings.filter((f) => f.category === "security" || f.category === "governance");

  return (
    <div className="space-y-4">
      {status.note && <p className="text-xs text-warn">{status.note}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel flex items-center gap-3">
          <div className="rounded-md bg-elev p-2.5 text-info">
            {s.codeScanning.status === "available" ? (
              <ShieldCheck className="h-5 w-5" />
            ) : s.codeScanning.status === "unknown" ? (
              <ShieldQuestion className="h-5 w-5" />
            ) : (
              <ShieldAlert className="h-5 w-5" />
            )}
          </div>
          <div>
            <p className="text-sm text-mute">GitHub code scanning</p>
            <p className="text-sm font-medium capitalize">{s.codeScanning.status.replace("-", " ")}</p>
          </div>
        </div>
        <div className="panel">
          <p className="text-sm text-mute">Secret-like matches</p>
          <p className={`text-2xl font-semibold ${s.secrets.length ? "text-bad" : ""}`}>
            {s.secrets.length}
          </p>
          <p className="text-xs text-mute">{s.secrets.length ? "values redacted — see findings" : "none in inspected files"}</p>
        </div>
        <div className="panel">
          <p className="text-sm text-mute">Workflows audited</p>
          <p className="text-2xl font-semibold">{s.workflowAudit.length}</p>
          <p className="text-xs text-mute">
            {s.envExamplePresent ? ".env.example present" : "no .env example found"}
          </p>
        </div>
      </div>

      <Panel title="Code scanning status">
        <p className="text-sm text-mute">{s.codeScanning.note}</p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Policy files">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-mute">Security policy</dt>
              <dd className="truncate font-mono text-xs">
                {s.policyFiles.securityPolicy ?? <span className="text-warn">not found</span>}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-mute">Dependency updates</dt>
              <dd className="truncate font-mono text-xs">
                {s.policyFiles.dependabot ?? <span className="text-warn">not found</span>}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-mute">Code owners</dt>
              <dd className="truncate font-mono text-xs">
                {s.policyFiles.codeowners ?? <span className="text-warn">not found</span>}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-mute">
            A missing policy is an observation, not a vulnerability.
          </p>
        </Panel>

        <Panel title="Secret-like matches (redacted)" subtitle="Heuristic patterns only — the matched values are never stored or displayed.">
          {s.secrets.length ? (
            <ul className="max-h-64 space-y-2 overflow-y-auto font-mono text-xs">
              {s.secrets.slice(0, 30).map((m) => (
                <li key={`${m.path}:${m.line}:${m.kind}`} className="flex flex-wrap items-center gap-2">
                  <span className="text-bad">{m.kind}</span>
                  <span className="text-mute">
                    {m.path}:{m.line}
                  </span>
                  <span className="rounded border border-line px-1 text-mute">{m.redacted}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No secret-like strings matched in the files inspected during this analysis.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="CI workflow audit" subtitle="Static heuristics over retrieved workflow YAML.">
        {s.workflowAudit.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-mute">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Workflow</th>
                  <th className="pb-2 pr-3 font-medium">permissions:</th>
                  <th className="pb-2 pr-3 font-medium">Risky triggers</th>
                  <th className="pb-2 font-medium">Untrusted context use</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.workflowAudit.map((w) => (
                  <tr key={w.path}>
                    <td className="py-2 pr-3 font-mono text-xs">{w.path}</td>
                    <td className="py-2 pr-3 text-xs">
                      {w.permissiveWrite ? (
                        <span className="text-bad">write-all</span>
                      ) : w.hasPermissionsBlock ? (
                        <span className="text-ok">declared</span>
                      ) : (
                        <span className="text-mute">not declared</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {w.riskyTriggers.length ? (
                        <span className="flex flex-wrap gap-1">
                          {w.riskyTriggers.map((t) => (
                            <Chip key={t} tone="warn">
                              {t}
                            </Chip>
                          ))}
                        </span>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </td>
                    <td className="py-2 text-xs">{w.untrustedContextUse ? <span className="text-warn">yes</span> : <span className="text-mute">no</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No workflow files were retrieved, so nothing could be audited.</Empty>
        )}
      </Panel>

      {securityFindings.length > 0 && (
        <Panel title="Security & governance findings">
          <ul className="space-y-3">
            {securityFindings.map((f) => (
              <li key={f.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={f.severity} />
                  <p className="text-sm font-medium">{f.title}</p>
                </div>
                <p className="mt-1 text-xs text-mute">{f.summary}</p>
                {f.evidence[0]?.path && (
                  <p className="mt-1 font-mono text-[11px] text-mute">
                    {f.evidence[0].path}
                    {f.evidence[0].startLine ? `:${f.evidence[0].startLine}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Security analysis rules">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-mute">
          {s.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
