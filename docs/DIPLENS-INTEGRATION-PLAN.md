# DIPLens Integration Plan — Evaluation & Benchmark Lab + Model Architecture Explorer

Status: **approved for implementation** (planning phase complete; all file paths, symbols, and line references below were verified by reading the two repositories at the stated commits).

## 1. Repositories inspected

| Repository | Local clone | Inspected commit | Contents |
|---|---|---|---|
| `dipeshdarks/DipLens` (this repo) | `github/DipLens` | `6ab2fa7` (branch `main`, clean) | Next.js 14 App Router, TypeScript strict, Tailwind, Recharts, Zod, Vitest. GitHub analytics report + in-app MDX docs. Deployed at https://diplensrepo.vercel.app |
| `dipeshdarks/DipAi` (DIPAI) | `github/ui` | `9d4de6b` (branch `main`, clean) | Python 3.10+ PyTorch toolkit: from-scratch decoder-only Transformer (`dipai/model.py`), SentencePiece tokenizer, packed `.bin` datasets, atomic checkpointing, LoRA/QLoRA fine-tune, CLI chat, Gradio web UI, pytest suite (15 files) |

Environment measured on the development machine: Windows 11, Python 3.10.1, Node 22.14, npm 11.7, NVIDIA RTX 2050 (4096 MiB, driver 581.80), `nvidia-smi` reachable.

## 2. Verified facts that constrain the design

### DIPAI (the model side)

- **Model:** `dipai/model.py:120` `class DipaiGPT(nn.Module)` — learned absolute token embeddings (`tok_emb`, line 128) **and** learned position embeddings (`pos_emb`, line 129, size `block_size × n_embd`), `n_layer` pre-LN `Block`s (line 100: `ln1 → attn → residual`, `ln2 → mlp → residual`), final `ln_f` (line 132), `lm_head` (line 133) with optional weight tying to `tok_emb` (lines 135–136). Attention is fused-QKV SDPA (`CausalSelfAttention`, line 38). MLP is 4× GELU (line 87).
- **Loss:** `dipai/model.py:199–206` — `F.cross_entropy(logits.view(-1, V), targets.view(-1), ignore_index=-100)`; **the caller supplies already-shifted targets** (`PackedDataset.sample_batch` at `dipai/dataset.py:632–662` returns `x = window[:-1]`, `y = window[1:]`). Plain next-token CE in nats ⇒ `perplexity = exp(validation loss)` is a valid interpretation.
- **Existing eval protocol:** `dipai/train.py:93–117` `estimate_loss()` — `@torch.no_grad()`, `model.eval()`, `eval_iters` **random** batches drawn with a seeded `np.random.RandomState(seed)`, mean of per-batch means. Training metrics come from the same loop (`train.py:452`); checkpoint `extra.history` records `val_loss` history.
- **Checkpoints:** `dipai/checkpoints.py` — `ckpt_%08d.pt` files, atomic `.tmp` + `os.replace`, `latest.json` pointer, payload `{format_version:1, step, saved_at, model, model_config, num_params, config, optimizer?, scaler?, extra?}` (`save_checkpoint`, line 43). Self-describing dirs also carry `config.yaml` and a copied `tokenizer.model` (+ optional `.model.meta.json` sidecar written by `DipaiTokenizer.save_meta`, `dipai/tokenizer.py:243`). Loading: `load_checkpoint` (line 188, `weights_only=False` because payloads contain plain dicts), rebuild via `ModelConfig(**payload["model_config"])` — same path `dipai/inference.py:196–244` uses, including the tokenizer-vocab ↔ model-vocab hard check (line 238).
- **HF/PEFT adapters** (`from_adapter`, `inference.py:265`) are a second checkpoint family (`adapter_config.json`). They are **not** expressible as `DipaiGPT` state dicts → the evaluation protocol v1 targets **scratch checkpoints only** and must declare adapters incompatible rather than fake a number.
- **Generation:** `dipai/generate.py:103–163` `generate()` — token loop with `stream_fn(token_id)` callback per token (exact first-token timestamp available), `GenerationSettings` (temperature/top_k/top_p/max_new_tokens/repetition_penalty, `validate()` at line 42). Batch size 1 in practice (repetition penalty indexes `logits[0]`).
- **Hardware probe:** `dipai/hardware.py` `probe_hardware()` → `HardwareInfo.to_dict()` (CUDA, GPU name, VRAM, RAM, torch version, platform) — reusable verbatim for report provenance.
- **Parameter counting precedent:** `scripts/estimate_model.py:46–65` `component_breakdown()` over `model.named_parameters()` (ties de-duplicated by PyTorch) + exact `model.num_params` on the `meta` device. The explorer must follow this real-tensor approach, not `param_budget_estimate()` (closed form, `dipai/config.py:61`).
- **Configs:** YAML → typed dataclasses (`dipai/config.py`), strict unknown-key rejection (`_build`, line 385). Scratch configs present: `configs/scratch.yaml`, `configs/smoke_4m.yaml`, `configs/dipai_50m.yaml`. `load_scratch_config` (line 433).
- **Tests:** `tests/conftest.py` provides session `tiny_tokenizer` (SP vocab≈400), `tiny_model_cfg` (L2/H2/E32/block32), `tiny_model` — CPU-only. Baseline run in `.venv` (torch 2.14.1+cpu + extras): **120 passed, 2 failed, 2 skipped** — both failures are `tests/test_hardware.py` expecting `hw.device_name is not None` / `fits_in_vram` behavior that requires CUDA torch; a CUDA-enabled torch install is in progress to make the suite match the project's target environment.

