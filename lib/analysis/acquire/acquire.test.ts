// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyFile } from "@/lib/analysis/acquire/classify";
import { acquireRaw, isValidSha } from "@/lib/analysis/acquire/raw";

const NUL = String.fromCharCode(0);

describe("file classification", () => {
  it("prioritizes source, then config, then tests", () => {
    expect(classifyFile("src/app.ts", 100)).toMatchObject({ category: "source", language: "typescript" });
    expect(classifyFile("src/app.test.ts", 100)).toMatchObject({ category: "test" });
    expect(classifyFile("package.json", 100)).toMatchObject({ category: "config" });
    // Config is fetched before tests: dependency/CI/config-map stages cannot
    // run at all without it, while tests only feed the coverage stage.
    const src = classifyFile("src/app.ts", 100).priority;
    const cfg = classifyFile("package.json", 100).priority;
    const tst = classifyFile("src/app.test.ts", 100).priority;
    expect(src).toBeLessThan(cfg);
    expect(cfg).toBeLessThan(tst);
  });

  it("recognises vendor, generated, binary and docs paths", () => {
    expect(classifyFile("node_modules/react/index.js", 10).category).toBe("vendor");
    expect(classifyFile("vendor/lib/x.go", 10).category).toBe("vendor");
    expect(classifyFile("api/v1/foo_pb2.py", 10).category).toBe("generated");
    expect(classifyFile("assets/logo.png", 10).category).toBe("binary");
    expect(classifyFile("docs/README.md", 10)).toMatchObject({ category: "docs", language: "other" });
    expect(classifyFile("dist/bundle.js", 10)).toMatchObject({ category: "generated" });
    expect(classifyFile("dist/bundle.js", 10).priority).toBeGreaterThan(classifyFile("src/index.ts", 10).priority);
  });

  it("detects go and python test files", () => {
    expect(classifyFile("pkg/store_test.go", 10).category).toBe("test");
    expect(classifyFile("app/tests/test_api.py", 10).category).toBe("test");
  });

  it("flags CI workflows as config", () => {
    expect(classifyFile(".github/workflows/ci.yml", 10)).toMatchObject({ category: "config" });
  });
});

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { "content-length": String(Buffer.byteLength(body)) }, ...init });
}

describe("raw acquisition", () => {
  it("accepts a valid SHA and rejects others", () => {
    expect(isValidSha("a".repeat(40))).toBe(true);
    expect(isValidSha("A".repeat(40))).toBe(true);
    expect(isValidSha("a".repeat(39))).toBe(false);
    expect(isValidSha(null)).toBe(false);
    expect(isValidSha("not-a-sha")).toBe(false);
  });

  it("pins every request to the commit SHA", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(String(url));
      return textResponse("const x = 1;\n");
    };
    const sha = "b".repeat(40);
    await acquireRaw({
      owner: "acme",
      repo: "widgets",
      sha,
      paths: ["src/a.ts", "src/b.ts"],
      maxFileBytes: 1000,
      maxTotalChars: 10_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(urls).toHaveLength(2);
    for (const u of urls) {
      expect(u).toContain(`https://raw.githubusercontent.com/acme/widgets/${sha}/`);
    }
  });

  it("collects files and reports failures per path", async () => {
    const fetchImpl = async (url: string) => {
      const u = String(url);
      if (u.endsWith("/ok.ts")) return textResponse("export const ok = 1;\n");
      if (u.endsWith("/missing.ts")) return new Response("Not Found", { status: 404 });
      if (u.endsWith("/blob.bin")) return textResponse(`bin${NUL}ary`);
      if (u.endsWith("/huge.ts")) return textResponse("x".repeat(500));
      return new Response("boom", { status: 500 });
    };
    const res = await acquireRaw({
      owner: "a",
      repo: "b",
      sha: "c".repeat(40),
      paths: ["ok.ts", "missing.ts", "blob.bin", "huge.ts", "err.ts"],
      maxFileBytes: 100,
      maxTotalChars: 10_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.files.map((f) => f.path)).toEqual(["ok.ts"]);
    expect(res.files[0].truncated).toBe(false);
    const reasons = Object.fromEntries(res.skipped.map((s) => [s.path, s.reason]));
    expect(reasons["missing.ts"]).toBe("http-error");
    expect(reasons["blob.bin"]).toBe("binary");
    expect(reasons["huge.ts"]).toBe("too-large");
    expect(reasons["err.ts"]).toBe("http-error");
    expect(res.requestsUsed).toBe(5);
  });

  it("enforces the total character budget across files", async () => {
    const body = "y".repeat(300);
    const fetchImpl = async () => textResponse(body);
    const res = await acquireRaw({
      owner: "a",
      repo: "b",
      sha: "d".repeat(40),
      paths: ["one.ts", "two.ts"],
      maxFileBytes: 1000,
      maxTotalChars: 200,
      concurrency: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    // The first file consumes the whole budget; the second is reported as
    // skipped rather than silently dropped or fetched anyway.
    expect(res.files).toHaveLength(1);
    expect(res.files[0].truncated).toBe(true);
    expect(res.files[0].content.length).toBeLessThanOrEqual(200);
    expect(res.skipped[0]).toMatchObject({ path: "two.ts", reason: "budget" });
    expect(res.files.reduce((n, f) => n + f.content.length, 0)).toBeLessThanOrEqual(200);
  });

  it("surfaces rate limiting without pretending the file was missing", async () => {
    const fetchImpl = async () => new Response("slow down", { status: 429 });
    const res = await acquireRaw({
      owner: "a",
      repo: "b",
      sha: "e".repeat(40),
      paths: ["x.ts"],
      maxFileBytes: 100,
      maxTotalChars: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.skipped[0].reason).toBe("rate-limited");
    expect(res.rateLimitNote).toMatch(/rate limit/i);
  });
});
