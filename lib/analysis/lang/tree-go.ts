/* Go extraction (tree-sitter-go grammar). */

import type Parser from "web-tree-sitter";
import type { ImportSpecifier } from "@/lib/analysis/engine/types";
import type { ExtractedFile, RawSymbol } from "./shared";
import { allChildren, childrenOfType, endLineOf, firstLineText, lineOf, makeEntry, namedChildOfType, nodeText } from "./shared";

function chainOf(node: Parser.SyntaxNode, depth = 0): string | null {
  if (depth > 8) return null;
  if (node.type === "identifier" || node.type === "field_identifier" || node.type === "package_identifier") return nodeText(node);
  if (node.type === "selector_expression") {
    const obj = node.namedChild(0);
    const field = namedChildOfType(node, "field_identifier") ?? node.namedChild(1);
    if (!field) return null;
    const o = obj ? chainOf(obj, depth + 1) : null;
    return o ? `${o}.${nodeText(field)}` : nodeText(field);
  }
  if (node.type === "call_expression") {
    const fn = node.childForFieldName("function");
    return fn ? chainOf(fn, depth + 1) : null;
  }
  return null;
}

function paramCountOf(list: Parser.SyntaxNode | null): number | undefined {
  if (!list) return undefined;
  let n = 0;
  for (const c of allChildren(list)) {
    if (c.type === "parameter_declaration" || c.type === "variadic_parameter_declaration") {
      const names = childrenOfType(c, "identifier");
      n += Math.max(names.length, 1);
    }
  }
  return n;
}

function signatureOf(decl: Parser.SyntaxNode, params: Parser.SyntaxNode | null): string {
  const src = nodeText(decl);
  const start = decl.startIndex;
  const end = params ? params.endIndex : start + Math.min(src.length, 80);
  const raw = src.slice(0, end - start).replace(/\s+/g, " ").trim();
  return raw.length > 200 ? `${raw.slice(0, 199)}…` : raw;
}

/** Receiver type name, e.g. `*Server` → Server. */
function receiverType(node: Parser.SyntaxNode): string | null {
  const recv = node.namedChild(0);
  if (!recv || recv.type !== "parameter_list") return null;
  const decl = childrenOfType(recv, "parameter_declaration")[0];
  if (!decl) return null;
  const ty = decl.namedChild(decl.namedChildCount - 1);
  if (!ty) return null;
  if (ty.type === "pointer_type") {
    const inner = ty.namedChild(0);
    return inner ? nodeText(inner) : null;
  }
  return nodeText(ty);
}

function visitBody(block: Parser.SyntaxNode, out: ExtractedFile, symbols: RawSymbol[], qualified: string): void {
  for (const call of block.descendantsOfType("call_expression")) {
    const fn = call.childForFieldName("function");
    if (!fn) continue;
    const chain = chainOf(fn);
    if (!chain) continue;
    const parts = chain.split(".");
    out.calls.push({
      line: lineOf(call),
      name: parts[parts.length - 1],
      isConstructor: /^new|New[A-Z]/.test(parts[parts.length - 1]),
      isAwaited: false,
      receiver: parts.length > 1 ? parts.slice(0, -1).join(".") : null,
      calleeText: chain,
    });
  }
  for (const id of block.descendantsOfType("identifier")) {
    const p = id.parent;
    if (!p) continue;
    if (p.type === "call_expression" && p.childForFieldName("function") === id) continue;
    if (p.type === "parameter_declaration" || p.type === "short_var_declaration") continue;
    if (p.type === "selector_expression" && p.childForFieldName("field") === id) continue;
    if (p.type === "field_identifier" || p.type === "type_identifier") continue;
    out.reads.push({ line: lineOf(id), name: nodeText(id) });
  }
  void symbols;
  void qualified;
}

