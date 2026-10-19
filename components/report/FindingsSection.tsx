"use client";

import { useMemo, useState } from "react";
import type { Confidence, Finding, FindingCategory, Severity } from "@/types/analysis";
import type { DeepAnalysis } from "@/types/analysis";
import { Chip, Empty, Panel } from "@/components/ui";
import { ConfidenceBadge, SeverityBadge, StatusBadge } from "@/components/report/StatusBits";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];
const CATEGORIES: FindingCategory[] = [
  "architecture",
  "dependencies",
  "code-quality",
  "security",
  "testing",
  "documentation",
  "governance",
  "activity",
];

function FindingCard({ f }: { f: Finding }) {
  return (
    <li className="border-t border-line pt-3 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={f.severity} />
        <p className="text-sm font-medium">{f.title}</p>
        <Chip>{f.category}</Chip>
        <StatusBadge status={f.status} />
      </div>
      <p className="mt-1 text-xs text-mute">{f.summary}</p>
      <ConfidenceBadge confidence={f.confidence} />
      {f.recommendation && (
        <p className="mt-1.5 text-xs text-info">Fix: {f.recommendation}</p>
      )}
      {f.evidence.length > 0 && (
        <ul className="mt-2 space-y-1">
          {f.evidence.map((e, i) => (
            <li key={`${f.id}-ev-${i}`} className="font-mono text-[11px] text-mute">
              {e.path && (
                <>
                  <span className="text-ink">{e.path}</span>
                  {e.startLine && (
                    <span>
                      :{e.startLine}
                      {e.endLine && e.endLine !== e.startLine ? `–${e.endLine}` : ""}
                    </span>
                  )}
                  {e.sourceUrl && (
                    <>
                      {" · "}
                      <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="text-info hover:underline">
                        view source
                      </a>
                    </>
                  )}
                </>
              )}
              {e.excerpt && <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap text-mute">{e.excerpt}</pre>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function FindingsSection({ analysis }: { analysis: DeepAnalysis }) {
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [confidence, setConfidence] = useState<Confidence | "all">("all");
  const [category, setCategory] = useState<FindingCategory | "all">("all");

  const filtered = useMemo(
    () =>
      analysis.findings.filter(
        (f) =>
          (severity === "all" || f.severity === severity) &&
          (confidence === "all" || f.confidence === confidence) &&
          (category === "all" || f.category === category),
      ),
    [analysis.findings, severity, confidence, category],
  );

  const counts = useMemo(() => {
    const bySeverity: Record<string, number> = {};
    for (const f of analysis.findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    return bySeverity;
  }, [analysis.findings]);

  return (
    <div className="space-y-4">
      <Panel
        title="Findings"
        subtitle={`${analysis.findings.length} finding(s) ranked by severity, then confidence. Every finding cites its evidence — filter to narrow the investigation.`}
      >
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-mute">Severity</span>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity | "all")}
              className="rounded-md border border-line bg-elev px-2 py-1 text-ink"
              data-testid="filter-severity"
            >
              <option value="all">all</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s} ({counts[s] ?? 0})
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-mute">Confidence</span>
            <select
              value={confidence}
              onChange={(e) => setConfidence(e.target.value as Confidence | "all")}
              className="rounded-md border border-line bg-elev px-2 py-1 text-ink"
              data-testid="filter-confidence"
            >
              <option value="all">all</option>
              {CONFIDENCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-mute">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as FindingCategory | "all")}
              className="rounded-md border border-line bg-elev px-2 py-1 text-ink"
              data-testid="filter-category"
            >
              <option value="all">all</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <span className="text-mute" data-testid="findings-count">
            {filtered.length} shown
          </span>
        </div>
      </Panel>

      <Panel title="Evidence-backed findings">
        {filtered.length ? (
          <ul className="space-y-3">
            {filtered.map((f) => (
              <FindingCard key={f.id} f={f} />
            ))}
          </ul>
        ) : (
          <Empty>No findings match the current filters. Clear a filter to see the rest.</Empty>
        )}
      </Panel>

      <Panel title="How to read these findings" subtitle="Severity and confidence are independent axes.">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-mute">
          <li>
            <strong className="text-ink">Severity</strong> — potential consequence if the condition is real.
          </li>
          <li>
            <strong className="text-ink">Confidence</strong> — how strongly the retrieved evidence supports the
            claim. A severe issue can be low-confidence.
          </li>
          <li>
            <strong className="text-ink">Status</strong> — <code className="text-ok">verified</code> means the
            evidence directly establishes the claim; <code className="text-warn">heuristic</code> means a
            pattern-based inference; <code className="text-mute">unavailable</code> means data was missing.
          </li>
          <li>Findings are limited to files retrieved within the analysis budget — absence of a finding is not proof of absence.</li>
        </ul>
      </Panel>
    </div>
  );
}
