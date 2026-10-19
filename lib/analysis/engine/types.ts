/* Core types for the Diplens deep forensic engine.
 *
 * Everything here is produced from static analysis of retrieved source at one
 * pinned commit SHA. Nothing is fabricated: unresolved work is represented as
 * unresolved, unavailable data as unavailable.
 */

import type { Confidence, Evidence, FindingCategory, Severity } from "@/types/analysis";

/* ---------- revision pinning ---------- */

export type Snapshot = {
  owner: string;
  repo: string;
  /** Branch, tag or SHA the user selected. */
  ref: string;
  /** Immutable commit the whole analysis is pinned to. Null if unresolvable. */
  sha: string | null;
  /** Stable identity for cache keys: owner/repo@sha#engineVersion */
  snapshotId: string;
  analyzedAt: string;
};

export type EngineVersions = {
  engine: string;
  ruleset: string;
  analyzers: Array<{ language: string; analyzer: string; version: string }>;
};

/* ---------- stages ---------- */

export type StageStatusValue = "complete" | "partial" | "unavailable" | "failed" | "skipped";

export type StageRecord = {
  id: string;
  name: string;
  status: StageStatusValue;
  durationMs: number;
  inspected: number;
  total?: number;
  warnings: string[];
  error?: string;
  stats: Record<string, number | string | boolean>;
};

/* ---------- symbols ---------- */

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "constant"
  | "field"
  | "module"
  | "test"
  | "route"
  | "other";

export type Visibility = "public" | "private" | "protected" | "internal" | "unknown";

export type SymbolRecord = {
  /** Stable across runs: `${path}::${qualifiedName}::${startLine}` */
  id: string;
  kind: SymbolKind;
  name: string;
  /** Dot-separated nesting path inside the file, e.g. `UserService.login`. */
  qualifiedName: string;
  path: string;
  startLine: number;
  endLine: number;
  signature: string | null;
  visibility: Visibility;
  exported: boolean;
  parentId: string | null;
  language: string;
  parseStatus: "ok" | "partial";
  /** Number of parameters — cheap complexity hint. */
  paramCount?: number;
};

export type ReferenceResolution = "resolved" | "unresolved" | "ambiguous";

export type ReferenceRecord = {
  path: string;
  line: number;
  /** The callee as written in source, including any receiver: `this.db.query`. */
  name: string;
  use: "call" | "read" | "write" | "type" | "new" | "inherit";
  symbolId: string | null;
  resolution: ReferenceResolution;
  unresolvedReason?: string;
};

export type ImportSpecifier = { local: string; imported: string; kind: "named" | "default" | "namespace" | "type" };

export type ImportRecord = {
  path: string;
  line: number;
  source: string;
  specifiers: ImportSpecifier[];
  /** Repo-relative path of the resolved module, null when external or unresolvable. */
  resolvedPath: string | null;
  resolution: ReferenceResolution;
  unresolvedReason?: string;
};

/* ---------- evidence graph ---------- */

export type EdgeKind =
  | "imports"
  | "calls"
  | "references"
  | "implements"
  | "extends"
  | "defines"
  | "reads"
  | "writes"
  | "tests"
  | "configures"
  | "depends on";

export type GraphEdge = {
  kind: EdgeKind;
  from: string;
  to: string;
  path: string;
  line: number;
  /** "confirmed" = resolved from syntax/scope; "approximate" = pattern-based. */
  confidence: "confirmed" | "approximate";
  note?: string;
};

export type GraphNode = {
  id: string;
  label: string;
  kind: "symbol" | "file" | "module" | "external";
  path?: string;
};

/* ---------- entry points ---------- */

export type EntryPointKind =
  | "http-route"
  | "api-handler"
  | "cli"
  | "main"
  | "framework-lifecycle"
  | "event-handler"
  | "queue-consumer"
  | "scheduler"
  | "webhook"
  | "ui-handler";

export type EntryPoint = {
  id: string;
  kind: EntryPointKind;
  name: string;
  path: string;
  startLine: number;
  endLine: number;
  symbolId: string | null;
  framework: string | null;
  basis: string;
};

/* ---------- execution paths ---------- */

export type StepRole =
  | "entry"
  | "input"
  | "validation"
  | "auth"
  | "logic"
  | "state"
  | "external"
  | "persistence"
  | "error"
  | "return";

export type ExecutionStep = {
  symbolId: string | null;
  name: string;
  path: string;
  startLine: number;
  endLine: number;
  role: StepRole;
  label: string;
  conditions: string[];
  sideEffects: string[];
  dataPassed: string[];
  sourceUrl: string;
};

