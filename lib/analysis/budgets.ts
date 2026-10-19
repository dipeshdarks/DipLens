import type { AnalysisBudgetView } from "@/types/analysis";

export type AnalysisBudget = AnalysisBudgetView & {
  requestTimeoutMs: number;
  maxApiRequests: number;
  maxDirTraversals: number;
};

/** Hard limits for one deep-analysis run. Configurable per call (tests) but fixed in production. */
export const DEFAULT_BUDGET: AnalysisBudget = {
  maxFiles: 24,
  maxFileBytes: 196_608,
  maxTotalChars: 400_000,
  maxTreeEntries: 12_000,
  maxDepth: 8,
  requestTimeoutMs: 8_000,
  maxApiRequests: 40,
  maxDirTraversals: 6,
};

/**
 * Budget for the deep forensic engine. Source bytes come from raw.githubusercontent
 * (no API rate cost), so the limiting factors are wall clock and memory rather
 * than the 5000/hr authenticated API quota.
 */
export const DEEP_BUDGET: AnalysisBudget = {
  maxFiles: 250,
  maxFileBytes: 262_144,
  maxTotalChars: 4_000_000,
  maxTreeEntries: 30_000,
  maxDepth: 12,
  requestTimeoutMs: 12_000,
  maxApiRequests: 60,
  maxDirTraversals: 6,
};

export function budgetView(b: AnalysisBudget): AnalysisBudgetView {
  return {
    maxFiles: b.maxFiles,
    maxFileBytes: b.maxFileBytes,
    maxTotalChars: b.maxTotalChars,
    maxTreeEntries: b.maxTreeEntries,
    maxDepth: b.maxDepth,
  };
}
