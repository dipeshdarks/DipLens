/* TypeScript / TSX / JavaScript extraction.
 *
 * Walks the tree-sitter tree directly (no Query objects) so export context,
 * accessibility modifiers and nesting are available while visiting.
 */

import type Parser from "web-tree-sitter";
import type { LanguageId } from "@/lib/analysis/parsers/loader";
import type { ImportSpecifier } from "@/lib/analysis/engine/types";
import type { ExtractedFile, RawCall, RawImport, RawSymbol } from "./shared";
import {
  allChildren,
  childrenOfType,
  endLineOf,
  firstLineText,
  hasAnonChild,
  isConstantName,
  isUnderExport,
  lineOf,
  makeEntry,
  namedChildOfType,
  nodeText,
  visibilityOf,
} from "./shared";

const FUNCTION_LIKE = new Set(["arrow_function", "function_expression", "function_declaration", "generator_function"]);

function paramCountOf(fn: Parser.SyntaxNode): number {
  const params = namedChildOfType(fn, "formal_parameters");
  if (!params) return 0;
  let n = 0;
  for (let i = 0; i < params.namedChildCount; i++) {
    const c = params.namedChild(i);
    if (c && ["required_parameter", "optional_parameter", "rest_pattern", "identifier", "object_pattern", "array_pattern"].includes(c.type)) n++;
  }
  return n;
}

/** Signature = everything from the declaration start through the parameter list. */
function signatureOf(decl: Parser.SyntaxNode, params: Parser.SyntaxNode | null): string {
  if (!params) return firstLineText(decl, 160);
  const src = nodeText(decl);
  const end = params.endIndex;
  const start = decl.startIndex;
  const raw = src.slice(0, end - start).split(/\r?\n/).join(" ");
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}

/** Flatten `this.db.query` / `a.b.c` into a dotted callee text. */
function memberChain(node: Parser.SyntaxNode, depth = 0): string | null {
  if (depth > 8) return null;
  if (node.type === "identifier" || node.type === "property_identifier" || node.type === "private_property_identifier") {
    return nodeText(node);
  }
  if (node.type === "this") return "this";
  if (node.type === "member_expression") {
    const obj = node.childForFieldName("object") ?? node.namedChild(0);
    const prop = node.childForFieldName("property") ?? node.namedChild(1);
    if (!prop) return null;
    const o = obj ? memberChain(obj, depth + 1) : null;
    const p = nodeText(prop);
    return o ? `${o}.${p}` : p;
  }
  if (node.type === "call_expression") {
    const fn = node.childForFieldName("function");
    return fn ? memberChain(fn, depth + 1) : null;
  }
  if (node.type === "subscript_expression") {
    const obj = node.namedChild(0);
    return obj ? memberChain(obj, depth + 1) : null;
  }
  return null;
}

function receiverOf(fnNode: Parser.SyntaxNode): string | null {
  if (fnNode.type === "member_expression") {
    const obj = fnNode.childForFieldName("object");
    return obj ? memberChain(obj) : null;
  }
  return null;
}

