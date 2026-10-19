import type {
  Confidence,
  Evidence,
  Finding,
  FindingCategory,
  FindingStatus,
  Severity,
} from "@/types/analysis";
import { redactSecrets } from "@/lib/analysis/redact";

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const EXCERPT_MAX = 240;

let counter = 0;

/** Stable-ish unique id: category + slugified title (+ dedupe counter). */
export function slugId(category: FindingCategory, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  counter += 1;
  return `${category}-${slug || "finding"}-${counter}`;
}

/** Reset the id counter (tests only). */
export function resetFindingIds(): void {
  counter = 0;
}

export type MakeFindingInput = {
  category: FindingCategory;
  severity: Severity;
  title: string;
  summary: string;
  evidence?: Evidence[];
  confidence: Confidence;
  status: FindingStatus;
  recommendation?: string;
};

/**
 * Build a Finding with validated evidence:
 * - line numbers must be positive integers and ordered (start <= end)
 * - excerpts are truncated and secret-redacted
 * - evidence without any locator is dropped (never fabricate references)
 */
export function makeFinding(input: MakeFindingInput): Finding {
  const evidence = (input.evidence ?? [])
    .map(normalizeEvidence)
    .filter((e): e is Evidence => e !== null);

  const f: Finding = {
    id: slugId(input.category, input.title),
    category: input.category,
    severity: input.severity,
    title: input.title,
    summary: redactSecrets(input.summary),
    evidence,
    confidence: input.confidence,
    status: input.status,
  };
  if (input.recommendation) f.recommendation = input.recommendation;
  return f;
}

export function normalizeEvidence(e: Evidence): Evidence | null {
  const hasPath = typeof e.path === "string" && e.path.length > 0;
  const hasExcerpt = typeof e.excerpt === "string" && e.excerpt.trim().length > 0;
  if (!hasPath && !hasExcerpt) return null;

  const out: Evidence = {};
  if (hasPath) out.path = e.path;
  if (typeof e.startLine === "number") {
    if (!Number.isInteger(e.startLine) || e.startLine < 1) return null;
    out.startLine = e.startLine;
  }
  if (typeof e.endLine === "number") {
    if (!Number.isInteger(e.endLine) || e.endLine < 1) return null;
    if (out.startLine && e.endLine < out.startLine) return null;
    out.endLine = e.endLine;
  }
  if (hasExcerpt) {
    const trimmed = redactSecrets(e.excerpt!.trim());
    out.excerpt = trimmed.length > EXCERPT_MAX ? `${trimmed.slice(0, EXCERPT_MAX)}…` : trimmed;
  }
  if (e.sourceUrl && /^https:\/\//.test(e.sourceUrl)) out.sourceUrl = e.sourceUrl;
  return out;
}

/** Evidence that cites a specific file+line must link back to the raw source on GitHub. */
export function githubBlobUrl(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  startLine?: number,
  endLine?: number,
): string {
  const base = `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  if (startLine) {
    return endLine && endLine !== startLine ? `${base}#L${startLine}-L${endLine}` : `${base}#L${startLine}`;
  }
  return base;
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.title.localeCompare(b.title),
  );
}

export const FINDING_CATEGORIES: FindingCategory[] = [
  "architecture",
  "dependencies",
  "code-quality",
  "security",
  "testing",
  "documentation",
  "governance",
  "activity",
];
