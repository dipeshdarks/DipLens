// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseSource } from "@/lib/analysis/parsers/loader";
import { extractFromTree } from "@/lib/analysis/lang";
import { buildSymbolTable } from "@/lib/analysis/index/symbols";
import { detectDefects } from "@/lib/analysis/defects/detect";
import type { DefectFinding } from "@/lib/analysis/engine/types";
import type Parser from "web-tree-sitter";

const TS_SRC = `export async function loadUser(id: string) {
  try {
    const res = await fetch("/api/user/" + id);
    return await res.json();
  } catch (e) {
  }
}

export async function chain() {
  const p = fetch("/a").then((r) => r.json());
  console.log(p);
}

export function pick(xs: string[]) {
  for (let i = 0; i <= xs.length; i++) {
    console.log(xs[i]);
  }
}

export function same(a: number) {
  if (a === a) return 1;
  return 0;
}

export function getLen(x?: string) {
  return x!.length;
}

export function setFlag(flag: boolean) {
  let ok = false;
  if (ok = flag) return true;
  return false;
}
`;

const PY_SRC = `import os
import requests

async def poll(url):
    r = requests.get(url)
    return r.json()

def write_config(path):
    fh = open(path, "w")
    fh.write("{}")
    return fh

def append_item(items=[]):
    items.append(1)
    return items

def clear_tmp():
    try:
        os.remove("/tmp/x")
    except:
        pass

def is_abc(s):
    if s is "abc":
        return True
    return False
`;

const GO_SRC = `package main

import "os"

func read(p string) {
	f, err := os.Open(p)
	if err != nil {
		return
	}
	data := make([]byte, 10)
	f.Read(data)
}

func cleanup(p string) {
	os.Remove(p)
}

func asString(v interface{}) string {
	return v.(string)
}
`;

async function run(lang: "typescript" | "python" | "go", src: string, filePath: string) {
  const parsed = await parseSource(lang, src);
  expect(parsed.failure).toBeNull();
  const extracted = extractFromTree(parsed.rootNode!, filePath, lang, "ok");
  const table = buildSymbolTable([extracted]);
  const findings = detectDefects({
    path: filePath,
    language: lang,
    rootNode: parsed.rootNode as Parser.SyntaxNode,
    source: src,
    symbols: table.symbols,
  });
  return findings;
}

function titles(findings: DefectFinding[]): string[] {
  return findings.map((f) => f.title);
}

function byKey(findings: DefectFinding[], needle: RegExp): DefectFinding | undefined {
  return findings.find((f) => f.id.includes(needle.source) || f.title.match(needle));
}

describe("defect detectors (typescript)", () => {
  it("finds an empty catch block and quotes it", async () => {
    const findings = await run("typescript", TS_SRC, "src/app.ts");
    const hit = byKey(findings, /empty-catch/);
    expect(hit).toBeTruthy();
    expect(hit!.defectClass).toBe("error-handling");
    expect(hit!.evidence[0].path).toBe("src/app.ts");
    expect(hit!.evidence[0].excerpt).toContain("catch");
    expect(hit!.verificationPlan.length).toBeGreaterThan(30);
    expect(hit!.status).toBe("verified");
  });

  it("finds a then-chain with no rejection handler", async () => {
    const findings = await run("typescript", TS_SRC, "src/app.ts");
    const hit = byKey(findings, /then-no-catch/);
    expect(hit).toBeTruthy();
    expect(hit!.defectClass).toBe("async");
    expect(hit!.evidence[0].excerpt).toContain(".then(");
    expect(hit!.falsePositiveCaveats).toMatch(/false positive/);
  });

  it("does not report the awaited/catch-handled chain in loadUser", async () => {
    const findings = await run("typescript", TS_SRC, "src/app.ts");
    const thenFindings = findings.filter((f) => f.id.includes("then-no-catch"));
    expect(thenFindings.length).toBe(1);
  });

  it("finds the inclusive length bound", async () => {
    const findings = await run("typescript", TS_SRC, "src/app.ts");
    const hit = byKey(findings, /off-by-one/);
    expect(hit).toBeTruthy();
    expect(hit!.defectClass).toBe("logic");
    expect(hit!.evidence[0].excerpt).toContain("xs.length");
    expect(hit!.confidence).toBe("medium");
    expect(hit!.status).toBe("heuristic");
  });

  it("finds the self-comparison", async () => {
    const findings = await run("typescript", TS_SRC, "src/app.ts");
    const hit = byKey(findings, /self-comparison/);
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe("high");
    expect(hit!.evidence[0].excerpt).toContain("a === a");
    expect(hit!.status).toBe("verified");
  });

  it("finds the non-null assertion", async () => {
    const findings = await run("typescript", TS_SRC, "src/app.ts");
    const hit = byKey(findings, /non-null-assertion/);
    expect(hit).toBeTruthy();
    expect(hit!.defectClass).toBe("contract");
    expect(hit!.severity).toBe("low");
  });

  it("finds the assignment inside an if condition", async () => {
    const findings = await run("typescript", TS_SRC, "src/app.ts");
    const hit = byKey(findings, /assignment-in-condition/);
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe("high");
    expect(hit!.evidence[0].excerpt).toContain("ok = flag");
  });

  it("every finding carries the full evidence contract", async () => {
    const findings = await run("typescript", TS_SRC, "src/app.ts");
    expect(findings.length).toBeGreaterThanOrEqual(6);
    for (const f of findings) {
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(f.evidence[0].path).toBe("src/app.ts");
      expect((f.evidence[0]?.excerpt ?? "").length).toBeGreaterThan(5);
      expect(f.triggerConditions.length).toBeGreaterThan(0);
      expect(f.remediation.length).toBeGreaterThan(10);
      expect(f.method.length).toBeGreaterThan(10);
      expect(f.falsePositiveCaveats.length).toBeGreaterThan(10);
      expect(["critical", "high", "medium", "low", "info"]).toContain(f.severity);
      expect(f.category).toBe("code-quality");
    }
  });
});

