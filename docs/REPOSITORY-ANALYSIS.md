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

## Prioritized findings (severity × confidence)

Confidence: **C** = confirmed against source or live check; **H** = hypothesis needing more verification.

| # | Severity | Finding | Evidence | Confidence |
|---|---|---|---|---|
| 1 | High | No CI: `.github/` does not exist in the tree, so lint/typecheck/test/build never run on pushes or PRs. | `git ls-tree -r --name-only origin/main` shows no `.github` path | C |
| 2 | High (docs) | Documentation was README-only before this site: no concept, architecture, API, or troubleshooting docs. | Repo tree pre-`489823e` had no `content/docs`, no `docs/` | C |
| 3 | Medium | No LICENSE file on GitHub — reuse terms undefined; the site deliberately claims none. | GitHub tree has no `LICENSE`; docs state this explicitly | C |
| 4 | Medium | Test-coverage gap: `components/report/*` (OverviewSection, CommitActivityChart wrapper, Contributors/Security/Architecture sections) and `app/repo/*` have no unit tests; coverage exists for `lib/*` and interaction-critical components. | Test inventory: 16 files, all under `lib/`, `components/` root, `components/docs/` | C |
| 5 | Medium | Report route returns HTTP 200 for unknown repositories (streaming loading shell). Visible UX is a correct 404 state; the status code lies. | `app/repo/[owner]/[repo]/page.tsx` streams; verified live: route itself 200, not-found page renders | C (documented in README) |
| 6 | Medium | Wide MDX tables (e.g. the 3–4 column budget/reference tables) pushed the whole page sideways at ≤390px because `.docs-prose table` had no scroll container. | `globals.css` had `table { w-full border-collapse }` with no `overflow-x`; fixed in this round with GitHub-style `display:block; overflow-x:auto` | C (fixed) |
| 7 | Medium | Build is fragile to ESM-only plugins: `remark-gfm`/`rehype-highlight` under CJS `next.config.js` must be loaded via `.default`, else `unified` rejects the preset ("empty preset" error). | Reproduced during build; fixed at `next.config.js:1-9` | C |
| 8 | Medium | MDX under React Server Components crashes (`createContext is not a function`) unless root `mdx-components.tsx` exists — `@next/mdx` then falls back to `@mdx-js/react`. The file is load-bearing. | Stack trace at `/docs/[slug]` page-data collection; alias chain in `@next/mdx/index.js:24-28`; fix `mdx-components.tsx` | C |
| 9 | Low | No separate `CONTRIBUTING.md`; contribution guidance lives only in `/docs/contributing`. | Repo tree lacks the file; docs page states this | C |
| 10 | Low | Inline code tokens with long unbreakable strings (URLs, deep paths) could overflow 320px viewports. | `.docs-prose code:not(pre code)` had no `overflow-wrap`; fixed in this round | C (fixed) |
| 11 | Low | GitHub stats endpoint can answer HTTP 202 for minutes on new repos; users may read the pending state as a bug. | Handled in `lib/github.ts` (`pending`) with UI hint; residual UX confusion only | H |

Out of scope (reported, not changed): findings 1 and 4 would require adding CI workflows and new tests for `components/report/*` — core-app changes beyond the documentation task.

## UX and developer-experience problems (pre-existing)

1. **No entry map.** Before the site, a new developer had only the README: no "what is this, what can it do, how do I start" narrative, no architecture explanation, no error reference.
2. **Opaque health signals.** Thresholds (≤30d active, ≤180d moderate, stars+forks ≥100) were readable only inside `lib/health.ts`.
3. **Unverifiable claims risk.** No place existed to document partial failures (202 stats, `sectionErrors`), inviting users to distrust the UI when a section showed empty.
4. **No troubleshooting path.** Rate-limit and pending-stats behavior were only discoverable by reading source.
5. **Undocumented naming.** Repo is `DipAi`, product is `Diplens`; without the explanation the branding looks inconsistent (addressed on the getting-started page).

## Design critique (Phase 3 — basis for the implemented system)

**Information hierarchy.** Single-college docs pages with h2-first structure (h1 is the page title rendered by the layout, not MDX) — avoids double h1 and keeps ToC anchors derived from h2/h3 only.

