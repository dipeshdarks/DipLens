# Evaluation & Benchmark Design — Feature 1

Status: **approved for implementation.** Every DIPAI reference below was verified by reading the source at commit `9d4de6b`; line numbers are anchors into that commit.

## 1. Objective

Let developers answer: **did this checkpoint genuinely improve the model, or did the evaluation conditions change?** — with real measurements, preserved configuration, explicit comparability rules, and exportable provenance. Execution lives in DIPAI (local, has GPU/data); DIPLens renders, compares, warns, and exports. **DIPLens never runs inference.**

## 2. Supported scope (honest boundaries)

| In scope (v1) | Out of scope (declared, never faked) |
|---|---|
| Scratch checkpoints: `ckpt_*.pt` written by `dipai/checkpoints.py` (`format_version: 1`) | HF/PEFT adapters (`adapter_config.json`) — incompatible gate, explicit message |
| Validation loss + perplexity on packed `val.bin` (protocol below) | Training metrics (labelled separately in UI as training-time values) |
| Generation latency/throughput for `DipaiGPT` via `dipai/generate.py` | Batch > 1 generation (loop is batch-1; reported as batch_size 1, not invented) |
| CPU and CUDA devices, `float32`/`float16`/`bfloat16` as resolved by `dipai/hardware.resolve_dtype` | Multi-GPU, distributed eval |
| Comparison of ≥2 runs that share an equivalence class | Cross-protocol “comparison” of non-equivalent runs (blocked by warnings) |

## 3. Checkpoint selection & compatibility gate

CLI: `python -m dipai.evaluate --checkpoint <file-or-dir> …`

Selection (DIPAI side, reusing `dipai/checkpoints.py`):

- `--checkpoint` directory → `latest_checkpoint()` (pointer `latest.json`, scan fallback, `checkpoints.py:171`); `--checkpoint` file used directly; `--list-checkpoints <dir>` prints every `ckpt_*.pt` with its metadata for scripting.
- Per entry the report records: `file` name, `step`, `saved_at` (ISO UTC from payload `saved_at`), `num_params` (payload), `model_config` (payload), `sha256` (streamed, 1 MiB chunks), `bytes`, and `format_version`. Unknown/absent fields are `null`, displayed as “unavailable” — **never invented**.

Compatibility gate — checked **before** any weights are applied; first failure emits a `status:"failed"` report (or exits non-zero with `--no-emit-on-error`):

1. file exists, extension `.pt`;
2. `torch.load(..., weights_only=False)` succeeds (same trust model as `dipai/inference.py` — **DIPAI-produced checkpoints only**; the report records that policy);
3. payload is a dict containing `model`, `model_config`, `step`;
4. `ModelConfig(**model_config)` validates (`dipai/config.py:43`);
5. adapter signature detected (`adapter_config.json` sibling or payload keys) → **incompatible**: “HF/PEFT adapter — protocol v1 evaluates scratch checkpoints only”;
6. tokenizer resolvable in checkpoint dir (`tokenizer.model`, the `inference.py:221` order) else from `payload.config.train.tokenizer_path`; `tok.vocab_size == model_config.vocab_size` (parity with `inference.py:238`);
7. device/dtype resolvable via `probe_hardware()` / `resolve_dtype()`; CUDA required flags honored (`--device cuda` fails cleanly when unavailable);
8. optional `--require-fit` VRAM pre-check via `estimate_scratch_vram_bytes`/`fits_in_vram` (`dipai/hardware.py`) → refuses with actionable message instead of OOM-crashing.

Load failures and CUDA OOM during evaluation are caught (`dipai.utils.is_cuda_oom`, `oom_guard`) → `status:"failed"`, `errors:[{stage, message}]`, partial metrics preserved under `metrics_partial`.

## 4. Reproducible evaluation configuration (recorded in every report)

