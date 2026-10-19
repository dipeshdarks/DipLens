/* Defect detectors (Stage 6).
 *
 * Each detector matches a *specific, named* defect pattern in the AST. Nothing
 * here guesses at behaviour: every finding quotes the source line it matched,
 * states the exact pattern that fired, and carries a verification plan. Where
 * a pattern can be intentional, confidence drops to "medium"/"low" and the
 * falsePositiveCaveats say what to check.
 *
 * Classes follow engine/types.ts: logic | error-handling | async | resource | contract.
 */

import type Parser from "web-tree-sitter";
import type { DefectFinding, SymbolRecord } from "@/lib/analysis/engine/types";
import type { LanguageId } from "@/lib/analysis/parsers/loader";
import type { Confidence, Evidence, FindingCategory, Severity } from "@/types/analysis";

type DetectorInput = {
  path: string;
  language: LanguageId;
  rootNode: Parser.SyntaxNode;
  source: string;
  symbols: SymbolRecord[];
};

type Draft = {
  key: string;
  defectClass: DefectFinding["defectClass"];
  title: string;
  severity: Severity;
  confidence: Confidence;
  evidenceStatus: DefectFinding["evidenceStatus"];
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
  status: DefectFinding["status"];
  category?: FindingCategory;
};

const COMMENT_TYPES = new Set(["comment", "line_comment", "block_comment"]);

function lineOf(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

function excerptOf(source: string, startLine: number, endLine: number, max = 400): string {
  const lines = source.split(/\r?\n/);
  const from = Math.max(0, startLine - 1);
  const to = Math.min(lines.length, Math.max(startLine, endLine));
  const text = lines.slice(from, to).join("\n").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function walk(node: Parser.SyntaxNode, visit: (n: Parser.SyntaxNode) => void): void {
  visit(node);
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}

function operatorOf(node: Parser.SyntaxNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && !c.isNamed) return c.text ?? "";
  }
  return "";
}

function textOf(node: Parser.SyntaxNode | null): string {
  return node?.text ?? "";
}

/**
 * Is this a coroutine?
 *
 * Grammar versions differ: some expose `async_function_definition`, others fold
 * `async` into an anonymous keyword child of `function_definition`. Both shapes
 * are accepted so the detector does not silently depend on which was bundled.
 */
function hasAsyncKeyword(node: Parser.SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && !c.isNamed && c.text === "async") return true;
  }
  return false;
}

/** Nearest ancestor of a given type, stopping at the function boundary. */
function ancestorOfType(node: Parser.SyntaxNode, types: Set<string>): Parser.SyntaxNode | null {
  let cur: Parser.SyntaxNode | null = node.parent;
  while (cur) {
    if (types.has(cur.type)) return cur;
    cur = cur.parent;
  }
  return null;
}

function dottedOf(node: Parser.SyntaxNode | null, depth = 0): string {
  if (!node || depth > 8) return "";
  const t = node.text ?? "";
  if (node.type === "identifier" || node.type === "property_identifier" || node.type === "field_identifier") return t;
  if (node.type === "member_expression" || node.type === "selector_expression") {
    const o = dottedOf(node.childForFieldName("object") ?? node.namedChild(0), depth + 1);
    const p = node.childForFieldName("property") ?? node.namedChild(node.namedChildCount - 1);
    return o ? `${o}.${p?.text ?? ""}` : (p?.text ?? "");
  }
  if (node.type === "call_expression" || node.type === "call") {
    return dottedOf(node.childForFieldName("function") ?? node.namedChild(0), depth + 1);
  }
  return t;
}

function enclosingSymbol(path: string, symbols: SymbolRecord[], line: number): string | null {
  const inFile = symbols.filter((s) => s.path === path && s.startLine <= line);
  if (!inFile.length) return null;
  const innermost = inFile.reduce((a, b) => (b.startLine > a.startLine ? b : a));
  return innermost.id;
}

/* ------------------------------------------------------------------ */
/* Detector scaffolding                                                */
/* ------------------------------------------------------------------ */

