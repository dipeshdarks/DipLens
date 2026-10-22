import { compareRuns } from "./compare";
import type { EvalReport } from "./schemas";

/**
 * Deterministic exports for the Evaluation Lab (docs/EVALUATION-BENCHMARK-DESIGN.md §7).
 * Contract: nulls are exported as empty CSV cells / "unavailable" in Markdown,
 * never as 0; JSON exports a single run verbatim or a wrapped comparison;
 * no environment paths other than the artifact's own path_display fields.
 */

const CSV_COLUMNS = [
  "run_id",
  "created_at",
  "status",
  "reproducible",
  "checkpoint_file",
  "checkpoint_step",
  "num_params",
  "vocab_size",
  "block_size",
  "mode",
  "batch_size",
  "eval_iters",
  "seed",
  "device",
  "dtype",
  "torch_version",
  "val_loss",
  "perplexity",
  "token_count",
  "sequence_count",
  "median_tokens_per_second",
  "median_ttft_ms",
  "median_total_ms",
  "warning_codes",
  "error_stages",
] as const;

function datasetBlock(r: EvalReport): Record<string, unknown> {
  return (r.dataset ?? {}) as Record<string, unknown>;
}

function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "boolean" ? String(value) : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function md(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "unavailable";
  return typeof value === "string" ? value.replace(/\|/g, "\\|") : String(value);
}

function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Export one run verbatim, or a comparison envelope for several runs. */
export function runsToJSON(runs: EvalReport[]): string {
  if (runs.length === 1) {
    return `${JSON.stringify(runs[0], null, 2)}\n`;
  }
  const comparison = compareRuns(runs);
  return `${JSON.stringify(
    {
      schema: "dipai-eval-compare",
      schema_version: 1,
      exported_at: utcNowIso(),
      runs,
      comparability: { level: comparison.level, findings: comparison.findings },
    },
    null,
    2
  )}\n`;
}

