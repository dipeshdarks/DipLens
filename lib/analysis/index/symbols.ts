/* Symbol table construction and reference resolution.
 *
 * IDs are stable across runs: `${path}::${qualifiedName}::${startLine}`.
 * Resolution never invents a target — every reference ends up resolved,
 * ambiguous (with the candidates), or unresolved (with a reason).
 */

import type {
  ImportRecord,
  ReferenceRecord,
  SymbolRecord,
} from "@/lib/analysis/engine/types";
import type { ExtractedFile, RawSymbol } from "@/lib/analysis/lang";
import { resolveImport, dirOf } from "./resolve";

export type SymbolTable = {
  symbols: SymbolRecord[];
  byId: Map<string, SymbolRecord>;
  fileSymbols: Map<string, SymbolRecord[]>;
  /** path -> exported local name -> symbol id */
  exportsByFile: Map<string, Map<string, string>>;
  /** path -> local binding name -> target */
  bindings: Map<string, Map<string, Binding>>;
  imports: ImportRecord[];
  references: ReferenceRecord[];
  /** path -> repository directories (for Go package matching) */
  knownDirs: Set<string>;
  stats: {
    filesParsed: number;
    symbols: number;
    imports: number;
    importsResolved: number;
    references: number;
    referencesResolved: number;
    referencesAmbiguous: number;
    referencesUnresolved: number;
  };
};

export type Binding =
  | { kind: "local-symbol"; symbolId: string; name: string }
  | { kind: "import"; source: string; importedName: string; localName: string; resolvedPath: string | null }
  | { kind: "external"; source: string; importedName: string; localName: string };

export function symbolIdOf(path: string, qualifiedName: string, startLine: number): string {
  return `${path}::${qualifiedName}::${startLine}`;
}

function toSymbolRecord(path: string, raw: RawSymbol): SymbolRecord {
  return {
    id: symbolIdOf(path, raw.qualifiedName, raw.startLine),
    kind: raw.kind,
    name: raw.name,
    qualifiedName: raw.qualifiedName,
    path,
    startLine: raw.startLine,
    endLine: raw.endLine,
    signature: raw.signature,
    visibility: raw.visibility,
    exported: raw.exported,
    parentId: null,
    language: raw.language,
    parseStatus: raw.parseStatus,
    paramCount: raw.paramCount,
  };
}

