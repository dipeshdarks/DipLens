// @vitest-environment node
import { describe, expect, it } from "vitest";
import { initRuntime, languageForPath, parseSource } from "@/lib/analysis/parsers/loader";
import { extractFromTree } from "@/lib/analysis/lang";

const TS_SAMPLE = `import React from "react";
import { a as b, type T } from "./x";
export * from "./y";
export default class UserService extends Base implements Iface {
  private cache = new Map();
  static VERSION = "1";
  constructor(private db) {}
  async login(u, p) {
    const r = await this.db.query(u);
    return r;
  }
  protected handle = (e) => { console.log(e); };
}
export function login(u, p) { return u + p; }
export const CFG = { port: 8080 };
export interface Iface { run(): void }
export type Alias = string | number;
export enum Color { Red, Green }
export namespace NS { export function inner() {} }
const arrow = (x) => x * 2;
const mem = memo(function compute(a) { return a; });
`;

const PY_SAMPLE = `from os import path as osp
import json
from .util import helper

class Store:
    VERSION = "1"
    def __init__(self, db):
        self.db = db
        self._cache = {}
    async def get(self, key):
        q = "select * from t"
        return await self.db.execute(q)

def main():
    s = Store(None)
    s.get("x")

if __name__ == "__main__":
    main()
`;

const GO_SAMPLE = `package main

import (
  "fmt"
  "net/http"
)

type Server struct {
  port int
}

func (s *Server) Handler(w http.ResponseWriter, r *http.Request) {
  q := r.URL.Query().Get("q")
  fmt.Printf("q=%s", q)
}

func main() {
  s := &Server{port: 8080}
  http.ListenAndServe(":8080", http.HandlerFunc(s.Handler))
}
`;

const PATHS: Record<string, string> = { typescript: "src/sample.ts", python: "pkg/sample.py", go: "cmd/main.go" };

async function extract(lang: "typescript" | "python" | "go", src: string) {
  const parsed = await parseSource(lang, src);
  expect(parsed.failure).toBeNull();
  expect(parsed.rootNode).not.toBeNull();
  return extractFromTree(parsed.rootNode!, PATHS[lang], lang, parsed.hasError ? "partial" : "ok");
}

describe("parser loader", () => {
  it("initializes the wasm runtime", async () => {
    await expect(initRuntime()).resolves.toBe(true);
  });

  it("maps extensions to grammars", () => {
    expect(languageForPath("src/a.ts")).toBe("typescript");
    expect(languageForPath("src/a.tsx")).toBe("tsx");
    expect(languageForPath("src/a.js")).toBe("javascript");
    expect(languageForPath("pkg/a.py")).toBe("python");
    expect(languageForPath("cmd/main.go")).toBe("go");
    expect(languageForPath("README.md")).toBe("other");
  });

  it("parses without syntax errors on well-formed samples", async () => {
    for (const [lang, src] of [
      ["typescript", TS_SAMPLE],
      ["python", PY_SAMPLE],
      ["go", GO_SAMPLE],
    ] as const) {
      const parsed = await parseSource(lang, src);
      expect(parsed.failure, lang).toBeNull();
      expect(parsed.hasError, lang).toBe(false);
    }
  });
});

