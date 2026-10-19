import type { FileSnapshot, Finding, QualityReport, TreeEntry } from "@/types/analysis";
import { makeFinding, githubBlobUrl } from "@/lib/analysis/evidence";

const LINT_CONFIGS = [
  /(^|\/)\.eslintrc(\.[a-z]+)?$/i,
  /(^|\/)eslint\.config\.[cm]?[jt]s$/i,
  /(^|\/)\.rubocop\.yml$/i,
  /(^|\/)\.golangci\.ya?ml$/i,
  /(^|\/)ruff\.toml$/i,
  /(^|\/)\.flake8$/i,
  /(^|\/)clippy\.(toml|lints)$/i,
];
const FORMAT_CONFIGS = [
  /(^|\/)\.prettierrc(\.[a-z]+)?$/i,
  /(^|\/)prettier\.config\.[cm]?[jt]s$/i,
  /(^|\/)\.clang-format$/i,
  /(^|\/)rustfmt\.toml$/i,
  /(^|\/)\.editorconfig$/i,
];
const TYPE_CONFIGS = [/tsconfig(\.[\w-]+)?\.json$/i, /(^|\/)mypy\.ini$/i, /(^|\/)py\.typed$/i];

const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/g;

export function countTodos(text: string, path: string, cap = 20): { path: string; todos: number; line: number } | null {
  const lines = text.split(/\r?\n/);
  let todos = 0;
  let firstLine = 0;
  for (let i = 0; i < lines.length && i < 4_000; i++) {
    TODO_RE.lastIndex = 0;
    if (TODO_RE.test(lines[i])) {
      todos += 1;
      if (!firstLine) firstLine = i + 1;
    }
  }
  return todos ? { path, todos: Math.min(todos, cap), line: firstLine } : null;
}

export function buildQualityReport(input: {
  snapshots: FileSnapshot[];
  treePaths: string[];
  owner: string;
  repo: string;
  ref: string;
}): { report: QualityReport; findings: Finding[] } {
  const { snapshots, treePaths, owner, repo, ref } = input;
  const findings: Finding[] = [];

  const firstMatch = (res: RegExp[]) => treePaths.find((p) => res.some((re) => re.test(p))) ?? null;
  const lintConfig = firstMatch(LINT_CONFIGS);
  const formatConfig = firstMatch(FORMAT_CONFIGS);
  const typeCheckConfig = firstMatch(TYPE_CONFIGS);

  let strictTyping: boolean | null = null;
  const tsconfig = snapshots.find((s) => /(^|\/)tsconfig.*\.json$/i.test(s.path));
  if (tsconfig) {
    try {
      const parsed = JSON.parse(stripComments(tsconfig.content)) as { compilerOptions?: { strict?: boolean } };
      strictTyping = parsed.compilerOptions?.strict === true;
    } catch {
      strictTyping = null;
    }
  }

  const largestFiles = snapshots
    .map((s) => ({ path: s.path, size: s.size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 5);

  const todoCounts: QualityReport["todoCounts"] = [];
  for (const snap of snapshots) {
    const t = countTodos(snap.content, snap.path);
    if (t) todoCounts.push(t);
  }
  todoCounts.sort((a, b) => b.todos - a.todos);

  // Large modules: only among retrieved files, disclosed as such.
  const LARGE_BYTES = 60_000;
  for (const f of largestFiles.filter((x) => x.size >= LARGE_BYTES).slice(0, 3)) {
    findings.push(
      makeFinding({
        category: "code-quality",
        severity: "low",
        title: `Large module: ${f.path}`,
        summary: `${f.path} is ${(f.size / 1024).toFixed(0)} KB of source. Very large modules are harder to review and test, though size alone is not a defect.`,
        evidence: [{ path: f.path, sourceUrl: githubBlobUrl(owner, repo, ref, f.path) }],
        confidence: "high",
        status: "verified",
        recommendation: "Consider splitting responsibilities into smaller modules if the file mixes multiple concerns.",
      }),
    );
  }

  const totalTodos = todoCounts.reduce((a, b) => a + b.todos, 0);
  if (totalTodos >= 15) {
    const top = todoCounts[0];
    findings.push(
      makeFinding({
        category: "code-quality",
        severity: "info",
        title: `${totalTodos} TODO/FIXME markers in retrieved files`,
        summary: `Scanned files contain ${totalTodos} TODO/FIXME/HACK/XXX markers (highest: ${top.path} with ${top.todos}).`,
        evidence: [{ path: top.path, startLine: top.line, endLine: top.line }],
        confidence: "high",
        status: "verified",
        recommendation: "Track markers in the issue tracker so they are resolved rather than accumulating.",
      }),
    );
  }

  if (!lintConfig) {
    findings.push(
      makeFinding({
        category: "code-quality",
        severity: "info",
        title: "No linter configuration detected",
        summary: "No recognized linter configuration file was found in the repository tree. A linter may still be configured through package scripts or CI.",
        evidence: [],
        confidence: "medium",
        status: "verified",
        recommendation: "Add a linter configuration (ESLint, Ruff, golangci-lint, Clippy, RuboCop…).",
      }),
    );
  }

  const notes: string[] = [
    `Quality signals are computed from ${snapshots.length} retrieved file${snapshots.length === 1 ? "" : "s"} only; files skipped by the budget are not analyzed.`,
    "Stylistic preferences are not reported as defects.",
  ];

  return {
    report: {
      inspectedFiles: snapshots.length,
      largestFiles,
      todoCounts: todoCounts.slice(0, 8),
      lintConfig,
      formatConfig,
      typeCheckConfig,
      strictTyping,
      notes,
    },
    findings,
  };
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
