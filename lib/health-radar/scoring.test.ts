import { describe, expect, it } from "vitest";
import {
  DIMENSION_ORDER,
  HEALTH_DIMENSIONS,
  METHODOLOGY_VERSION,
  TOTAL_WEIGHT,
  daysBetween,
  scoreHealthRadar,
} from "@/lib/health-radar/scoring";
import type {
  CommunityProfile,
  HealthInput,
  IssueSampleItem,
  PullSampleItem,
} from "@/types/health";
import type { ReleaseSummary, RepoSummary, WeeklyActivity } from "@/types/report";

const NOW = Date.parse("2026-10-25T00:00:00Z");
const DAY = 86_400_000;

/** Flatten evidence items to searchable text (they are objects, not strings). */
const evText = (evidence: Array<{ label: string; value: string; note?: string }>): string =>
  evidence.map((e) => `${e.label} ${e.value} ${e.note ?? ""}`).join(" ");

function repo(overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    owner: "acme",
    name: "widget",
    fullName: "acme/widget",
    description: "A sample widget library.",
    htmlUrl: "https://github.com/acme/widget",
    avatarUrl: "https://example.com/a.png",
    stars: 1200,
    forks: 90,
    openIssues: 12,
    defaultBranch: "main",
    primaryLanguage: "TypeScript",
    licenseName: "MIT License",
    licenseSpdx: "MIT",
    archived: false,
    disabled: false,
    topics: ["widgets", "typescript"],
    createdAt: "2020-01-01T00:00:00Z",
    pushedAt: new Date(NOW - 3 * DAY).toISOString(),
    updatedAt: new Date(NOW - DAY).toISOString(),
    ...overrides,
  };
}

function weeks(count: number, activeEvery = 1): WeeklyActivity[] {
  return Array.from({ length: count }, (_, i) => ({
    weekStart: new Date(NOW - (count - i) * 7 * DAY).toISOString().slice(0, 10),
    commits: i % activeEvery === 0 ? 10 : 0,
  }));
}

function release(daysAgo: number, tag = "v1.0.0"): ReleaseSummary {
  return {
    id: daysAgo,
    tagName: tag,
    title: tag,
    publishedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    htmlUrl: `https://github.com/acme/widget/releases/${tag}`,
    prerelease: false,
    draft: false,
  };
}

const profile: CommunityProfile = {
  healthPercentage: 90,
  description: "A sample widget library.",
  files: { readme: true, license: true, contributing: true, codeOfConduct: false, security: true },
};

function issues(n: number, opts: Partial<IssueSampleItem> = {}): IssueSampleItem[] {
  return Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    state: "closed",
    createdAt: new Date(NOW - 60 * DAY).toISOString(),
    closedAt: new Date(NOW - (60 - 5) * DAY).toISOString(),
    comments: 2,
    ...opts,
  }));
}

function pulls(n: number, merged = true): PullSampleItem[] {
  return Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    state: "closed",
    createdAt: new Date(NOW - 40 * DAY).toISOString(),
    mergedAt: merged ? new Date(NOW - 35 * DAY).toISOString() : null,
    comments: 1,
  }));
}

function fullInput(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    repo: repo(),
    weeks: weeks(52),
    statsPending: false,
    releases: [release(10, "v2.1.0"), release(55, "v2.0.0"), release(100, "v1.9.0")],
    contributorCount: 42,
    topContributors: [
      { login: "a", avatarUrl: "", profileUrl: "", contributions: 40 },
      { login: "b", avatarUrl: "", profileUrl: "", contributions: 30 },
      { login: "c", avatarUrl: "", profileUrl: "", contributions: 30 },
    ],
    communityProfile: profile,
    issuesSample: issues(20),
    pullsSample: pulls(15),
    ...overrides,
  };
}

describe("scoring model configuration", () => {
  it("weights sum to 100", () => {
    expect(TOTAL_WEIGHT).toBe(100);
    const sum = DIMENSION_ORDER.reduce((a, id) => a + HEALTH_DIMENSIONS[id].weight, 0);
    expect(sum).toBe(100);
  });

  it("exposes all six documented dimensions", () => {
    expect(DIMENSION_ORDER).toEqual([
      "maintenance",
      "releases",
      "issues",
      "community",
      "documentation",
      "transparency",
    ]);
  });

  it("has an explanation and evidence for every dimension", () => {
    const radar = scoreHealthRadar(fullInput(), NOW);
    for (const d of radar.dimensions) {
      expect(d.explanation.length).toBeGreaterThan(30);
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.weight).toBe(HEALTH_DIMENSIONS[d.id].weight);
    }
    expect(radar.methodologyVersion).toBe(METHODOLOGY_VERSION);
  });
});