describe("defect detectors (python)", () => {
  it("finds a blocking call in an async function", async () => {
    const findings = await run("python", PY_SRC, "app/tasks.py");
    const hit = byKey(findings, /blocking-in-async/);
    expect(hit).toBeTruthy();
    expect(hit!.title).toContain("requests.get");
    expect(hit!.confidence).toBe("high");
    expect(hit!.status).toBe("verified");
    expect(hit!.remediation).toMatch(/asyncio\.to_thread/);
  });

  it("finds open() outside a with statement", async () => {
    const findings = await run("python", PY_SRC, "app/tasks.py");
    const hit = byKey(findings, /open-without-with/);
    expect(hit).toBeTruthy();
    expect(hit!.defectClass).toBe("resource");
    expect(hit!.evidence[0].excerpt).toContain("open(path");
  });

  it("finds a mutable default argument", async () => {
    const findings = await run("python", PY_SRC, "app/tasks.py");
    const hit = byKey(findings, /mutable-default/);
    expect(hit).toBeTruthy();
    expect(hit!.defectClass).toBe("contract");
    expect(hit!.title).toContain("items");
    expect(hit!.verificationPlan).toMatch(/twice/);
  });

  it("finds a bare except that only passes", async () => {
    const findings = await run("python", PY_SRC, "app/tasks.py");
    const hit = byKey(findings, /swallowed-exception/);
    expect(hit).toBeTruthy();
    expect(hit!.defectClass).toBe("error-handling");
    expect(hit!.severity).toBe("high");
    expect(hit!.title).toMatch(/Bare except/);
  });

  it("finds `is` compared against a string literal", async () => {
    const findings = await run("python", PY_SRC, "app/tasks.py");
    const hit = byKey(findings, /is-literal/);
    expect(hit).toBeTruthy();
    expect(hit!.defectClass).toBe("logic");
    expect(hit!.evidence[0].excerpt).toContain('is "abc"');
    expect(hit!.remediation).toContain("==");
  });
});

describe("defect detectors (go)", () => {
  it("finds a handle opened without a deferred close", async () => {
    const findings = await run("go", GO_SRC, "cmd/main.go");
    const hit = byKey(findings, /missing-defer-close/);
    expect(hit).toBeTruthy();
    expect(hit!.defectClass).toBe("resource");
    expect(hit!.title).toContain("f");
    expect(hit!.verificationPlan).toMatch(/lsof|GODEBUG|descriptor/i);
  });

  it("finds a discarded error from a known stdlib API", async () => {
    const findings = await run("go", GO_SRC, "cmd/main.go");
    const hit = byKey(findings, /unchecked-error/);
    expect(hit).toBeTruthy();
    expect(hit!.defectClass).toBe("error-handling");
    expect(hit!.evidence[0].excerpt).toContain("os.Remove");
    expect(hit!.method).toMatch(/known error-returning stdlib API/);
  });

  it("does not report the checked os.Open or the Read call", async () => {
    const findings = await run("go", GO_SRC, "cmd/main.go");
    const unchecked = findings.filter((f) => f.id.includes("unchecked-error"));
    expect(unchecked.length).toBe(1);
    const excerpt = unchecked[0]?.evidence[0]?.excerpt ?? "";
    expect(excerpt).toContain("os.Remove");
    expect(excerpt).not.toContain("os.Open");
    expect(excerpt).not.toContain("f.Read");
  });

  it("finds a single-value type assertion", async () => {
    const findings = await run("go", GO_SRC, "cmd/main.go");
    const hit = byKey(findings, /type-assert/);
    expect(hit).toBeTruthy();
    expect(hit!.defectClass).toBe("contract");
    expect(hit!.title).toContain("ok");
    expect(hit!.status).toBe("heuristic");
  });
});