describe("typescript extraction", () => {
  it("extracts symbols, imports, calls and entry points", async () => {
    const out = await extract("typescript", TS_SAMPLE);
    const byQ = (q: string) => out.symbols.find((s) => s.qualifiedName === q);

    expect(byQ("UserService")).toMatchObject({ kind: "class", exported: true });
    expect(byQ("UserService.login")).toMatchObject({ kind: "method", exported: true, visibility: "public" });
    expect(byQ("UserService.cache")).toMatchObject({ kind: "field", visibility: "private" });
    expect(byQ("UserService.VERSION")).toMatchObject({ kind: "field" });
    expect(byQ("login")).toMatchObject({ kind: "function", exported: true });
    expect(byQ("CFG")).toMatchObject({ kind: "constant", exported: true });
    expect(byQ("Iface")).toMatchObject({ kind: "interface", exported: true });
    expect(byQ("Alias")).toMatchObject({ kind: "type", exported: true });
    expect(byQ("Color")).toMatchObject({ kind: "enum", exported: true });
    expect(byQ("NS")).toMatchObject({ kind: "module" });
    expect(byQ("NS.inner")).toMatchObject({ kind: "function" });
    expect(byQ("arrow")).toMatchObject({ kind: "function" });
    expect(byQ("mem")).toMatchObject({ kind: "function" });

    const sources = out.imports.map((i) => i.source);
    expect(sources).toContain("react");
    expect(sources).toContain("./x");
    expect(sources).toContain("./y");
    expect(out.imports.find((i) => i.source === "./x")?.specifiers).toEqual([
      { local: "b", imported: "a", kind: "named" },
      { local: "T", imported: "T", kind: "type" },
    ]);
    expect(out.imports.find((i) => i.source === "./y")?.isReExport).toBe(true);

    expect(out.calls.some((c) => c.calleeText === "this.db.query")).toBe(true);
    expect(out.calls.find((c) => c.calleeText === "this.db.query")?.isAwaited).toBe(true);
    expect(out.calls.some((c) => c.calleeText === "new Map")).toBe(true);
    expect(out.calls.some((c) => c.name === "memo")).toBe(true);
  });

  it("computes line numbers from the source", async () => {
    const parsed = await parseSource("typescript", TS_SAMPLE);
    const out = extractFromTree(parsed.rootNode!, "x.ts", "typescript", "ok");
    const login = out.symbols.find((s) => s.qualifiedName === "login")!;
    const line = TS_SAMPLE.split("\n").findIndex((l) => l.includes("export function login")) + 1;
    expect(login.startLine).toBe(line);
  });
});

describe("python extraction", () => {
  it("extracts classes, methods, imports and the main guard", async () => {
    const out = await extract("python", PY_SAMPLE);
    const byQ = (q: string) => out.symbols.find((s) => s.qualifiedName === q);

    expect(byQ("Store")).toMatchObject({ kind: "class" });
    expect(byQ("Store.__init__")).toMatchObject({ kind: "method" });
    expect(byQ("Store.get")).toMatchObject({ kind: "method" });
    expect(byQ("Store.VERSION")).toMatchObject({ kind: "field" });
    expect(byQ("Store._cache")).toMatchObject({ visibility: "private" });
    expect(byQ("main")).toMatchObject({ kind: "function" });

    expect(out.imports.map((i) => i.source)).toEqual(["os", "json", ".util"]);
    expect(out.imports[0].specifiers[0]).toEqual({ local: "osp", imported: "path", kind: "named" });
    expect(out.entryPoints.some((e) => e.kind === "main")).toBe(true);
    expect(out.calls.some((c) => c.calleeText === "s.get")).toBe(true);
  });
});

describe("go extraction", () => {
  it("extracts functions, methods, types and http entry points", async () => {
    const out = await extract("go", GO_SAMPLE);
    const byQ = (q: string) => out.symbols.find((s) => s.qualifiedName === q);

    expect(byQ("Server")).toMatchObject({ kind: "class" });
    expect(byQ("Server.port")).toMatchObject({ kind: "field" });
    expect(byQ("Server.Handler")).toMatchObject({ kind: "method" });
    expect(byQ("main")).toMatchObject({ kind: "function", exported: false });

    expect(out.imports.map((i) => i.source)).toEqual(["fmt", "net/http"]);
    expect(out.entryPoints.some((e) => e.kind === "main" && e.name === "main")).toBe(true);
    expect(out.entryPoints.some((e) => e.kind === "http-route" && e.name === "Server.Handler")).toBe(true);
    expect(out.calls.some((c) => c.calleeText === "http.ListenAndServe")).toBe(true);
    expect(out.calls.some((c) => c.calleeText === "r.URL.Query.Get")).toBe(true);
  });
});
