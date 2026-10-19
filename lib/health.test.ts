import { describe, expect, it } from "vitest";
import { daysSince, healthSignals, summarizeWeeks } from "@/lib/health";
import type { Report } from "@/types/report";

const NOW = Date.UTC(2026, 9, 19);

function report(overrides: Partial<Report> = {}): Report {
  return {
    repo: {
      owner: "acme",
      name: "widget",
      fullName: "acme/widget",
      description: "A widget",
      htmlUrl: "https://github.com/acme/widget",
      avatarUrl: "https://example.com/a.png",
      stars: 150,
      forks: 40,
      openIssues: 5,
      defaultBranch: "main",
      primaryLanguage: "TypeScript",
      licenseName: "MIT License",
      licenseSpdx: "MIT",
      archived: false,
      createdAt: "2020-01-01T00:00:00Z",
      pushedAt: "2026-10-10T00:00:00Z",
      updatedAt: "2026-10-10T00:00:00Z",
    },
    contributors: [],
    contributorCount: 3,
    weeks: null,
    statsPending: false,
    releases: [],
    languages: null,
    sectionErrors: {},
    checkedAt: "2026-10-19T12:00:00Z",
    ...overrides,
  };
}

describe("daysSince", () => {
  it("returns null for missing or invalid dates", () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince(undefined)).toBeNull();
    expect(daysSince("not-a-date")).toBeNull();
  });

  it("computes whole days", () => {
    expect(daysSince("2026-10-17T00:00:00Z", NOW)).toBe(2);
  });
});

describe("healthSignals", () => {
  it("marks recent push as Active", () => {
    const s = healthSignals(report(), NOW);
    expect(s[0]!.label).toBe("Active");
    expect(s[0]!.detail).toContain("Last push");
  });

  it("marks 100-day-old push as Moderate and 200-day-old as Needs attention", () => {
    expect(healthSignals(report({ repo: { ...report().repo, pushedAt: "2026-07-11T00:00:00Z" } }), NOW)[0]!.label).toBe("Moderate");
    expect(healthSignals(report({ repo: { ...report().repo, pushedAt: "2026-03-30T00:00:00Z" } }), NOW)[0]!.label).toBe("Needs attention");
  });

  it("distinguishes no releases from unavailable releases", () => {
    const empty = healthSignals(report({ releases: [] }), NOW);
    expect(empty[1]!.label).toBe("Unknown");
    expect(empty[1]!.detail).toBe("No published releases.");

    const missing = healthSignals(report({ releases: null }), NOW);
    expect(missing[1]!.detail).toBe("Release data unavailable.");
  });

  it("uses latest published release date for release recency", () => {
    const s = healthSignals(
      report({
        releases: [
          {
            id: 1,
            tagName: "v1",
            title: null,
            publishedAt: "2026-10-01T00:00:00Z",
            htmlUrl: "https://github.com/acme/widget/releases/1",
            prerelease: false,
            draft: false,
          },
        ],
      }),
      NOW,
    );
    expect(s[1]!.label).toBe("Active");
  });

  it("flags archived repos in maintenance", () => {
    const s = healthSignals(report({ repo: { ...report().repo, archived: true } }), NOW);
    expect(s[3]!.label).toBe("Needs attention");
    expect(s[3]!.detail).toContain("archived");
  });

  it("treats stars+forks >= 100 as Active community interest", () => {
    expect(healthSignals(report(), NOW)[2]!.label).toBe("Active");
    expect(
      healthSignals(report({ repo: { ...report().repo, stars: 10, forks: 5 } }), NOW)[2]!.label,
    ).toBe("Moderate");
  });
});

describe("summarizeWeeks", () => {
  it("returns null for null or empty data", () => {
    expect(summarizeWeeks(null)).toBeNull();
    expect(summarizeWeeks([])).toBeNull();
  });

  it("computes totals, peak, and quiet week", () => {
    const s = summarizeWeeks([
      { weekStart: "2026-01-01", commits: 5 },
      { weekStart: "2026-01-08", commits: 20 },
      { weekStart: "2026-01-15", commits: 0 },
    ]);
    expect(s).toMatchObject({
      total: 25,
      weeks: 3,
      activeWeeks: 2,
      peak: { weekStart: "2026-01-08", commits: 20 },
      quiet: { weekStart: "2026-01-15", commits: 0 },
    });
  });
});
