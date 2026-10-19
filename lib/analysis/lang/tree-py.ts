/* Python extraction (tree-sitter-python grammar). */

import type Parser from "web-tree-sitter";
import type { ImportSpecifier } from "@/lib/analysis/engine/types";
import type { ExtractedFile, RawImport, RawSymbol } from "./shared";
import { allChildren, childrenOfType, endLineOf, firstLineText, lineOf, makeEntry, namedChildOfType, nodeText } from "./shared";

function dottedNameOf(node: Parser.SyntaxNode | null): string | null {
  if (!node) return null;
  if (node.type === "dotted_name") {
    return allChildren(node)
      .filter((c) => c.type === "identifier")
      .map(nodeText)
      .join(".");
  }
  if (node.type === "relative_import") {
    const prefix = namedChildOfType(node, "import_prefix");
    const dots = prefix ? nodeText(prefix).length : 0;
    const rest = dottedNameOf(namedChildOfType(node, "dotted_name"));
    return `${".".repeat(Math.max(dots, 1))}${rest ?? ""}`;
  }
  return nodeText(node);
}

function paramCountOf(params: Parser.SyntaxNode | null): number | undefined {
  if (!params) return undefined;
  let n = 0;
  for (const c of allChildren(params)) {
    if (!c.isNamed) continue;
    if (["identifier", "default_parameter", "typed_parameter", "typed_default_parameter", "list_splat_pattern", "dictionary_splat_pattern"].includes(c.type)) n++;
  }
  return n;
}

function signatureOf(fn: Parser.SyntaxNode, params: Parser.SyntaxNode | null): string {
  const src = nodeText(fn);
  const start = fn.startIndex;
  const end = params ? params.endIndex : fn.startIndex + Math.min(src.length, 80);
  const raw = src.slice(0, end - start).replace(/\s+/g, " ").trim();
  const isAsync = allChildren(fn).some((c) => !c.isNamed && c.type === "async");
  const prefix = isAsync ? "async " : "";
  const full = `${prefix}def ${raw}`;
  return full.length > 200 ? `${full.slice(0, 199)}…` : full;
}

function visitFunction(
  node: Parser.SyntaxNode,
  out: ExtractedFile,
  scope: string[],
  parentClass: string | null,
  exported: boolean,
  symbols: RawSymbol[],
): void {
  const nameNode = namedChildOfType(node, "identifier");
  const name = nameNode ? nodeText(nameNode) : "<anonymous>";
  const params = namedChildOfType(node, "parameters");
  const isDunder = name.startsWith("__") && name.endsWith("__") && name.length > 4;
  const isPrivate = name.startsWith("_") && !isDunder;
  const sym: RawSymbol = {
    kind: parentClass ? "method" : "function",
    name,
    qualifiedName: [...scope, name].join("."),
    startLine: lineOf(node),
    endLine: endLineOf(node),
    signature: signatureOf(node, params),
    visibility: isPrivate ? "private" : "public",
    exported: !isPrivate,
    parentName: parentClass,
    paramCount: paramCountOf(params),
    language: "python",
    parseStatus: "ok",
  };
  symbols.push(sym);
  void exported;
  visitBody(node, out, scope, parentClass, symbols);
}

