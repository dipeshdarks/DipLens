import { importEvalReport, type EvalReport, type ImportResult } from "./schemas";

/**
 * localStorage-backed history of imported eval reports
 * (docs/EVALUATION-BENCHMARK-DESIGN.md §6).
 *
 * - Key: diplens-eval-runs, newest first, max 20 runs / 1.5 MB serialized.
 * - Entries are re-validated with importEvalReport on load; corrupt entries drop.
 * - Dedupe by run.id (a re-import replaces the stored copy).
 * - Quota failures fall back to an in-memory session list with a notice —
 *   never a crash, never silent data loss without a user-visible notice.
 * - SSR-safe: server render sees an empty history.
 */

export const HISTORY_KEY = "diplens-eval-runs";
export const HISTORY_MAX_RUNS = 20;
export const HISTORY_MAX_BYTES = 1.5 * 1024 * 1024;

export type HistoryState = {
  runs: EvalReport[];
  notice?: string;
};

let memoryRuns: EvalReport[] | null = null;
let memoryNotice: string | null = null;

/** Test/session hook: reset the in-memory fallback (does not touch storage). */
export function resetHistoryMemory(): void {
  memoryRuns = null;
  memoryNotice = null;
}

function storageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readStored(): { runs: EvalReport[]; dropped: number } {
  // An active quota fallback is authoritative over stale localStorage contents.
  if (memoryRuns !== null) return { runs: memoryRuns, dropped: 0 };
  if (!storageAvailable()) return { runs: [], dropped: 0 };
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(HISTORY_KEY);
  } catch {
    return { runs: memoryRuns ?? [], dropped: 0 };
  }
  if (raw === null) return { runs: [], dropped: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { runs: [], dropped: 1 };
  }
  if (!Array.isArray(parsed)) return { runs: [], dropped: 1 };
  const runs: EvalReport[] = [];
  let dropped = 0;
  for (const entry of parsed) {
    const result: ImportResult<EvalReport> = importEvalReport(entry);
    if (result.ok) runs.push(result.data);
    else dropped += 1;
  }
  return { runs, dropped };
}

function writeStored(runs: EvalReport[]): { ok: boolean; bytes: number } {
  const bytes = new TextEncoder().encode(JSON.stringify(runs)).length;
  if (!storageAvailable()) {
    memoryRuns = runs;
    memoryNotice = "Browser storage is unavailable — runs are kept for this session only.";
    return { ok: false, bytes };
  }
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(runs));
    memoryRuns = null;
    memoryNotice = null;
    return { ok: true, bytes };
  } catch {
    // Quota exceeded (or storage disabled): keep the session list in memory.
    memoryRuns = runs;
    memoryNotice = "Browser storage is full or unavailable — runs are kept for this session only.";
    return { ok: false, bytes };
  }
}

function trim(runs: EvalReport[]): EvalReport[] {
  let out = runs.slice(0, HISTORY_MAX_RUNS);
  let serialized = JSON.stringify(out);
  while (out.length > 1 && new TextEncoder().encode(serialized).length > HISTORY_MAX_BYTES) {
    out = out.slice(0, out.length - 1);
    serialized = JSON.stringify(out);
  }
  return out;
}

function stateFrom(runs: EvalReport[], dropped: number): HistoryState {
  const noticeParts: string[] = [];
  if (dropped > 0) noticeParts.push(`${dropped} stored run(s) were unreadable and removed.`);
  if (memoryNotice) noticeParts.push(memoryNotice);
  return noticeParts.length > 0 ? { runs, notice: noticeParts.join(" ") } : { runs };
}

/** Current history (newest first). */
export function loadHistory(): HistoryState {
  if (typeof window === "undefined") return { runs: [] };
  const { runs, dropped } = readStored();
  return stateFrom(runs, dropped);
}

/** Add (or replace by run.id) a run; returns the new state. */
export function addRun(run: EvalReport): HistoryState {
  if (typeof window === "undefined") return { runs: [] };
  const { runs, dropped } = readStored();
  const next = [run, ...runs.filter((r) => r.run.id !== run.run.id)];
  const trimmed = trim(next);
  writeStored(trimmed);
  return stateFrom(trimmed, dropped);
}

/** Remove one run by id; returns the new state. */
export function removeRun(runId: string): HistoryState {
  if (typeof window === "undefined") return { runs: [] };
  const { runs, dropped } = readStored();
  const next = runs.filter((r) => r.run.id !== runId);
  writeStored(next);
  return stateFrom(next, dropped);
}

/** Clear all stored runs; returns the new (empty) state. */
export function clearHistory(): HistoryState {
  if (typeof window === "undefined") return { runs: [] };
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* storage unavailable — memory clear below is still meaningful */
  }
  memoryRuns = null;
  memoryNotice = null;
  return { runs: [] };
}
