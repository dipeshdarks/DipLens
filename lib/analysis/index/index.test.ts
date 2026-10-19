// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseSource } from "@/lib/analysis/parsers/loader";
import { extractFromTree } from "@/lib/analysis/lang";
import { buildSymbolTable } from "@/lib/analysis/index/symbols";
import { buildCallGraph } from "@/lib/analysis/graph/callgraph";
import { reconstructPaths } from "@/lib/analysis/graph/paths";
import { computeComplexity } from "@/lib/analysis/lang/complexity";
import type { ExtractedFile } from "@/lib/analysis/lang";

const FILES: Record<string, { lang: "typescript" | "python" | "go"; src: string }> = {
  "src/db.ts": {
    lang: "typescript",
    src: `export function query(sql: string) {
  return sql.length;
}
export function escape(s: string) {
  return s.replace(/'/g, "''");
}
`,
  },
  "src/users.ts": {
    lang: "typescript",
    src: `import { query, escape } from "./db";
export function findUser(name: string) {
  return query("select * from users where name = '" + escape(name) + "'");
}
export function findRaw(name: string) {
  return query("select * from users where name = '" + name + "'");
}
`,
  },
  "src/api.ts": {
    lang: "typescript",
    src: `import { findUser, findRaw } from "./users";
export function getUser(req: { name: string }) {
  return findUser(req.name);
}
export function getRaw(req: { name: string }) {
  return findRaw(req.name);
}
`,
  },
  "app/views.py": {
    lang: "python",
    src: `from app.store import save, load

def index(request):
    data = load(request.GET["q"])
    return data

def create(request):
    save(request.body)
    return "ok"
`,
  },
  "app/store.py": {
    lang: "python",
    src: `def save(row):
    return row

def load(key):
    return key
`,
  },
  "cmd/main.go": {
    lang: "go",
    src: `package main

import "fmt"

func helper(n int) int {
  if n > 0 {
    return n
  }
  return 0
}

func main() {
  fmt.Println(helper(1))
}
`,
  },
};

async function buildFixture(): Promise<ExtractedFile[]> {
  const out: ExtractedFile[] = [];
  for (const [path, { lang, src }] of Object.entries(FILES)) {
    const parsed = await parseSource(lang, src);
    expect(parsed.failure, path).toBeNull();
    const extracted = extractFromTree(parsed.rootNode!, path, lang, "ok");
    extracted.errorRanges = parsed.errorRanges;
    out.push(extracted);
  }
  return out;
}

describe("symbol table and import resolution", () => {
  it("resolves relative TS imports to repository files", async () => {
    const table = buildSymbolTable(await buildFixture());
    const tsImports = table.imports.filter((i) => i.path.endsWith(".ts"));
    expect(tsImports.every((i) => i.resolution === "resolved")).toBe(true);
    expect(tsImports.find((i) => i.path === "src/users.ts")?.resolvedPath).toBe("src/db.ts");
    expect(tsImports.find((i) => i.path === "src/api.ts")?.resolvedPath).toBe("src/users.ts");
  });

  it("resolves relative Python imports", async () => {
    const table = buildSymbolTable(await buildFixture());
    const py = table.imports.find((i) => i.path === "app/views.py");
    expect(py?.resolution).toBe("resolved");
    expect(py?.resolvedPath).toBe("app/store.py");
  });

  it("labels Go stdlib imports as external with a reason", async () => {
    const table = buildSymbolTable(await buildFixture());
    const go = table.imports.find((i) => i.path === "cmd/main.go");
    expect(go?.resolution).toBe("unresolved");
    expect(go?.unresolvedReason).toMatch(/standard library/);
  });

  it("assigns stable ids and links children to parents", async () => {
    const table = buildSymbolTable(await buildFixture());
    const userClass = table.symbols.find((s) => s.id === "src/db.ts::query::1");
    expect(userClass).toBeTruthy();
    expect(table.symbols.every((s) => s.id.includes(s.path))).toBe(true);
  });

  it("resolves calls across files", async () => {
    const table = buildSymbolTable(await buildFixture());
    const apiToUsers = table.references.find((r) => r.path === "src/api.ts" && r.name === "findUser");
    expect(apiToUsers?.resolution).toBe("resolved");
    expect(table.byId.get(apiToUsers!.symbolId!)?.path).toBe("src/users.ts");

    const usersToDb = table.references.find((r) => r.path === "src/users.ts" && r.name === "query");
    expect(usersToDb?.resolution).toBe("resolved");
    expect(table.byId.get(usersToDb!.symbolId!)?.path).toBe("src/db.ts");
  });

  it("reports unresolved external calls rather than inventing targets", async () => {
    const table = buildSymbolTable(await buildFixture());
    // Reference `name` is the full dotted callee as written in source.
    const fmt = table.references.find((r) => r.path === "cmd/main.go" && r.name === "fmt.Println");
    expect(fmt?.resolution).toBe("unresolved");
    expect(fmt?.unresolvedReason).toMatch(/standard library|external|no binding/);
  });

  it("links Python module-level calls within a file", async () => {
    const table = buildSymbolTable(await buildFixture());
    const pyCall = table.references.find((r) => r.path === "app/store.py" || r.path === "app/views.py");
    const saveCall = table.references.find((r) => r.path === "app/views.py" && r.name === "save");
    expect(saveCall?.resolution).toBe("resolved");
    expect(table.byId.get(saveCall!.symbolId!)?.path).toBe("app/store.py");
    expect(pyCall).toBeTruthy();
  });
});

