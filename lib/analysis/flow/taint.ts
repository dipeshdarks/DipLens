/* Taint / data-flow analysis.
 *
 * Intraprocedural by default, with one bounded interprocedural hop when a
 * tainted value is passed to a callee that resolves to a repository symbol.
 *
 * Every result is a *candidate*: static analysis of untrusted input without
 * executing the program cannot prove an exploit. The report says so, and each
 * path carries the preconditions and caveats needed to verify it.
 */

import type Parser from "web-tree-sitter";
import type {
  StateSlot,
  SymbolRecord,
  TaintHop,
  TaintPath,
  TaintSink,
  TaintSource,
} from "@/lib/analysis/engine/types";
import type { LanguageId } from "@/lib/analysis/parsers/loader";
import type { Confidence } from "@/types/analysis";
import { sanitizersFor, sinksFor, sourcesFor, type SinkSpec } from "./catalogs";

/** Node types that begin their own frame � never walked as part of a caller. */
const NESTED_FUNCTION_TYPES = new Set([
  "function_declaration",
  "method_definition",
  "function_definition",
  "method_declaration",
]);

export type TaintInput = {
  path: string;
  language: LanguageId;
  rootNode: Parser.SyntaxNode;
  source: string;
  symbols: SymbolRecord[];
  /** Symbol ids treated as entry points — their parameters are untrusted. */
  entrySymbolIds: Set<string>;
  /** Resolve a callee name to a repository symbol, or null. */
  resolveCallee: (path: string, callee: string) => SymbolRecord | null;
};

export type TaintOutput = {
  sources: TaintSource[];
  sinks: TaintSink[];
  paths: TaintPath[];
  state: StateSlot[];
  inspected: number;
};

type TaintValue = {
  origin: TaintSource;
  transforms: string[];
  sanitizedBy: string | null;
  line: number;
};

type LocalEnv = Map<string, TaintValue>;

function dottedName(node: Parser.SyntaxNode, language: LanguageId, depth = 0): string | null {
  if (depth > 8) return null;
  const text = node.text ?? "";
  if (node.type === "identifier" || node.type === "property_identifier" || node.type === "field_identifier" || node.type === "type_identifier") {
    return text;
  }
  if (node.type === "this" || node.type === "self") return text;
  if (node.type === "member_expression" || node.type === "attribute" || node.type === "selector_expression" || node.type === "subscript_expression") {
    const obj = node.childForFieldName("object") ?? node.namedChild(0);
    const prop = node.childForFieldName("property") ?? node.namedChild(node.namedChildCount - 1);
    if (!prop) return null;
    const o = obj ? dottedName(obj, language, depth + 1) : null;
    const p = prop.text ?? "";
    return o ? `${o}.${p}` : p;
  }
  if (node.type === "call_expression" || node.type === "call") {
    const fn = node.childForFieldName("function") ?? node.namedChild(0);
    return fn ? dottedName(fn, language, depth + 1) : null;
  }
  return null;
}