### DIPLens (the web side)

- **Design system:** tokens in `app/globals.css` (`--c-base … --c-bad`, dark-first + `.light`), utility classes `.panel`, `.btn`; shared components `components/ui.tsx` (`Panel`, `MetricCard`, `Chip`, `Empty`, `num()`/`date()`); Lucide icons; Recharts already a dependency (`package.json`) for charts.
- **Navigation:** root `app/layout.tsx` header (logo, version chip, `Features / How it works / Docs`, `HeaderActions`, GitHub link). New features get header links; the docs sidebar/nav come from `lib/docs/registry.ts` + `lib/docs/pages.json`.
- **Source-link helper:** `lib/docs/registry.ts` `GITHUB.blob(path)` → `https://github.com/dipeshdarks/DipAi/blob/main/<path>` (correct target repo for `dipai/*` sources, branch `main`).
- **Patterns to reuse:** Zod validation (`lib/validation.ts`), pure unit-tested logic modules (`lib/health.ts`), component tests with `@testing-library/react` + `userEvent` and `next/navigation` mocks (`components/RepoSearch.test.tsx`), docs search index generated at `predev`/`prebuild` (no runtime `fs`, Vercel-safe), `num()` renders `—` for null (**never fake zeros**).
- **Checks baseline:** `npm test` → **16 files / 144 tests passed** (exit 0). `npm run lint`, `npm run typecheck`, `npm run build` are the other gates.
- **No GPU on Vercel:** serverless functions have no GPU, ~10–60 s limits and ≤1 GB memory — they cannot run PyTorch evaluation. `GITHUB_TOKEN` is the only env var today; `.env.example`.

## 3. Integration boundary (decision)

**Chosen: option 2 from the master prompt — versioned artifacts generated inside DIPAI, imported into DIPLens.**

```
 DIPAI (local, has data + checkpoints + torch)          DIPLens (Vercel / browser)
┌──────────────────────────────────────┐               ┌─────────────────────────────────────┐
│ python -m dipai.archmeta             │               │ app/architecture  (client page)     │
│   → architecture JSON                │  commit/import│   lib/generated/architecture.json   │
│     schema dipai-archmeta/1          │──────────────▶│   + optional file import (Zod v1)   │
│                                      │               │                                     │
│ python -m dipai.evaluate             │  file import  │ app/evaluation    (client page)      │
│   → evaluation report JSON           │──────────────▶│   Zod validate → history            │
│     schema dipai-evalreport/1        │               │   compare + warnings + exports      │
└──────────────────────────────────────┘               └─────────────────────────────────────┘
   owns: checkpoints, data, torch, GPU                     owns: rendering, comparison, export
   never: web serving of GPU work                           never: model execution, fake metrics
```

