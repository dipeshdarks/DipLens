import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitHubError,
  getReport,
  normalizeActivity,
  normalizeLanguages,
  normalizeRelease,
  normalizeRepo,
} from "@/lib/github";

const rawRepo = {
  full_name: "acme/widget",
  name: "widget",
  description: null,
  html_url: "https://github.com/acme/widget",
  language: null,
  stargazers_count: 0,
  forks_count: 0,
  open_issues_count: 0,
  default_branch: "main",
  pushed_at: null,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  archived: false,
  license: null,
  owner: { login: "acme", avatar_url: "https://example.com/a.png" },
};

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeRepo", () => {
  it("maps raw payload to normalized summary", () => {
    const s = normalizeRepo(rawRepo);
    expect(s.owner).toBe("acme");
    expect(s.stars).toBe(0);
    expect(s.description).toBeNull();
    expect(s.licenseSpdx).toBeNull();
  });

  it("keeps true zeros as zeros, not null", () => {
    expect(normalizeRepo(rawRepo).stars).toBe(0);
  });

  it("maps NOASSERTION license to null", () => {
    const s = normalizeRepo({
      ...rawRepo,
      license: { spdx_id: "NOASSERTION", name: "Other" },
    });
    expect(s.licenseSpdx).toBeNull();
    expect(s.licenseName).toBe("Other");
  });
});

describe("normalizeRelease", () => {
  it("maps fields and defaults", () => {
    const r = normalizeRelease({
      id: 7,
      tag_name: "v1.0.0",
      name: null,
      html_url: "https://github.com/acme/widget/releases/7",
      published_at: null,
      prerelease: false,
      draft: false,
    });
    expect(r.title).toBeNull();
    expect(r.publishedAt).toBeNull();
  });
});

describe("normalizeActivity", () => {
  it("converts epoch weeks to date strings", () => {
    const weeks = normalizeActivity([{ week: 1_760_000_000, total: 12 }]);
    expect(weeks[0]!.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(weeks[0]!.commits).toBe(12);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeActivity([])).toEqual([]);
  });
});

describe("normalizeLanguages", () => {
  it("sorts by bytes and computes percent", () => {
    const langs = normalizeLanguages({ TypeScript: 750, CSS: 250 });
    expect(langs[0]).toMatchObject({ name: "TypeScript", percent: 75 });
    expect(langs[1]).toMatchObject({ name: "CSS", percent: 25 });
  });

  it("returns empty array for zero total", () => {
    expect(normalizeLanguages({})).toEqual([]);
  });
});

describe("getReport error mapping", () => {
  it("maps 404 to not_found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    await expect(getReport("acme", "missing")).rejects.toMatchObject({
      kind: "not_found",
    });
  });

  it("maps 403 with exhausted rate limit to rate_limited", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("{}", {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 120),
          },
        }),
      ),
    );
    const err = await getReport("acme", "widget").catch((e: GitHubError) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).kind).toBe("rate_limited");
    expect((err as GitHubError).retryAfterSeconds).toBeGreaterThan(0);
  });

  it("maps 401 to unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(getReport("acme", "widget")).rejects.toMatchObject({
      kind: "unauthorized",
    });
  });

  it("maps 500 to upstream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(getReport("acme", "widget")).rejects.toMatchObject({
      kind: "upstream",
    });
  });
});

describe("getReport partial failures", () => {
  function stubFetch(route: (url: string) => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => route(String(input))),
    );
  }

  it("renders core data when optional endpoints fail", async () => {
    stubFetch((url) => {
      if (url.endsWith("/repos/acme/widget")) return jsonResponse(rawRepo);
      if (url.includes("/contributors")) return new Response("{}", { status: 500 });
      if (url.includes("/stats/commit_activity")) return new Response("{}", { status: 500 });
      if (url.includes("/releases")) return new Response("{}", { status: 500 });
      if (url.includes("/languages")) return new Response("{}", { status: 500 });
      return new Response("{}", { status: 404 });
    });

    const r = await getReport("acme", "widget");
    expect(r.repo.fullName).toBe("acme/widget");
    expect(r.contributors).toBeNull();
    expect(r.weeks).toBeNull();
    expect(r.releases).toBeNull();
    expect(r.sectionErrors.contributors).toBeTruthy();
    expect(r.sectionErrors.releases).toBeTruthy();
  });

  it("handles 202 pending statistics without failing", async () => {
    stubFetch((url) => {
      if (url.endsWith("/repos/acme/widget")) return jsonResponse(rawRepo);
      if (url.includes("/stats/commit_activity")) return new Response("{}", { status: 202 });
      if (url.includes("/contributors")) return jsonResponse([]);
      if (url.includes("/releases")) return jsonResponse([]);
      if (url.includes("/languages")) return jsonResponse({});
      return new Response("{}", { status: 404 });
    });

    const r = await getReport("acme", "widget");
    expect(r.statsPending).toBe(true);
    expect(r.weeks).toBeNull();
    expect(r.sectionErrors.stats).toBeUndefined();
  });

  it("parses contributor count from Link header", async () => {
    stubFetch((url) => {
      if (url.endsWith("/repos/acme/widget")) return jsonResponse(rawRepo);
      if (url.includes("per_page=1")) {
        return jsonResponse([{ login: "a", avatar_url: "", html_url: "", contributions: 1 }], {
          headers: {
            link: '<https://api.github.com/repos/acme/widget/contributors?per_page=1&page=42>; rel="last"',
          },
        });
      }
      if (url.includes("/contributors")) return jsonResponse([]);
      if (url.includes("/stats/commit_activity")) return new Response("{}", { status: 202 });
      if (url.includes("/releases")) return jsonResponse([]);
      if (url.includes("/languages")) return jsonResponse({});
      return new Response("{}", { status: 404 });
    });

    const r = await getReport("acme", "widget");
    expect(r.contributorCount).toBe(42);
  });
});