export function buildSymbolTable(files: ExtractedFile[]): SymbolTable {
  const symbols: SymbolRecord[] = [];
  const byId = new Map<string, SymbolRecord>();
  const fileSymbols = new Map<string, SymbolRecord[]>();
  const exportsByFile = new Map<string, Map<string, string>>();
  const bindings = new Map<string, Map<string, Binding>>();
  const imports: ImportRecord[] = [];
  const references: ReferenceRecord[] = [];
  const knownDirs = new Set<string>();

  const codeFiles = files.filter((f) => f.symbols.length > 0 || f.imports.length > 0 || f.calls.length > 0);
  const knownPaths = new Set(files.map((f) => f.path));
  for (const p of knownPaths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      knownDirs.add(parts.slice(0, i).join("/"));
    }
  }

  /* Pass 1: symbols + per-file export map. */
  for (const file of codeFiles) {
    const list: SymbolRecord[] = [];
    for (const raw of file.symbols) {
      const rec = toSymbolRecord(file.path, raw);
      // Link children to parents.
      if (raw.parentName) {
        const parent = file.symbols.find((s) => s.qualifiedName === raw.parentName);
        if (parent) rec.parentId = symbolIdOf(file.path, parent.qualifiedName, parent.startLine);
      }
      byId.set(rec.id, rec);
      list.push(rec);
      symbols.push(rec);
    }
    fileSymbols.set(file.path, list);

    const exp = new Map<string, string>();
    for (const rec of list) {
      if (rec.exported) exp.set(rec.name, rec.id);
      // Top-level names are always importable within the file even when not exported.
    }
    exportsByFile.set(file.path, exp);
  }

  /* Pass 2: imports + local bindings. */
  for (const file of codeFiles) {
    const map = new Map<string, Binding>();
    // Every symbol in the file is a local binding by its simple name.
    for (const rec of fileSymbols.get(file.path) ?? []) {
      if (!map.has(rec.name)) map.set(rec.name, { kind: "local-symbol", symbolId: rec.id, name: rec.name });
    }

    for (const imp of file.imports) {
      const outcome = resolveImport(file.language, file.path, imp.source, knownPaths, knownDirs);
      const record: ImportRecord = {
        path: file.path,
        line: imp.line,
        source: imp.source,
        specifiers: imp.specifiers,
        resolvedPath: outcome.resolvedPath,
        resolution: outcome.resolution,
        unresolvedReason: outcome.reason,
      };
      imports.push(record);

      for (const spec of imp.specifiers) {
        if (!spec.local) continue;
        if (outcome.resolvedPath) {
          map.set(spec.local, {
            kind: "import",
            source: imp.source,
            importedName: spec.imported,
            localName: spec.local,
            resolvedPath: outcome.resolvedPath,
          });
        } else {
          map.set(spec.local, {
            kind: "external",
            source: imp.source,
            importedName: spec.imported,
            localName: spec.local,
          });
        }
      }
      // Namespace import: `import * as ns` binds the namespace, member access
      // is resolved later via `ns.member`.
      if (imp.specifiers.some((s) => s.kind === "namespace")) {
        const ns = imp.specifiers.find((s) => s.kind === "namespace");
        if (ns) map.set(ns.local, { kind: "external", source: imp.source, importedName: "*", localName: ns.local });
      }
    }
    bindings.set(file.path, map);
  }

  /* Pass 3: reference resolution. */
  let resolvedCount = 0;
  let ambiguousCount = 0;
  let unresolvedCount = 0;

  for (const file of codeFiles) {
    const map = bindings.get(file.path) ?? new Map<string, Binding>();
    const seen = new Set<string>();
    const push = (ref: ReferenceRecord) => {
      const key = `${ref.path}:${ref.line}:${ref.name}:${ref.use}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (ref.resolution === "resolved") resolvedCount++;
      else if (ref.resolution === "ambiguous") ambiguousCount++;
      else unresolvedCount++;
      references.push(ref);
    };

    for (const call of file.calls) {
      const name = call.name;
      const dotted = call.calleeText;
      const binding = map.get(name);

      // Receiver-qualified call: `obj.method` — try to bind the receiver.
      if (dotted.includes(".")) {
        const head = dotted.split(".")[0];
        const headBinding = map.get(head);
        if (headBinding?.kind === "import" && headBinding.resolvedPath) {
          const targetId = exportsByFile.get(headBinding.resolvedPath)?.get(dotted.split(".").slice(1).join("."));
          if (targetId) {
            push({ path: file.path, line: call.line, name: dotted, use: "call", symbolId: targetId, resolution: "resolved" });
            continue;
          }
        }
        if (headBinding?.kind === "local-symbol") {
          const rec = byId.get(headBinding.symbolId);
          if (rec) {
            const member = dotted.split(".").slice(1).join(".");
            const candidates = (fileSymbols.get(rec.path) ?? []).filter(
              (s) => s.parentId === rec.id && s.name === member,
            );
            if (candidates.length === 1) {
              push({ path: file.path, line: call.line, name: dotted, use: "call", symbolId: candidates[0].id, resolution: "resolved" });
              continue;
            }
          }
        }
        // Same-file member call (`this.method`, `s.get`, `self.execute`).
        const member = dotted.split(".").slice(1).join(".");
        const localMembers = (fileSymbols.get(file.path) ?? []).filter((s) => s.name === member || s.qualifiedName.endsWith(`.${member}`));
        if (localMembers.length === 1) {
          push({ path: file.path, line: call.line, name: dotted, use: "call", symbolId: localMembers[0].id, resolution: "resolved" });
          continue;
        }
      }

      if (binding?.kind === "local-symbol") {
        push({ path: file.path, line: call.line, name: dotted, use: "call", symbolId: binding.symbolId, resolution: "resolved" });
        continue;
      }
      if (binding?.kind === "import" && binding.resolvedPath) {
        const targetId = exportsByFile.get(binding.resolvedPath)?.get(binding.importedName);
        if (targetId) {
          push({ path: file.path, line: call.line, name: dotted, use: "call", symbolId: targetId, resolution: "resolved" });
          continue;
        }
        push({
          path: file.path,
          line: call.line,
          name: dotted,
          use: "call",
          symbolId: null,
          resolution: "unresolved",
          unresolvedReason: `imported symbol not found in ${binding.resolvedPath}`,
        });
        continue;
      }
      if (binding?.kind === "external") {
        push({
          path: file.path,
          line: call.line,
          name: dotted,
          use: "call",
          symbolId: null,
          resolution: "unresolved",
          unresolvedReason: `external: ${binding.source}`,
        });
        continue;
      }

      // No binding: search the file, then the repository by simple name.
      const inFile = (fileSymbols.get(file.path) ?? []).filter((s) => s.name === name);
      if (inFile.length === 1) {
        push({ path: file.path, line: call.line, name: dotted, use: "call", symbolId: inFile[0].id, resolution: "resolved" });
        continue;
      }
      const inRepo = symbols.filter((s) => s.name === name && s.kind !== "field");
      if (inRepo.length === 1) {
        push({ path: file.path, line: call.line, name: dotted, use: "call", symbolId: inRepo[0].id, resolution: "resolved" });
        continue;
      }
      if (inRepo.length > 1) {
        push({
          path: file.path,
          line: call.line,
          name: dotted,
          use: "call",
          symbolId: null,
          resolution: "ambiguous",
          unresolvedReason: `${inRepo.length} symbols named ${name}; no import to disambiguate`,
        });
        continue;
      }
      push({
        path: file.path,
        line: call.line,
        name: dotted,
        use: "call",
        symbolId: null,
        resolution: "unresolved",
        unresolvedReason: "no binding and no repository symbol with this name",
      });
    }

    // Reads become references too (lower value but needed for coverage/impact).
    const readSeen = new Set<string>();
    for (const read of file.reads) {
      const key = `${read.line}:${read.name}`;
      if (readSeen.has(key)) continue;
      readSeen.add(key);
      const binding = map.get(read.name);
      if (binding?.kind === "local-symbol") {
        push({ path: file.path, line: read.line, name: read.name, use: "read", symbolId: binding.symbolId, resolution: "resolved" });
      }
    }
  }

  const importResolvedCount = imports.filter((i) => i.resolution === "resolved").length;

  return {
    symbols,
    byId,
    fileSymbols,
    exportsByFile,
    bindings,
    imports,
    references,
    knownDirs,
    stats: {
      filesParsed: codeFiles.length,
      symbols: symbols.length,
      imports: imports.length,
      importsResolved: importResolvedCount,
      references: references.length,
      referencesResolved: resolvedCount,
      referencesAmbiguous: ambiguousCount,
      referencesUnresolved: unresolvedCount,
    },
  };
}

export { dirOf };