**Content density.** Article column capped near 70ch inside a 1280px shell; the three-column grid (60px sidebar + article + 208px ToC) collapses by dropping columns (ToC hides <1280px, sidebar becomes a drawer <1280px) instead of shrinking the reading column.

**Typography.** 15px/1.7 body in `--c-mute` with `--c-ink` headings; monospace accents for commands and tokens; `tabular-nums` globally for metric alignment.

**Color & contrast.** Dark-first charcoal ladder (`base #0B0D10 → card #12161C → elev #1F2731`) with a single blue accent (`--c-info`) and semantic ok/warn/bad; light theme inverts to a WCAG-sane ramp rather than a naive invert. Focus ring: 2px `--c-info` outline with offset.

**Code presentation.** Build-time `rehype-highlight` (no runtime JS), custom token theme shared by both modes, language chip + copy button revealed on hover/focus-within, `overflow-x-auto` containment.

**Search discoverability.** Persistent header control with visible ⌘K hint; dialog states for empty/querying/no-results; results carry kind icons and context snippets.

**Interaction feedback.** Copy → "Copied" + check icon (1.6s), sidebar drawer with Escape + backdrop close, search with arrow/Enter/Escape keyboard model, theme toggle persisted pre-paint by inline script to avoid flash.

**Accessibility.** `aria-current` on active nav, `role="dialog"`/`aria-modal` on search, `aria-expanded`/`aria-controls` on drawer trigger, accessible names on all icon buttons, `prefers-reduced-motion` kills all animation.

**Deliberate avoids:** no glassmorphism, no gradient decoration, no fake metrics/badges, no animation library, no emoji icons (lucide only).

## Second-pass review results (Phase 9, three-persona pass)

- **Reviewer A (new developer):** can answer what-it-is/what-can-it-do/how-to-start from `/` and `/docs/getting-started`; naming (Diplens vs DipAi) explicitly explained; no dead ends (all nav targets verified live). *Defect found and fixed: none blocking; page map verified.*
- **Reviewer B (engineer):** API reference signatures cross-checked against source; budgets table matches `budgets.ts`; no invented commands (all npm scripts from `package.json`). *Findings 1–5 above recorded as honest limitations in-site where user-facing.*
- **Reviewer C (designer):** *Defects found:* (a) mobile table overflow — fixed; (b) inline-code overflow — fixed; (c) theme toggle untested — added `ThemeToggle.test.tsx` (3 tests). Diagram container already `overflow-x-auto`.

## Verification record (headless, production build)

Script `scratch/verify-site.mjs` against `next start` (scratch is gitignored):

- 17 routes checked: `/`, `/docs`, all 11 `/docs/{slug}`, `/robots.txt`, `/sitemap.xml` → 200; `/definitely-not-a-page-xyz` → 404; `/repo/dipeshdarks/DipAi` → 200 (live GitHub-backed).
- 13 distinct internal link targets extracted from rendered HTML: all resolve; every in-page anchor target (e.g. `#directory-layout`, `#rate-limit-reached`, `/#features`, `/#how`) present in the destination DOM.
- Content smoke: homepage brand, docs hero CTAs, architecture diagram source (`flowchart TD`) and its heading anchors, API reference symbols (`parseRepo`, `getReport`, `runDeepAnalysis`) present in SSR output.
- Browser-based visual testing at 1440/1024/768/390/320 was **not available in this environment**; responsive behavior was reviewed at source level (breakpoint usage, overflow containment) — listed as an unverified area below.

## Unverified areas (honest list)

1. Real-browser visual pass across the five target widths (no browser tooling available).
2. Client-side Mermaid SVG rendering (diagram source ships in SSR payload and the component has a `<pre>` fallback; actual SVG paint needs a browser).
3. Vercel production deploy of these changes (canonical base `https://diplensrepo.vercel.app` was taken from the repository About link).

## Documentation site delivery notes

- MDX content: `content/docs/*.mdx` (11 pages).
- Search index: generated by `scripts/build-docs-index.mjs` → `lib/docs/search-index.json`
  (bundled client-side; no runtime fs; Vercel-safe).
- Canonical deployment URL used for sitemap/metadata: `https://diplensrepo.vercel.app`
  (repository About link).
- Pushed with the site: commit `489823e` on `main`.