function emit(input: DetectorInput, drafts: Draft[]): DefectFinding[] {
  const seen = new Set<string>();
  const out: DefectFinding[] = [];
  for (const d of drafts) {
    if (seen.has(d.key)) continue;
    seen.add(d.key);
    out.push({
      id: `defect::${input.path}::${d.defectClass}::${d.key}`,
      category: d.category ?? "code-quality",
      defectClass: d.defectClass,
      title: d.title,
      severity: d.severity,
      confidence: d.confidence,
      evidenceStatus: d.evidenceStatus,
      impact: d.impact,
      mechanism: d.mechanism,
      triggerConditions: d.triggerConditions,
      reachability: d.reachability,
      evidence: d.evidence,
      affectedSymbols: d.affectedSymbols,
      mitigations: d.mitigations,
      remediation: d.remediation,
      verificationPlan: d.verificationPlan,
      method: d.method,
      falsePositiveCaveats: d.falsePositiveCaveats,
      relatedIds: [],
      status: d.status,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* async                                                               */
/* ------------------------------------------------------------------ */

const JS_BLOCKING_CALL = /(^|\.)(sleep|sleepSync|setTimeoutSync)\s*\(/;
const PY_BLOCKING_CALLS = [
  /^time\.sleep$/,
  /^requests\.(get|post|put|patch|delete|head|options|request)$/,
  /^urllib\.request\.(urlopen|Request)$/,
  /^subprocess\.(run|call|check_output|check_call|Popen)$/,
  /^os\.system$/,
  /^input$/,
];

function detectAsyncJs(input: DetectorInput): Draft[] {
  const drafts: Draft[] = [];
  if (input.language === "python") return drafts;

  walk(input.rootNode, (n) => {
    if (n.type !== "call_expression") return;
    const callee = n.childForFieldName("function") ?? n.namedChild(0);
    if (callee?.type !== "member_expression") return;
    const prop = callee.childForFieldName("property") ?? callee.namedChild(callee.namedChildCount - 1);
    if (prop?.text !== "then") return;

    // Scope the check to the owning statement so `.then(a).then(b)` counts once
    // and so `return x.then(f)` / `await x.then(f)` are correctly excluded.
    const OWNERS = new Set([
      "expression_statement",
      "variable_declarator",
      "return_statement",
      "public_field_definition",
      "lexical_declaration",
      "variable_declaration",
      "pair",
    ]);
    let stmt: Parser.SyntaxNode = n;
    while (stmt.parent && !OWNERS.has(stmt.parent.type)) stmt = stmt.parent;
    const owner: Parser.SyntaxNode = stmt.parent && OWNERS.has(stmt.parent.type) ? stmt.parent : stmt;
    const scopeText = owner.text ?? "";
    const line = lineOf(owner);

    if (owner.type === "return_statement") return;
    if (ancestorOfType(n, new Set(["await"]))) return;
    if (/\.\s*(catch|finally)\s*\(/.test(scopeText)) return;
    if (JS_BLOCKING_CALL.test(scopeText)) return;
    if (owner.type === "variable_declarator") {
      const nameNode = owner.childForFieldName("name") ?? owner.namedChild(0);
      const name = nameNode?.text;
      if (name) {
        const later = new RegExp(`(^|[^A-Za-z0-9_$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\.\\s*(catch|finally)\\s*\\(`);
        if (later.test(input.source)) return;
      }
    }
    const scope = owner;

    drafts.push({
      key: `then-no-catch:${line}`,
      defectClass: "async",
      title: "Promise chain has no rejection handler",
      severity: "medium",
      confidence: "medium",
      evidenceStatus: "needs-verification",
      impact: "A rejection in this chain becomes an unhandled promise rejection: the failure is logged (or silently dropped) instead of reaching the caller's error path, and work downstream of it never runs.",
      mechanism: "`then()` handles fulfilment only. Without `catch()`/`finally()` on the same chain, the rejection has no handler at this site.",
      triggerConditions: ["The promise returned by this chain rejects (network failure, thrown error in a fulfilment handler, validation failure)."],
      reachability: "Requires the chained operation to reject; the code path itself runs on every execution of the enclosing function.",
      evidence: [{ path: input.path, startLine: line, endLine: owner.endPosition.row + 1, excerpt: excerptOf(input.source, line, owner.endPosition.row + 1, 300) }],
      affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
      mitigations: ["An outer handler may exist if this chain is returned to a caller that attaches one."],
      remediation: "Attach `.catch()` (or `try/catch` around `await`) on the chain, or return the promise so the caller handles rejection.",
      verificationPlan: "Force the underlying operation to fail (stop the dependency, feed invalid input) and confirm the error reaches the caller instead of surfacing as an unhandled rejection.",
      method: "AST: call_expression whose callee property is `then`, scoped to the enclosing statement, with no `.catch`/`.finally` in that statement and no `return`/`await` on the path.",
      falsePositiveCaveats: "If the chain is assigned and `.catch()` is attached in a later statement on the same identifier, this is a false positive — the detector greps for that, but aliasing (`const q = p.then(f); q.catch(g)`) only resolves when the name is reused literally.",
      status: "heuristic",
    });
  });

  void JS_BLOCKING_CALL;
  return drafts;
}

function detectAsyncPython(input: DetectorInput): Draft[] {
  const drafts: Draft[] = [];
  walk(input.rootNode, (n) => {
    const isAsync = n.type === "async_function_definition" || hasAsyncKeyword(n);
    if (!isAsync) return;
    const fnName =
      n.childForFieldName("name")?.text ??
      n.namedChildren.find((c) => c.type === "identifier")?.text ??
      "<anonymous>";
    const startLine = lineOf(n);

    walk(n, (c) => {
      if (c.type !== "call") return;
      const target = dottedOf(c.childForFieldName("function") ?? c.namedChild(0));
      if (!target || !PY_BLOCKING_CALLS.some((re) => re.test(target))) return;
      // `await time.sleep(...)` would still be blocking, but at least the author
      // knew; only flag the *un-awaited* form, which blocks the event loop.
      if (ancestorOfType(c, new Set(["await"]))) return;
      const line = lineOf(c);
      drafts.push({
        key: `blocking-in-async:${line}`,
        defectClass: "async",
        title: `Blocking call \`${target}\` inside \`async def ${fnName}\``,
        severity: "medium",
        confidence: "high",
        evidenceStatus: "confirmed",
        impact: "The call blocks the event loop for its whole duration, stalling every other coroutine sharing it — request timeouts, heartbeats and scheduled work all stall together.",
        mechanism: "A synchronous blocking API is invoked from a coroutine without `await`, so control does not return to the event loop until it completes.",
        triggerConditions: ["Any concurrent request or scheduled task sharing the same event loop while this coroutine runs."],
        reachability: `Runs whenever \`async def ${fnName}\` is executed.`,
        evidence: [{ path: input.path, startLine: line, endLine: c.endPosition.row + 1, excerpt: excerptOf(input.source, line, c.endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, startLine)].filter((x): x is string => !!x),
        mitigations: ["Run it in a worker thread (`asyncio.to_thread`) if a synchronous implementation must be kept."],
        remediation: `Replace with the async equivalent, or offload to \`asyncio.to_thread(${target})\`.`,
        verificationPlan: "Start a concurrent slow request, then call this coroutine; measure whether the concurrent request stalls for the duration of the blocking call.",
        method: "AST: `async_function_definition` containing a `call` matching a known blocking API with no `await` ancestor.",
        falsePositiveCaveats: "If the coroutine runs on a dedicated single-use loop where nothing else is scheduled, the stall is invisible. The list of blocking APIs is fixed and conservative; a project-specific wrapper around them will not be matched.",
        status: "verified",
      });
    });
  });
  return drafts;
}

/* ------------------------------------------------------------------ */
/* error-handling                                                      */
/* ------------------------------------------------------------------ */

function detectErrorHandling(input: DetectorInput): Draft[] {
  const drafts: Draft[] = [];

  walk(input.rootNode, (n) => {
    if (n.type === "catch_clause") {
      const body = n.childForFieldName("body") ?? n.namedChildren[n.namedChildCount - 1];
      if (!body) return;
      const meaningful = [];
      for (let i = 0; i < body.namedChildCount; i++) {
        const c = body.namedChild(i);
        if (!c) continue;
        if (COMMENT_TYPES.has(c.type)) continue;
        meaningful.push(c);
      }
      if (meaningful.length > 0) return;
      const line = lineOf(n);
      drafts.push({
        key: `empty-catch:${line}`,
        defectClass: "error-handling",
        title: "Exception handler body is empty",
        severity: "medium",
        confidence: "high",
        evidenceStatus: "confirmed",
        impact: "The failure disappears: no log, no rethrow, no fallback. Downstream code continues as though the operation succeeded, so the real error surfaces later somewhere unrelated.",
        mechanism: "A `catch` clause with no statements (comments excluded) discards the exception object entirely.",
        triggerConditions: ["Any throw from the guarded block."],
        reachability: "Runs on every throw from the try block.",
        evidence: [{ path: input.path, startLine: line, endLine: n.endPosition.row + 1, excerpt: excerptOf(input.source, line, n.endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
        mitigations: ["The failure may also be observable through a side effect elsewhere (state flag, metrics)."],
        remediation: "Log the error with context, rethrow it, or apply an explicit fallback that acknowledges the failure.",
        verificationPlan: "Throw from the try block and confirm no log entry, no state change and no propagated error occurs — that confirms the swallow.",
        method: "AST: `catch_clause` whose body contains no named children other than comments.",
        falsePositiveCaveats: "Intentional 'ignore this error' blocks exist (cleanup paths). They are still worth confirming: an empty body cannot distinguish deliberate silence from a forgotten handler.",
        status: "verified",
      });
    }

    if (n.type === "except_clause") {
      const body = n.childForFieldName("body") ?? n.namedChildren[n.namedChildCount - 1];
      if (!body) return;
      const stmts: Parser.SyntaxNode[] = [];
      for (let i = 0; i < body.namedChildCount; i++) {
        const c = body.namedChild(i);
        if (!c || COMMENT_TYPES.has(c.type)) continue;
        stmts.push(c);
      }
      if (!stmts.length) return;
      const SWALLOW = new Set(["pass", "continue", "break", "pass_statement", "continue_statement", "break_statement"]);
      const onlySwallow = stmts.every((s) => SWALLOW.has(s.type));
      if (!onlySwallow) return;
      const typeNode = n.namedChildren.find((c) => c.type !== "block" && c.type !== "body");
      const bare = !typeNode;
      const line = lineOf(n);
      const bodyLabel = stmts.map((s) => s.type.replace(/_statement$/, "")).join(", ");
      drafts.push({
        key: `swallowed-exception:${line}`,
        defectClass: "error-handling",
        title: bare ? "Bare except swallows every exception" : `Exception handled by discarding it (\`${bodyLabel}\` only)`,
        severity: bare ? "high" : "medium",
        confidence: "high",
        evidenceStatus: "confirmed",
        impact: bare
          ? "A bare `except:` also catches `KeyboardInterrupt`, `SystemExit` and `MemoryError`, so shutdown and out-of-memory conditions are silently discarded."
          : "The failure produces no log and no propagated error; execution continues as if the operation succeeded.",
        mechanism: `The handler body contains only \`${bodyLabel}\`, which discards the exception object.`,
        triggerConditions: ["Any exception raised in the guarded block."],
        reachability: "Runs on every raise from the try block.",
        evidence: [{ path: input.path, startLine: line, endLine: n.endPosition.row + 1, excerpt: excerptOf(input.source, line, n.endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
        mitigations: ["Narrowing the exception type in a later refactor would reduce the blast radius."],
        remediation: "Catch the specific exception types, log with context, and either rehandle or re-raise.",
        verificationPlan: "Raise each expected exception type inside the try block and confirm a log record or propagated error appears.",
        method: "AST: `except_clause` whose body statements are all pass/continue/break.",
        falsePositiveCaveats: "A bare except that only calls `continue` in a retry loop can be deliberate — confirm the loop actually retries rather than giving up.",
        status: "verified",
      });
    }
  });

  // Go: result of an error-returning API discarded as a bare statement.
  if (input.language === "go") {
    const GO_UNCHECKED_METHODS = new Set(["Close", "Sync", "Flush", "Truncate", "Chmod", "Chown", "Chtimes"]);
    const GO_UNCHECKED_PKG = new Set(["Remove", "RemoveAll", "MkdirAll", "Mkdir", "Setenv", "Unsetenv", "Rename", "Link", "Symlink", "WriteFile", "Chmod", "Chown"]);
    walk(input.rootNode, (n) => {
      if (n.type !== "expression_statement") return;
      const call = n.namedChild(0);
      if (!call || (call.type !== "call_expression" && call.type !== "call")) return;
      const line = lineOf(n);
      const lineText = input.source.split(/\r?\n/)[line - 1] ?? "";
      // Already examined by an explicit `if err := ...; err != nil` guard.
      if (/if\s+err\s*(:?=)|if\s+err\s*!=/.test(lineText)) return;
      const callee = dottedOf(call.childForFieldName("function") ?? call.namedChild(0));
      if (!callee) return;
      const last = callee.split(".").slice(-1)[0];
      const root = callee.split(".")[0];
      const isPkgFn = root === "os" && GO_UNCHECKED_PKG.has(last);
      const isMethod = GO_UNCHECKED_METHODS.has(last) && callee.includes(".");
      if (!isPkgFn && !isMethod) return;

      drafts.push({
        key: `unchecked-error:${line}`,
        defectClass: "error-handling",
        title: `Error returned by \`${callee}()\` is discarded`,
        severity: "medium",
        confidence: "medium",
        evidenceStatus: "needs-verification",
        impact: "The operation may have failed while execution continues: files left un-deleted or un-closed, directories not created, environment not set — each producing a later failure far from this line.",
        mechanism: "`errcheck` pattern: a call whose signature returns `error` is used as a bare expression statement, so the error value is never bound or compared.",
        triggerConditions: ["The underlying syscall or operation fails (permissions, disk full, missing parent directory, closed descriptor)."],
        reachability: `Runs whenever \`${callee}()\` is reached.`,
        evidence: [{ path: input.path, startLine: line, endLine: n.endPosition.row + 1, excerpt: excerptOf(input.source, line, n.endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
        mitigations: ["The failure may be surfaced by a later operation on the same resource."],
        remediation: "Bind and handle it: `if err := " + callee + "(); err != nil { return err }`, or log it when continuing is genuinely correct.",
        verificationPlan: "Run `errcheck ./...` (or make the operation fail: read-only filesystem, missing parent dir) and confirm the error is ignored.",
        method: "AST: bare `expression_statement` calling a known error-returning stdlib API, not on an `if err` guard line. Known-API list, not signature-derived.",
        falsePositiveCaveats: "The API list is name-based because return types are not resolved; a project method named `Close()` that returns nothing would be a false positive. Calls whose error is intentionally ignored (best-effort cleanup) are also matched.",
        status: "heuristic",
      });
    });
  }

  return drafts;
}

/* ------------------------------------------------------------------ */
/* resource                                                            */
/* ------------------------------------------------------------------ */

function detectResource(input: DetectorInput): Draft[] {
  const drafts: Draft[] = [];

  if (input.language === "go") {
    const openers = new Map<string, Parser.SyntaxNode[]>(); // ident -> call nodes
    walk(input.rootNode, (n) => {
      if (n.type !== "short_var_declaration" && n.type !== "assignment") return;
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (!left || !right) return;
      const call = right.type === "expression_list" ? right.namedChild(0) : right;
      if (!call || (call.type !== "call_expression" && call.type !== "call")) return;
      const callee = dottedOf(call.childForFieldName("function") ?? call.namedChild(0));
      if (!/^os\.(Open|Create|OpenFile)$/.test(callee)) return;
      const idents: string[] = [];
      for (let i = 0; i < left.namedChildCount; i++) {
        const c = left.namedChild(i);
        if (c?.type === "identifier") idents.push(c.text ?? "");
      }
      const handle = idents.find((x) => x && x !== "err");
      if (!handle) return;
      if (!openers.has(handle)) openers.set(handle, []);
      openers.get(handle)!.push(call);
    });

    for (const [handle, calls] of openers) {
      const fnAncestor = ancestorOfType(calls[0], new Set(["function_declaration", "method_declaration", "func_literal"]));
      const scopeText = fnAncestor ? fnAncestor.text ?? "" : input.source;
      const line = lineOf(calls[0]);
      const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const closed = new RegExp(`defer\\s+${escaped}\\.Close\\s*\\(|${escaped}\\.Close\\s*\\(`).test(scopeText);
      if (closed) continue;
      drafts.push({
        key: `missing-defer-close:${line}`,
        defectClass: "resource",
        title: `\`${handle}\` from \`${dottedOf(calls[0].childForFieldName("function") ?? calls[0].namedChild(0))}()\` is never closed`,
        severity: "medium",
        confidence: "high",
        evidenceStatus: "confirmed",
        impact: "The file descriptor stays open until process exit. Under repeated calls the process exhausts its descriptor limit and every subsequent open fails.",
        mechanism: "`os.Open`/`os.Create`/`os.OpenFile` return a handle that must be closed; no `defer <handle>.Close()` (or any `<handle>.Close()`) appears in the enclosing function.",
        triggerConditions: [`Execution of the enclosing function at least once; the leak compounds per call.`],
        reachability: "Every execution of the enclosing function leaks one descriptor.",
        evidence: [{ path: input.path, startLine: line, endLine: calls[0].endPosition.row + 1, excerpt: excerptOf(input.source, line, calls[0].endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
        mitigations: ["The runtime closes descriptors at process exit, so a short-lived CLI may never observe it."],
        remediation: `Add \`defer ${handle}.Close()\` immediately after checking the error.`,
        verificationPlan: "Wrap the enclosing function in a loop (e.g. 10k iterations) and watch `lsof -p <pid> | wc -l` / `Count` on Windows, or run with `GODEBUG=fdcheck`.",
        method: "AST: `os.Open`/`os.Create`/`os.OpenFile` result bound to an identifier; enclosing function text searched for a `.Close()` on that identifier.",
        falsePositiveCaveats: "A deferred close in a caller, a struct field, or a closer registry outside this function will not be seen — the check is function-scoped by design.",
        status: "verified",
      });
    }
  }

  if (input.language === "python") {
    walk(input.rootNode, (n) => {
      if (n.type !== "call") return;
      const fn = n.childForFieldName("function") ?? n.namedChild(0);
      if (fn?.text !== "open") return;
      // `with open(...)` and `open(...)` nested inside a with-item are fine.
      const withAncestor = ancestorOfType(n, new Set(["with_statement"]));
      if (withAncestor) {
        // Only fine if the with-statement is an ancestor of *this* call's item.
        const itemAncestor = ancestorOfType(n, new Set(["with_clause", "with_item"]));
        if (itemAncestor || withAncestor) return;
      }
      const line = lineOf(n);
      const parentType = n.parent?.type ?? "";
      const isAssigned = ["assignment", "variable_declarator", "expression_list", "argument_list", "default_parameter", "keyword_argument"].includes(parentType) || !!ancestorOfType(n, new Set(["assignment", "variable_declarator"]));
      drafts.push({
        key: `open-without-with:${line}`,
        defectClass: "resource",
        title: "`open()` used outside a `with` statement",
        severity: isAssigned ? "medium" : "low",
        confidence: isAssigned ? "high" : "medium",
        evidenceStatus: isAssigned ? "confirmed" : "needs-verification",
        impact: "The file is left to the garbage collector: the buffer may not be flushed before the data is read elsewhere, and the descriptor is held for an unbounded time.",
        mechanism: "`open()` returns a file object whose lifetime is managed explicitly by `with`; without it nothing guarantees `close()` runs on the error path.",
        triggerConditions: ["Any exception between the open and a later explicit close.", "Process exit before GC runs the finalizer."],
        reachability: "Every execution of the enclosing function.",
        evidence: [{ path: input.path, startLine: line, endLine: n.endPosition.row + 1, excerpt: excerptOf(input.source, line, n.endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
        mitigations: ["CPython's reference counting usually closes promptly when the last reference dies — but not on the exception path where the frame keeps the name alive."],
        remediation: "Rewrite as `with open(...) as fh:` so close is guaranteed on every path.",
        verificationPlan: "Raise inside the block and confirm with `psutil`/`lsof` that the descriptor count does not grow across iterations.",
        method: "AST: `call` with function `open` and no `with_statement` ancestor.",
        falsePositiveCaveats: "`pathlib.Path.open()` is a different node and is not matched. A later explicit `.close()` in the same function is not consulted — check for it before treating this as a leak.",
        status: "heuristic",
      });
    });
  }

  return drafts;
}

/* ------------------------------------------------------------------ */
/* contract                                                            */
/* ------------------------------------------------------------------ */

function detectContract(input: DetectorInput): Draft[] {
  const drafts: Draft[] = [];

  if (input.language === "python") {
    walk(input.rootNode, (n) => {
      if (n.type !== "default_parameter") return;
      const value = n.childForFieldName("value") ?? n.namedChild(n.namedChildCount - 1);
      if (!value) return;
      const isMutable = value.type === "list" || value.type === "dictionary" || value.type === "set" || value.type === "list_comprehension" || value.type === "dictionary_comprehension";
      if (!isMutable) return;
      const name = (n.childForFieldName("name") ?? n.namedChild(0))?.text ?? "?";
      const line = lineOf(n);
      drafts.push({
        key: `mutable-default:${line}`,
        defectClass: "contract",
        title: `Mutable default value for parameter \`${name}\``,
        severity: "medium",
        confidence: "high",
        evidenceStatus: "confirmed",
        impact: "The default object is created once at def time and shared across every call. Later mutations persist between invocations, so state leaks from one call into the next.",
        mechanism: "Python evaluates default arguments once, when the `def` executes — not per call.",
        triggerConditions: [`Any mutation of \`${name}\` inside the function, followed by another call that omits the argument.`],
        reachability: "Requires the function to be called at least twice and to mutate the parameter.",
        evidence: [{ path: input.path, startLine: line, endLine: n.endPosition.row + 1, excerpt: excerptOf(input.source, line, n.endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
        mitigations: ["If the function never mutates the default, the shared instance is harmless."],
        remediation: `Use \`${name}=None\` and create the mutable value inside the body.`,
        verificationPlan: "Call the function twice without the argument and print the default's contents before and after — growth across calls confirms it.",
        method: "AST: `default_parameter` whose value node is a list/dict/set literal.",
        falsePositiveCaveats: "Intentional per-process caches use this idiom on purpose; check whether the accumulation is the point.",
        status: "verified",
      });
    });
  }

  if (input.language !== "python") {
    walk(input.rootNode, (n) => {
      if (n.type !== "non_null_expression") return;
      const line = lineOf(n);
      const text = (n.text ?? "").slice(0, 60);
      drafts.push({
        key: `non-null-assertion:${line}`,
        defectClass: "contract",
        title: "Non-null assertion bypasses the type system",
        severity: "low",
        confidence: "high",
        evidenceStatus: "confirmed",
        impact: "The `!` operator tells the compiler a value can never be undefined. If that is wrong at runtime the result is a TypeError at a location the compiler already cleared as safe — the check that would have caught it was deleted.",
        mechanism: "TypeScript's non-null assertion operator erases `undefined`/`null` from the declared type without performing any runtime check.",
        triggerConditions: ["The asserted value actually being null or undefined at runtime (missing API field, absent map key, failed lookup)."],
        reachability: "Every execution of the expression.",
        evidence: [{ path: input.path, startLine: line, endLine: n.endPosition.row + 1, excerpt: excerptOf(input.source, line, n.endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
        mitigations: ["Surrounding narrowing (an `if (x !== undefined)`) may already make the assertion redundant."],
        remediation: "Replace with an explicit guard, `??` fallback, or a runtime schema validation at the boundary that produced the value.",
        verificationPlan: "Delete the `!` and run `tsc` — if an error appears, that expression was relying on the assertion to compile.",
        method: "AST: `non_null_expression` node.",
        falsePositiveCaveats: "Many are provably safe next to a guard. This is reported as low severity precisely because the compiler, not a runtime, is what it defeats.",
        status: "verified",
      });
    });
  }

  if (input.language === "go") {
    walk(input.rootNode, (n) => {
      if (n.type !== "type_assertion_expression" && n.type !== "type_assertion") return;
      // The two-value form `v, ok := x.(T)` is a different node shape; the
      // single-value form is the one that panics on mismatch.
      const line = lineOf(n);
      const expr = textOf(n.childForFieldName("expression") ?? n.namedChild(0));
      const typeText = textOf(n.childForFieldName("type") ?? n.namedChild(n.namedChildCount - 1));
      drafts.push({
        key: `type-assert:${line}`,
        defectClass: "contract",
        title: `Type assertion \`${expr}.(${typeText})\` without the \`ok\` form`,
        severity: "medium",
        confidence: "medium",
        evidenceStatus: "needs-verification",
        impact: "A mismatch between the dynamic type and the asserted type panics immediately, taking down the goroutine (or the whole process, if unrecovered).",
        mechanism: "The single-value type assertion panics instead of returning `(value, false)`. Only the two-value form is total.",
        triggerConditions: ["A value of a different concrete type reaching this expression — typically after a map read, interface widening, or JSON decode into `interface{}`."],
        reachability: "Every execution where the assertion is reached; failure depends on the runtime type.",
        evidence: [{ path: input.path, startLine: line, endLine: n.endPosition.row + 1, excerpt: excerptOf(input.source, line, n.endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
        mitigations: ["A `recover()` in the same goroutine converts the panic into an error, if one exists."],
        remediation: "Use `v, ok := x.(T)` and branch on `ok`.",
        verificationPlan: "Feed a value of the wrong dynamic type through the same path and confirm a panic; then repeat with the two-value form and confirm a handled branch.",
        method: "AST: `type_assertion_expression` node — the single-value form (the two-value form is a `type_switch_statement` or a 2-element assignment).",
        falsePositiveCaveats: "If the value's type is guaranteed by construction immediately above, the assertion is safe — the guarantee is simply not visible to this function-local check.",
        status: "heuristic",
      });
    });
  }

  return drafts;
}

/* ------------------------------------------------------------------ */
/* logic                                                               */
/* ------------------------------------------------------------------ */

function detectLogic(input: DetectorInput): Draft[] {
  const drafts: Draft[] = [];

  const COMPARISON_TYPES = new Set(["binary_expression", "comparison_operator"]);
  const COMPARISON_OPS = new Set(["==", "===", "!=", "!==", ">", "<", ">=", "<="]);

  walk(input.rootNode, (n) => {
    if (!COMPARISON_TYPES.has(n.type)) return;
    const op = operatorOf(n);
    if (!COMPARISON_OPS.has(op)) return;
    const left = n.childForFieldName("left") ?? n.namedChild(0);
    const right = n.childForFieldName("right") ?? n.namedChild(2) ?? n.namedChild(n.namedChildCount - 1);
    if (!left || !right) return;
    const lt = left.text ?? "";
    const rt = right.text ?? "";
    const line = lineOf(n);

    // Identical operands: always true (==) / always false (!=).
    if (lt && lt === rt) {
      drafts.push({
        key: `self-comparison:${line}`,
        defectClass: "logic",
        title: `Operand compared with itself: \`${lt} ${op} ${rt}\``,
        severity: "high",
        confidence: "high",
        evidenceStatus: "confirmed",
        impact: `The result is constant (\`${op === "==" || op === "===" || op === ">=" || op === "<=" ? "true" : "false"}\`), so the branch it guards is either always taken or never taken — one side of the logic is dead.`,
        mechanism: "Both sides of the comparison are character-identical, so the comparison cannot distinguish anything.",
        triggerConditions: ["None — the outcome is fixed at compile time."],
        reachability: "Every execution of the enclosing expression.",
        evidence: [{ path: input.path, startLine: line, endLine: n.endPosition.row + 1, excerpt: excerptOf(input.source, line, n.endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
        mitigations: [],
        remediation: "Replace the intended comparison — usually the right-hand side was meant to be a different variable or a literal.",
        verificationPlan: "Evaluate the expression in a REPL or unit test; confirm it is constant, then inspect what the dead branch was supposed to do.",
        method: "AST: comparison operator whose two operand subtrees have identical source text.",
        falsePositiveCaveats: "Only literal equality/comparison operators are considered; `a + a === b * 2` and similar are not matched.",
        status: "verified",
      });
      return;
    }

    // Off-by-one: inclusive comparison against a length.
    const isLength = /(^|[^\w.])(length|len)\s*\)?\s*$/.test(rt) || /^len\s*\(/.test(rt) || /\.length$/.test(rt);
    if ((op === "<=") && isLength) {
      const enclosing = ancestorOfType(n, new Set(["for_statement", "for", "for_range_statement", "while_statement"]));
      if (enclosing) {
        drafts.push({
          key: `off-by-one:${line}`,
          defectClass: "logic",
          title: "Inclusive bound against a length — last iteration reads past the end",
          severity: "medium",
          confidence: "medium",
          evidenceStatus: "needs-verification",
          impact: "The final iteration indexes at `length`, which is one past the last valid element: undefined (JS), an index-out-of-range error (Go), or a silent empty read.",
          mechanism: "`i <= x.length` runs for `i == x.length`. Valid indices are `0 .. length-1`, so the operator should be `<` unless an off-by-one was intended.",
          triggerConditions: ["The loop reaching its final iteration with the collection at exactly `length` elements."],
          reachability: `Runs on every execution of the loop that completes fully.`,
          evidence: [{ path: input.path, startLine: line, endLine: enclosing.endPosition.row + 1, excerpt: excerptOf(input.source, line, enclosing.endPosition.row + 1, 300) }],
          affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
          mitigations: ["If the body guards with its own bounds check, the out-of-range access never happens."],
          remediation: "Change the bound to `<`, or index with `i - 1` if the extra iteration is deliberate.",
          verificationPlan: "Run the loop over a non-empty collection and assert the index stays `< length`; add a case with an empty collection.",
          method: "AST: `<=` comparison whose right operand is a `len(...)`/`.length` expression, inside a loop.",
          falsePositiveCaveats: "`i <= n` where `n = length - 1` also matches textually and is correct. The detector cannot see that relationship.",
          status: "heuristic",
        });
      }
    }
  });

  // Python: `x is "literal"` (identity vs equality).
  if (input.language === "python") {
    walk(input.rootNode, (n) => {
      if (n.type !== "comparison_operator") return;
      const op = operatorOf(n);
      if (op !== "is" && op !== "is not") return;
      const operands = n.namedChildren;
      const hasString = operands.some((c) => c.type === "string" || c.type === "concatenated_string");
      if (!hasString) return;
      const line = lineOf(n);
      drafts.push({
        key: `is-literal:${line}`,
        defectClass: "logic",
        title: `\`is\` used to compare against a string literal`,
        severity: "medium",
        confidence: "high",
        evidenceStatus: "confirmed",
        impact: "`is` tests object identity, not equality. For string literals CPython may intern them so the test happens to pass, but the result is implementation-dependent — it changes with string length, interning policy and interpreter version.",
        mechanism: "Identity comparison against a freshly-built string returns False even when the contents are equal.",
        triggerConditions: ["A string that is not interned (long, dynamically built, or from input) reaching the comparison."],
        reachability: "Every evaluation of the condition.",
        evidence: [{ path: input.path, startLine: line, endLine: n.endPosition.row + 1, excerpt: excerptOf(input.source, line, n.endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
        mitigations: ["CPython interns short identifier-like literals, which masks the bug in common cases."],
        remediation: "Use `==` for value comparison.",
        verificationPlan: "Run with `python -X dev` — Python emits a `SyntaxWarning` for this; then test with a long or dynamically produced string.",
        method: "AST: `comparison_operator` with operator `is`/`is not` and a string-literal operand.",
        falsePositiveCaveats: "`x is None` is idiomatic and correct — only string literals are matched here.",
        status: "verified",
      });
    });
  }

  // Assignment used where a boolean test was meant: `if (x = y)`.
  // The assignment *is* the condition rather than an operand of a comparison,
  // so it needs its own pass over `if`/`while` heads.
  if (input.language !== "python" && input.language !== "go") {
    walk(input.rootNode, (n) => {
      if (n.type !== "if_statement" && n.type !== "while_statement" && n.type !== "do_statement") return;
      const head = n.childForFieldName("condition") ?? n.namedChild(1);
      if (!head) return;
      const hits: Parser.SyntaxNode[] = [];
      walk(head, (c) => {
        if (hits.length) return;
        if (c.type === "assignment_expression" || c.type === "assignment") hits.push(c);
      });
      const hit = hits[0];
      if (!hit) return;
      const target = hit.childForFieldName("left") ?? hit.namedChild(0);
      const line = lineOf(hit);
      drafts.push({
        key: `assignment-in-condition:${line}`,
        defectClass: "logic",
        title: `Assignment to \`${(target?.text ?? "?").slice(0, 40)}\` inside a condition`,
        severity: "high",
        confidence: "high",
        evidenceStatus: "confirmed",
        impact: "The condition writes the variable and then tests what it just wrote, discarding the value the variable held before. The branch therefore reflects the right-hand side, not the state the author most likely meant to check.",
        mechanism: "`==` was intended but `=` was written. The grammar accepts an assignment as an expression, so the compiler does not object.",
        triggerConditions: ["Every evaluation of the condition — this is not input-dependent."],
        reachability: `Runs whenever the enclosing ${n.type === "while_statement" ? "loop condition" : "condition"} is evaluated.`,
        evidence: [{ path: input.path, startLine: line, endLine: n.endPosition.row + 1, excerpt: excerptOf(input.source, line, n.endPosition.row + 1, 300) }],
        affectedSymbols: [enclosingSymbol(input.path, input.symbols, line)].filter((x): x is string => !!x),
        mitigations: ["If the assignment is deliberate and the written value is what should be tested, this is a false positive — an inline comment usually marks the intent."],
        remediation: "Split into two statements, or write `===` if a comparison was intended.",
        verificationPlan: "Print the variable immediately before the condition and confirm its prior value is never consulted; then switch to `===` and see whether behaviour changes.",
        method: "AST: `if`/`while` condition subtree containing an `assignment_expression`.",
        falsePositiveCaveats: "Deliberate assign-and-test idioms exist (rare in JS/TS, common in C). They are reported anyway because the pattern is overwhelmingly a typo; severity, not filtering, carries that judgement.",
        status: "verified",
      });
    });
  }

  return drafts;
}

/* ------------------------------------------------------------------ */

export function detectDefects(input: DetectorInput): DefectFinding[] {
  const drafts: Draft[] = [
    ...detectAsyncJs(input),
    ...detectAsyncPython(input),
    ...detectErrorHandling(input),
    ...detectResource(input),
    ...detectContract(input),
    ...detectLogic(input),
  ];
  return emit(input, drafts);
}
