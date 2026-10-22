import type { EvalReport } from "./schemas";

/**
 * Comparability analysis for the Evaluation Lab (docs/EVALUATION-BENCHMARK-DESIGN.md §5).
 *
 * Pure and deterministic: level "block" means the runs must not be compared
 * side by side; "warn" means numbers are valid but conditions differ;
 * "comparable" means no findings. A single run is always comparable.
 *
 * Codes (locked): block = protocol_mismatch, dataset_mismatch,
 * tokenizer_mismatch, mode_diff, batch_diff, sample_setup_mismatch,
 * block_size_diff, generation_setup_mismatch; warn = device_diff, dtype_diff,
 * torch_version_diff, generation_partial, not_reproducible.
 */

export type ComparisonLevel = "block" | "warn";

export type ComparisonFinding = {
  level: ComparisonLevel;
  code: string;
  message: string;
};

export type ComparisonResult = {
  runs: EvalReport[];
  findings: ComparisonFinding[];
  level: "comparable" | "warn" | "block";
  comparable: boolean;
};

type Check = {
  level: ComparisonLevel;
  code: string;
  values: Array<string | number | boolean | null>;
  label: string;
  unit?: string;
};

function fmt(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "not recorded";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return value;
}

function distinct(values: Array<string | number | boolean | null>): boolean {
  return new Set(values.map((v) => (v === null ? "__null__" : String(v)))).size > 1;
}

function datasetSha(r: EvalReport): string | null {
  const ds = r.dataset as Record<string, unknown> | undefined;
  const sha = ds?.sha256;
  return typeof sha === "string" && sha.length > 0 ? sha : null;
}

function tokenizerSha(r: EvalReport): string | null {
  return r.tokenizer.sha256;
}

function tokenizerVocab(r: EvalReport): number | null {
  return r.tokenizer.vocab_size;
}

function valBlockSize(r: EvalReport): number | null {
  return r.metrics.validation?.block_size ?? null;
}

function generationBlock(r: EvalReport): Record<string, unknown> | null {
  const gen = r.settings.generation;
  return gen === null || gen === undefined ? null : (gen as Record<string, unknown>);
}

function generationIdentity(gen: Record<string, unknown>): string | null {
  const sha = typeof gen.prompt_set_sha256 === "string" && gen.prompt_set_sha256 ? gen.prompt_set_sha256 : null;
  const preview = typeof gen.prompt_preview === "string" && gen.prompt_preview ? gen.prompt_preview : null;
  return sha ?? preview ?? null;
}

function samplingSignature(gen: Record<string, unknown>): string {
  const keys = ["temperature", "top_k", "top_p", "repetition_penalty", "max_new_tokens"] as const;
  const parts = keys.map((k) => `${k}=${String(gen[k])}`);
  return parts.join(" ");
}

function toChecks(runs: EvalReport[]): Check[] {
  const checks: Check[] = [];

  checks.push({
    level: "block",
    code: "protocol_mismatch",
    values: runs.map((r) => r.protocol),
    label: "report protocol",
  });
  checks.push({
    level: "block",
    code: "dataset_mismatch",
    values: runs.map(datasetSha),
    label: "validation data (val.bin sha256)",
  });

  // Tokenizer identity: prefer file hashes; when no run fingerprinted one,
  // fall back to vocab size (already equal only if the same tokenizer class).
  const shas = runs.map(tokenizerSha);
  if (shas.every((s) => s === null)) {
    checks.push({
      level: "block",
      code: "tokenizer_mismatch",
      values: runs.map(tokenizerVocab),
      label: "tokenizer vocab size",
    });
  } else {
    checks.push({
      level: "block",
      code: "tokenizer_mismatch",
      values: shas,
      label: "tokenizer (sha256)",
    });
  }

  checks.push({
    level: "block",
    code: "mode_diff",
    values: runs.map((r) => r.settings.mode),
    label: "evaluation mode",
  });
  checks.push({
    level: "block",
    code: "batch_diff",
    values: runs.map((r) => r.settings.batch_size),
    label: "batch size",
  });
  checks.push({
    level: "block",
    code: "block_size_diff",
    values: runs.map(valBlockSize),
    label: "model block size",
  });

  if (runs.some((r) => r.settings.mode === "sampled")) {
    checks.push({
      level: "block",
      code: "sample_setup_mismatch",
      values: runs.map((r) => `${r.settings.mode} iters=${r.settings.eval_iters ?? "?"} seed=${r.settings.seed ?? "?"}`),
      label: "sampled-mode setup (eval_iters, seed)",
    });
  }

  const gens = runs.map(generationBlock);
  const present = gens.filter((g): g is Record<string, unknown> => g !== null);
  if (present.length > 0 && present.length < runs.length) {
    checks.push({
      level: "warn",
      code: "generation_partial",
      values: runs.map((r) => (generationBlock(r) !== null ? "generation benchmarked" : "no generation benchmark")),
      label: "generation benchmark coverage",
    });
  }
  if (present.length > 1) {
    checks.push({
      level: "block",
      code: "generation_setup_mismatch",
      values: present.map(generationIdentity),
      label: "generation prompt set",
    });
    checks.push({
      level: "block",
      code: "generation_setup_mismatch",
      values: present.map(samplingSignature),
      label: "generation sampling parameters",
    });
  }

  checks.push({
    level: "warn",
    code: "device_diff",
    values: runs.map((r) => r.environment.device_resolved),
    label: "device",
  });
  checks.push({
    level: "warn",
    code: "dtype_diff",
    values: runs.map((r) => r.environment.dtype_resolved),
    label: "dtype",
  });
  checks.push({
    level: "warn",
    code: "torch_version_diff",
    values: runs.map((r) => r.environment.torch_version),
    label: "torch version",
  });
  checks.push({
    level: "warn",
    code: "not_reproducible",
    values: runs.map((r) => (r.reproducible ? "reproducible" : "inputs not fingerprinted")),
    label: "input fingerprinting",
  });

  return checks;
}

/**
 * Compare N imported eval reports (N >= 1). Pure: no mutation of inputs.
 */
export function compareRuns(runs: EvalReport[]): ComparisonResult {
  if (runs.length <= 1) {
    return { runs, findings: [], level: "comparable", comparable: true };
  }

  const findings: ComparisonFinding[] = [];
  const seen = new Set<string>();
  const hasNull = (values: Check["values"]) => values.some((v) => v === null);

  for (const check of toChecks(runs)) {
    if (!distinct(check.values)) continue;
    const key = `${check.level}:${check.code}:${check.label}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let message: string;
    if (check.code === "dataset_mismatch" && hasNull(check.values)) {
      message = `validation data not fingerprinted in every run (${check.label})`;
    } else if (check.code === "tokenizer_mismatch" && hasNull(check.values)) {
      message = `tokenizer not fingerprinted in every run (${check.label}: ${check.values.map(fmt).join(" vs ")})`;
    } else {
      const listed = [...new Set(check.values.map(fmt))].join(" vs ");
      message = `${check.label} differs across runs: ${listed}`;
    }
    findings.push({ level: check.level, code: check.code, message });
  }

  const level: ComparisonResult["level"] = findings.some((f) => f.level === "block")
    ? "block"
    : findings.length > 0
      ? "warn"
      : "comparable";

  return { runs, findings, level, comparable: level !== "block" };
}
