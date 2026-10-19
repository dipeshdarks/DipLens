import type { Ecosystem, FileSnapshot, SkippedFile, TreeEntry } from "@/types/analysis";
import type { AnalysisBudget } from "@/lib/analysis/budgets";

/* Important-file patterns by role, evaluated against tree paths (case-insensitive basename match). */

type FileRole =
  | "manifest"
  | "lockfile"
  | "readme"
  | "license"
  | "ci"
  | "config"
  | "env-example"
  | "contributing"
  | "security-policy"
  | "codeowners"
  | "docker"
  | "docs";

const ROLE_PATTERNS: Array<{ role: FileRole; re: RegExp }> = [
  { role: "manifest", re: /^(package\.json|package-lock\.json|npm-shrinkwrap\.json)$/i },
  { role: "manifest", re: /^(pyproject\.toml|requirements.*\.txt|setup\.py|setup\.cfg|pipfile)$/i },
  { role: "manifest", re: /^(go\.mod|cargo\.toml|pom\.xml|build\.gradle(\.kts)?|gemfile|composer\.json|\.csproj)$/i },
  { role: "lockfile", re: /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|pipfile\.lock|go\.sum|cargo\.lock|gemfile\.lock|composer\.lock)$/i },
  { role: "readme", re: /^readme(\.[a-z]+)?$/i },
  { role: "license", re: /^(license|copying)(\.[a-z]+)?$/i },
  { role: "ci", re: /^\.github\/workflows\/[^/]+\.(ya?ml)$/i },
  { role: "ci", re: /^(\.circleci\/config\.ya?ml|\.gitlab-ci\.ya?ml|azure-pipelines\.yml|\.travis\.yml)$/i },
  { role: "config", re: /^(tsconfig.*\.json|eslint\.(config|rc)|\.eslintrc(\.[a-z]+)?|prettier\.(config|json|rc)|\.prettierrc(\.[a-z]+)?|vite\.config\.[cm]?ts|next\.config\.(js|ts|mjs)|webpack\.config\.[cm]?js|jest\.config\.[cm]?js|vitest\.config\.[cm]?ts|babel\.config\.[cm]?js|rollup\.config\.[cm]?ts)$/i },
  { role: "config", re: /^(tox\.ini|pytest\.ini|ruff\.toml|\.flake8|mypy\.ini|setup\.cfg|makefile)$/i },
  { role: "env-example", re: /^\.env\.(example|sample|template|dist)$/i },
  { role: "contributing", re: /^contributing(\.[a-z]+)?$/i },
  { role: "security-policy", re: /^(security|threat-model)(\.[a-z]+)?$/i },
  { role: "codeowners", re: /^(codeowners|\.github\/codeowners)$/i },
  { role: "docker", re: /^(dockerfile|docker-compose(\.[a-z0-9]+)?\.ya?ml|\.dockerignore)$/i },
  { role: "docs", re: /(^|\/)docs\//i },
];

export function classifyPath(path: string): FileRole[] {
  const base = path.split("/").pop() ?? path;
  const roles: FileRole[] = [];
  for (const { role, re } of ROLE_PATTERNS) {
    if (re.test(path) || re.test(base)) roles.push(role);
  }
  return roles;
}