export type ExecutionPath = {
  id: string;
  entryId: string;
  entryName: string;
  steps: ExecutionStep[];
  /** "confirmed" = every hop resolved from syntax; "probable" = at least one unresolved link. */
  confidence: "confirmed" | "probable";
  unresolvedLink?: string;
  boundedBy: string;
  summary: string;
};

/* ---------- data flow / taint ---------- */

export type TaintCategory =
  | "sql"
  | "shell"
  | "path"
  | "code-eval"
  | "xss"
  | "redirect"
  | "ssrf"
  | "deserialization"
  | "log"
  | "auth-decision"
  | "template";

export type TaintSource = {
  id: string;
  kind: string;
  path: string;
  line: number;
  expression: string;
  trust: "untrusted" | "environment" | "mixed";
};

export type TaintSink = {
  id: string;
  category: TaintCategory;
  api: string;
  path: string;
  line: number;
  expression: string;
};

export type TaintHop = {
  symbolId: string | null;
  name: string;
  path: string;
  line: number;
  transform: string;
};

export type TaintPath = {
  id: string;
  source: TaintSource;
  sink: TaintSink;
  hops: TaintHop[];
  sanitizers: Array<{ name: string; path: string; line: number }>;
  missingValidation: string[];
  preconditions: string[];
  confidence: Confidence;
  /** Static analysis produces candidates, never confirmed exploits. */
  status: "candidate";
  remediation: string;
  falsePositiveCaveats: string;
};

export type StateSlot = {
  id: string;
  path: string;
  name: string;
  declarationLine: number;
  writers: Array<{ path: string; line: number; symbolId: string | null }>;
  readers: Array<{ path: string; line: number; symbolId: string | null }>;
  synchronized: boolean | null;
  scope: "module" | "file" | "class";
};

/* ---------- defects ---------- */

export type DefectClass =
  | "logic"
  | "error-handling"
  | "async"
  | "resource"
  | "contract";

export type DefectFinding = {
  id: string;
  category: FindingCategory;
  defectClass: DefectClass;
  title: string;
  severity: Severity;
  confidence: Confidence;
  /** Evidence status per the report schema. */
  evidenceStatus: "confirmed" | "high-confidence" | "needs-verification" | "informational";
  impact: string;
  mechanism: string;
  triggerConditions: string[];
  reachability: string;
  evidence: Evidence[];
  affectedSymbols: string[];
  mitigations: string[];
  remediation: string;
  verificationPlan: string;
  method: string;
  falsePositiveCaveats: string;
  relatedIds: string[];
  status: "verified" | "heuristic";
};

/* ---------- subsystems ---------- */

export type Subsystem = {
  id: string;
  name: string;
  purpose: string;
  paths: string[];
  entrySymbols: string[];
  dependsOn: string[];
  dependedOnBy: string[];
  sideEffects: string[];
  stateOwnership: string;
  errorBehavior: string;
  tests: string[];
  risks: string[];
  evidenceStatus: "confirmed" | "high-confidence" | "needs-verification" | "informational";
};

/* ---------- correlations ---------- */

export type RelationKind =
  | "caused by"
  | "contributes to"
  | "exposes"
  | "amplifies"
  | "mitigated by"
  | "covered by test"
  | "related to";

export type Correlation = {
  id: string;
  subject: string;
  relation: RelationKind;
  target: string;
  observations: string[];
  reasoning: string;
  uncertainty: string;
};

/* ---------- remediation ---------- */

export type RemediationItem = {
  rank: number;
  title: string;
  horizon: "immediate" | "short-term" | "long-term";
  findings: string[];
  rationale: string;
  effort: "low" | "medium" | "high";
};

/* ---------- configuration map ---------- */

export type ConfigValue = {
  name: string;
  declaredAt: Array<{ path: string; line: number; kind: string }>;
  readAt: Array<{ path: string; line: number; expression: string }>;
  transformedBy: Array<{ path: string; line: number; how: string }>;
  default: string | null;
  required: boolean | null;
  status: "mapped" | "declared-only" | "read-only" | "unresolved";
  note?: string;
};

/* ---------- tests ---------- */

export type TestLink = {
  testSymbolId: string;
  testPath: string;
  targetSymbolId: string | null;
  targetPath: string | null;
  basis: "import" | "naming" | "description";
  confidence: Confidence;
};

export type CoverageGap = {
  targetSymbolId: string;
  targetName: string;
  path: string;
  startLine: number;
  why: string;
  suggestedTest: { setup: string; input: string; expected: string; failureCase: string };
};
