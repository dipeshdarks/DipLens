import type {
  Dependency,
  DependencyReport,
  DependencySet,
  Ecosystem,
  FileSnapshot,
} from "@/types/analysis";
import { makeFinding } from "@/lib/analysis/evidence";
import type { Finding } from "@/types/analysis";

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const UNCONSTRAINED = new Set(["*", "", "latest", "workspace:*", "file:", "link:"]);

function countUnconstrained(deps: Record<string, string>): number {
  return Object.values(deps).filter((v) => {
    const range = typeof v === "string" ? v.trim() : "";
    return UNCONSTRAINED.has(range) || range.startsWith("file:") || range.startsWith("link:");
  }).length;
}

export function parsePackageJson(snap: FileSnapshot): DependencySet | null {
  const pkg = safeJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    packageManager?: string;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    name?: string;
  }>(snap.content);
  if (!pkg) return null;

  const toDeps = (rec: Record<string, string> | undefined, dev: boolean): Dependency[] =>
    Object.entries(rec ?? {})
      .map(([name, range]) => ({ name, range: String(range ?? ""), dev }))
      .sort((a, b) => a.name.localeCompare(b.name));

  const direct = [
    ...toDeps(pkg.dependencies, false),
    ...toDeps(pkg.devDependencies, true),
  ];
  const allRanges = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  return {
    ecosystem: "javascript",
    manifestPath: snap.path,
    direct,
    lockfilePath: null, // resolved by caller against the tree
    packageManager: pkg.packageManager ?? null,
    runtimes: pkg.engines ?? {},
    scripts: pkg.scripts ?? {},
    unconstrainedCount: countUnconstrained(allRanges),
  };
}

export function parseRequirementsTxt(snap: FileSnapshot): DependencySet | null {
  const direct: Dependency[] = [];
  let unconstrained = 0;
  for (const rawLine of snap.content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const cleaned = line.split("#")[0].trim();
    const m = cleaned.match(/^([A-Za-z0-9_.-]+)\s*(.*)$/);
    if (!m) continue;
    const name = m[1];
    const range = (m[2] ?? "").trim();
    if (!range) unconstrained += 1;
    direct.push({ name, range: range || "(none)", dev: false });
  }
  return {
    ecosystem: "python",
    manifestPath: snap.path,
    direct: direct.sort((a, b) => a.name.localeCompare(b.name)),
    lockfilePath: null,
    packageManager: null,
    runtimes: {},
    scripts: {},
    unconstrainedCount: unconstrained,
  };
}

export function parseGoMod(snap: FileSnapshot): DependencySet | null {
  const direct: Dependency[] = [];
  const goVersion = snap.content.match(/^go\s+([\d.]+)/m)?.[1] ?? null;
  let inRequire = false;
  for (const rawLine of snap.content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("require (")) {
      inRequire = true;
      continue;
    }
    if (inRequire && line === ")") {
      inRequire = false;
      continue;
    }
    const req = line.match(/^(?:require\s+)?([\w./-]+)\s+(v[\w.+-]+)/);
    if (req) direct.push({ name: req[1], range: req[2], dev: false });
  }
  if (!direct.length && !goVersion) return null;
  return {
    ecosystem: "go",
    manifestPath: snap.path,
    direct: direct.sort((a, b) => a.name.localeCompare(b.name)),
    lockfilePath: snap.content.includes("go.sum") ? "go.sum" : null,
    packageManager: null,
    runtimes: goVersion ? { go: goVersion } : {},
    scripts: {},
    unconstrainedCount: 0,
  };
}