const ECOSYSTEM_FILES: Array<{ eco: Ecosystem; re: RegExp }> = [
  { eco: "javascript", re: /(^|\/)(package\.json|yarn\.lock|pnpm-lock\.yaml|package-lock\.json)$/i },
  { eco: "python", re: /(^|\/)(pyproject\.toml|requirements[^/]*\.txt|setup\.py|Pipfile)$/i },
  { eco: "rust", re: /(^|\/)Cargo\.toml$/i },
  { eco: "go", re: /(^|\/)go\.mod$/i },
  { eco: "java", re: /(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/i },
  { eco: "ruby", re: /(^|\/)Gemfile$/i },
  { eco: "php", re: /(^|\/)composer\.json$/i },
  { eco: "dotnet", re: /(^|\/)[^/]+\.csproj$/i },
];

export function detectEcosystems(entries: TreeEntry[]): Ecosystem[] {
  const found = new Set<Ecosystem>();
  for (const e of entries) {
    if (e.type !== "blob") continue;
    for (const { eco, re } of ECOSYSTEM_FILES) {
      if (re.test(e.path)) found.add(eco);
    }
  }
  return [...found];
}

export function detectDirectories(entries: TreeEntry[], max = 24): string[] {
  const dirs = new Set<string>();
  for (const e of entries) {
    if (e.type !== "blob") continue;
    const parts = e.path.split("/");
    parts.pop();
    if (parts.length) dirs.add(parts.join("/"));
    if (parts.length > 1) dirs.add(parts[0]);
  }
  return [...dirs].sort().slice(0, max);
}

/* Priority: manifests/configs first, then workflow files, then entry-point-ish sources. */

const ENTRY_HINT = /(^|\/)(src|app|lib|pages|api|cmd|bin|main|index|server|cli)[^/]*\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb)$/i;
const TEST_HINT = /(^|\/)(__tests__|tests?|spec|e2e)(\/|$)|\.(test|spec)\.[a-z]+$/i;
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cs)$/i;

const ROLE_PRIORITY: Record<FileRole, number> = {
  manifest: 0,
  "security-policy": 1,
  ci: 2,
  config: 3,
  "env-example": 4,
  lockfile: 5,
  readme: 6,
  license: 7,
  codeowners: 8,
  contributing: 9,
  docker: 10,
  docs: 11,
};

export type PrioritizedFile = { path: string; size: number; reasons: string[] };

/**
 * Choose which files to retrieve within the budget.
 * Pure and deterministic: same tree + budget ⇒ same selection.
 */
export function prioritizeFiles(
  entries: TreeEntry[],
  budget: AnalysisBudget,
  taken: Set<string> = new Set(),
): { selected: PrioritizedFile[]; skipped: SkippedFile[] } {
  const blobs = entries.filter((e) => e.type === "blob" && !taken.has(e.path));
  const skipped: SkippedFile[] = [];
  let chars = 0;
  const selected: PrioritizedFile[] = [];

  const withRoles = blobs.map((e) => ({ e, roles: classifyPath(e.path) }));
  const ranked = withRoles
    .map(({ e, roles }) => {
      const best = roles.length ? Math.min(...roles.map((r) => ROLE_PRIORITY[r])) : 99;
      const entryBoost = SOURCE_EXT.test(e.path) && ENTRY_HINT.test(e.path) ? -3 : 0;
      const testPenalty = TEST_HINT.test(e.path) ? 5 : 0;
      const depth = e.path.split("/").length;
      return { e, roles, score: best + entryBoost + testPenalty + depth };
    })
    .sort((a, b) => a.score - b.score || a.e.path.localeCompare(b.e.path));

  for (const { e, roles } of ranked) {
    if (selected.length >= budget.maxFiles) {
      skipped.push({ path: e.path, reason: "budget-exhausted" });
      continue;
    }
    if (typeof e.size === "number" && e.size > budget.maxFileBytes) {
      skipped.push({ path: e.path, reason: "too-large" });
      continue;
    }
    // Reserve an estimated average size so total chars stay within budget.
    const est = typeof e.size === "number" ? e.size : 4_000;
    if (chars + est > budget.maxTotalChars) {
      skipped.push({ path: e.path, reason: "budget-exhausted" });
      continue;
    }
    chars += est;
    selected.push({ path: e.path, size: est, reasons: roles.length ? roles : ["source"] });
  }

  return { selected, skipped };
}

/** Filter the tree into a browsable structure (depth-capped for truncated trees). */
export function topLevelStructure(entries: TreeEntry[], maxPerDir = 40): string[] {
  const dirs = new Set<string>();
  const files: string[] = [];
  for (const e of entries) {
    if (e.type === "tree") dirs.add(e.path);
    else if (!e.path.includes("/")) files.push(e.path);
  }
  const out = [...dirs].sort().slice(0, maxPerDir).map((d) => `${d}/`);
  return [...out, ...files.sort().slice(0, maxPerDir)];
}

export type { FileSnapshot };