Rejected alternatives and why:

1. *Reuse an existing API* — neither repo has one for models (DipAI's Gradio UI is a local process; DIPLens' only route is the GitHub proxy `app/api/file/route.ts`). Nothing to reuse.
2. *(chosen)* *Generated artifacts* — works offline, zero serverless cost, no new infra, testable on both sides, safe (pure data, no code execution on import).
3. *Authenticated evaluation service* — no hosting exists for a GPU worker; would violate “do not depend on a permanently running GPU server” and “no unauthenticated public endpoint”; maintenance burden unjustified.
4. *Offline workflow only* — this **is** the offline workflow (option 2), plus a UX: the DIPLens Lab imports what the DIPAI CLI produced.

**Schemas** live in two validated mirrors: Python (writers, hand-rolled checks — no new runtime deps) and Zod (readers, `lib/diplens/schemas.ts`). Version field `schema` + integer `schema_version`; readers reject unknown major values with a dedicated UI state and ignore unknown fields (forward compatible). Shared JSON fixtures under `tests/fixtures/` (DIPAI) and `lib/diplens/fixtures/` (DIPLens) are validated by **both** suites to keep the mirrors honest.

## 4. Files to be added / modified

### DIPAI (new files only; **no existing DIPAI file is modified** — keeps GitHub line anchors stable)

| File | Purpose |
|---|---|
| `dipai/artifacts.py` | Shared: sha256 streaming, run ids, UTC timestamps, git provenance (`HEAD` + `origin/main` + dirty flag), hardware/env capture, report writing (atomic), schema constants. |
| `dipai/archmeta.py` | `python -m dipai.archmeta` — architecture metadata extraction (config or checkpoint source), real-tensor parameter breakdown, observed tensor shapes (tiny CPU forward with hooks), verified source anchors, `dipai-archmeta/1` artifact. |
| `dipai/evaluate.py` | `python -m dipai.evaluate` — checkpoint compatibility gate, validation loss (full + sampled modes), perplexity (safe exp), generation latency/throughput benchmark, `dipai-evalreport/1` artifact with full provenance; statuses `completed / failed / cancelled`. |
| `tests/test_artifacts.py` | Hashing, provenance, atomic write, schema shape, fixture round-trip. |
| `tests/test_archmeta.py` | Param sums reconcile (tie on/off), shapes, anchor verification against real source files, checkpoint vs config sources. |
| `tests/test_evaluate.py` | Metric math on known fixtures, aggregation equivalence, ppl edge cases, compat refusals, determinism, failed/cancelled handling. |

### DIPLens (new; existing files modified only to add nav links + docs entries)

| File | Purpose |
|---|---|
| `lib/diplens/schemas.ts` | Zod mirrors of `dipai-archmeta/1` and `dipai-evalreport/1`. |
| `lib/diplens/compare.ts` | Pure comparability engine: equivalence classes, `block` / `warn` findings from real report fields. |
| `lib/diplens/export.ts` | Pure JSON / CSV / Markdown builders for runs + comparisons. |
| `lib/diplens/history.ts` | Client-side run history (localStorage, size-capped, quota-safe). |
| `lib/generated/architecture.json` | Committed artifact generated by DIPAI from `configs/scratch.yaml` (documented regeneration command). |
| `scripts/sync-arch-artifact.mjs` | Copies + structurally validates a generated archmeta file into `lib/generated/`. |
| `app/architecture/page.tsx` | Architecture Explorer page (client). |
| `app/evaluation/page.tsx` | Evaluation Lab page (client). |
| `components/explorer/*` | `ArchSummary`, `ArchGraph`, `ComponentDetail`, `ParamBreakdown` (+ chart). |
| `components/lab/*` | `ImportDropzone`, `RunList`, `RunDetail`, `CompareView`, `ExportMenu`. |
| `lib/diplens/*.test.ts`, `components/explorer/*.test.tsx`, `components/lab/*.test.tsx` | Unit + component tests. |
| Modified: `app/layout.tsx` (header links), `lib/docs/registry.ts` + `lib/docs/pages.json` + two MDX pages (feature docs), `app/sitemap.ts`, `README.md`. | Navigation & documentation. |

