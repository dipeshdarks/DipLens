/* tree-sitter WASM loader.
 *
 * Grammar ABIs in `tree-sitter-wasms` were produced by tree-sitter-cli 0.20
 * (ABI 14); web-tree-sitter is pinned to 0.24.7 which loads them. Loading a
 * grammar fails soft: the language is reported unavailable rather than
 * crashing the analysis.
 */

import path from "node:path";
import fs from "node:fs";
import Parser from "web-tree-sitter";

export type LanguageId = "typescript" | "tsx" | "javascript" | "python" | "go" | "other";

let initPromise: Promise<boolean> | null = null;
const languageCache = new Map<string, Parser.Language | null>();
let runtimeAvailable = false;

/**
 * Resolve a package file, tolerating bundler/ESM contexts where
 * `require.resolve` is unavailable, by falling back to the project root.
 */
function resolvePackageFile(specifier: string, fallbackRelative: string): string | null {
  try {
    if (typeof require !== "undefined") {
      const p = require.resolve(specifier);
      if (p) return p;
    }
  } catch {
    /* fall through to cwd resolution */
  }
  const fallback = path.join(process.cwd(), "node_modules", ...fallbackRelative.split("/"));
  return fs.existsSync(fallback) ? fallback : null;
}

function locateRuntimeWasm(): string {
  const p = resolvePackageFile("web-tree-sitter/package.json", "web-tree-sitter/package.json");
  return p ? path.join(path.dirname(p), "tree-sitter.wasm") : path.join(process.cwd(), "node_modules/web-tree-sitter/tree-sitter.wasm");
}

function grammarPath(id: LanguageId): string {
  const p = resolvePackageFile("tree-sitter-wasms/package.json", "tree-sitter-wasms/package.json");
  const dir = p ? path.dirname(p) : path.join(process.cwd(), "node_modules/tree-sitter-wasms");
  return path.join(dir, "out", `tree-sitter-${id}.wasm`);
}

/** Initialize the runtime exactly once. Returns false when unavailable. */
export function initRuntime(): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await Parser.init({ locateFile: () => locateRuntimeWasm() });
        runtimeAvailable = true;
      } catch {
        runtimeAvailable = false;
      }
      return runtimeAvailable;
    })();
  }
  return initPromise;
}

export function isRuntimeAvailable(): boolean {
  return runtimeAvailable;
}

/** Load a grammar, caching both successes and failures. */
export async function getLanguage(id: LanguageId): Promise<Parser.Language | null> {
  if (languageCache.has(id)) return languageCache.get(id) ?? null;
  const ok = await initRuntime();
  if (!ok) {
    languageCache.set(id, null);
    return null;
  }
  try {
    const lang = await Parser.Language.load(grammarPath(id));
    languageCache.set(id, lang);
    return lang;
  } catch {
    languageCache.set(id, null);
    return null;
  }
}

export type ParseOutcome = {
  language: LanguageId;
  source: string;
  tree: Parser.Tree | null;
  rootNode: Parser.SyntaxNode | null;
  /** True when the grammar reported ERROR/MISSING nodes (partial parse). */
  hasError: boolean;
  /** Line ranges (1-based, inclusive) containing parse errors. */
  errorRanges: Array<{ startLine: number; endLine: number }>;
  failure: string | null;
};

const MAX_ERROR_RANGES = 25;

/** Parse source with a language. Never throws. */
export async function parseSource(language: LanguageId, source: string): Promise<ParseOutcome> {
  const empty: ParseOutcome = {
    language,
    source,
    tree: null,
    rootNode: null,
    hasError: false,
    errorRanges: [],
    failure: null,
  };
  try {
    const lang = await getLanguage(language);
    if (!lang) return { ...empty, failure: "grammar-unavailable" };
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(source);
    if (!tree) return { ...empty, failure: "parse-returned-null" };
    const rootNode = tree.rootNode;
    const errorRanges: ParseOutcome["errorRanges"] = [];
    if (rootNode.hasError) {
      const stack: Parser.SyntaxNode[] = [rootNode];
      while (stack.length && errorRanges.length < MAX_ERROR_RANGES) {
        const n = stack.pop()!;
        if (n.type === "ERROR" || n.isMissing) {
          errorRanges.push({ startLine: n.startPosition.row + 1, endLine: n.endPosition.row + 1 });
          continue;
        }
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c && (c.hasError || c.isMissing)) stack.push(c);
        }
      }
    }
    return { language, source, tree, rootNode, hasError: rootNode.hasError, errorRanges, failure: null };
  } catch (e) {
    return { ...empty, failure: e instanceof Error ? e.message : "parse-failed" };
  }
}

/** Map a file extension to a grammar. Returns "other" for unsupported files. */
export function languageForPath(filePath: string): LanguageId {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript";
  if (lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".py") || lower.endsWith(".pyi")) return "python";
  if (lower.endsWith(".go")) return "go";
  return "other";
}

/** Reset caches (tests only). */
export function resetParserCaches(): void {
  languageCache.clear();
}
