/* Extraction types and shared helpers for the tree-sitter based front end. */

import type Parser from "web-tree-sitter";
import type { LanguageId } from "@/lib/analysis/parsers/loader";
import type { EntryPoint, ImportSpecifier, SymbolKind, Visibility } from "@/lib/analysis/engine/types";

export type RawSymbol = {
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
  signature: string | null;
  visibility: Visibility;
  exported: boolean;
  parentName: string | null;
  paramCount?: number;
  language: LanguageId;
  parseStatus: "ok" | "partial";
};

export type RawCall = {
  line: number;
  name: string;
  isConstructor: boolean;
  isAwaited: boolean;
  receiver: string | null;
  calleeText: string;
};

export type RawImport = {
  line: number;
  source: string;
  specifiers: ImportSpecifier[];
  isReExport: boolean;
};

export type RawRead = { line: number; name: string };

export type ExtractedFile = {
  path: string;
  language: LanguageId;
  parseStatus: "ok" | "partial";
  errorRanges: Array<{ startLine: number; endLine: number }>;
  symbols: RawSymbol[];
  imports: RawImport[];
  calls: RawCall[];
  reads: RawRead[];
  entryPoints: EntryPoint[];
  notes: string[];
};

export function lineOf(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

export function endLineOf(node: Parser.SyntaxNode): number {
  return node.endPosition.row + 1;
}

export function nodeText(node: Parser.SyntaxNode): string {
  return node.text ?? "";
}

/** First line of a node's source, collapsed for signatures. */
export function firstLineText(node: Parser.SyntaxNode, max = 200): string {
  const raw = nodeText(node);
  const first = raw.split(/\r?\n/, 1)[0] ?? "";
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

export function namedChildOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && c.type === type) return c;
  }
  return null;
}

export function childrenOfType(node: Parser.SyntaxNode, ...types: string[]): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && types.includes(c.type)) out.push(c);
  }
  return out;
}

export function allChildren(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) out.push(c);
  }
  return out;
}

export function hasAnonChild(node: Parser.SyntaxNode, type: string): boolean {
  return allChildren(node).some((c) => !c.isNamed && c.type === type);
}

/** True when the node (or an ancestor within `ancestorDepth`) sits under an export statement. */
export function isUnderExport(node: Parser.SyntaxNode, ancestorDepth = 1): boolean {
  let cur: Parser.SyntaxNode | null = node.parent;
  let depth = 0;
  while (cur && depth <= ancestorDepth) {
    if (cur.type === "export_statement") return true;
    cur = cur.parent;
    depth++;
  }
  return false;
}

/** Extract the visibility modifier text on a member, if any. */
export function visibilityOf(node: Parser.SyntaxNode): Visibility {
  const c = childrenOfType(node, "accessibility_modifier")[0];
  if (!c) return "public";
  const t = nodeText(c).trim();
  if (t === "private") return "private";
  if (t === "protected") return "protected";
  if (t === "public") return "public";
  return "unknown";
}

/** SCREAMING_SNAKE heuristic for constants. */
export function isConstantName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name) && name.length > 1;
}

export function makeEntry(
  kind: EntryPoint["kind"],
  name: string,
  path: string,
  node: Parser.SyntaxNode,
  basis: string,
  framework: string | null = null,
  symbolId: string | null = null,
): EntryPoint {
  return {
    id: `${path}::${kind}::${name}::${lineOf(node)}`,
    kind,
    name,
    path,
    startLine: lineOf(node),
    endLine: endLineOf(node),
    symbolId,
    framework,
    basis,
  };
}

export function emptyExtracted(path: string, language: LanguageId, parseStatus: "ok" | "partial" | "unparsed"): ExtractedFile {
  return {
    path,
    language,
    parseStatus: parseStatus === "unparsed" ? "partial" : parseStatus,
    errorRanges: [],
    symbols: [],
    imports: [],
    calls: [],
    reads: [],
    entryPoints: [],
    notes: parseStatus === "unparsed" ? ["not-parsed"] : [],
  };
}
