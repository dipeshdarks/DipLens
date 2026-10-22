# Repository Analysis — DipAi (Diplens)

Internal analysis produced before and during the documentation-site build. Every claim here was
verified against the repository at commit `489823e` (docs platform) on top of `6626f36` (app).
Default branch: **main**. Version: **0.1.0**.

## 1. Project purpose and architecture

**Purpose.** Diplens turns public GitHub repository metadata into a shareable analytics report —
metrics, weekly commit activity, contributors, releases, languages, and explainable health
signals — plus a budget-limited static deep-analysis pipeline (symbols, call graphs, taint
candidates, defects) over fetched source text. It is a single Next.js App Router application; the
documentation website ships inside the same app at `/docs`.

**Architecture (high level).**

- Server components fetch and normalize GitHub data; client islands handle charts, clipboard,
  search, and theming.
- Input (`owner/repo` or github.com URL) is validated by Zod in `lib/validation.ts` before any
  network call.
- The report route `app/repo/[owner]/[repo]/page.tsx` assembles a `Report` via `getReport()` and
  an optional `DeepAnalysis` via `runDeepAnalysis()` with `DEFAULT_BUDGET`.
- Missing data is `null` and renders as `—`; partial satellite failures populate `sectionErrors`
  instead of failing the page.
- The docs subsystem (`content/docs/*.mdx`, `lib/docs/*`, `components/docs/*`, `app/docs/*`) is
  independent of the analysis engine and consumes no GitHub API at runtime.

## 2. Technology stack and dependencies

| Layer | Choice |
|---|---|
| Framework | Next.js 14.2.x (App Router), React 18, TypeScript strict |
| Styling | Tailwind CSS with CSS-variable design tokens (dark-first + `html.light`) |
| Fonts / icons | Geist Sans/Mono, lucide-react |
| Charts | Recharts (commit-activity bars) |
| Validation | Zod |
| MDX | `@next/mdx` + `@mdx-js/loader`, `remark-gfm`, `rehype-highlight`, `mermaid` |
| Static analysis | `web-tree-sitter` + `tree-sitter-wasms` (externalized in `next.config.js`) |
| Tests | Vitest + Testing Library (jsdom), `vitest.setup.ts` |
| Data | GitHub REST API (`api.github.com`, version `2022-11-28`), raw text via `raw.githubusercontent.com` |

Only one env var exists: optional server-side `GITHUB_TOKEN`. There is no `engines` field;
Node 20+ is assumed from `@types/node`.

## 3. Important modules and responsibilities

| Module | Responsibility |
|---|---|
| `lib/validation.ts` | `parseRepo`, `parseFilePath`, `encodeRepoPath`; OWNER/REPO regexes; path-traversal defense |
| `lib/github.ts` | `gh()` wrapper (8s timeout, per-endpoint revalidate), typed `GitHubError`, normalizers, `getReport()` |
| `lib/github/endpoints.ts` | head SHA, tree, raw file, commits, branches, tags, workflows, code-scanning probe |
| `lib/health.ts` | `healthSignals()` heuristics, `summarizeWeeks()` chart summaries |
| `lib/analysis/` | full pipeline: acquire → classify → parse → symbols → call graph → paths → taint → defects → architecture/deps/security/quality/CI |
| `lib/analysis/budgets.ts` | `DEFAULT_BUDGET` (24 files, 192 KB/file, depth 8) and `DEEP_BUDGET` |
| `types/report.ts`, `types/analysis.ts` | stable normalized application types |
| `app/repo/[owner]/[repo]/` | shareable report route + loading/error/not-found states |
| `app/api/file/route.ts` | size-capped (256 KB) text file viewer with path validation |
| `lib/docs/*`, `components/docs/*`, `app/docs/*`, `content/docs/*` | documentation site (registry, search index, MDX pages, UI) |
| `scripts/build-docs-index.mjs` | generates `lib/docs/search-index.json` at predev/prebuild |

## 4. Actual user workflows

1. **Analyze a repository.** Homepage → enter `owner/repo` or github.com URL (or press `/`) →
   report at `/repo/{owner}/{repo}` → copy share link.