function extractImportStatement(node: Parser.SyntaxNode, path: string, out: ExtractedFile): void {
  const clause = namedChildOfType(node, "import_clause");
  const srcNode = childrenOfType(node, "string")[0] ?? node.namedChild(node.namedChildCount - 1);
  const source = srcNode ? nodeText(srcNode).replace(/^["']|["']$/g, "") : "";
  const specifiers: ImportSpecifier[] = [];
  if (clause) {
    for (const c of allChildren(clause)) {
      if (c.type === "identifier") {
        specifiers.push({ local: nodeText(c), imported: "default", kind: "default" });
      } else if (c.type === "named_imports") {
        for (const spec of childrenOfType(c, "import_specifier")) {
          const names = childrenOfType(spec, "identifier");
          const imported = names[0] ? nodeText(names[0]) : "";
          const local = names[1] ? nodeText(names[1]) : imported;
          const isType = hasAnonChild(spec, "type");
          specifiers.push({ local, imported, kind: isType ? "type" : "named" });
        }
      } else if (c.type === "namespace_import") {
        const id = namedChildOfType(c, "identifier") ?? c.namedChild(0);
        if (id) specifiers.push({ local: nodeText(id), imported: "*", kind: "namespace" });
      }
    }
  }
  out.imports.push({ line: lineOf(node), source, specifiers, isReExport: false });
  void path;
}

function extractExportStatement(node: Parser.SyntaxNode, out: ExtractedFile, exported: Set<RawSymbol>, scope: string[]): void {
  const hasString = childrenOfType(node, "string").length > 0;
  if (hasString) {
    const srcNode = childrenOfType(node, "string")[0];
    const source = srcNode ? nodeText(srcNode).replace(/^["']|["']$/g, "") : "";
    out.imports.push({ line: lineOf(node), source, specifiers: [], isReExport: true });
    return;
  }
  for (const c of allChildren(node)) {
    if (!c.isNamed || c.type === "decorator") continue;
    visitDeclaration(c, out, exported, scope, true);
  }
}

function addSymbol(out: ExtractedFile, sym: RawSymbol): void {
  out.symbols.push(sym);
}

function extractClassLike(
  node: Parser.SyntaxNode,
  out: ExtractedFile,
  exported: Set<RawSymbol>,
  scope: string[],
  isExported: boolean,
  language: LanguageId,
): void {
  const nameNode = namedChildOfType(node, "type_identifier") ?? namedChildOfType(node, "identifier");
  const name = nameNode ? nodeText(nameNode) : "<anonymous>";
  const qualified = [...scope, name].join(".");
  const exportedNow = isExported || isUnderExport(node);
  const sym: RawSymbol = {
    kind: "class",
    name,
    qualifiedName: qualified,
    startLine: lineOf(node),
    endLine: endLineOf(node),
    signature: firstLineText(node, 160),
    visibility: "public",
    exported: exportedNow,
    parentName: scope.length ? scope[scope.length - 1] : null,
    language,
    parseStatus: "ok",
  };
  addSymbol(out, sym);
  if (exportedNow) exported.add(sym);

  const body = namedChildOfType(node, "class_body") ?? namedChildOfType(node, "interface_body");
  if (!body) return;

  for (const m of allChildren(body)) {
    if (!m.isNamed) continue;
    if (m.type === "method_definition") {
      const prop = namedChildOfType(m, "property_identifier") ?? namedChildOfType(m, "private_property_identifier");
      const mName = prop ? nodeText(prop) : "<method>";
      const params = namedChildOfType(m, "formal_parameters");
      addSymbol(out, {
        kind: "method",
        name: mName,
        qualifiedName: `${qualified}.${mName}`,
        startLine: lineOf(m),
        endLine: endLineOf(m),
        signature: signatureOf(m, params),
        visibility: visibilityOf(m),
        exported: exportedNow,
        parentName: qualified,
        paramCount: paramCountOf(m),
        language,
        parseStatus: "ok",
      });
      visitFunctionBody(m, out, language);
    } else if (m.type === "public_field_definition" || m.type === "field_definition") {
      const prop = namedChildOfType(m, "property_identifier") ?? namedChildOfType(m, "field_identifier");
      const fName = prop ? nodeText(prop) : "<field>";
      const value = m.childForFieldName("value");
      const isFnField = value ? FUNCTION_LIKE.has(value.type) : false;
      addSymbol(out, {
        kind: isFnField ? "method" : "field",
        name: fName,
        qualifiedName: `${qualified}.${fName}`,
        startLine: lineOf(m),
        endLine: endLineOf(m),
        signature: firstLineText(m, 160),
        visibility: visibilityOf(m),
        exported: exportedNow,
        parentName: qualified,
        paramCount: isFnField && value ? paramCountOf(value) : undefined,
        language,
        parseStatus: "ok",
      });
    } else if (m.type === "method_signature") {
      const prop = namedChildOfType(m, "property_identifier");
      const mName = prop ? nodeText(prop) : "<method>";
      addSymbol(out, {
        kind: "method",
        name: mName,
        qualifiedName: `${qualified}.${mName}`,
        startLine: lineOf(m),
        endLine: endLineOf(m),
        signature: signatureOf(m, namedChildOfType(m, "formal_parameters")),
        visibility: "public",
        exported: exportedNow,
        parentName: qualified,
        language,
        parseStatus: "ok",
      });
    }
  }

  // Visit field initializers so calls inside them (including `new X()`) are recorded.
  for (const m of allChildren(body)) {
    if (!m.isNamed) continue;
    const value = m.childForFieldName("value");
    if (value && value.type !== "statement_block") visitFunctionBody(value, out, language);
  }
}

function extractFunctionDecl(
  node: Parser.SyntaxNode,
  out: ExtractedFile,
  exported: Set<RawSymbol>,
  scope: string[],
  isExported: boolean,
  language: LanguageId,
  kindOverride?: RawSymbol["kind"],
): void {
  const nameNode = namedChildOfType(node, "identifier");
  const name = nameNode ? nodeText(nameNode) : "<anonymous>";
  const qualified = [...scope, name].join(".");
  const params = namedChildOfType(node, "formal_parameters");
  const exportedNow = isExported || isUnderExport(node);
  const sym: RawSymbol = {
    kind: kindOverride ?? "function",
    name,
    qualifiedName: qualified,
    startLine: lineOf(node),
    endLine: endLineOf(node),
    signature: signatureOf(node, params),
    visibility: "public",
    exported: exportedNow,
    parentName: scope.length ? scope[scope.length - 1] : null,
    paramCount: params ? paramCountOf(node) : undefined,
    language,
    parseStatus: "ok",
  };
  addSymbol(out, sym);
  if (exportedNow) exported.add(sym);
  visitFunctionBody(node, out, language);
}

function visitFunctionBody(fn: Parser.SyntaxNode, out: ExtractedFile, language: LanguageId): void {
  const calls = fn.descendantsOfType("call_expression");
  for (const call of calls) {
    const fnNode = call.childForFieldName("function");
    if (!fnNode) continue;
    const chain = memberChain(fnNode);
    if (!chain) continue;
    const dotted = chain.split(".");
    const receiver = dotted.length > 1 ? dotted.slice(0, -1).join(".") : null;
    let isAwaited = false;
    let p: Parser.SyntaxNode | null = call.parent;
    let depth = 0;
    while (p && depth < 3) {
      if (p.type === "await_expression") {
        isAwaited = true;
        break;
      }
      p = p.parent;
      depth++;
    }
    out.calls.push({
      line: lineOf(call),
      name: dotted[dotted.length - 1],
      isConstructor: false,
      isAwaited,
      receiver,
      calleeText: chain,
    });
  }
  for (const n of fn.descendantsOfType("new_expression")) {
    const target = n.namedChild(0);
    if (!target) continue;
    const chain = memberChain(target);
    if (!chain) continue;
    const dotted = chain.split(".");
    out.calls.push({
      line: lineOf(n),
      name: dotted[dotted.length - 1],
      isConstructor: true,
      isAwaited: false,
      receiver: dotted.length > 1 ? dotted.slice(0, -1).join(".") : null,
      calleeText: `new ${chain}`,
    });
  }
  for (const id of fn.descendantsOfType("identifier")) {
    const parent = id.parent;
    if (!parent) continue;
    // Only treat identifiers that are not part of a declaration/call callee as reads.
    if (parent.type === "call_expression" && parent.childForFieldName("function") === id) continue;
    if (parent.type === "variable_declarator" && parent.childForFieldName("name") === id) continue;
    if (parent.type === "formal_parameters") continue;
    if (parent.type === "member_expression" && parent.childForFieldName("property") === id) continue;
    out.reads.push({ line: lineOf(id), name: nodeText(id) });
  }
  void language;
}

function extractVariableDeclaration(
  node: Parser.SyntaxNode,
  out: ExtractedFile,
  exported: Set<RawSymbol>,
  scope: string[],
  isExported: boolean,
  language: LanguageId,
): void {
  for (const decl of childrenOfType(node, "variable_declarator")) {
    const nameNode = decl.childForFieldName("name") ?? namedChildOfType(decl, "identifier");
    const value = decl.childForFieldName("value") ?? decl.namedChild(decl.namedChildCount - 1);
    const name = nameNode ? nodeText(nameNode) : "<anon>";
    const qualified = [...scope, name].join(".");
    const exportedNow = isExported || isUnderExport(node);
    const valueIsFunction = value ? FUNCTION_LIKE.has(value.type) : false;
    const valueIsWrappedFn =
      value && value.type === "call_expression" ? !!value.descendantsOfType("arrow_function").length || !!value.descendantsOfType("function_expression").length : false;
    const isClassLike = value ? value.type === "class_declaration" || value.type === "class" : false;

    let kind: RawSymbol["kind"] = "variable";
    if (valueIsFunction || valueIsWrappedFn) kind = "function";
    else if (isClassLike) kind = "class";
    else if (nameNode && isConstantName(name)) kind = "constant";

    const sym: RawSymbol = {
      kind,
      name,
      qualifiedName: qualified,
      startLine: lineOf(decl),
      endLine: endLineOf(decl),
      signature: valueIsFunction && value ? signatureOf(value, namedChildOfType(value, "formal_parameters")) : firstLineText(node, 120),
      visibility: "public",
      exported: exportedNow,
      parentName: scope.length ? scope[scope.length - 1] : null,
      paramCount: valueIsFunction && value ? paramCountOf(value) : undefined,
      language,
      parseStatus: "ok",
    };
    addSymbol(out, sym);
    if (exportedNow) exported.add(sym);
    if (value) visitFunctionBody(value, out, language);
  }
}

function visitDeclaration(
  node: Parser.SyntaxNode,
  out: ExtractedFile,
  exported: Set<RawSymbol>,
  scope: string[],
  isExported: boolean,
): void {
  const language = out.language;
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration":
      extractFunctionDecl(node, out, exported, scope, isExported, language);
      return;
    case "class_declaration":
    case "abstract_class_declaration":
    case "class":
      extractClassLike(node, out, exported, scope, isExported, language);
      return;
    case "interface_declaration":
    case "type_alias_declaration":
    case "enum_declaration": {
      const nameNode = namedChildOfType(node, "type_identifier") ?? namedChildOfType(node, "identifier");
      const name = nameNode ? nodeText(nameNode) : "<anonymous>";
      const kind: RawSymbol["kind"] = node.type === "interface_declaration" ? "interface" : node.type === "enum_declaration" ? "enum" : "type";
      const exportedNow = isExported || isUnderExport(node);
      const sym: RawSymbol = {
        kind,
        name,
        qualifiedName: [...scope, name].join("."),
        startLine: lineOf(node),
        endLine: endLineOf(node),
        signature: firstLineText(node, 160),
        visibility: "public",
        exported: exportedNow,
        parentName: scope.length ? scope[scope.length - 1] : null,
        language,
        parseStatus: "ok",
      };
      addSymbol(out, sym);
      if (exportedNow) exported.add(sym);
      if (node.type === "interface_declaration") {
        const body = namedChildOfType(node, "interface_body");
        if (body) {
          for (const m of childrenOfType(body, "method_signature")) {
            const prop = namedChildOfType(m, "property_identifier");
            const mName = prop ? nodeText(prop) : "<method>";
            addSymbol(out, {
              kind: "method",
              name: mName,
              qualifiedName: `${sym.qualifiedName}.${mName}`,
              startLine: lineOf(m),
              endLine: endLineOf(m),
              signature: signatureOf(m, namedChildOfType(m, "formal_parameters")),
              visibility: "public",
              exported: exportedNow,
              parentName: sym.qualifiedName,
              language,
              parseStatus: "ok",
            });
          }
        }
      }
      return;
    }
    case "internal_module": {
      const nameNode = namedChildOfType(node, "identifier");
      const name = nameNode ? nodeText(nameNode) : "<anonymous>";
      const exportedNow = isExported || isUnderExport(node);
      const sym: RawSymbol = {
        kind: "module",
        name,
        qualifiedName: [...scope, name].join("."),
        startLine: lineOf(node),
        endLine: endLineOf(node),
        signature: `namespace ${name}`,
        visibility: "public",
        exported: exportedNow,
        parentName: scope.length ? scope[scope.length - 1] : null,
        language,
        parseStatus: "ok",
      };
      addSymbol(out, sym);
      if (exportedNow) exported.add(sym);
      const block = namedChildOfType(node, "statement_block");
      if (block) visitStatements(block, out, exported, [...scope, name], language);
      return;
    }
    case "lexical_declaration":
    case "variable_declaration":
      extractVariableDeclaration(node, out, exported, scope, isExported, language);
      return;
    case "export_statement":
      extractExportStatement(node, out, exported, scope);
      return;
    case "import_statement":
      extractImportStatement(node, out.path, out);
      return;
    case "expression_statement": {
      const expr = node.namedChild(0);
      if (expr && expr.type === "call_expression") visitFunctionBody(expr, out, language);
      return;
    }
    default: {
      // Framework registrations and other top-level calls still matter.
      if (node.type === "call_expression" || node.type === "await_expression") visitFunctionBody(node, out, language);
      return;
    }
  }
}

function visitStatements(block: Parser.SyntaxNode, out: ExtractedFile, exported: Set<RawSymbol>, scope: string[], language: LanguageId): void {
  for (const c of allChildren(block)) {
    if (c.isNamed) visitDeclaration(c, out, exported, scope, false);
  }
  void language;
}

/** Detect top-level framework registrations as entry points (best effort). */
function detectEntryPoints(out: ExtractedFile, root: Parser.SyntaxNode): void {
  const file = out.path.toLowerCase();
  for (const call of out.calls) {
    const chain = call.calleeText;
    if (/^(app|server|router|fastify|express|koa)\.(get|post|put|patch|delete|all|use|route|listen|handle)$/.test(chain)) {
      out.entryPoints.push(makeEntry("http-route", chain, out.path, root, `framework registration: ${chain} at line ${call.line}`, chain.split(".")[0], null));
    } else if (/^(app|router)\.(get|post|put|patch|delete)$/.test(chain)) {
      out.entryPoints.push(makeEntry("http-route", chain, out.path, root, `route registration at line ${call.line}`, null, null));
    }
  }
  if (/\/(cli|bin|commands?|main)\//.test(file) || /(cli|commander|yargs|argparse)/.test(file)) {
    const mainSym = out.symbols.find((s) => s.name === "main" || s.name === "run" || s.name === "cli");
    if (mainSym) out.entryPoints.push(makeEntry("cli", mainSym.name, out.path, root, `file role suggests CLI (${out.path})`, null, null));
  }
}

export function extractTypeScriptFamily(root: Parser.SyntaxNode, filePath: string, language: LanguageId, parseStatus: "ok" | "partial"): ExtractedFile {
  const out: ExtractedFile = {
    path: filePath,
    language,
    parseStatus,
    errorRanges: [],
    symbols: [],
    imports: [],
    calls: [],
    reads: [],
    entryPoints: [],
    notes: [],
  };
  const exported = new Set<RawSymbol>();
  visitStatements(root, out, exported, [], language);
  detectEntryPoints(out, root);
  return out;
}