function lineOf(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

function makeSource(kind: string, path: string, node: Parser.SyntaxNode, expression: string, trust: TaintSource["trust"]): TaintSource {
  return { id: `${path}::${kind}::${lineOf(node)}::${expression.slice(0, 40)}`, kind, path, line: lineOf(node), expression, trust };
}

/** Does this expression text mention any tainted identifier? */
function textMentionsTainted(text: string, env: LocalEnv): TaintValue | null {
  let best: TaintValue | null = null;
  for (const [name, value] of env) {
    const re = new RegExp(`(^|[^A-Za-z0-9_$.])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_]|$)`);
    if (re.test(text)) {
      if (!best || value.transforms.length < best.transforms.length) best = value;
    }
  }
  return best;
}

function sanitizersForLanguage(language: LanguageId): ReturnType<typeof sanitizersFor> {
  return sanitizersFor(language);
}

function applySanitizer(text: string, language: LanguageId): string | null {
  for (const s of sanitizersForLanguage(language)) {
    if (s.name.test(text)) return text.match(s.name)?.[1] ?? text;
  }
  return null;
}

function confidenceOf(value: TaintValue, sanitized: boolean): Confidence {
  if (sanitized) return "low";
  if (value.transforms.some((t) => t.startsWith("via "))) return "medium";
  if (value.origin.trust === "environment") return "medium";
  return "high";
}

type ArgText = { text: string; taint: TaintValue | null };

/**
 * Does this call actually enter a shell?
 *
 * Two shapes matter: argv form (`exec.Command("sh", "-c", ...)`) and inline
 * form (`subprocess.run("sh -c " + payload, shell=True)`). Both reintroduce
 * string re-joining; a plain argv array with a non-shell binary does not.
 */
function hasShellWrapper(args: ArgText[]): boolean {
  const atoms = args.map((a) => a.text.replace(/^["'`]+|["'`]+$/g, "").trim());
  const isShell = atoms.some((a) => /^(sh|bash|zsh|dash|ksh|csh|fish|cmd|cmd\.exe|powershell|pwsh)$/i.test(a));
  const isFlag = atoms.some((a) => /^(-c|-Command|-cc|\/c|\/C)$/i.test(a));
  if (isShell && isFlag) return true;
  return args.some((a) => /(^|[\s"'`])(sh|bash|zsh|dash|ksh|cmd|cmd\.exe|powershell|pwsh)(\.exe)?[\s"'`]+-c\b/i.test(a.text));
}

/**
 * Which tainted argument makes this call a candidate?
 *
 * The default ("first") is the operand that matters: the SQL statement, the
 * command string, the path, the URL, the evaluated code. Taint only in a
 * *later* argument usually means a bound parameter or an argv element, both of
 * which are the safe pattern � so those are deliberately not reported.
 *
 * Shell sinks with a clean leading argument are argv-array calls. They become
 * candidates again when an explicit shell wrapper (`sh -c`, `cmd /c`) appears,
 * because that is where string re-joining reintroduces injection.
 */
function pickTaintedArgument(spec: SinkSpec, args: ArgText[]): ArgText | null {
  if (args.length === 0) return null;
  if (spec.argRule === "any") return args.find((a) => a.taint) ?? null;

  const first = args[0];
  if (first?.taint) return first;

  if (spec.shell && hasShellWrapper(args)) return args.find((a) => a.taint) ?? null;
  return null;
}

/* ------------------------------------------------------------------ */

type FunctionFrame = {
  node: Parser.SyntaxNode;
  name: string;
  symbolId: string | null;
  isEntry: boolean;
  params: string[];
};

function collectFunctions(root: Parser.SyntaxNode, language: LanguageId): FunctionFrame[] {
  const frames: FunctionFrame[] = [];
  const FUNCTION_TYPES = new Set([...NESTED_FUNCTION_TYPES, "arrow_function", "function_expression"]);

  function nameOf(n: Parser.SyntaxNode): string {
    const direct =
      n.namedChildren.find((c) => c.type === "identifier" || c.type === "property_identifier" || c.type === "field_identifier") ?? null;
    return direct?.text ?? nameOfReceiver(n) ?? "<anonymous>";
  }

  function nameOfReceiver(n: Parser.SyntaxNode): string | null {
    // Go method: (recv) Name(params)
    const fields = n.namedChildren.filter((c) => c.type === "field_identifier");
    if (fields.length) return fields[0].text ?? null;
    return null;
  }

  function paramsOf(n: Parser.SyntaxNode): string[] {
    const params =
      n.namedChildren.find((c) => c.type === "formal_parameters" || c.type === "parameters" || c.type === "parameter_list") ?? null;
    if (!params) return [];
    const out: string[] = [];
    for (let i = 0; i < params.namedChildCount; i++) {
      const c = params.namedChild(i);
      if (!c) continue;
      const id = c.namedChildren.find((x) => x.type === "identifier" || x.type === "field_identifier");
      if (id?.text) out.push(id.text);
      else if (c.type === "identifier" && c.text) out.push(c.text);
    }
    return out;
  }

  function walk(n: Parser.SyntaxNode): void {
    if (FUNCTION_TYPES.has(n.type)) {
      frames.push({ node: n, name: nameOf(n), symbolId: null, isEntry: false, params: paramsOf(n) });
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c) walk(c);
    }
  }
  walk(root);
  void language;
  return frames;
}

function matchSymbol(frame: FunctionFrame, symbols: SymbolRecord[], path: string): SymbolRecord | null {
  const inFile = symbols.filter((s) => s.path === path);
  const byLine = inFile.find((s) => s.startLine === frame.node.startPosition.row + 1);
  if (byLine) return byLine;
  const byName = inFile.filter((s) => s.name === frame.name);
  return byName.length === 1 ? byName[0] : null;
}

/* ------------------------------------------------------------------ */

export function analyzeTaint(input: TaintInput, interproceduralBudget = 40): TaintOutput {
  const { path, language, rootNode, source, symbols, entrySymbolIds, resolveCallee } = input;
  const sinks = sinksFor(language);
  const sources = sourcesFor(language);
  const out: TaintOutput = { sources: [], sinks: [], paths: [], state: [], inspected: 0 };

  const frames = collectFunctions(rootNode, language);
  for (const f of frames) {
    const sym = matchSymbol(f, symbols, path);
    f.symbolId = sym?.id ?? null;
    f.isEntry = (f.symbolId && entrySymbolIds.has(f.symbolId)) || /handler|main|route|endpoint|controller|view|index/i.test(f.name);
  }

  const analyzedCallees = new Set<string>();

  function analyzeFrame(frame: FunctionFrame, externalParams: Map<string, TaintValue>, depth: number): void {
    out.inspected++;
    const env: LocalEnv = new Map(externalParams);
    const sinksInFrame: Array<{ sink: TaintSink; value: TaintValue; hopName: string }> = [];

    // Seed: entry parameters are untrusted.
    if (frame.isEntry) {
      for (const p of frame.params) {
        if (env.has(p)) continue;
        const src = makeSource("entry-parameter", path, frame.node, `${frame.name}(${p})`, "untrusted");
        out.sources.push(src);
        env.set(p, { origin: src, transforms: [], sanitizedBy: null, line: frame.node.startPosition.row + 1 });
      }
    }

    function noteSource(kind: string, expr: string, trust: TaintSource["trust"], node: Parser.SyntaxNode): TaintValue {
      const existing = out.sources.find((s) => s.path === path && s.line === lineOf(node) && s.expression === expr);
      const src = existing ?? makeSource(kind, path, node, expr, trust);
      if (!existing) out.sources.push(src);
      return { origin: src, transforms: [], sanitizedBy: null, line: lineOf(node) };
    }

    /** Resolve the taint of an arbitrary expression node. */
    function taintOfExpr(node: Parser.SyntaxNode | null): TaintValue | null {
      if (!node) return null;
      const text = node.text ?? "";

      // Any expression — identifier, subscript, call chain — that reads a
      // documented request/environment surface *is* a source.
      if (text.length <= 600) {
        for (const spec of sources) {
          if (spec.callee.test(text)) return noteSource(spec.kind, text.slice(0, 200), spec.trust, node);
        }
      }

      // Unwrap single-element wrappers (Go `q := expr` right side, list literals
      // written as one child) so the specific rules below see the real node.
      if ((node.type === "expression_list" || node.type === "argument_list") && node.namedChildCount === 1) {
        const only = node.namedChild(0);
        if (only) return taintOfExpr(only);
      }

      if (node.type === "template_string" || node.type === "string" || node.type === "interpreted_string_literal") {
        const hit = textMentionsTainted(text, env);
        if (hit) return { ...hit, transforms: [...hit.transforms, "string-interpolation"], line: lineOf(node) };
      }
      if (node.type === "binary_expression" || node.type === "concatenation" || node.type === "addition_expression") {
        const hit = textMentionsTainted(text, env);
        if (hit) return { ...hit, transforms: [...hit.transforms, "concatenation"], line: lineOf(node) };
      }
      if (node.type === "identifier") {
        return env.get(node.text ?? "") ?? null;
      }
      if (node.type === "member_expression" || node.type === "attribute" || node.type === "selector_expression") {
        const chain = dottedName(node, language);
        if (chain) {
          const rootId = chain.split(".")[0];
          const local = env.get(rootId);
          if (local) return { ...local, transforms: [...local.transforms, chain], line: lineOf(node) };
          // `this.x` / `self.x` reads of previously tainted fields.
          const hit = textMentionsTainted(chain, env);
          if (hit) return { ...hit, transforms: [...hit.transforms, chain], line: lineOf(node) };
        }
      }
      if (node.type === "call_expression" || node.type === "call") {
        // Recurse into arguments: a call returning a tainted value.
        const args = node.namedChildren.find((c) => c.type === "arguments" || c.type === "argument_list");
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i);
            const t = taintOfExpr(a);
            if (t) return { ...t, transforms: [...t.transforms, `${dottedName(node, language) ?? "call"}(...)`], line: lineOf(node) };
          }
        }
      }
      if (node.type === "await") {
        const inner = node.namedChild(0);
        const t = taintOfExpr(inner);
        return t ? { ...t, line: lineOf(node) } : null;
      }
      const fallback = textMentionsTainted(text, env);
      return fallback ? { ...fallback, line: lineOf(node) } : null;
    }

    function isSinkCallee(callee: string): SinkSpec | null {
      for (const s of sinks) {
        if (s.callee.test(callee)) return s;
      }
      return null;
    }

    function handleCall(node: Parser.SyntaxNode): void {
      const callee = dottedName(node, language);
      if (!callee) return;
      const args = node.namedChildren.find((c) => c.type === "arguments" || c.type === "argument_list");
      const argTexts: Array<{ text: string; taint: TaintValue | null }> = [];
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const a = args.namedChild(i);
          if (!a) continue;
          argTexts.push({ text: a.text ?? "", taint: taintOfExpr(a) });
        }
      }

      const spec = isSinkCallee(callee);
      if (spec) {
        const candidate = pickTaintedArgument(spec, argTexts);
        if (candidate?.taint) {
          const san = applySanitizer(candidate.text, language);
          const sinkNode: TaintSink = {
            id: `${path}::${spec.category}::${lineOf(node)}::${callee}`,
            category: spec.category,
            api: callee,
            path,
            line: lineOf(node),
            expression: (node.text ?? "").slice(0, 160),
          };
          out.sinks.push(sinkNode);
          sinksInFrame.push({ sink: sinkNode, value: { ...candidate.taint, sanitizedBy: san ?? candidate.taint.sanitizedBy }, hopName: callee });
        }
      }

      // Interprocedural: pass taint into a resolvable repository callee.
      if (depth < 2 && interproceduralBudget > 0) {
        const simple = callee.split(".").slice(-1)[0];
        const target = resolveCallee(path, simple) ?? resolveCallee(path, callee);
        if (target && !analyzedCallees.has(target.id)) {
          const taintedArgs = argTexts.filter((a) => a.taint);
          if (taintedArgs.length) {
            analyzedCallees.add(target.id);
            const external = new Map<string, TaintValue>();
            // Map positional args onto the callee's parameter names heuristically.
            const calleeParams = symbols.find((s) => s.id === target.id)?.paramCount ?? taintedArgs.length;
            for (let i = 0; i < Math.min(calleeParams, taintedArgs.length); i++) {
              const t = taintedArgs[i].taint;
              if (t) external.set(`__arg${i}`, { ...t, transforms: [...t.transforms, `via ${simple}`] });
            }
            // Also try the callee's declared parameter names in order.
            const declared = frames.find((f) => f.symbolId === target.id)?.params ?? [];
            declared.forEach((p, i) => {
              const t = taintedArgs[Math.min(i, taintedArgs.length - 1)]?.taint;
              if (t) external.set(p, { ...t, transforms: [...t.transforms, `via ${simple}`] });
            });
            if (external.size) {
              const calleeFrame = frames.find((f) => f.symbolId === target.id);
              if (calleeFrame) analyzeFrame(calleeFrame, external, depth + 1);
            }
          }
        }
      }
    }

    /** Resolve an assignment target to the identifiers it writes. */
    function targetNames(target: Parser.SyntaxNode): string[] {
      if (target.type === "identifier" || target.type === "property_identifier" || target.type === "field_identifier") {
        return target.text ? [target.text] : [];
      }
      if (target.type === "expression_list" || target.type === "pattern_list" || target.type === "tuple_pattern" || target.type === "argument_list") {
        const out: string[] = [];
        for (let i = 0; i < target.namedChildCount; i++) {
          const c = target.namedChild(i);
          if (c) out.push(...targetNames(c));
        }
        return out;
      }
      if (target.type === "variable_declarator" || target.type === "assignment_pattern") {
        const n = target.childForFieldName("left") ?? target.childForFieldName("name") ?? target.namedChild(0);
        return n ? targetNames(n) : [];
      }
      const chain = dottedName(target, language);
      return chain ? [chain.split(".")[0]] : [];
    }

    /** Property-set sinks such as `el.innerHTML = value` are calls in disguise. */
    function noteAssignmentSinks(target: Parser.SyntaxNode, taint: TaintValue): void {
      const chain = dottedName(target, language);
      if (!chain) return;
      for (const s of sinks) {
        if (s.category !== "xss" || !s.callee.test(chain)) continue;
        const sinkNode: TaintSink = {
          id: `${path}::${s.category}::${lineOf(target)}::${chain}`,
          category: s.category,
          api: chain,
          path,
          line: lineOf(target),
          expression: `${chain} = ${target.parent?.text ?? ""}`.slice(0, 160),
        };
        out.sinks.push(sinkNode);
        sinksInFrame.push({ sink: sinkNode, value: taint, hopName: `assign ${chain}` });
      }
    }

    function handleAssignment(target: Parser.SyntaxNode, value: Parser.SyntaxNode | null, node: Parser.SyntaxNode): void {
      if (!value) return;
      const taint = taintOfExpr(value);
      if (taint) noteAssignmentSinks(target, taint);
      for (const n of targetNames(target)) {
        if (!n) continue;
        if (taint) env.set(n, taint);
        else env.delete(n);
      }
      void node;
    }

    function visit(n: Parser.SyntaxNode): void {
      const type = n.type;

      if (type === "call_expression" || type === "call") {
        handleCall(n);
      }

      if (type === "assignment" || type === "assignment_expression" || type === "augmented_assignment") {
        // Positional fallback matters: tree-sitter-javascript does not expose
        // left/right fields on assignment_expression in every grammar version.
        const target = n.childForFieldName("left") ?? n.childForFieldName("target") ?? n.namedChild(0);
        const value = n.childForFieldName("right") ?? n.childForFieldName("value") ?? n.namedChild(n.namedChildCount - 1);
        if (target && value !== target) handleAssignment(target, value, n);
      } else if (type === "short_var_declaration") {
        const left = n.childForFieldName("left");
        const right = n.childForFieldName("right");
        if (left) handleAssignment(left, right, n);
      } else if (type === "variable_declaration" || type === "lexical_declaration") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i);
          if (!c) continue;
          if (c.type === "variable_declarator") {
            const target = c.childForFieldName("name") ?? c.namedChild(0);
            const value = c.childForFieldName("value") ?? c.namedChild(c.namedChildCount - 1);
            if (target) handleAssignment(target, value, n);
          } else if (c.type === "identifier" || c.type === "expression_list") {
            const value = n.namedChild(n.namedChildCount - 1);
            handleAssignment(c, value === c ? null : value, n);
          }
        }
      } else if (type === "expression_statement") {
        // Python / Go plain statements fall through to their children.
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i);
        if (!c) continue;
        // Do not descend into nested function declarations: they are frames.
        if (NESTED_FUNCTION_TYPES.has(c.type)) continue;
        visit(c);
      }
    }

    visit(frame.node);

    for (const { sink, value, hopName } of sinksInFrame) {
      const sanitized = !!value.sanitizedBy;
      const hops: TaintHop[] = value.transforms.slice(0, 6).map((t) => ({
        symbolId: frame.symbolId,
        name: t,
        path,
        line: value.line,
        transform: t,
      }));
      hops.push({ symbolId: frame.symbolId, name: hopName, path, line: sink.line, transform: `reaches ${sink.api}` });

      const caveats: string[] = [
        "Static analysis: this path was not executed. Confirm with a runtime test or by reading the sink's own validation.",
      ];
      if (sanitized) caveats.push(`A sanitizer-like call (${value.sanitizedBy}) appears on the path; verify it actually covers this sink category.`);
      if (value.origin.trust === "environment") caveats.push("Origin is environment/config, which is trusted in most deployments but attacker-controlled in shared-hosting or CI-poisoning scenarios.");

      const missing: string[] = [];
      if (!sanitized) {
        if (sink.category === "sql") missing.push("parameterized query / bound parameters");
        else if (sink.category === "shell") missing.push("argv-array execution or strict argument allow-list");
        else if (sink.category === "path") missing.push("rooted path resolution with traversal rejection");
        else if (sink.category === "xss") missing.push("context-aware output encoding");
        else if (sink.category === "redirect") missing.push("route allow-list");
        else if (sink.category === "ssrf") missing.push("destination host allow-list");
        else if (sink.category === "deserialization") missing.push("schema validation / safe loader");
        else if (sink.category === "code-eval") missing.push("static dispatch instead of dynamic evaluation");
        else missing.push("input validation at the trust boundary");
      }

      out.paths.push({
        id: sink.id,
        source: value.origin,
        sink,
        hops,
        sanitizers: sanitized ? [{ name: String(value.sanitizedBy), path, line: value.line }] : [],
        missingValidation: missing,
        preconditions: [
          `The value reaching \`${sink.api}\` must still contain attacker-controlled content at line ${sink.line}.`,
          `The enclosing function ${frame.name} must be reachable from an entry point.`,
        ],
        confidence: sanitized ? "low" : confidenceOf(value, sanitized),
        status: "candidate",
        remediation: sinks.find((s) => s.category === sink.category)?.remediation ?? "Validate and encode the value at the trust boundary.",
        falsePositiveCaveats: caveats.join(" "),
      });
    }
  }

  for (const frame of frames) {
    if (frame.symbolId && entrySymbolIds.has(frame.symbolId)) {
      analyzeFrame(frame, new Map(), 0);
    }
  }
  // Second pass for non-entry frames that themselves read request-like sources.
  for (const frame of frames) {
    if (out.inspected > 400) break;
    if (frame.symbolId && entrySymbolIds.has(frame.symbolId)) continue;
    analyzeFrame(frame, new Map(), 0);
  }

  out.state = collectState(rootNode, path, language, symbols);
  return out;
}