2. **Read the docs.** `/docs` → sidebar or search (<kbd>⌘K</kbd>/<kbd>Ctrl+K</kbd>) →
   previous/next navigation; Mermaid diagrams on the architecture page.
3. **Contribute.** Fork → `npm install` → `npm run lint && npm run typecheck && npm test &&
   npm run build` → PR (see `/docs/contributing`).
4. **Optional token.** Copy `.env.example` → `.env.local`, set `GITHUB_TOKEN`, restart dev server.

There is no CLI, no sign-in, no billing, and no write path to GitHub.

## 5. Verified commands and APIs

npm scripts (from `package.json`): `predev`, `dev`, `prebuild`, `build`, `start`, `lint`,
`typecheck`, `test`, `test:watch`.

Exported module surface (in-repo, `@/*` alias): documented with real signatures in
`/docs/api-reference`. HTTP surface: only `GET /api/file` plus the page routes.

## 6. Current documentation gaps (addressed by this site)

- Pre-site README-only docs; no concept/model docs, no API reference, no troubleshooting.
- No CONTRIBUTING.md and no LICENSE file (the contributing page states this honestly).
- No architecture diagrams.
- Health-signal rules were undocumented outside `lib/health.ts` source.

Remaining honest gaps: no LICENSE; no separate CONTRIBUTING.md; analysis-language coverage
(TypeScript/JavaScript, Python, Go) is not auto-detected in the UI.

## 7. Technical risks and limitations

- **Rate limits.** 60 req/h unauthenticated; mitigated by `GITHUB_TOKEN` and per-endpoint cache.
- **HTTP 202 stats pending.** GitHub can lag on `stats/commit_activity`; UI shows a pending state
  rather than zeros.
- **Streaming not-found.** The report route streams its loading shell, so an unknown repo renders
  a correct not-found *page* with HTTP 200.
- **RSC + MDX pitfall.** `@next/mdx` aliases the provider to root `mdx-components.tsx`; without
  that file, compiled MDX falls back to `@mdx-js/react`, whose `createContext` crashes under
  React Server Components. The root `mdx-components.tsx` is load-bearing — do not delete it.
- **ESM-only remark/rehype plugins.** Under CJS `next.config.js`, `remark-gfm` and
  `rehype-highlight` must be loaded via `.default`.
- **Analysis budget.** Production runs `DEFAULT_BUDGET`; skipped files are reported, never hidden.
- **Static-only policy.** Analysed code is never executed; findings are candidates with evidence.

## 8. Proposed documentation structure (implemented)

Home · Getting Started (intro, installation, quick start) · Core Concepts · Features ·
Architecture · API Reference · Configuration · Examples · Troubleshooting · Contributing.
Registered in `lib/docs/pages.json`; navigation groups in `lib/docs/registry.ts`.

## 9. UI/UX implementation plan (implemented)

Dark-first tokens (`#0B0D10` base, `#12161C` card, `#29313B` line, `#F4F7FA` ink, `#9AA6B2`
mute, `#67E8A5` ok, `#7CB7FF` info) with an accessible light theme. Three-column docs layout
(sticky sidebar ≥1280px, article, TOC ≥1280px; mobile drawer). Client-side full-text search over
a build-time JSON index. Copyable code blocks with language labels; callouts; Mermaid diagrams;
theme toggle with no-flash bootstrap; `prefers-reduced-motion` respected.

## 10. Testing and completion criteria

- `npm run lint` — clean (next/core-web-vitals).
- `npm run typecheck` — clean (strict).
- `npm test` — 142 tests / 16 files, including docs slug, search-core, CopyButton, SearchDialog.
- `npm run build` — succeeds; all 11 docs pages statically generated; report route dynamic.
- Definition of done: every published page has real content; search returns real hits; copy
  buttons verified in tests; GitHub links target verified paths only; no placeholder pages; no
  fabricated stars/forks/license claims.

## Documentation site delivery notes

- MDX content: `content/docs/*.mdx` (11 pages).
- Search index: generated by `scripts/build-docs-index.mjs` → `lib/docs/search-index.json`
  (bundled client-side; no runtime fs; Vercel-safe).
- Canonical deployment URL used for sitemap/metadata: `https://diplensrepo.vercel.app`
  (repository About link).
- Pushed with the site: commit `489823e` on `main`.
