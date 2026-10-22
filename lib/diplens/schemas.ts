import { z } from "zod";

/**
 * Zod mirrors of the DIPAI JSON artifacts (dipai-archmeta/1, dipai-evalreport/1).
 *
 * Contract rules (see docs/DIPLENS-INTEGRATION-PLAN.md):
 * - Every object is `.passthrough()`: unknown fields validate and survive, so
 *   DIPAI can add fields without breaking DipLens imports.
 * - `lib/diplens/fixtures/` + `lib/generated/architecture.json` are validated by
 *   both suites (vitest here, pytest in the DIPAI checkout).
 * - No network, no secrets: these schemas only gate local file imports (2 MB cap).
 */

/** Shared file-import cap for both artifact kinds. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export const ARCHMETA_SCHEMA = "dipai-archmeta";
export const ARCHMETA_SCHEMA_VERSION = 1;
export const EVALREPORT_SCHEMA = "dipai-evalreport";
export const EVALREPORT_SCHEMA_VERSION = 1;
export const EVALREPORT_PROTOCOL = "dipai-eval/v1";

const warningSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    detail: z.unknown().nullable(),
  })
  .passthrough();

const tensorShapeSchema = z.array(z.number());

// ---------------------------------------------------------------------------
// dipai-archmeta/1
// ---------------------------------------------------------------------------

export const archSourceRefSchema = z
  .object({
    kind: z.enum(["config", "checkpoint", "test"]),
    path_display: z.string(),
    sha256: z.string(),
    checkpoint_step: z.number().nullable().optional(),
    config_path_display: z.string().nullable().optional(),
  })
  .passthrough();

export const archComponentSourceSchema = z
  .object({
    file: z.string(),
    symbol: z.string(),
    lines: z.tuple([z.number(), z.number()]),
    url: z.string(),
    verified: z.boolean(),
    note: z.string().nullable(),
  })
  .passthrough();

export const archComponentSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["io", "embedding", "op", "block", "norm", "attention", "mlp", "head"]),
    label: z.string(),
    purpose: z.string(),
    params: z.number().nullable(),
    count_scope: z.string().optional(),
    parent: z.string().optional(),
    children: z.array(z.string()).optional(),
    config: z.record(z.unknown()),
    source: archComponentSourceSchema,
    config_note: z.string().nullable().optional(),
  })
  .passthrough();

export const archParamsSchema = z
  .object({
    total: z.number(),
    nonembed: z.number().nullable(),
    trainable: z.number(),
    frozen: z.number(),
    components: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          count: z.number(),
          pct: z.number(),
        })
        .passthrough()
    ),
    tie_note: z.string().nullable().optional(),
  })
  .passthrough();

export const archShapeNodeSchema = z
  .object({
    input: tensorShapeSchema.optional(),
    output: tensorShapeSchema.optional(),
    params: z.record(tensorShapeSchema).optional(),
    note: z.string().optional(),
  })
  .passthrough();

export const archShapesSchema = z
  .object({
    batch: z.number(),
    seq: z.number(),
    note: z.string(),
    nodes: z.record(archShapeNodeSchema),
  })
  .passthrough();

export const archModelSchema = z
  .object({
    class: z.string(),
    model_config: z.record(z.unknown()),
    head_dim: z.number(),
    positional_encoding: z.string(),
    normalization: z.string(),
    activation: z.string(),
    attention: z.string(),
    max_context: z.number(),
    vocab_source: z.string(),
  })
  .passthrough();

export const archFlowEdgeSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    label: z.string(),
  })
  .passthrough();

export const archMetaSchema = z
  .object({
    schema: z.literal(ARCHMETA_SCHEMA),
    schema_version: z.literal(ARCHMETA_SCHEMA_VERSION),
    generated_at: z.string(),
    generator: z
      .object({
        dipai_git: z
          .object({
            head: z.string(),
            origin_main: z.string(),
            dirty: z.string(),
          })
          .passthrough(),
        anchors_verified: z.boolean(),
      })
      .passthrough(),
    source: archSourceRefSchema,
    model: archModelSchema,
    params: archParamsSchema,
    shapes: archShapesSchema,
    components: z.array(archComponentSchema),
    flow: z.array(archFlowEdgeSchema),
    block_flow: z.array(archFlowEdgeSchema).optional(),
    warnings: z.array(warningSchema),
  })
  .passthrough();

export type ArchMeta = z.infer<typeof archMetaSchema>;
export type ArchComponent = z.infer<typeof archComponentSchema>;
export type ArchFlowEdge = z.infer<typeof archFlowEdgeSchema>;

// ---------------------------------------------------------------------------
// dipai-evalreport/1
// ---------------------------------------------------------------------------

export const evalReportSchema = z
  .object({
    schema: z.literal(EVALREPORT_SCHEMA),
    schema_version: z.literal(EVALREPORT_SCHEMA_VERSION),
    protocol: z.string(),
    run: z
      .object({
        id: z.string(),
        created_at: z.string(),
        argv: z.array(z.string()),
        status: z.enum(["completed", "failed", "cancelled"]),
        note: z.string().optional(),
      })
      .passthrough(),
    environment: z
      .object({
        cuda_available: z.boolean(),
        cuda_version: z.string().nullable(),
        device_name: z.string().nullable(),
        vram_total_gb: z.number().nullable(),
        vram_free_gb: z.number().nullable(),
        compute_capability: z.string().nullable(),
        ram_total_gb: z.number(),
        ram_available_gb: z.number(),
        cpu_count: z.number(),
        platform: z.string(),
        python_version: z.string(),
        torch_version: z.string(),
        bitsandbytes_available: z.boolean().nullable(),
        bitsandbytes_version: z.string().nullable(),
        warnings: z.array(z.string()),
        python: z.string(),
        torch: z.string(),
        sentencepiece: z.string(),
        device_resolved: z.string(),
        dtype_resolved: z.string(),
        compile_enabled: z.boolean(),
        cudnn_benchmark: z.boolean(),
      })
      .passthrough(),
    checkpoint: z
      .object({
        file: z.string().nullable(),
        path_display: z.string().nullable(),
        sha256: z.string().nullable(),
        bytes: z.number().nullable(),
        step: z.number().nullable(),
        saved_at: z.string().nullable(),
        num_params: z.number().nullable(),
        format_version: z.number().nullable(),
        model_config: z.record(z.unknown()).nullable(),
      })
      .passthrough(),
    tokenizer: z
      .object({
        path: z.string().nullable(),
        sha256: z.string().nullable(),
        vocab_size: z.number().nullable(),
        source: z.enum(["checkpoint-dir", "config-path", "none"]),
        meta: z.record(z.unknown()).nullable(),
      })
      .passthrough(),
    // An early-failure report carries {} here; a gated report carries the block.
    dataset: z.union([
      z
        .object({
          data_dir: z.string(),
          val_file: z.string(),
          sha256: z.string().nullable(),
          tokens: z.number().nullable(),
          blocks: z.number().nullable(),
          block_size: z.number(),
          split: z.string(),
          stats_sha256: z.string().nullable(),
          stats: z.record(z.unknown()).nullable(),
        })
        .passthrough(),
      z.object({}),
    ]),
    settings: z
      .object({
        mode: z.enum(["full", "sampled"]),
        eval_iters: z.number().nullable(),
        seed: z.number().nullable(),
        batch_size: z.number(),
        max_sequences: z.number().nullable(),
        generation: z
          .object({
            prompt_set_sha256: z.string().nullable(),
            prompt_preview: z.string().nullable(),
            prompt_count: z.number(),
            max_new_tokens: z.number(),
            temperature: z.number(),
            top_k: z.number(),
            top_p: z.number(),
            repetition_penalty: z.number(),
            warmup_iterations: z.number(),
            timed_iterations: z.number(),
            eos_id: z.number().nullable(),
          })
          .passthrough()
          .nullable(),
      })
      .passthrough(),
    metrics: z
      .object({
        kind: z.string(),
        load_seconds: z.number().nullable().optional(),
        validation: z
          .object({
            val_loss: z.number().nullable(),
            perplexity: z.number().nullable(),
            token_count: z.number(),
            sequence_count: z.number(),
            block_size: z.number(),
            mode: z.string(),
            aggregation: z.string(),
          })
          .passthrough()
          .optional(),
        generation: z
          .object({
            batch_size: z.number(),
            gpu_sync: z.boolean(),
            warmup_iterations: z.number(),
            timed_iterations: z.number(),
            iterations: z.array(
              z
                .object({
                  index: z.number(),
                  prompt_tokens: z.number(),
                  generated_tokens: z.number(),
                  ttft_ms: z.number().nullable(),
                  total_ms: z.number(),
                  tokens_per_second: z.number().nullable(),
                  decode_tokens_per_second: z.number().nullable(),
                  early_stop: z.boolean(),
                })
                .passthrough()
            ),
            summary: z
              .object({
                timed_iterations: z.number(),
                median_ttft_ms: z.number().nullable(),
                p95_ttft_ms: z.number().nullable(),
                median_total_ms: z.number().nullable(),
                p95_total_ms: z.number().nullable(),
                median_tokens_per_second: z.number().nullable(),
              })
              .passthrough(),
          })
          .passthrough()
          .optional(),
        training_reference: z
          .object({
            kind: z.literal("training"),
            best_val: z.number(),
            step: z.number().nullable(),
            source: z.string(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    metrics_partial: z.record(z.unknown()).optional(),
    reproducible: z.boolean(),
    reproducible_reasons: z.array(z.string()),
    warnings: z.array(warningSchema),
    errors: z.array(
      z
        .object({
          stage: z.string(),
          message: z.string(),
        })
        .passthrough()
    ),
  })
  .passthrough();

export type EvalReport = z.infer<typeof evalReportSchema>;
export type EvalWarning = z.infer<typeof warningSchema>;

// ---------------------------------------------------------------------------
// Import helpers — kind-aware failure states for the UI
// ---------------------------------------------------------------------------

export type ImportFailure = {
  ok: false;
  kind: "invalid" | "unsupported";
  message: string;
};

export type ImportResult<T> = { ok: true; data: T } | ImportFailure;

function formatIssue(issue: z.ZodIssue): string {
  const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${where}: ${issue.message}`;
}

function importArtifact<T>(
  raw: unknown,
  expectedSchema: string,
  expectedVersion: number,
  schema: z.ZodType<T>
): ImportResult<T> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, kind: "invalid", message: "file is not a JSON object" };
  }
  const rec = raw as Record<string, unknown>;
  if (rec.schema !== expectedSchema) {
    return {
      ok: false,
      kind: "invalid",
      message: `not a DIPAI ${expectedSchema} artifact (schema: ${JSON.stringify(rec.schema ?? null)})`,
    };
  }
  if (rec.schema_version !== expectedVersion) {
    return {
      ok: false,
      kind: "unsupported",
      message: `${expectedSchema} version ${String(rec.schema_version ?? null)} is not supported (expected version ${expectedVersion})`,
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      kind: "invalid",
      message: `malformed ${expectedSchema} artifact — ${first ? formatIssue(first) : "validation failed"}`,
    };
  }
  return { ok: true, data: parsed.data };
}

/** Import a dipai-archmeta/1 file (raw JSON.parse output). */
export function importArchMeta(raw: unknown): ImportResult<ArchMeta> {
  return importArtifact(raw, ARCHMETA_SCHEMA, ARCHMETA_SCHEMA_VERSION, archMetaSchema);
}

/** Import a dipai-evalreport/1 file (raw JSON.parse output). */
export function importEvalReport(raw: unknown): ImportResult<EvalReport> {
  return importArtifact(raw, EVALREPORT_SCHEMA, EVALREPORT_SCHEMA_VERSION, evalReportSchema);
}

/** JSON.parse + import, with a friendly message for broken JSON text. */
export function importJsonText<T>(
  text: string,
  importer: (raw: unknown) => ImportResult<T>
): ImportResult<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      kind: "invalid",
      message: `file is not valid JSON (${err instanceof Error ? err.message : "parse error"})`,
    };
  }
  return importer(raw);
}