```
protocol: "dipai-eval/v1"          # metric semantics + aggregation rules
run: { id: uuid4-hex, created_at: ISO-8601-UTC, argv: [...], status: completed|failed|cancelled }
environment: probe_hardware().to_dict() + { python, torch, sentencepiece, platform, dtype_resolved, device_resolved }
checkpoint: { file, path_display, sha256, bytes, step, saved_at, num_params, format_version, model_config }
tokenizer:  { path?, sha256?, vocab_size, source: "checkpoint-dir"|"config-path"|"none", meta? }
dataset:    { data_dir, val_file, sha256?, tokens?, blocks?, block_size, split: "val",
              stats_sha256?, stats?: <dataset_stats.json fields> }        # nulls when file absent
settings:   { mode: "full"|"sampled", eval_iters?, seed?, batch_size, max_sequences?,
              generation: { prompt_set_sha256?, prompt_count, max_new_tokens, temperature, top_k, top_p,
                            repetition_penalty, warmup_iterations, timed_iterations, eos_id } }
software:   { dipai_git: { head, origin_main?, dirty }, schema: "dipai-evalreport", schema_version: 1 }
```

- **Run id + timestamp** are unique per invocation; `argv` preserved so settings can be replayed (paths containing user homes are shortened to the project-relative form in `path_display`; **no environment variables are ever exported**).
- **Dataset fingerprint:** sha256 of `val.bin` plus `dataset_stats.json` when present (the stats file carries `seed`, `val_fraction`, `vocab_size`, `block_size`, token counts — `dipai/dataset.py:58–84`).
- **Equivalence class** (computed by DIPLens, `lib/diplens/compare.ts`, same rule documented here): two runs are *comparable* iff equal `protocol`, `checkpoint.dataset.sha256`, `tokenizer.sha256` (or both null with equal vocab+dataset), `mode`, `batch_size`, `eval_iters`+`seed` (sampled mode), `block_size`, and generation `prompt_set_sha256` + sampling settings (generation benchmarks). Differing `device`/`dtype`/`torch_version` ⇒ **warn** (“numeric drift possible, conditions differ”), still comparable but flagged. Any `block` difference ⇒ UI refuses charting/controlled-comparison framing; table view remains available **with a permanent banner**.

## 5. Validation loss and perplexity

Both modes reuse the model's real objective: `DipaiGPT.forward` with shifted targets and `ignore_index=-100` (`model.py:199–206`), under `@torch.no_grad()` + `model.eval()`, autocast only when `device == "cuda" and dtype in (float16, bfloat16)` (parity with `train.py:106`). Tokenizer/dataset handling never re-encodes text: evaluation reads the same packed `val.bin` the trainer used.

### Mode `full` (default, recommended)

- Deterministic: iterate blocks in file order (`PackedDataset.get_block(i)`, `dataset.py:623`), no RNG, optional `--max-sequences N` cap (recorded; `null` = all blocks).
- Batches of `--batch-size` (default 8); for each batch `k` the model returns mean CE over its `B·T` token positions; aggregate **token-weighted**: `val_loss = Σ_k loss_k·n_k / Σ_k n_k` with `n_k = B·T` (last batch `B_last·T`). Because every position is a real target (packed data has no padding), this equals corpus-level mean CE exactly.
- Record: `val_loss`, `ppl`, `token_count = Σ n_k`, `sequence_count`, `block_size`.

### Mode `sampled` (trainer parity)

- Exact semantics of `train.estimate_loss` (`train.py:93–117`): `--eval-iters` random batches from `np.random.RandomState(seed)`; aggregation = unweighted mean of equal-size batch means; **all knobs recorded** (`eval_iters`, `seed`, `batch_size`).
- Use when matching training-time numbers; the mode itself is an equivalence key.

### Perplexity

- `ppl = exp(val_loss)` — valid because the loss is mean next-token CE in **nats** over a full-support softmax (grounded statement, not a convention guess).
- Safety: computed with `math.exp` guarded by `try/except OverflowError`; non-finite `val_loss` ⇒ `ppl = null` + warning `ppl_unavailable` (reason recorded). `val_loss` is **never** clamped, never replaced, never defaulted: a failed run shows `null` (“unavailable”), never `0`.
- Validation vs training metrics: reports carry `metrics.kind: "validation"`; any `train`-time values that exist (e.g. checkpoint `extra.best_val`) live under `metrics.training_reference` with `kind: "training"` and the UI labels them distinctly.

## 6. Generation latency & throughput

Method (per checkpoint, one report section `metrics.generation`):