function visitBody(node: Parser.SyntaxNode, out: ExtractedFile, scope: string[], parentClass: string | null, symbols: RawSymbol[]): void {
  for (const c of allChildren(node)) {
    if (!c.isNamed) continue;
    if (c.type === "call") {
      const fn = c.childForFieldName("function");
      const chain = fn ? chainOf(fn) : null;
      if (chain) {
        const parts = chain.split(".");
        out.calls.push({
          line: lineOf(c),
          name: parts[parts.length - 1],
          isConstructor: parts.length > 1 && /^[A-Z]/.test(parts[parts.length - 1]),
          isAwaited: c.parent?.type === "await" || false,
          receiver: parts.length > 1 ? parts.slice(0, -1).join(".") : null,
          calleeText: chain,
        });
      }
      // Recurse into call arguments for nested calls.
      const args = namedChildOfType(c, "argument_list");
      if (args) visitBody(args, out, scope, parentClass, symbols);
      for (const kw of childrenOfType(args ?? c, "keyword_argument")) {
        const val = namedChildOfType(kw, "lambda");
        if (val) visitBody(val, out, scope, parentClass, symbols);
      }
    } else if (c.type === "lambda") {
      visitBody(c, out, scope, parentClass, symbols);
    } else if (c.type === "class_definition") {
      visitClass(c, out, [...scope], symbols);
    } else if (c.type === "function_definition") {
      visitFunction(c, out, scope, parentClass, false, symbols);
    } else if (c.type === "if_statement") {
      visitBody(c, out, scope, parentClass, symbols);
    } else if (c.type === "block" || c.type === "module") {
      visitBody(c, out, scope, parentClass, symbols);
    } else if (c.type === "expression_statement") {
      visitBody(c, out, scope, parentClass, symbols);
    } else if (c.type === "assignment") {
      const value = c.childForFieldName("value");
      if (value && ["lambda", "call", "class"].includes(value.type)) visitBody(value, out, scope, parentClass, symbols);
      const target = c.childForFieldName("left") ?? c.namedChild(0);
      if (target && target.type === "attribute") {
        const attr = target.childForFieldName("attribute") ?? target.namedChild(target.namedChildCount - 1);
        const obj = target.childForFieldName("object") ?? target.namedChild(0);
        if (attr) {
          const attrName = nodeText(attr);
          out.reads.push({ line: lineOf(attr), name: attrName });
          // `self.field = ...` inside a method declares an instance field of the class.
          if (parentClass && obj && nodeText(obj) === "self") {
            const q = `${parentClass}.${attrName}`;
            if (!symbols.some((s) => s.qualifiedName === q)) {
              symbols.push({
                kind: "field",
                name: attrName,
                qualifiedName: q,
                startLine: lineOf(c),
                endLine: endLineOf(c),
                signature: firstLineText(c, 120),
                visibility: attrName.startsWith("_") ? "private" : "public",
                exported: false,
                parentName: parentClass,
                language: "python",
                parseStatus: "ok",
              });
            }
          }
        }
      }
    } else if (c.type === "await") {
      visitBody(c, out, scope, parentClass, symbols);
    } else if (c.type === "return_statement" || c.type === "for_statement" || c.type === "while_statement" || c.type === "with_statement") {
      visitBody(c, out, scope, parentClass, symbols);
    }
  }
  for (const id of node.descendantsOfType("identifier")) {
    const p = id.parent;
    if (!p) continue;
    if (p.type === "call" && p.childForFieldName("function") === id) continue;
    if (p.type === "parameters") continue;
    if (p.type === "attribute" && p.childForFieldName("attribute") === id) continue;
    if (p.type === "class_definition" || p.type === "function_definition") continue;
    out.reads.push({ line: lineOf(id), name: nodeText(id) });
  }
}

function chainOf(node: Parser.SyntaxNode, depth = 0): string | null {
  if (depth > 8) return null;
  if (node.type === "identifier") return nodeText(node);
  if (node.type === "self") return "self";
  if (node.type === "attribute") {
    const obj = node.childForFieldName("object") ?? node.namedChild(0);
    const attr = node.childForFieldName("attribute") ?? node.namedChild(1);
    if (!attr) return null;
    const o = obj ? chainOf(obj, depth + 1) : null;
    return o ? `${o}.${nodeText(attr)}` : nodeText(attr);
  }
  return null;
}

function visitClass(node: Parser.SyntaxNode, out: ExtractedFile, scope: string[], symbols: RawSymbol[]): void {
  const nameNode = namedChildOfType(node, "identifier");
  const name = nameNode ? nodeText(nameNode) : "<anonymous>";
  const qualified = [...scope, name].join(".");
  const isPrivate = name.startsWith("_");
  symbols.push({
    kind: "class",
    name,
    qualifiedName: qualified,
    startLine: lineOf(node),
    endLine: endLineOf(node),
    signature: firstLineText(node, 160),
    visibility: isPrivate ? "private" : "public",
    exported: !isPrivate,
    parentName: scope.length ? scope[scope.length - 1] : null,
    language: "python",
    parseStatus: "ok",
  });
  const block = namedChildOfType(node, "block");
  if (!block) return;
  for (const c of allChildren(block)) {
    if (!c.isNamed) continue;
    if (c.type === "function_definition") {
      visitFunction(c, out, [...scope, name], qualified, false, symbols);
    } else if (c.type === "expression_statement") {
      const assign = c.namedChild(0);
      if (assign && assign.type === "assignment") {
        const left = assign.childForFieldName("left") ?? assign.childForFieldName("name") ?? assign.namedChild(0);
        // `self._cache = {}` is an attribute target; the field name is the `attribute` field.
        const attrField = left && left.type === "attribute" ? (left.childForFieldName("attribute") ?? left.namedChild(left.namedChildCount - 1)) : null;
        const leftName = left ? (attrField ? nodeText(attrField) : nodeText(left)) : "";
        if (leftName && /^[A-Za-z_]/.test(leftName)) {
          symbols.push({
            kind: "field",
            name: leftName,
            qualifiedName: `${qualified}.${leftName}`,
            startLine: lineOf(assign),
            endLine: endLineOf(assign),
            signature: firstLineText(assign, 120),
            visibility: leftName.startsWith("_") ? "private" : "public",
            exported: false,
            parentName: qualified,
            language: "python",
            parseStatus: "ok",
          });
        }
      }
    }
  }
}