/* ---------- shared mutable state ---------- */

function collectState(root: Parser.SyntaxNode, path: string, language: LanguageId, symbols: SymbolRecord[]): StateSlot[] {
  const slots = new Map<string, StateSlot>();
  const GLOBAL_TYPES = new Set(["lexical_declaration", "variable_declaration"]);

  function ensure(name: string, node: Parser.SyntaxNode, scope: StateSlot["scope"]): StateSlot {
    const id = `${path}::${name}::${node.startPosition.row + 1}`;
    if (!slots.has(id)) {
      slots.set(id, {
        id,
        path,
        name,
        declarationLine: node.startPosition.row + 1,
        writers: [],
        readers: [],
        synchronized: null,
        scope,
      });
    }
    return slots.get(id)!;
  }

  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i);
    if (!c) continue;
    if (!GLOBAL_TYPES.has(c.type)) continue;
    for (let j = 0; j < c.namedChildCount; j++) {
      const d = c.namedChild(j);
      if (!d || d.type !== "variable_declarator") continue;
      const nameNode = d.childForFieldName("name") ?? d.namedChild(0);
      if (!nameNode?.text) continue;
      const slot = ensure(nameNode.text, d, "module");
      slot.writers.push({ path, line: d.startPosition.row + 1, symbolId: null });
    }
  }

  // Any later assignment to a globally declared name is a write.
  const globalNames = new Set([...slots.values()].map((s) => s.name));
  const allAssignments = root.descendantsOfType("assignment");
  for (const a of allAssignments) {
    const left = a.childForFieldName("left") ?? a.namedChild(0);
    if (!left?.text) continue;
    const name = left.type === "identifier" ? left.text! : left.text!.split(".")[0];
    for (const slot of slots.values()) {
      if (slot.name !== name) continue;
      if (a.startPosition.row + 1 === slot.declarationLine) continue;
      slot.writers.push({ path, line: a.startPosition.row + 1, symbolId: null });
    }
  }

  for (const slot of slots.values()) {
    if (slot.writers.length > 1) slot.synchronized = false;
  }
  void language;
  void symbols;
  return [...slots.values()].filter((s) => s.writers.length > 1);
}