/** RFC 4180 CSV: one row per run, empty cells for nulls. */
export function runsToCSV(runs: EvalReport[]): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];
  for (const r of runs) {
    const validation = r.metrics.validation;
    const summary = r.metrics.generation?.summary ?? null;
    const ds = datasetBlock(r);
    const row: Array<string | number | boolean | null> = [
      r.run.id,
      r.run.created_at,
      r.run.status,
      r.reproducible,
      r.checkpoint.file,
      r.checkpoint.step,
      r.checkpoint.num_params,
      r.tokenizer.vocab_size,
      validation?.block_size ?? (typeof ds.block_size === "number" ? ds.block_size : null),
      r.settings.mode,
      r.settings.batch_size,
      r.settings.eval_iters,
      r.settings.seed,
      r.environment.device_resolved,
      r.environment.dtype_resolved,
      r.environment.torch_version,
      validation?.val_loss ?? null,
      validation?.perplexity ?? null,
      validation?.token_count ?? null,
      validation?.sequence_count ?? null,
      summary?.median_tokens_per_second ?? null,
      summary?.median_ttft_ms ?? null,
      summary?.median_total_ms ?? null,
      r.warnings.map((w) => w.code).join(";"),
      r.errors.map((e) => e.stage).join(";"),
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Human-readable Markdown report with units and calculation notes. */
export function runsToMarkdown(runs: EvalReport[]): string {
  const out: string[] = [];
  const comparison = runs.length > 1 ? compareRuns(runs) : null;

  out.push(runs.length === 1 ? "# DIPAI evaluation report" : "# DIPAI evaluation comparison");
  out.push("");
  out.push(`- Exported at: ${utcNowIso()}`);
  out.push(`- Runs: ${runs.length}`);
  if (runs.length === 1) out.push(`- Run: \`${runs[0].run.id}\` (${runs[0].run.status})`);
  out.push("");

  out.push("## Checkpoints");
  out.push("");
  out.push("| Run | File | Step | Parameters | Vocab | Status |");
  out.push("| --- | --- | ---: | ---: | ---: | --- |");
  for (const r of runs) {
    out.push(
      `| \`${r.run.id}\` | ${md(r.checkpoint.file)} | ${md(r.checkpoint.step)} | ${md(
        r.checkpoint.num_params === null ? null : r.checkpoint.num_params.toLocaleString("en-US")
      )} | ${md(r.tokenizer.vocab_size)} | ${md(r.run.status)} |`
    );
  }
  out.push("");

  out.push("## Validation metrics");
  out.push("");
  out.push("| Metric | Unit | " + runs.map((r) => `\`${r.run.id}\``).join(" | ") + " |");
  out.push("| --- | --- | " + runs.map(() => "---").join(" | ") + " |");
  const metricRows: Array<[string, string, (r: EvalReport) => number | null | undefined]> = [
    ["Validation loss", "nats", (r) => r.metrics.validation?.val_loss],
    ["Perplexity", "exp(loss)", (r) => r.metrics.validation?.perplexity],
    ["Evaluated tokens", "tokens", (r) => r.metrics.validation?.token_count],
    ["Evaluated sequences", "sequences", (r) => r.metrics.validation?.sequence_count],
    ["Median generation speed", "tokens/s", (r) => r.metrics.generation?.summary?.median_tokens_per_second],
    ["Median time to first token", "ms", (r) => r.metrics.generation?.summary?.median_ttft_ms],
    ["Median total time", "ms", (r) => r.metrics.generation?.summary?.median_total_ms],
  ];
  for (const [label, unit, get] of metricRows) {
    out.push(`| ${label} | ${unit} | ` + runs.map((r) => md(get(r))).join(" | ") + " |");
  }
  out.push("");
  out.push(
    "Calculation notes: validation loss is mean cross-entropy over evaluated tokens (nats); perplexity = exp(validation loss); generation medians are per-iteration medians over the timed iterations (`gpu_sync=false` wall clock)."
  );
  out.push("");

  out.push("## Conditions");
  out.push("");
  out.push("| Condition | " + runs.map((r) => `\`${r.run.id}\``).join(" | ") + " |");
  out.push("| --- | " + runs.map(() => "---").join(" | ") + " |");
  const conditionRows: Array<[string, (r: EvalReport) => string | number | boolean | null | undefined]> = [
    ["Device", (r) => r.environment.device_resolved],
    ["Dtype", (r) => r.environment.dtype_resolved],
    ["Torch", (r) => r.environment.torch_version],
    ["Python", (r) => r.environment.python_version],
    ["Mode", (r) => r.settings.mode],
    ["Batch size", (r) => r.settings.batch_size],
    ["Eval iterations", (r) => r.settings.eval_iters],
    ["Seed", (r) => r.settings.seed],
    ["Inputs reproducible", (r) => (r.reproducible ? "yes" : "no")],
  ];
  for (const [label, get] of conditionRows) {
    out.push(`| ${label} | ` + runs.map((r) => md(get(r))).join(" | ") + " |");
  }
  out.push("");

  if (comparison) {
    out.push("## Comparability");
    out.push("");
    out.push(`- Level: **${comparison.level}**`);
    if (comparison.findings.length === 0) {
      out.push("- No mismatches detected across runs.");
    } else {
      for (const f of comparison.findings) {
        out.push(`- ${f.level === "block" ? "**block**" : "warn"} \`${f.code}\`: ${f.message}`);
      }
    }
    out.push("");
  }

  const warned = runs.filter((r) => r.warnings.length > 0 || r.errors.length > 0);
  if (warned.length > 0) {
    out.push("## Warnings and errors");
    out.push("");
    for (const r of warned) {
      for (const w of r.warnings) out.push(`- \`${r.run.id}\` warning \`${w.code}\`: ${w.message}`);
      for (const e of r.errors) out.push(`- \`${r.run.id}\` error \`${e.stage}\`: ${e.message}`);
    }
    out.push("");
  }

  return `${out.join("\n")}\n`;
}

/**
 * Trigger a browser download. No-op outside the browser (SSR/tests).
 * Returns whether a download was initiated (tests spy on this function).
 */
export function downloadText(filename: string, text: string, mime = "application/json"): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
