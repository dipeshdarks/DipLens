// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseSource } from "@/lib/analysis/parsers/loader";
import { extractFromTree } from "@/lib/analysis/lang";
import { buildSymbolTable } from "@/lib/analysis/index/symbols";
import { analyzeTaint } from "@/lib/analysis/flow/taint";
import type { ExtractedFile } from "@/lib/analysis/lang";
import type Parser from "web-tree-sitter";

const TS_VULN = `import { db } from "./db";

export function searchUsers(req: { query: { q: string } }, res: any) {
  const q = req.query.q;
  const sql = "select * from users where name = '" + q + "'";
  return db.query(sql);
}

export function searchSafe(req: { query: { q: string } }, res: any) {
  const q = req.query.q;
  return db.query("select * from users where name = ?", [q]);
}

export function redirectUser(req: { query: { next: string } }, res: any) {
  res.redirect(req.query.next);
}
`;

const PY_VULN = `import os
from app.db import cursor

def search(request):
    q = request.GET["q"]
    sql = f"select * from users where name = '{q}'"
    cursor.execute(sql)
    return "ok"

def safe_search(request):
    q = request.GET["q"]
    cursor.execute("select * from users where name = %s", [q])
    return "ok"

def run_cmd(request):
    name = request.GET["name"]
    os.system("echo " + name)
    return "done"
`;

const GO_VULN = `package main

import (
  "database/sql"
  "fmt"
  "os/exec"
  "net/http"
)

func search(w http.ResponseWriter, r *http.Request) {
  q := r.URL.Query().Get("q")
  sqlText := fmt.Sprintf("select * from users where name = '%s'", q)
  db.Query(sqlText)
}

func runCmd(w http.ResponseWriter, r *http.Request) {
  name := r.URL.Query().Get("name")
  exec.Command("sh", "-c", "echo "+name)
}

func safeSearch(w http.ResponseWriter, r *http.Request) {
  q := r.URL.Query().Get("q")
  db.Query("select * from users where name = ?", q)
}
`;

async function runTaint(lang: "typescript" | "python" | "go", src: string, filePath: string) {
  const parsed = await parseSource(lang, src);
  expect(parsed.failure).toBeNull();
  const extracted = extractFromTree(parsed.rootNode!, filePath, lang, "ok");
  const table = buildSymbolTable([extracted]);
  // Entry points: every exported/top-level function taking request-like params.
  const entryIds = new Set(table.symbols.filter((s) => s.kind === "function" || s.kind === "method").map((s) => s.id));
  const out = analyzeTaint({
    path: filePath,
    language: lang,
    rootNode: parsed.rootNode as Parser.SyntaxNode,
    source: src,
    symbols: table.symbols,
    entrySymbolIds: entryIds,
    resolveCallee: () => null,
  });
  return { out, table, extracted };
}

describe("taint analysis (typescript)", () => {
  it("finds the SQL injection candidate and its source", async () => {
    const { out } = await runTaint("typescript", TS_VULN, "src/api.ts");
    const sqlPaths = out.paths.filter((p) => p.sink.category === "sql");
    expect(sqlPaths.length).toBeGreaterThanOrEqual(1);
    const vuln = sqlPaths.find((p) => p.sink.line >= 5 && p.sink.line <= 7);
    expect(vuln).toBeTruthy();
    expect(vuln!.source.expression).toContain("req.query.q");
    expect(vuln!.confidence).toBe("high");
    expect(vuln!.status).toBe("candidate");
    expect(vuln!.missingValidation.join(" ")).toMatch(/parameterized/i);
    expect(vuln!.preconditions.length).toBeGreaterThan(0);
    expect(vuln!.falsePositiveCaveats).toMatch(/not executed/i);
  });

  it("finds the open redirect candidate", async () => {
    const { out } = await runTaint("typescript", TS_VULN, "src/api.ts");
    const redirect = out.paths.find((p) => p.sink.category === "redirect");
    expect(redirect).toBeTruthy();
    expect(redirect!.remediation).toMatch(/allow-list|route/i);
  });

  it("does not report the parameterized query as a candidate", async () => {
    const { out } = await runTaint("typescript", TS_VULN, "src/api.ts");
    // `searchSafe` passes q as a bound argument, not concatenated into the SQL.
    const safeLines = out.paths.filter((p) => p.sink.line >= 10 && p.sink.line <= 12);
    expect(safeLines.length).toBe(0);
  });
});

describe("taint analysis (python)", () => {
  it("finds the f-string SQL injection candidate", async () => {
    const { out } = await runTaint("python", PY_VULN, "app/views.py");
    const sql = out.paths.find((p) => p.sink.category === "sql" && p.sink.line <= 8);
    expect(sql).toBeTruthy();
    expect(sql!.source.kind).toBe("http-request");
    expect(sql!.source.expression).toContain("request.GET");
  });

  it("finds the shell injection candidate", async () => {
    const { out } = await runTaint("python", PY_VULN, "app/views.py");
    const shell = out.paths.find((p) => p.sink.category === "shell");
    expect(shell).toBeTruthy();
    expect(shell!.sink.api).toContain("system");
    expect(shell!.missingValidation.join(" ")).toMatch(/argv|allow-list/i);
  });

  it("leaves the parameterized execute alone", async () => {
    const { out } = await runTaint("python", PY_VULN, "app/views.py");
    const safeLines = out.paths.filter((p) => p.sink.category === "sql" && p.sink.line >= 12 && p.sink.line <= 14);
    expect(safeLines.length).toBe(0);
  });
});

describe("taint analysis (go)", () => {
  it("finds SQL built with Sprintf", async () => {
    const { out } = await runTaint("go", GO_VULN, "cmd/main.go");
    const sql = out.paths.find((p) => p.sink.category === "sql");
    expect(sql).toBeTruthy();
    expect(sql!.hops.some((h) => h.transform.includes("Sprintf") || h.transform.includes("sqlText"))).toBe(true);
  });

  it("finds exec.Command with a tainted argument", async () => {
    const { out } = await runTaint("go", GO_VULN, "cmd/main.go");
    const shell = out.paths.find((p) => p.sink.category === "shell");
    expect(shell).toBeTruthy();
    expect(shell!.sink.api).toContain("Command");
  });
});