export function parseCargoToml(snap: FileSnapshot): DependencySet | null {
  const direct: Dependency[] = [];
  let section: "none" | "deps" | "dev" = "none";
  for (const rawLine of snap.content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      section = line === "[dependencies]" ? "deps" : line === "[dev-dependencies]" ? "dev" : "none";
      continue;
    }
    if (section === "none") continue;
    const m = line.match(/^([\w-]+)\s*=\s*(.+)$/);
    if (m) {
      const raw = m[2].replace(/^"|"$/g, "");
      direct.push({ name: m[1], range: raw, dev: section === "dev" });
    }
  }
  if (!direct.length) return null;
  return {
    ecosystem: "rust",
    manifestPath: snap.path,
    direct: direct.sort((a, b) => a.name.localeCompare(b.name)),
    lockfilePath: null,
    packageManager: null,
    runtimes: {},
    scripts: {},
    unconstrainedCount: direct.filter((d) => d.range === "*").length,
  };
}

const LOCKFILE_BY_ECOSYSTEM: Record<Ecosystem, RegExp> = {
  javascript: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i,
  python: /(^|\/)(poetry\.lock|pipfile\.lock|uv\.lock)$/i,
  rust: /(^|\/)Cargo\.lock$/i,
  go: /(^|\/)go\.sum$/i,
  java: /(^|\/)(gradle\.lockfile|pom\.xml)$/i,
  ruby: /(^|\/)Gemfile\.lock$/i,
  php: /(^|\/)composer\.lock$/i,
  dotnet: /(^|\/)packages\.lock\.json$/i,
  other: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i,
};

export function buildDependencyReport(
  snapshots: FileSnapshot[],
  allPaths: string[],
): { report: DependencyReport; findings: Finding[] } {
  const sets: DependencySet[] = [];
  const notes: string[] = [];
  const findings: Finding[] = [];

  for (const snap of snapshots) {
    let set: DependencySet | null = null;
    const base = snap.path.split("/").pop() ?? snap.path;
    if (/^package\.json$/i.test(base)) {
      set = parsePackageJson(snap);
      if (set) {
        const lock = allPaths.find((p) => LOCKFILE_BY_ECOSYSTEM.javascript.test(p) && !p.includes("node_modules"));
        set.lockfilePath = lock ?? null;
      }
    } else if (/^requirements[^/]*\.txt$/i.test(base)) {
      set = parseRequirementsTxt(snap);
      if (set) set.lockfilePath = allPaths.find((p) => LOCKFILE_BY_ECOSYSTEM.python.test(p)) ?? null;
    } else if (/^go\.mod$/i.test(base)) {
      set = parseGoMod(snap);
      if (set) set.lockfilePath = allPaths.find((p) => p.endsWith("go.sum")) ?? null;
    } else if (/^cargo\.toml$/i.test(base)) {
      set = parseCargoToml(snap);
      if (set) set.lockfilePath = allPaths.find((p) => LOCKFILE_BY_ECOSYSTEM.rust.test(p)) ?? null;
    } else if (/^pyproject\.toml$/i.test(base)) {
      set = parsePyproject(snap);
      if (set) set.lockfilePath = allPaths.find((p) => LOCKFILE_BY_ECOSYSTEM.python.test(p)) ?? null;
    } else if (/^gemfile$/i.test(base)) {
      set = parseGemfile(snap);
      if (set) set.lockfilePath = allPaths.find((p) => LOCKFILE_BY_ECOSYSTEM.ruby.test(p)) ?? null;
    }
    if (set) sets.push(set);
  }

  if (!sets.length) {
    notes.push("No recognized package manifest was retrieved within the analysis budget.");
  }

  for (const set of sets) {
    if (!set.lockfilePath && set.ecosystem !== "go") {
      findings.push(
        makeFinding({
          category: "dependencies",
          severity: "medium",
          title: `No lockfile found for ${set.manifestPath}`,
          summary: `The ${set.ecosystem} manifest ${set.manifestPath} has no companion lockfile in the repository tree, so builds may resolve different dependency versions over time.`,
          evidence: [{ path: set.manifestPath }],
          confidence: "high",
          status: "verified",
          recommendation: "Commit the lockfile produced by your package manager and install with a frozen/locked mode in CI.",
        }),
      );
    } else if (set.lockfilePath) {
      notes.push(`${set.manifestPath}: lockfile ${set.lockfilePath} present.`);
    }

    if (set.unconstrainedCount > 0) {
      findings.push(
        makeFinding({
          category: "dependencies",
          severity: "low",
          title: `${set.unconstrainedCount} unpinned dependency constraint${set.unconstrainedCount === 1 ? "" : "s"} in ${set.manifestPath}`,
          summary: `${set.unconstrainedCount} dependenc${set.unconstrainedCount === 1 ? "y uses" : "ies use"} a wildcard or path-based range, which weakens reproducibility.`,
          evidence: [{ path: set.manifestPath }],
          confidence: "medium",
          status: "heuristic",
          recommendation: "Prefer exact or tilde/caret ranges appropriate to the ecosystem for direct dependencies.",
        }),
      );
    }
  }

  const js = sets.find((s) => s.ecosystem === "javascript");
  if (js?.packageManager === null && js.lockfilePath?.endsWith("pnpm-lock.yaml")) {
    js.packageManager = "pnpm";
  } else if (js?.lockfilePath === null && js) {
    const yarn = allPaths.find((p) => p.endsWith("yarn.lock"));
    if (yarn) js.packageManager = "yarn";
  }

  notes.push(
    "Vulnerability scanning is not performed: RepoLens queries no advisory database here. Package age alone never implies a vulnerability.",
  );
  notes.push("Outdated-package detection is skipped because no registry version comparison is performed.");

  return {
    report: { sets, notes, vulnerabilityScanPerformed: false, outdatedPackagesChecked: false },
    findings,
  };
}

