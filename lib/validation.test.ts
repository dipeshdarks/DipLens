import { describe, expect, it } from "vitest";
import { encodeRepoPath, parseRepo } from "@/lib/validation";

describe("parseRepo — accepted formats", () => {
  it("accepts bare owner/repo", () => {
    expect(parseRepo("vercel/next.js")).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("accepts https URL without trailing slash", () => {
    expect(parseRepo("https://github.com/vercel/next.js")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
  });

  it("accepts https URL with trailing slash", () => {
    expect(parseRepo("https://github.com/vercel/next.js/")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
  });

  it("accepts http and www variants", () => {
    expect(parseRepo("http://www.github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("strips .git suffix", () => {
    expect(parseRepo("owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseRepo("  owner/repo  ")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("accepts single-character names", () => {
    expect(parseRepo("a/b")).toEqual({ owner: "a", repo: "b" });
  });

  it("preserves case", () => {
    expect(parseRepo("Vercel/Next.js")).toEqual({ owner: "Vercel", repo: "Next.js" });
  });
});

describe("parseRepo — rejected formats", () => {
  const bad = [
    "",
    "   ",
    "owner",
    "owner/repo/extra",
    "https://github.com/owner",
    "https://github.com/owner/repo/extra",
    "https://gitlab.com/owner/repo",
    "https://github.com.evil.com/owner/repo",
    "not a url",
    "-owner/repo",
    "owner-/repo",
    "owner/.hidden",
    "owner/repo?",
    "/owner/repo",
  ];
  for (const input of bad) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(parseRepo(input)).toBeNull();
    });
  }
});

describe("encodeRepoPath", () => {
  it("encodes path segments safely", () => {
    expect(encodeRepoPath("vercel", "next.js")).toBe("vercel/next.js");
    expect(encodeRepoPath("a b", "c/d")).toBe("a%20b/c%2Fd");
  });
});