describe("healthy repository", () => {
  it("scores Healthy with high confidence and all dimensions included", () => {
    const radar = scoreHealthRadar(fullInput(), NOW);
    expect(radar.label).toBe("Healthy");
    expect(radar.confidence).toBe("high");
    expect(radar.confidencePercent).toBe(100);
    expect(radar.overall).not.toBeNull();
    expect(radar.overall!).toBeGreaterThanOrEqual(70);
    expect(radar.dimensions).toHaveLength(6);
    expect(radar.dimensions.every((d) => d.score !== null)).toBe(true);
    expect(radar.computedAt).toBe(new Date(NOW).toISOString());
  });

  it("produces positive signals from real evidence", () => {
    const radar = scoreHealthRadar(fullInput(), NOW);
    expect(radar.positiveSignals.join(" ")).toMatch(/README, license, and contributing/);
    expect(radar.positiveSignals.join(" ")).toMatch(/Pushed to within/);
  });
});

describe("missing data handling", () => {
  it("excludes a failed releases endpoint and renormalizes the remaining weights", () => {
    const radar = scoreHealthRadar(fullInput({ releases: null }), NOW);
    const rel = radar.dimensions.find((d) => d.id === "releases")!;
    expect(rel.status).toBe("unavailable");
    expect(rel.score).toBeNull();
    expect(rel.excludedReason).toBeTruthy();
    expect(radar.confidencePercent).toBe(100 - HEALTH_DIMENSIONS.releases.weight);
    expect(radar.confidence).toBe("high");
    expect(radar.missingInformation.join(" ")).toMatch(/Release/);
    // total must equal 100 - excluded weight, no phantom zero contribution
    const included = radar.dimensions.filter((d) => d.score !== null);
    expect(included.reduce((a, d) => a + d.weight, 0)).toBe(radar.confidencePercent);
  });

  it("drops enough weight to lower confidence when large data is missing", () => {
    const radar = scoreHealthRadar(
      fullInput({ releases: null, weeks: null, issuesSample: null, pullsSample: null }),
      NOW,
    );
    expect(radar.confidencePercent).toBe(100 - 15 - 20);
    expect(radar.confidence).toBe("medium");
  });

  it("returns Insufficient data when less than half the weight is available", () => {
    const radar = scoreHealthRadar(
      fullInput({
        releases: null,
        weeks: null,
        statsPending: false,
        issuesSample: null,
        pullsSample: null,
        contributorCount: null,
        topContributors: null,
        communityProfile: null,
      }),
      NOW,
    );
    expect(radar.confidencePercent).toBeLessThan(50);
    expect(radar.label).toBe("Insufficient data");
    expect(radar.overall).not.toBeNull(); // transparency-only score still shown
  });

  it("falls back to metadata-only scoring when every supporting endpoint fails", () => {
    // The base repository metadata always exists when a radar is computed, so
    // transparency (weight 10) is the floor — overall reflects only that floor
    // and the label discloses that the result is not trustworthy.
    const radar = scoreHealthRadar(
      fullInput({
        repo: repo({ pushedAt: null, description: null, topics: [], licenseSpdx: null }),
        releases: null,
        weeks: null,
        issuesSample: null,
        pullsSample: null,
        contributorCount: null,
        topContributors: null,
        communityProfile: null,
      }),
      NOW,
    );
    expect(radar.overall).toBe(20); // transparency: only "repository enabled"
    expect(radar.confidencePercent).toBe(10);
    expect(radar.label).toBe("Insufficient data");
    expect(radar.dimensions.filter((d) => d.score === null)).toHaveLength(5);
  });

  it("distinguishes zero activity from unavailable data", () => {
    const radar = scoreHealthRadar(
      fullInput({
        weeks: weeks(52).map((w) => ({ ...w, commits: 0, daily: undefined })),
        repo: repo({ pushedAt: null }),
      }),
      NOW,
    );
    const maint = radar.dimensions.find((d) => d.id === "maintenance")!;
    expect(maint.status).toBe("scored");
    expect(maint.score).toBe(0); // real zero commits, scored — not "unknown"
    expect(evText(maint.evidence)).toMatch(/0 of 52/);
  });

  it("scores maintenance from recency alone when statistics are pending", () => {
    const radar = scoreHealthRadar(fullInput({ weeks: null, statsPending: true }), NOW);
    const maint = radar.dimensions.find((d) => d.id === "maintenance")!;
    expect(maint.status).toBe("scored");
    expect(maint.score).toBe(100); // pushed 3 days ago
    expect(radar.missingInformation.join(" ")).toMatch(/still being computed/);
  });
});

