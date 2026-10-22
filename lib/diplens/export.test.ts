import { describe, expect, it, vi } from "vitest";
import evalFixture from "@/lib/diplens/fixtures/evalreport_v1.json";
import { downloadText, runsToCSV, runsToJSON, runsToMarkdown } from "@/lib/diplens/export";
import type { EvalReport } from "@/lib/diplens/schemas";

function run(id: string, mutate?: (r: EvalReport) => void): EvalReport {
  const copy: EvalReport = JSON.parse(JSON.stringify(evalFixture));
  copy.run.id = id;
  mutate?.(copy);
  return copy;
}

function csvRows(text: string): string[][] {
  // Minimal RFC 4180 splitter for assertions (quoted cells handled).
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe("runsToJSON", () => {
  it("exports a single run verbatim (round-trip)", () => {
    const text = runsToJSON([run("abc123")]);
    const parsed = JSON.parse(text) as EvalReport;
    expect(parsed.run.id).toBe("abc123");
    expect(parsed.schema).toBe("dipai-evalreport");
    expect(parsed.metrics.validation?.val_loss).toBeCloseTo(6.40106482366665, 9);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("wraps multiple runs with a comparison envelope", () => {
    const text = runsToJSON([run("a"), run("b")]);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.schema).toBe("dipai-eval-compare");
    expect(Array.isArray(parsed.runs)).toBe(true);
    expect((parsed.runs as unknown[]).length).toBe(2);
    const comparability = parsed.comparability as { level: string; findings: unknown[] };
    expect(comparability.level).toBe("comparable");
    expect(comparability.findings).toEqual([]);
  });

  it("includes blocking findings in the envelope when runs differ", () => {
    const text = runsToJSON([
      run("a"),
      run("b", (r) => {
        r.settings.batch_size = 8;
      }),
    ]);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const comparability = parsed.comparability as { level: string; findings: Array<{ code: string }> };
    expect(comparability.level).toBe("block");
    expect(comparability.findings.map((f) => f.code)).toContain("batch_diff");
  });
});

describe("runsToCSV", () => {
  it("emits a header and one row per run", () => {
    const rows = csvRows(runsToCSV([run("a"), run("b")]));
    expect(rows).toHaveLength(3);
    expect(rows[0][0]).toBe("run_id");
    expect(rows[0]).toContain("val_loss");
    expect(rows[0]).toContain("perplexity");
    expect(rows[1]?.[0]).toBe("a");
    expect(rows[2]?.[0]).toBe("b");
  });

  it("exports nulls as empty cells, never 0", () => {
    const rows = csvRows(runsToCSV([run("a")]));
    const header = rows[0];
    const values = rows[1];
    const evalItersIdx = header.indexOf("eval_iters");
    const seedIdx = header.indexOf("seed");
    expect(evalItersIdx).toBeGreaterThan(-1);
    expect(values[evalItersIdx]).toBe("");
    expect(values[seedIdx]).toBe("");
  });

  it("quotes cells containing commas", () => {
    const csv = runsToCSV([
      run("a", (r) => {
        r.checkpoint.file = "step 1, final.pt";
      }),
    ]);
    expect(csv).toContain('"step 1, final.pt"');
    const rows = csvRows(csv);
    const fileIdx = rows[0].indexOf("checkpoint_file");
    expect(rows[1][fileIdx]).toBe("step 1, final.pt");
  });

  it("joins warning codes with semicolons", () => {
    const csv = runsToCSV([
      run("a", (r) => {
        r.warnings = [
          { code: "cpu_only_run", message: "m1", detail: null },
          { code: "oom_partial", message: "m2", detail: { stage: "validation" } },
        ];
      }),
    ]);
    expect(csv).toContain("cpu_only_run;oom_partial");
  });
});

describe("runsToMarkdown", () => {
  it("renders single-run report with units and calculation notes", () => {
    const md = runsToMarkdown([run("a")]);
    expect(md).toContain("# DIPAI evaluation report");
    expect(md).toContain("Validation loss");
    expect(md).toContain("nats");
    expect(md).toContain("Calculation notes");
    expect(md).toContain("perplexity = exp(validation loss)");
    expect(md).toContain("`a`");
  });

  it("renders null metrics as unavailable, never 0", () => {
    const md = runsToMarkdown([
      run("a", (r) => {
        r.settings.eval_iters = null;
        if (r.metrics.validation) r.metrics.validation.val_loss = null;
      }),
    ]);
    expect(md).toContain("unavailable");
    expect(md).not.toContain("| Validation loss | nats | 0 |");
  });

  it("renders a comparability section for multiple runs", () => {
    const md = runsToMarkdown([
      run("a"),
      run("b", (r) => {
        r.settings.batch_size = 8;
      }),
    ]);
    expect(md).toContain("# DIPAI evaluation comparison");
    expect(md).toContain("## Comparability");
    expect(md).toContain("**block**");
    expect(md).toContain("batch_diff");
  });

  it("lists warning and error details", () => {
    const md = runsToMarkdown([
      run("a", (r) => {
        r.errors = [{ stage: "validation", message: "boom" }];
      }),
    ]);
    expect(md).toContain("## Warnings and errors");
    expect(md).toContain("`a` error `validation`: boom");
  });
});

describe("downloadText", () => {
  it("creates a blob URL, clicks a temporary anchor, and revokes the URL", () => {
    const createObjectURL = vi.fn(() => "blob:diplens-test");
    const revokeObjectURL = vi.fn();
    const originalCreate = (URL as unknown as Record<string, unknown>).createObjectURL;
    const originalRevoke = (URL as unknown as Record<string, unknown>).revokeObjectURL;
    (URL as unknown as Record<string, unknown>).createObjectURL = createObjectURL;
    (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      const ok = downloadText("runs.json", "{}", "application/json");
      expect(ok).toBe(true);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:diplens-test");
      expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    } finally {
      clickSpy.mockRestore();
      (URL as unknown as Record<string, unknown>).createObjectURL = originalCreate;
      (URL as unknown as Record<string, unknown>).revokeObjectURL = originalRevoke;
    }
  });

  it("returns false when blob URL creation is unavailable (jsdom default)", () => {
    const ok = downloadText("runs.csv", "a,b", "text/csv");
    expect(ok).toBe(false);
  });
});