describe("call graph", () => {
  it("builds confirmed cross-file edges and counts unresolved calls", async () => {
    const files = await buildFixture();
    const table = buildSymbolTable(files);
    const graph = buildCallGraph(table, table.symbols);

    const edgeKeys = graph.edges.map((e) => `${e.from}->${e.to}`);
    const apiGetUser = table.symbols.find((s) => s.path === "src/api.ts" && s.name === "getUser")!;
    const usersFindUser = table.symbols.find((s) => s.path === "src/users.ts" && s.name === "findUser")!;
    expect(edgeKeys).toContain(`${apiGetUser.id}->${usersFindUser.id}`);
    expect(graph.stats.confirmedEdges).toBeGreaterThan(0);
    expect(graph.stats.unresolvedCalls).toBeGreaterThan(0);
  });

  it("records in-degree so hubs are identifiable", async () => {
    const files = await buildFixture();
    const table = buildSymbolTable(files);
    const graph = buildCallGraph(table, table.symbols);
    const dbQuery = table.symbols.find((s) => s.path === "src/db.ts" && s.name === "query")!;
    expect((graph.incoming.get(dbQuery.id) ?? []).length).toBe(2);
  });

  it("marks convention-based test links as approximate", async () => {
    const testFile: ExtractedFile = {
      path: "src/users.test.ts",
      language: "typescript",
      parseStatus: "ok",
      errorRanges: [],
      symbols: [
        {
          kind: "function",
          name: "testFindUser",
          qualifiedName: "testFindUser",
          startLine: 1,
          endLine: 3,
          signature: "function testFindUser()",
          visibility: "public",
          exported: true,
          parentName: null,
          language: "typescript",
          parseStatus: "ok",
        },
      ],
      imports: [],
      calls: [],
      reads: [],
      entryPoints: [],
      notes: [],
    };
    const table = buildSymbolTable([...(await buildFixture()), testFile]);
    const graph = buildCallGraph(table, table.symbols);
    expect(graph.stats.approximateEdges).toBeGreaterThanOrEqual(1);
    expect(graph.edges.some((e) => e.kind === "tests" && e.confidence === "approximate")).toBe(true);
  });
});

describe("execution paths", () => {
  it("walks from entry points down confirmed edges", async () => {
    const files = await buildFixture();
    const table = buildSymbolTable(files);
    const graph = buildCallGraph(table, table.symbols);
    const symbolsById = new Map(table.symbols.map((s) => [s.id, s]));
    const main = table.symbols.find((s) => s.path === "cmd/main.go" && s.name === "main")!;
    const helper = table.symbols.find((s) => s.path === "cmd/main.go" && s.name === "helper")!;

    const paths = reconstructPaths(
      [{ id: "e1", kind: "main", name: "main", path: "cmd/main.go", startLine: main.startLine, endLine: main.endLine, symbolId: main.id, framework: null, basis: "test" }],
      symbolsById,
      graph,
      { maxDepth: 4, maxPaths: 10 },
    );
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].steps[0].symbolId).toBe(main.id);
    expect(paths[0].steps.map((s) => s.symbolId)).toContain(helper.id);
  });
});

describe("complexity", () => {
  it("counts decision points and nesting per function", async () => {
    const src = `export function simple(a) { return a; }
export function branchy(a) {
  if (a > 1) { return 1; }
  else if (a > 0) { return 2; }
  for (let i = 0; i < a; i++) { if (i % 2 === 0) { a--; } }
  return a && true ? a : 0;
}
`;
    const parsed = await parseSource("typescript", src);
    const samples = computeComplexity(parsed.rootNode!, "typescript");
    const simple = samples.find((s) => s.startLine === 1)!;
    const branchy = samples.find((s) => s.startLine === 2)!;
    expect(simple.cyclomatic).toBe(1);
    expect(branchy.cyclomatic).toBeGreaterThan(simple.cyclomatic);
    expect(branchy.maxNesting).toBeGreaterThan(0);
  });
});
