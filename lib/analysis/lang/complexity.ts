/* Per-symbol complexity metrics.
 *
 * Cyclomatic complexity is approximated as 1 + the number of decision points
 * inside a function body. This is a *static syntactic* measure: it counts
 * branches that exist in the source, not paths that were executed.
 */

import type Parser from "web-tree-sitter";
import type { LanguageId } from "@/lib/analysis/parsers/loader";

export type ComplexitySample = {
  startLine: number;
  endLine: number;
  /** 1 + decision points. 1 means a straight-line function. */
  cyclomatic: number;
  maxNesting: number;
  decisionPoints: number;
};

const DECISION_TYPES = new Set([
  // TypeScript / JavaScript
  "if_statement",
  "switch_case",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "catch_clause",
  "conditional_expression",
  "logical_expression",
  // Python
  "elif_clause",
  "boolean_operator",
  "except_clause",
  // Go
  "expression_switch_statement",
  "type_switch_statement",
  "select_statement",
  "case",
]);

const NESTING_TYPES = new Set([
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_statement",
  "switch_case",
  "expression_switch_statement",
  "type_switch_statement",
  "select_statement",
  "catch_clause",
  "try_statement",
  "case",
  "elif_clause",
  "else_clause",
]);

/** Function-like nodes that get their own complexity sample. */
const FUNCTION_CONTAINERS = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_expression",
  "arrow_function",
  "method_definition",
  "function_definition",
  "method_declaration",
]);

/** Nesting containers that are not measured themselves but do raise nesting. */
const CLASS_CONTAINERS = new Set(["class_declaration", "abstract_class_declaration", "class_definition"]);

const CONTAINER_TYPES = new Set([...FUNCTION_CONTAINERS, ...CLASS_CONTAINERS]);

export function computeComplexity(root: Parser.SyntaxNode, language: LanguageId): ComplexitySample[] {
  const samples: ComplexitySample[] = [];

  function measure(node: Parser.SyntaxNode): void {
    let decisions = 0;
    let maxNesting = 0;

    function visit(n: Parser.SyntaxNode, nesting: number): void {
      if (NESTING_TYPES.has(n.type)) {
        maxNesting = Math.max(maxNesting, nesting + 1);
      }
      if (DECISION_TYPES.has(n.type)) {
        decisions++;
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i);
        if (!c) continue;
        const isNestedContainer = CONTAINER_TYPES.has(c.type) && c !== node;
        visit(c, isNestedContainer ? nesting : NESTING_TYPES.has(n.type) ? nesting + 1 : nesting);
      }
    }

    // Only measure the container's own body: nested functions get their own sample.
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (!c) continue;
      if (CONTAINER_TYPES.has(c.type)) continue;
      visit(c, 0);
    }

    samples.push({
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      cyclomatic: 1 + decisions,
      maxNesting,
      decisionPoints: decisions,
    });
  }

  // Descend through every node so functions wrapped in `export_statement` or
  // `decorated_definition` are still reached.
  function walk(node: Parser.SyntaxNode): void {
    if (FUNCTION_CONTAINERS.has(node.type)) measure(node);
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) walk(c);
    }
  }

  walk(root);
  void language;
  return samples;
}

/** Attach complexity samples to symbols by enclosing line range. */
export function attachComplexity<T extends { path: string; startLine: number; endLine: number }>(
  symbols: T[],
  samplesByFile: Map<string, ComplexitySample[]>,
): Map<string, ComplexitySample> {
  const out = new Map<string, ComplexitySample>();
  for (const s of symbols) {
    const samples = samplesByFile.get(s.path);
    if (!samples) continue;
    // Prefer the tightest enclosing sample.
    let best: ComplexitySample | null = null;
    for (const c of samples) {
      if (c.startLine <= s.startLine && c.endLine >= s.endLine) {
        if (!best || c.endLine - c.startLine <= best.endLine - best.startLine) best = c;
      }
    }
    if (best) out.set(`${s.path}:${s.startLine}:${s.endLine}`, best);
  }
  return out;
}