## 5. Data flows & interfaces

1. **Architecture artifact (committed):** `python -m dipai.archmeta --config configs/scratch.yaml -o <DipLens>/lib/generated/architecture.json` → `scripts/sync-arch-artifact.mjs` re-validates structure → committed → rendered statically (works on Vercel with zero runtime fs, same contract as the docs search index).
2. **Architecture artifact (import):** any `dipai-archmeta/1` JSON (e.g. from `configs/dipai_50m.yaml` or a checkpoint) dropped on the Explorer page → Zod parse → view replaces bundled one, provenance banner shows source.
3. **Evaluation reports:** `python -m dipai.evaluate --checkpoint data/checkpoints/<run> --data-dir data/processed … -o report.json` → user imports the file in the Lab → Zod parse → history + detail + compare + export.
4. **Failure flow:** DIPAI emits `status: "failed" | "cancelled"` reports with `errors[]` (stage + message, no stack traces, no secrets); the Lab renders them as first-class rows, metrics show “unavailable”, never `0`.

No API routes are added. No DIPAI code runs in the browser. No checkpoint bytes cross into DIPLens (only metadata + hashes).

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Fabricated-looking data | Every displayed number comes from an imported/generated artifact; `num()` `—` for null; sample banner for the bundled artifact naming its true origin (config-derived, no training claimed); no progress animations implying live evaluation. |
| Poisoned/huge JSON import | Size cap (2 MB), Zod strict shapes, no code execution, unknown versions → explicit unsupported state. |
| Line-anchor drift | Anchors verified at generation time (symbol regex + line-range check against the local file, `origin/main` blob existence via `git cat-file -e`); DIPAI changes are additive-only so pushed anchors stay valid; artifact records `source_commit`. |
| Schema drift Python↔Zod | Shared fixtures validated by both suites; `schema_version` gating. |
| localStorage quota / private mode | try/catch with in-memory fallback + visible notice; cap stored runs. |
| Vercel cost/limits | Pure static/client pages; no new serverless work beyond static assets. |
| Pre-existing CPU-only torch test failures | Environment issue documented in §2; CUDA torch upgrade running; final report states exact executed results. |

## 7. Testing strategy (summary; details in the two design docs)

- **DIPAI:** pytest, tiny fixtures from `tests/conftest.py` (no GPU, no training runs): metric math vs independently computed references, aggregation/token counting, ppl overflow, compat gate rejections, determinism of full mode, source-anchor verification, fixture schema round-trip, existing 15-file suite must stay green.
- **DIPLens:** Vitest — Zod accept/reject fixtures (incl. future-version reject), comparability matrix, export contents (provenance fields present, secrets absent), component tests (import → select → compare → export; explorer render, keyboard access, unsupported/empty/error states), then `npm run lint`, `npm run typecheck`, `npm run build`.

## 8. Incremental implementation steps

1. ~~Inspect both repositories; record verified facts (§2).~~ ✅
2. ~~Baselines: DIPAI pytest, DIPLens vitest.~~ ✅
3. Write these three planning documents. ✅ (this file)
4. DIPAI: `dipai/artifacts.py` + tests (hashes, provenance, atomic writes, fixture schema).
5. DIPAI: `dipai/archmeta.py` + tests; generate the bundled artifact.
6. DIPAI: `dipai/evaluate.py` + tests (metric math first, then CLI).
7. DIPLens: Zod schemas + `compare.ts` + `export.ts` + `history.ts` + tests (shared fixtures).
8. DIPLens: Architecture Explorer page/components + tests + `sync-arch-artifact.mjs` + bundled artifact.
9. DIPLens: Evaluation Lab page/components + tests.
10. Navigation, docs MDX pages, READMEs (both repos), sitemap.
11. Full checks both repos; fix regressions.
12. **Genuine demo run:** prepare a tiny local corpus → train two small checkpoints (early + later step) with the real trainer → run `python -m dipai.evaluate` on both → import both reports into the Lab to prove the full loop with real measurements (labeled as toy-corpus demo numbers).
13. Final implementation report (executed commands + real outcomes).

Each step lands green before the next begins; no step rewrites existing behavior.