export function extractPython(root: Parser.SyntaxNode, filePath: string, parseStatus: "ok" | "partial"): ExtractedFile {
  const out: ExtractedFile = {
    path: filePath,
    language: "python",
    parseStatus,
    errorRanges: [],
    symbols: [],
    imports: [],
    calls: [],
    reads: [],
    entryPoints: [],
    notes: [],
  };

  for (const c of allChildren(root)) {
    if (!c.isNamed) continue;
    if (c.type === "import_statement") {
      const names = childrenOfType(c, "dotted_name");
      const source = names.map(dottedNameOf).filter(Boolean).join(".");
      const specifiers: ImportSpecifier[] = names.map((n) => ({ local: dottedNameOf(n) ?? "", imported: dottedNameOf(n) ?? "", kind: "named" }));
      out.imports.push({ line: lineOf(c), source, specifiers, isReExport: false });
    } else if (c.type === "import_from_statement") {
      const modNode = c.namedChild(0);
      const source = dottedNameOf(modNode) ?? "";
      const specifiers: ImportSpecifier[] = [];
      for (let i = 1; i < c.namedChildCount; i++) {
        const n = c.namedChild(i);
        if (!n) continue;
        if (n.type === "aliased_import") {
          const dn = dottedNameOf(namedChildOfType(n, "dotted_name")) ?? "";
          const alias = namedChildOfType(n, "identifier");
          specifiers.push({ local: alias ? nodeText(alias) : dn, imported: dn, kind: "named" });
        } else if (n.type === "dotted_name") {
          const dn = dottedNameOf(n) ?? "";
          specifiers.push({ local: dn, imported: dn, kind: "named" });
        } else if (n.type === "identifier") {
          specifiers.push({ local: nodeText(n), imported: nodeText(n), kind: "named" });
        } else if (n.type === "wildcard_import") {
          specifiers.push({ local: "*", imported: "*", kind: "namespace" });
        }
      }
      out.imports.push({ line: lineOf(c), source, specifiers, isReExport: false });
    } else if (c.type === "class_definition") {
      visitClass(c, out, [], out.symbols);
    } else if (c.type === "function_definition") {
      visitFunction(c, out, [], null, false, out.symbols);
    } else if (c.type === "if_statement") {
      // `if __name__ == "__main__":`
      const cmp = c.childForFieldName("condition");
      if (cmp && cmp.type === "comparison_operator") {
        const text = nodeText(cmp);
        if (text.includes("__main__")) {
          const block = namedChildOfType(c, "block");
          const mainFn = out.symbols.find((s) => s.name === "main");
          out.entryPoints.push(
            makeEntry(
              "main",
              mainFn ? mainFn.name : "module-main",
              filePath,
              block ?? c,
              "Python __main__ guard invokes this module's entry",
              "python",
              null,
            ),
          );
          if (block) visitBody(block, out, [], null, out.symbols);
        } else {
          visitBody(c, out, [], null, out.symbols);
        }
      } else {
        visitBody(c, out, [], null, out.symbols);
      }
    } else if (c.type === "decorated_definition") {
      const inner = namedChildOfType(c, "definition");
      if (inner) {
        if (inner.type === "class_definition") visitClass(inner, out, [], out.symbols);
        else if (inner.type === "function_definition") visitFunction(inner, out, [], null, false, out.symbols);
      }
      const decos = childrenOfType(c, "decorator");
      for (const d of decos) {
        const chain = d.namedChild(0) ? chainOf(d.namedChild(0)!) : null;
        if (chain && /route|get|post|app\.|endpoint|api/i.test(chain)) {
          out.entryPoints.push(makeEntry("http-route", chain, filePath, d, `decorator registration: ${chain}`, chain.split(".")[0], null));
        }
      }
    } else {
      visitBody(c, out, [], null, out.symbols);
    }
  }

  const flask = out.imports.some((i) => /flask|fastapi|django|starlette/.test(i.source));
  if (flask) {
    for (const s of out.symbols) {
      if (s.kind === "function" && out.entryPoints.length < 5) {
        out.entryPoints.push(makeEntry("api-handler", s.name, filePath, root, "declared in a web-framework module", null, null));
        break;
      }
    }
  }
  return out;
}
