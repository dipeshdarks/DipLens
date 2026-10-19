/* Cross-file import resolution.
 *
 * Resolution is best-effort and always reports *why* a target could not be
 * found. Nothing is ever guessed: an unresolved import stays unresolved.
 */

import type { ReferenceResolution } from "@/lib/analysis/engine/types";
import type { LanguageId } from "@/lib/analysis/parsers/loader";

export type KnownPath = string;

const TS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const TS_INDEX = TS_EXTS.map((e) => `/index${e}`);
const PY_EXTS = [".py", ".pyi"];

export function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}

/** Resolve a relative specifier against a known file set. */
function tryCandidates(baseDir: string, specifier: string, exts: string[], indexSuffixes: string[], known: Set<string>): string | null {
  const joined = normalize(`${baseDir}/${specifier}`);
  if (!joined) return null;
  if (known.has(joined)) return joined;
  for (const ext of exts) {
    if (known.has(joined + ext)) return joined + ext;
  }
  for (const idx of indexSuffixes) {
    if (known.has(joined + idx)) return joined + idx;
  }
  return null;
}

export type ResolutionOutcome = {
  resolvedPath: string | null;
  resolution: ReferenceResolution;
  reason?: string;
};

function external(source: string): ResolutionOutcome {
  return { resolvedPath: null, resolution: "unresolved", reason: `external module: ${source}` };
}

/** TypeScript/JavaScript resolution: relative paths, `@/` alias, then bare specifiers. */
export function resolveTsImport(importerPath: string, source: string, known: Set<string>, repoRootFiles: boolean): ResolutionOutcome {
  const baseDir = dirOf(importerPath);

  if (source.startsWith("./") || source.startsWith("../")) {
    const hit = tryCandidates(baseDir, source, TS_EXTS, TS_INDEX, known);
    if (hit) return { resolvedPath: hit, resolution: "resolved" };
    return { resolvedPath: null, resolution: "unresolved", reason: `relative target not retrieved: ${source}` };
  }

  // tsconfig-style path alias: `@/x` → `<repoRoot>/x`. Best effort without
  // reading tsconfig; a miss is reported as unresolved, never guessed.
  if (source.startsWith("@/")) {
    const hit = tryCandidates("", source.slice(2), TS_EXTS, TS_INDEX, known);
    if (hit) return { resolvedPath: hit, resolution: "resolved" };
    if (!repoRootFiles) return { resolvedPath: null, resolution: "unresolved", reason: `alias ${source} not covered by retrieved files` };
    return { resolvedPath: null, resolution: "unresolved", reason: `alias ${source} did not match a retrieved file` };
  }

  // Workspace package (`@scope/name`) or bare package.
  return external(source);
}

/** Python resolution: relative imports, then absolute module paths. */
export function resolvePyImport(importerPath: string, source: string, known: Set<string>): ResolutionOutcome {
  const baseDir = dirOf(importerPath);

  if (source.startsWith(".")) {
    // Count leading dots to determine how far up the package to go.
    const dots = source.length - source.replace(/^\.+/, "").length;
    const rest = source.replace(/^\.+/, "").replace(/\./g, "/");
    let dir = baseDir;
    for (let i = 1; i < dots; i++) {
      dir = dirOf(dir);
      if (!dir && i < dots - 1) return { resolvedPath: null, resolution: "unresolved", reason: `relative import escapes repository: ${source}` };
    }
    const hit = tryCandidates(dir, rest, PY_EXTS, PY_EXTS.map((e) => `/__init__${e}`), known);
    if (hit) return { resolvedPath: hit, resolution: "resolved" };
    return { resolvedPath: null, resolution: "unresolved", reason: `relative module not retrieved: ${source}` };
  }

  const dotted = source.replace(/\./g, "/");
  const hit = tryCandidates("", dotted, PY_EXTS, PY_EXTS.map((e) => `/__init__${e}`), known);
  if (hit) return { resolvedPath: hit, resolution: "resolved" };

  // A single-segment absolute import could be either stdlib or a local module
  // that was not retrieved. Report both possibilities rather than guessing.
  const isLikelyStdlib = !source.includes(".") && source.split("/").length === 1;
  return {
    resolvedPath: null,
    resolution: "unresolved",
    reason: isLikelyStdlib ? `stdlib or unretrieved local module: ${source}` : `unretrieved module: ${source}`,
  };
}

/**
 * Go resolution: imports without a dot in the first path element are the
 * standard library; anything else is external unless a repository directory
 * matches the import path suffix.
 */
export function resolveGoImport(source: string, knownDirs: Set<string>): ResolutionOutcome {
  if (!source) return { resolvedPath: null, resolution: "unresolved", reason: "empty import" };
  const first = source.split("/")[0];
  if (!first.includes(".")) {
    return { resolvedPath: null, resolution: "unresolved", reason: `standard library: ${source}` };
  }
  // Match the longest repository directory suffix of the import path.
  const segments = source.split("/");
  for (let take = segments.length; take >= 1; take--) {
    const suffix = segments.slice(segments.length - take).join("/");
    if (knownDirs.has(suffix)) {
      return { resolvedPath: `${suffix}/`, resolution: "resolved" };
    }
  }
  return { resolvedPath: null, resolution: "unresolved", reason: `external module: ${source}` };
}

export function resolveImport(
  language: LanguageId,
  importerPath: string,
  source: string,
  known: Set<string>,
  knownDirs: Set<string>,
): ResolutionOutcome {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
      return resolveTsImport(importerPath, source, known, knownDirs.size > 0);
    case "python":
      return resolvePyImport(importerPath, source, known);
    case "go":
      return resolveGoImport(source, knownDirs);
    default:
      return { resolvedPath: null, resolution: "unresolved", reason: `no resolver for language ${language}` };
  }
}

export { normalize as normalizeRepoPath };
