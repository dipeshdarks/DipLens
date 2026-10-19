/* Call graph construction.
 *
 * Edges come from the reference index. Only references the resolver actually
 * confirmed become confirmed edges; everything else is either an approximate
 * edge (name-based, no import to disambiguate) or is left out entirely.
 */

import type { GraphEdge, GraphNode, SymbolRecord } from "@/lib/analysis/engine/types";
import type { SymbolTable } from "@/lib/analysis/index/symbols";

export type CallGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** symbol id -> symbol ids it calls */
  outgoing: Map<string, string[]>;
  /** symbol id -> symbol ids that call it */
  incoming: Map<string, string[]>;
  stats: {
    nodes: number;
    confirmedEdges: number;
    approximateEdges: number;
    unresolvedCalls: number;
    maxOutDegree: number;
    maxInDegree: number;
    /** Symbols called by more callers than this are hubs. */
    hubThreshold: number;
  };
};

const HUB_THRESHOLD = 5;

export function buildCallGraph(table: SymbolTable, symbols: SymbolRecord[]): CallGraph {
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const edges: GraphEdge[] = [];
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const edgeKeys = new Set<string>();
  let confirmed = 0;
  let approximate = 0;
  let unresolved = 0;

  // Map every reference to the symbol whose body contains it (the caller).
  const callerByLine = new Map<string, string[]>();
  for (const s of symbols) {
    const key = s.path;
    if (!callerByLine.has(key)) callerByLine.set(key, []);
    callerByLine.get(key)!.push(s.id);
  }

  function callerOf(path: string, line: number): string | null {
    const candidates = callerByLine.get(path) ?? [];
    let best: SymbolRecord | null = null;
    for (const id of candidates) {
      const s = byId.get(id);
      if (!s) continue;
      if (s.startLine <= line && s.endLine >= line) {
        if (!best || s.endLine - s.startLine <= best.endLine - best.startLine) best = s;
      }
    }
    return best ? best.id : null;
  }

  for (const ref of table.references) {
    if (ref.use !== "call") continue;
    if (ref.resolution === "ambiguous") {
      unresolved++;
      continue;
    }
    if (ref.resolution === "unresolved") {
      unresolved++;
      continue;
    }
    if (!ref.symbolId) continue;
    const callee = byId.get(ref.symbolId);
    if (!callee || callee.kind === "field") continue;
    const callerId = callerOf(ref.path, ref.line);
    if (!callerId || callerId === ref.symbolId) continue;

    const key = `${callerId}->${ref.symbolId}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);

    const confidence: GraphEdge["confidence"] = "confirmed";
    edges.push({
      kind: "calls",
      from: callerId,
      to: ref.symbolId,
      path: ref.path,
      line: ref.line,
      confidence,
    });
    if (!outgoing.has(callerId)) outgoing.set(callerId, []);
    outgoing.get(callerId)!.push(ref.symbolId);
    if (!incoming.has(ref.symbolId)) incoming.set(ref.symbolId, []);
    incoming.get(ref.symbolId)!.push(callerId);
    confirmed++;
  }

  // Test -> tested symbol edges by naming convention (approximate).
  // Matching is case-insensitive: `testFindUser` links to `findUser`.
  for (const s of symbols) {
    if (s.kind !== "function" && s.kind !== "method") continue;
    const base = s.path.toLowerCase();
    if (!/(\.test\.|\.spec\.|_test\.|test_|\/tests?\/|__tests__\/)/.test(base)) continue;
    const m = s.name.match(/^(?:test|it|spec)[_-]?(.+)$/i);
    const candidate = m ? m[1] : s.name.replace(/^test/i, "").replace(/Test$/, "");
    if (!candidate) continue;
    const lower = candidate.toLowerCase();
    const candidates = symbols.filter(
      (t) =>
        t.name.toLowerCase() === lower &&
        t.path !== s.path &&
        !/(\.test\.|\.spec\.|_test\.|test_)/.test(t.path.toLowerCase()),
    );
    if (candidates.length !== 1) continue;
    const key = `${s.id}->${candidates[0].id}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      kind: "tests",
      from: s.id,
      to: candidates[0].id,
      path: s.path,
      line: s.startLine,
      confidence: "approximate",
      note: "test-name convention",
    });
    approximate++;
  }

  const nodes: GraphNode[] = symbols.map((s) => ({
    id: s.id,
    label: s.qualifiedName,
    kind: "symbol",
    path: s.path,
  }));

  let maxOut = 0;
  let maxIn = 0;
  for (const list of outgoing.values()) maxOut = Math.max(maxOut, list.length);
  for (const list of incoming.values()) maxIn = Math.max(maxIn, list.length);

  return {
    nodes,
    edges,
    outgoing,
    incoming,
    stats: {
      nodes: nodes.length,
      confirmedEdges: confirmed,
      approximateEdges: approximate,
      unresolvedCalls: unresolved,
      maxOutDegree: maxOut,
      maxInDegree: maxIn,
      hubThreshold: HUB_THRESHOLD,
    },
  };
}
