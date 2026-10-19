import type { CoverageStatus, IndicatorStatus, Severity } from "@/types/analysis";

const STATUS_TONES: Record<string, string> = {
  complete: "border-ok/40 text-ok",
  good: "border-ok/40 text-ok",
  partial: "border-warn/50 text-warn",
  missing: "border-warn/50 text-warn",
  unavailable: "border-bad/50 text-bad",
  unknown: "border-line text-mute",
};

export function StatusChip({ status, label }: { status: CoverageStatus | IndicatorStatus; label?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_TONES[status] ?? STATUS_TONES.unknown}`}>
      {label ?? status}
    </span>
  );
}

const SEVERITY_TONES: Record<Severity, string> = {
  critical: "border-bad/60 bg-bad/10 text-bad",
  high: "border-bad/40 text-bad",
  medium: "border-warn/50 text-warn",
  low: "border-info/40 text-info",
  info: "border-line text-mute",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${SEVERITY_TONES[severity]}`}>
      {severity}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const tone =
    confidence === "high" ? "text-ok" : confidence === "medium" ? "text-info" : "text-mute";
  return <span className={`text-xs ${tone}`}>confidence: {confidence}</span>;
}

export function StatusBadge({ status }: { status: "verified" | "heuristic" | "unavailable" }) {
  const tone =
    status === "verified" ? "text-ok" : status === "heuristic" ? "text-warn" : "text-mute";
  return <span className={`text-xs ${tone}`}>{status}</span>;
}
