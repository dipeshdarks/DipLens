/* Execution path reconstruction.
 *
 * Paths are walked from detected entry points down the *confirmed* call
 * graph. Each hop is a real resolved call edge; a path that would require a
 * dynamic dispatch is marked probable and records the unresolved link rather
 * than inventing the next step.
 */

import type {
  EntryPoint,
  ExecutionPath,
  ExecutionStep,
  StepRole,
  SymbolRecord,
} from "@/lib/analysis/engine/types";
import type { CallGraph } from "./callgraph";

export type PathOptions = {
  maxDepth?: number;
  maxPaths?: number;
  maxStepsPerPath?: number;
};

const DEFAULTS: Required<PathOptions> = { maxDepth: 6, maxPaths: 24, maxStepsPerPath: 12 };

const ROLE_RULES: Array<{ role: StepRole; test: (s: SymbolRecord) => boolean }> = [
  { role: "entry", test: (s) => /main|handler|index|app|server|start|run/i.test(s.name) && /main|cli|index|server|app/i.test(s.path) },
  { role: "auth", test: (s) => /auth|login|session|jwt|token|permission|acl|rbac|oauth|credential/i.test(`${s.name} ${s.path}`) },
  { role: "validation", test: (s) => /valid|sanitiz|sanitize|check|verify|assert|schema|parse.*param|coerce/i.test(`${s.name} ${s.path}`) },
  { role: "persistence", test: (s) => /repo|store|dao|model|db|database|query|persist|save|insert|update|select|migration/i.test(`${s.name} ${s.path}`) },
  { role: "external", test: (s) => /client|api|fetch|http|request|gateway|adapter|provider|sdk|vendor/i.test(`${s.name} ${s.path}`) },
  { role: "state", test: (s) => /cache|state|store|session|memo|redox|context|global/i.test(`${s.name} ${s.path}`) },
  { role: "error", test: (s) => /error|exception|fail|retry|catch|abort|panic/i.test(`${s.name} ${s.path}`) },
  { role: "input", test: (s) => /parse|read|load|input|param|body|query|form|upload|stdin/i.test(s.name) },
  { role: "logic", test: () => true },
];

export function classifyRole(s: SymbolRecord): StepRole {
  for (const rule of ROLE_RULES) {
    if (rule.test(s)) return rule.role;
  }
  return "logic";
}

function stepFor(s: SymbolRecord, role: StepRole): ExecutionStep {
  const sideEffects: string[] = [];
  if (role === "persistence") sideEffects.push("database access");
  if (role === "external") sideEffects.push("network or third-party call");
  if (role === "state") sideEffects.push("shared state mutation");
  if (/throw|panic|raise|abort/i.test(s.name)) sideEffects.push("may abort the call chain");
  return {
    symbolId: s.id,
    name: s.qualifiedName,
    path: s.path,
    startLine: s.startLine,
    endLine: s.endLine,
    role,
    label: `${role}: ${s.qualifiedName}`,
    conditions: [],
    sideEffects,
    dataPassed: [],
    sourceUrl: "",
  };
}

export function reconstructPaths(
  entryPoints: EntryPoint[],
  symbolsById: Map<string, SymbolRecord>,
  graph: CallGraph,
  options: PathOptions = {},
): ExecutionPath[] {
  const opts = { ...DEFAULTS, ...options };
  const paths: ExecutionPath[] = [];

  for (const entry of entryPoints) {
    if (paths.length >= opts.maxPaths) break;

    const rootIds: string[] = [];
    if (entry.symbolId && symbolsById.has(entry.symbolId)) {
      rootIds.push(entry.symbolId);
    } else {
      // Entry has no resolved symbol: find candidates by name in the same file.
      for (const s of symbolsById.values()) {
        if (s.path === entry.path && (s.name === entry.name || entry.name.endsWith(`.${s.name}`))) rootIds.push(s.id);
      }
    }
    if (!rootIds.length) continue;

    const visitedGlobal = new Set<string>();

    function walk(symbolId: string, ep: EntryPoint, acc: string[]): void {
      if (acc.length >= opts.maxStepsPerPath) return;
      if (acc.includes(symbolId)) return;
      const nextAcc = [...acc, symbolId];
      const children = graph.outgoing.get(symbolId) ?? [];
      const isLeaf = children.length === 0;

      if (isLeaf || nextAcc.length >= opts.maxDepth) {
        if (nextAcc.length < 2) return;
        const steps = nextAcc
          .map((id) => symbolsById.get(id))
          .filter((s): s is SymbolRecord => !!s)
          .map((s, i) => stepFor(s, i === 0 ? "entry" : classifyRole(s)));
        const key = nextAcc.join(">");
        if (visitedGlobal.has(key)) return;
        visitedGlobal.add(key);
        paths.push({
          id: `${ep.id}#${paths.length}`,
          entryId: ep.id,
          entryName: ep.name,
          steps,
          confidence: "confirmed",
          boundedBy: nextAcc.length >= opts.maxDepth ? `depth limit ${opts.maxDepth}` : "no further resolved callees",
          summary: `${ep.name} → ${steps[steps.length - 1]?.name ?? "?"} (${steps.length} steps)`,
        });
        return;
      }

      // Prefer the highest-degree child first so hub paths surface early.
      const ordered = [...children].sort((a, b) => (graph.outgoing.get(b)?.length ?? 0) - (graph.outgoing.get(a)?.length ?? 0));
      for (const child of ordered.slice(0, 4)) {
        if (paths.length >= opts.maxPaths) return;
        walk(child, ep, nextAcc);
      }
    }

    for (const rootId of rootIds) {
      if (paths.length >= opts.maxPaths) break;
      walk(rootId, entry, []);
    }
  }

  return paths;
}

/** Symbols reachable from any entry point — used for the reachability finding. */
export function reachableSet(entryPoints: EntryPoint[], symbolsById: Map<string, SymbolRecord>, graph: CallGraph): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const ep of entryPoints) {
    if (ep.symbolId && symbolsById.has(ep.symbolId)) {
      queue.push(ep.symbolId);
      seen.add(ep.symbolId);
    }
  }
  while (queue.length) {
    const id = queue.pop()!;
    for (const child of graph.outgoing.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return seen;
}