function parsePyproject(snap: FileSnapshot): DependencySet | null {
  const text = snap.content;
  if (!/^\[/.test(text)) return null;
  const direct: Dependency[] = [];
  const depBlock = text.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (depBlock) {
    for (const entry of depBlock[1].matchAll(/"([A-Za-z0-9_.\[\]-]+)([^"]*)"/g)) {
      direct.push({ name: entry[1], range: entry[2]?.trim() || "(none)", dev: false });
    }
  }
  const toolPoetry = text.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/);
  if (toolPoetry) {
    for (const line of toolPoetry[1].split("\n")) {
      const m = line.trim().match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
      if (m && m[1] !== "python") {
        direct.push({ name: m[1], range: m[2].replace(/^"|"$/g, ""), dev: false });
      }
    }
  }
  const pythonVersion = text.match(/requires-python\s*=\s*"([^"]+)"/)?.[1] ?? null;
  if (!direct.length && !pythonVersion) return null;
  return {
    ecosystem: "python",
    manifestPath: snap.path,
    direct: direct.sort((a, b) => a.name.localeCompare(b.name)),
    lockfilePath: null,
    packageManager: text.includes("[tool.poetry]") ? "poetry" : null,
    runtimes: pythonVersion ? { python: pythonVersion } : {},
    scripts: {},
    unconstrainedCount: direct.filter((d) => d.range === "(none)").length,
  };
}

function parseGemfile(snap: FileSnapshot): DependencySet | null {
  const direct: Dependency[] = [];
  for (const rawLine of snap.content.split(/\r?\n/)) {
    const m = rawLine.trim().match(/^(?:gem|gem\s+)["']([^"']+)["']\s*(?:,\s*["']([^"']+)["'])?/);
    if (m) direct.push({ name: m[1], range: m[2] ?? "(none)", dev: rawLine.includes("group:") });
  }
  if (!direct.length) return null;
  return {
    ecosystem: "ruby",
    manifestPath: snap.path,
    direct: direct.sort((a, b) => a.name.localeCompare(b.name)),
    lockfilePath: null,
    packageManager: "bundler",
    runtimes: {},
    scripts: {},
    unconstrainedCount: direct.filter((d) => d.range === "(none)").length,
  };
}