export function extractGo(root: Parser.SyntaxNode, filePath: string, parseStatus: "ok" | "partial"): ExtractedFile {
  const out: ExtractedFile = {
    path: filePath,
    language: "go",
    parseStatus,
    errorRanges: [],
    symbols: [],
    imports: [],
    calls: [],
    reads: [],
    entryPoints: [],
    notes: [],
  };
  const pkgNode = root.namedChild(0);
  const pkgName = pkgNode && pkgNode.type === "package_clause" ? (namedChildOfType(pkgNode, "package_identifier") ? nodeText(namedChildOfType(pkgNode, "package_identifier")!) : "") : "";

  for (const c of allChildren(root)) {
    if (!c.isNamed) continue;

    if (c.type === "import_declaration") {
      // Import specs live inside an `import_spec_list` for grouped imports,
      // and directly under the declaration for the single-spec form.
      const list = namedChildOfType(c, "import_spec_list");
      const specs = list ? childrenOfType(list, "import_spec") : childrenOfType(c, "import_spec");
      for (const spec of specs) {
        const lit = namedChildOfType(spec, "interpreted_string_literal") ?? spec.namedChild(0);
        const source = lit ? nodeText(lit).replace(/^"/, "").replace(/"$/, "") : "";
        const specifiers: ImportSpecifier[] = source ? [{ local: source.split("/").pop() ?? source, imported: source, kind: "namespace" }] : [];
        out.imports.push({ line: lineOf(spec), source, specifiers, isReExport: false });
      }
    } else if (c.type === "function_declaration") {
      const nameNode = namedChildOfType(c, "identifier");
      const name = nameNode ? nodeText(nameNode) : "<anonymous>";
      const params = namedChildOfType(c, "parameter_list");
      const isMain = name === "main" && pkgName === "main";
      out.symbols.push({
        kind: "function",
        name,
        qualifiedName: name,
        startLine: lineOf(c),
        endLine: endLineOf(c),
        signature: signatureOf(c, params),
        visibility: name.startsWith(name.slice(0, 1)) && /^[A-Z]/.test(name) ? "public" : "private",
        exported: /^[A-Z]/.test(name),
        parentName: null,
        paramCount: paramCountOf(params),
        language: "go",
        parseStatus: "ok",
      });
      const block = namedChildOfType(c, "block");
      if (block) visitBody(block, out, out.symbols, name);
      if (isMain && block) {
        out.entryPoints.push(makeEntry("main", "main", filePath, c, "Go package main func main", "go", null));
      }
    } else if (c.type === "method_declaration") {
      const nameNode = namedChildOfType(c, "field_identifier");
      const name = nameNode ? nodeText(nameNode) : "<anonymous>";
      const recv = receiverType(c);
      const params = childrenOfType(c, "parameter_list")[1] ?? null;
      const qualified = recv ? `${recv}.${name}` : name;
      out.symbols.push({
        kind: "method",
        name,
        qualifiedName: qualified,
        startLine: lineOf(c),
        endLine: endLineOf(c),
        signature: signatureOf(c, params),
        visibility: /^[A-Z]/.test(name) ? "public" : "private",
        exported: /^[A-Z]/.test(name),
        parentName: recv,
        paramCount: paramCountOf(params),
        language: "go",
        parseStatus: "ok",
      });
      const block = namedChildOfType(c, "block");
      if (block) visitBody(block, out, out.symbols, qualified);
      // HTTP handler heuristic: signature (http.ResponseWriter, *http.Request)
      if (block) {
        const paramsText = params ? nodeText(params) : "";
        if (paramsText.includes("ResponseWriter") && paramsText.includes("Request")) {
          out.entryPoints.push(makeEntry("http-route", qualified, filePath, c, "Go http.Handler signature (ResponseWriter, *Request)", "net/http", null));
        }
      }
    } else if (c.type === "type_declaration") {
      for (const spec of childrenOfType(c, "type_spec")) {
        const nameNode = namedChildOfType(spec, "type_identifier");
        const name = nameNode ? nodeText(nameNode) : "<anonymous>";
        const isStruct = !!namedChildOfType(spec, "struct_type");
        const isIface = !!namedChildOfType(spec, "interface_type");
        out.symbols.push({
          kind: isStruct || isIface ? "class" : "type",
          name,
          qualifiedName: name,
          startLine: lineOf(spec),
          endLine: endLineOf(spec),
          signature: firstLineText(spec, 160),
          visibility: /^[A-Z]/.test(name) ? "public" : "private",
          exported: /^[A-Z]/.test(name),
          parentName: null,
          language: "go",
          parseStatus: "ok",
        });
        if (isStruct) {
          const fields = namedChildOfType(namedChildOfType(spec, "struct_type")!, "field_declaration_list");
          if (fields) {
            for (const f of childrenOfType(fields, "field_declaration")) {
              const fn = namedChildOfType(f, "field_identifier") ?? f.namedChild(0);
              if (!fn) continue;
              const fieldName = nodeText(fn);
              out.symbols.push({
                kind: "field",
                name: fieldName,
                qualifiedName: `${name}.${fieldName}`,
                startLine: lineOf(f),
                endLine: endLineOf(f),
                signature: firstLineText(f, 120),
                visibility: /^[A-Z]/.test(fieldName) ? "public" : "private",
                exported: /^[A-Z]/.test(fieldName),
                parentName: name,
                language: "go",
                parseStatus: "ok",
              });
            }
          }
        }
        if (isIface) {
          const body = namedChildOfType(namedChildOfType(spec, "interface_type")!, "method_spec_list");
          if (body) {
            for (const m of childrenOfType(body, "method_spec")) {
              const mn = namedChildOfType(m, "field_identifier") ?? namedChildOfType(m, "identifier");
              if (!mn) continue;
              const methodName = nodeText(mn);
              out.symbols.push({
                kind: "method",
                name: methodName,
                qualifiedName: `${name}.${methodName}`,
                startLine: lineOf(m),
                endLine: endLineOf(m),
                signature: firstLineText(m, 160),
                visibility: /^[A-Z]/.test(methodName) ? "public" : "private",
                exported: /^[A-Z]/.test(methodName),
                parentName: name,
                language: "go",
                parseStatus: "ok",
              });
            }
          }
        }
      }
    }
  }

  for (const call of out.calls) {
    if (/^http\.ListenAndServe$|^(net|http)\.Handle/.test(call.calleeText)) {
      out.entryPoints.push(makeEntry("main", call.calleeText, filePath, root, `server start call: ${call.calleeText} (line ${call.line})`, "net/http", null));
    }
  }
  return out;
}