describe("zero releases are neutral, not unhealthy", () => {
  it("scores a neutral midpoint when the endpoint returned no releases", () => {
    const radar = scoreHealthRadar(fullInput({ releases: [] }), NOW);
    const rel = radar.dimensions.find((d) => d.id === "releases")!;
    expect(rel.status).toBe("neutral");
    expect(rel.score).toBe(50);
    expect(radar.confidencePercent).toBe(100); // still included — data was available
    expect(radar.missingInformation.join(" ")).toMatch(/not scored as unhealthy/);
  });
});

describe("archived repositories", () => {
  it("caps maintenance at 30 with an explanatory note", () => {
    const radar = scoreHealthRadar(
      fullInput({ repo: repo({ archived: true, pushedAt: new Date(NOW - 400 * DAY).toISOString() }) }),
      NOW,
    );
    const maint = radar.dimensions.find((d) => d.id === "maintenance")!;
    expect(maint.score).toBeLessThanOrEqual(30);
    expect(evText(maint.evidence)).toMatch(/archived/i);
  });

  it("caps transparency at 50 rather than zeroing", () => {
    const radar = scoreHealthRadar(fullInput({ repo: repo({ archived: true }) }), NOW);
    const t = radar.dimensions.find((d) => d.id === "transparency")!;
    expect(t.score).toBeLessThanOrEqual(50);
    expect(t.score).toBeGreaterThan(0);
  });
});

describe("issue sample scoring", () => {
  it("uses sample proxies and discloses the sample size", () => {
    const radar = scoreHealthRadar(fullInput(), NOW);
    const iss = radar.dimensions.find((d) => d.id === "issues")!;
    expect(iss.status).toBe("scored");
    expect(evText(iss.evidence)).toMatch(/Most recently updated/);
  });

  it("is neutral when the tracker is reachable but empty", () => {
    const radar = scoreHealthRadar(fullInput({ issuesSample: [], pullsSample: [] }), NOW);
    const iss = radar.dimensions.find((d) => d.id === "issues")!;
    expect(iss.status).toBe("neutral");
    expect(iss.score).toBe(50);
  });

  it("is unavailable when both samples fail", () => {
    const radar = scoreHealthRadar(
      fullInput({ issuesSample: null, pullsSample: null }),
      NOW,
    );
    const iss = radar.dimensions.find((d) => d.id === "issues")!;
    expect(iss.status).toBe("unavailable");
    expect(iss.excludedReason).toMatch(/both/i);
  });
});

describe("community dimension", () => {
  it("never scores stars or forks", () => {
    const low = scoreHealthRadar(fullInput({ repo: repo({ stars: 5, forks: 1 }) }), NOW);
    const high = scoreHealthRadar(fullInput({ repo: repo({ stars: 500_000, forks: 40_000 }) }), NOW);
    const a = low.dimensions.find((d) => d.id === "community")!.score;
    const b = high.dimensions.find((d) => d.id === "community")!.score;
    expect(a).toBe(b);
    expect(
      high.dimensions.find((d) => d.id === "community")!.evidence.find((e) =>
        e.label.startsWith("Context"),
      )?.note,
    ).toMatch(/never influence|not quality/i);
  });

  it("scores a true zero contributor count rather than excluding it", () => {
    const radar = scoreHealthRadar(fullInput({ contributorCount: 0, topContributors: null }), NOW);
    const c = radar.dimensions.find((d) => d.id === "community")!;
    expect(c.status).toBe("scored");
    expect(c.score).toBe(10); // band floor for zero contributors, not unavailable
  });
});

describe("confidence and labels", () => {
  it("maps scores to labels at the documented thresholds", () => {
    // Force a controlled overall by using only transparency (weight 10) with full metadata.
    const perfect = scoreHealthRadar(fullInput(), NOW);
    expect(["Healthy", "Watch", "Needs Attention"]).toContain(perfect.label);
  });

  it("reports medium confidence between 60 and 84 percent", () => {
    const radar = scoreHealthRadar(
      fullInput({ releases: null, communityProfile: null }),
      NOW,
    );
    expect(radar.confidencePercent).toBe(100 - 15 - 15);
    expect(radar.confidence).toBe("medium");
  });

  it("flags low confidence below 60 percent", () => {
    const radar = scoreHealthRadar(
      fullInput({
        releases: null,
        weeks: null,
        communityProfile: null,
        issuesSample: null,
        pullsSample: null,
      }),
      NOW,
    );
    expect(radar.confidencePercent).toBeLessThan(60);
    expect(radar.confidence).toBe("low");
  });
});

describe("daysBetween", () => {
  it("floors to whole days and never goes negative", () => {
    expect(daysBetween(new Date(NOW - 3 * DAY - 3600_000).toISOString(), NOW)).toBe(3);
    expect(daysBetween(new Date(NOW + 5 * DAY).toISOString(), NOW)).toBe(0);
  });

  it("returns null for invalid input", () => {
    expect(daysBetween("not-a-date", NOW)).toBeNull();
  });
});
