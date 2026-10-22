import { beforeEach, describe, expect, it, vi } from "vitest";
import evalFixture from "@/lib/diplens/fixtures/evalreport_v1.json";
import {
  HISTORY_KEY,
  HISTORY_MAX_BYTES,
  HISTORY_MAX_RUNS,
  addRun,
  clearHistory,
  loadHistory,
  removeRun,
  resetHistoryMemory,
} from "@/lib/diplens/history";
import type { EvalReport } from "@/lib/diplens/schemas";

function run(id: string, mutate?: (r: EvalReport) => void): EvalReport {
  const copy: EvalReport = JSON.parse(JSON.stringify(evalFixture));
  copy.run.id = id;
  mutate?.(copy);
  return copy;
}

beforeEach(() => {
  window.localStorage.clear();
  resetHistoryMemory();
  vi.restoreAllMocks();
});

describe("history — add and load", () => {
  it("persists a run and loads it back", () => {
    addRun(run("alpha"));
    const state = loadHistory();
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]?.run.id).toBe("alpha");
    expect(state.notice).toBeUndefined();
  });

  it("keeps runs newest first", () => {
    addRun(run("first"));
    addRun(run("second"));
    expect(loadHistory().runs.map((r) => r.run.id)).toEqual(["second", "first"]);
  });

  it("replaces an existing run with the same id instead of duplicating", () => {
    addRun(run("dup"));
    addRun(
      run("dup", (r) => {
        r.settings.batch_size = 99;
      })
    );
    const state = loadHistory();
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]?.settings.batch_size).toBe(99);
  });

  it("round-trips through the eval-report schema on load", () => {
    addRun(run("roundtrip"));
    const raw = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown[];
    expect(raw).toHaveLength(1);
    expect(loadHistory().runs[0]?.schema).toBe("dipai-evalreport");
  });
});

describe("history — limits", () => {
  it("evicts the oldest runs beyond HISTORY_MAX_RUNS", () => {
    for (let i = 1; i <= HISTORY_MAX_RUNS + 1; i += 1) addRun(run(`run-${i}`));
    const state = loadHistory();
    expect(state.runs).toHaveLength(HISTORY_MAX_RUNS);
    expect(state.runs[0]?.run.id).toBe(`run-${HISTORY_MAX_RUNS + 1}`);
    expect(state.runs.map((r) => r.run.id)).not.toContain("run-1");
  });

  it("trims oldest runs when the serialized payload exceeds HISTORY_MAX_BYTES", () => {
    const heavy = (id: string) =>
      run(id, (r) => {
        (r as unknown as Record<string, unknown>).padding = "x".repeat(400_000);
      });
    addRun(heavy("h1"));
    addRun(heavy("h2"));
    addRun(heavy("h3"));
    addRun(heavy("h4"));
    const state = loadHistory();
    const bytes = new TextEncoder().encode(JSON.stringify(state.runs)).length;
    expect(state.runs.length).toBeLessThan(4);
    expect(state.runs[0]?.run.id).toBe("h4");
    if (state.runs.length > 1) expect(bytes).toBeLessThanOrEqual(HISTORY_MAX_BYTES);
  });

  it("keeps at least the newest run even if it alone exceeds the byte budget", () => {
    const huge = run("huge", (r) => {
      (r as unknown as Record<string, unknown>).padding = "y".repeat(HISTORY_MAX_BYTES + 1000);
    });
    addRun(huge);
    const state = loadHistory();
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]?.run.id).toBe("huge");
  });
});

describe("history — corrupt storage", () => {
  it("reports unreadable raw JSON and returns empty", () => {
    window.localStorage.setItem(HISTORY_KEY, "{broken");
    const state = loadHistory();
    expect(state.runs).toEqual([]);
    expect(state.notice).toContain("unreadable");
  });

  it("drops invalid entries but keeps valid ones, with a notice", () => {
    const valid = JSON.parse(JSON.stringify(run("valid")));
    const invalid = { schema: "dipai-evalreport", schema_version: 99 };
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify([valid, invalid]));
    const state = loadHistory();
    expect(state.runs.map((r) => r.run.id)).toEqual(["valid"]);
    expect(state.notice).toContain("1 stored run(s)");
  });
});

describe("history — quota fallback", () => {
  it("keeps runs in memory with a session-only notice when setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const added = addRun(run("fallback"));
    expect(added.runs).toHaveLength(1);
    expect(added.notice).toContain("session only");
    // loadHistory must still see the run (memory is authoritative now).
    const state = loadHistory();
    expect(state.runs.map((r) => r.run.id)).toEqual(["fallback"]);
    expect(state.notice).toContain("session only");
  });

  it("recovers storage usage after the block clears", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    addRun(run("temp"));
    spy.mockRestore();
    const recovered = addRun(run("fresh"));
    expect(recovered.notice).toBeUndefined();
    expect(recovered.runs.map((r) => r.run.id)).toEqual(["fresh", "temp"]);
  });
});

describe("history — remove and clear", () => {
  it("removes a single run by id", () => {
    addRun(run("keep"));
    addRun(run("drop"));
    const state = removeRun("drop");
    expect(state.runs.map((r) => r.run.id)).toEqual(["keep"]);
    expect(loadHistory().runs).toHaveLength(1);
  });

  it("clears everything", () => {
    addRun(run("a"));
    addRun(run("b"));
    const state = clearHistory();
    expect(state.runs).toEqual([]);
    expect(loadHistory().runs).toEqual([]);
  });

  it("clearing also resets an active memory fallback", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    addRun(run("stuck"));
    expect(loadHistory().runs).toHaveLength(1);
    clearHistory();
    expect(loadHistory().runs).toEqual([]);
  });
});
