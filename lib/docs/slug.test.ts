import { describe, expect, it } from "vitest";
import { slugify, textOf } from "@/lib/docs/slug";

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("Getting Started")).toBe("getting-started");
  });

  it("strips markdown emphasis characters", () => {
    expect(slugify("`npm run` **build**")).toBe("npm-run-build");
  });

  it("collapses non-alphanumerics to single hyphens", () => {
    expect(slugify("GET /api/file — 256 KB cap")).toBe("get-api-file-256-kb-cap");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("textOf", () => {
  it("joins plain strings and numbers", () => {
    expect(textOf(["Install ", 42])).toBe("Install 42");
  });

  it("extracts text from nested elements", () => {
    const el = { props: { children: ["Deep ", { props: { children: "analysis" } }] } };
    expect(textOf(el as unknown as React.ReactNode)).toBe("Deep analysis");
  });

  it("returns empty string for null/undefined/boolean", () => {
    expect(textOf(null)).toBe("");
    expect(textOf(undefined)).toBe("");
    expect(textOf(true)).toBe("");
  });

  it("returns empty string for unrecognized values", () => {
    expect(textOf(Symbol("x") as unknown as React.ReactNode)).toBe("");
  });
});