1. **Load phase:** `time.perf_counter()` around tokenizer+model load (`DIPAIEngine.from_checkpoint` path) → `load_seconds` reported separately, excluded from all generation metrics.
2. **Warm-up:** `--warmup-iterations` (default 2) full generate calls, untimed (JIT/autotune/cudnn warm state); `warmup_iterations` recorded.
3. **Timed iterations:** `--timed-iterations` (default 5). Before/after each timed section and around the first-token boundary: `torch.cuda.synchronize()` when device is CUDA (recorded `gpu_sync: true/false`).
4. **Per iteration** (raw array kept, medians/p95 derived):
   - `prompt_tokens` (encode count), `generated_tokens` (actual, counted from the loop — never assumed from `max_new_tokens`; EOS may stop early),
   - `ttft_ms` — `t_first_token − t_start`, measured at the `stream_fn` callback for token 1 (`generate.py:157`),
   - `total_ms` — end − start (includes prompt processing + decode),
   - `tokens_per_second = generated_tokens / (total_ms/1000)` and `decode_tokens_per_second = generated_tokens / ((end − t_first)/1000)` — both null when `generated_tokens == 0` (no fabricated throughput),
   - prompt/output lengths, early-stop flag.
5. **Conditions:** defaults greedy `temperature=0` (deterministic token counts across runs; identical settings ⇒ identical workload), `--temperature/--top-k/--top-p/--rep-pen` overridable and recorded; `batch_size: 1` (what the loop actually does); prompt set = `--prompts-file` (utf-8, one per line; sha256 recorded; texts **not** copied into the report by default — counts and hash only) or `--prompt-text` (single, recorded truncated preview `preview_chars`).
6. **Environment block** includes device, resolved dtype, GPU name, VRAM total, torch version, `compile_enabled: false` (torch.compile is not used anywhere in DIPAI — stated as false, not guessed), `cudnn_benchmark`: read from torch at runtime.
7. **Equivalence:** latency comparisons require identical prompt-set sha + sampling settings + `max_new_tokens`; device/dtype differences produce `warn` findings and are printed next to the numbers (“conditions differ”).

## 7. Report artifact (`dipai-evalreport/1`)

- Atomic write (`.tmp` + `os.replace`, same discipline as `checkpoints.py`), pretty JSON, `schema`, `schema_version: 1`.
- `status`: `completed | failed | cancelled` (SIGINT → `cancelled` with partial metrics + note). Failures carry `errors: [{stage: compat|load|eval|generation|io, message}]`.
- `warnings[]`: machine codes (`ppl_overflow`, `tokenizer_meta_missing`, `dataset_stats_missing`, `cpu_only_run`, `oom_partial`, …) with human text — mirrored by the DIPLens comparability warnings.
- Exit codes: `0` completed, `1` failed, `2` cancelled, `3` usage/compat refusal (documented).
- **Never**: secrets, environment dumps, home paths beyond `path_display`, stack traces, or claims of reproducibility when `dataset.sha256` or `tokenizer.sha256` are null (report sets `reproducible: false` + reason in that case).

## 8. DIPLens Evaluation Lab (UI)

Route `app/evaluation` (client component; nav label **Evaluation Lab**):

1. **Import:** `ImportDropzone` (file input + drag/drop, 2 MB cap) → Zod `evalReportSchema` → history (`lib/diplens/history.ts`, localStorage key `diplens-eval-runs`, max 20 runs / 1.5 MB, quota-fail ⇒ in-memory fallback + notice). Invalid/unsupported versions get distinct error states (never silent drop).
2. **Checkpoint selector / run list:** rows keyed by run id: checkpoint file + step + short sha, status chip, `val_loss` / `ppl` (or “—”), device, timestamp. Checkbox selection (≥2) for comparison. This *is* the selector — checkpoints appear exactly as recorded in reports (no filesystem access, no invention).
3. **Run detail:** status & timestamps; checkpoint card (all metadata incl. sha256, compat notes); configuration summary (every §4 field; “unavailable” for nulls); metrics: validation `val_loss`, `ppl`, `token_count`, `sequence_count` with an expandable **“how this was calculated”** note (formula + protocol + mode + aggregation text derived from the report’s own fields); generation section: load_seconds, TTFT / total latency / tok·s⁻¹ medians + raw iteration table; training-reference values (if present) in a visually separate, labelled block; failures show `errors[]` verbatim.
4. **Comparison view:** columns = selected runs; rows = checkpoint, step, sha, dataset sha, tokenizer sha, protocol, mode, batch, iters/seed, device, dtype, `val_loss`, `ppl`, TTFT, tok·s⁻¹. Equivalence engine outputs: `comparable: true` → green banner + bar charts (recharts: `val_loss`, `ppl`, median TTFT, median tok/s across runs) fed **only** from saved report data; `warn` → amber banner listing conditions-differ findings + charts shown with the warning inline; `block` → red banner (“Not a controlled comparison — differing: …”), charts **disabled** with explanation, table stays readable with per-run provenance.
5. **Exports** (`lib/diplens/export.ts`, Blob download, client-side):
   - **JSON** — the selected run(s) verbatim (full config + provenance) or `{schema, exported_at, runs:[…], comparability}` for comparisons;
   - **CSV** — flat one-row-per-run metric/config table (RFC-4180 quoting; nulls = empty cell; includes sha256s, protocol, warnings flattened);
   - **Markdown** — GitHub-readable report: title, timestamp, environment, checkpoint table, metric table with units, calculation notes, comparability warnings, failed/unavailable fields explicitly marked “unavailable”.
6. **Safety:** no server endpoints; no code execution on import; no GPU triggers; no fake progress bars (the page never implies an evaluation is running — it states “import results produced by the DIPAI CLI”); concurrency N/A client-side; DIPAI CLI runs one model at a time (single process), documented.

## 9. Testing (Feature 1)

DIPAI (`tests/test_evaluate.py`, tiny fixtures, CPU, no GPU, no real training):

- token-weighted aggregation equals an independently computed reference CE over the same tiny `val.bin`;
- `full` mode determinism: two runs ⇒ identical `val_loss`/`token_count`;
- sampled mode: recorded seed ⇒ repeatable; seed change recorded as different settings;
- perplexity: `ppl == exp(val_loss)` on a fixture; overflow → `null` + warning (unit-test the guard directly with a synthetic huge loss);
- compat gate: missing file, corrupt file, non-DIPAI dict, adapter-shaped dir, vocab mismatch (crafted payload) → correct stage/message, `status:"failed"`;
- `cancelled` status path (simulated interrupt hook);
- `token_count` correctness for non-full final batch;
- generation metrics: `generated_tokens` counted ≠ `max_new_tokens` when EOS hits early; `tokens_per_second` null when 0 tokens; warmup excluded (assert timed array length); no `torch` CUDA assumption (runs on CPU with `gpu_sync:false`);
- hashing: known-bytes → known sha256; run ids unique.
- `tests/test_artifacts.py`: atomic write leaves no `.tmp`; schema constants; shared fixture validates against the schema.

DIPLens (`lib/diplens/*.test.ts` + `components/lab/*.test.tsx`):

- Zod accepts `dipai-evalreport/1` fixture; rejects version 99, rejects wrong schema string; tolerates unknown extra fields;
- comparability matrix: identical ⇒ comparable; dataset sha differs ⇒ block; device differs ⇒ warn; gen prompt sha differs ⇒ block (generation rows);
- exports: JSON round-trip preserves sha256/protocol/status; CSV has header + one row per run + quoting of commas/quotes; Markdown contains “unavailable” for null metrics and never renders `0` for them;
- history: persist/evict/cap/quota-failure fallback;
- components: import → list → select 2 → banner state (comparable/warn/block) → export button fires download; failed run renders errors; unsupported version renders dedicated message; keyboard-only selection works (checkbox roles);
- regression: existing 144 tests unchanged.

## 10. Implementation order (Feature 1)

1. `dipai/artifacts.py` (+ `tests/test_artifacts.py`)
2. metric/core functions in `dipai/evaluate.py` with pure tests first
3. CLI wiring + compat gate + statuses (+ tests)
4. generation benchmark (+ tests)
5. shared fixtures exported for DIPLens
6. `lib/diplens/schemas.ts` → `compare.ts` → `export.ts` → `history.ts` (+ tests)
7. UI components → page → nav
8. genuine demo: tiny corpus → 2 checkpoints → 2 reports → imported in the Lab
