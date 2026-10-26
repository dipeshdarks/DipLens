import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HealthRadarPanel from "@/components/health/HealthRadarPanel";
import { scoreHealthRadar } from "@/lib/health-radar/scoring";
import type { HealthInput } from "@/types/health";
import type { RepoSummary, WeeklyActivity } from "@/types/report";

const NOW = Date.parse("2026-10-25T00:00:00Z");
const DAY = 86_400_000;

function input(overrides: Partial<HealthInput> = {}): HealthInput {
  const repo: RepoSummary = {
    owner: "acme",
    name: "widget",
    fullName: "acme/widget",
    description: "A widget",
    htmlUrl: "https://github.com/acme/widget",
    avatarUrl: "",
    stars: 100,
    forks: 10,
    openIssues: 4,
    defaultBranch: "main",
    primaryLanguage: "TypeScript",
    licenseName: "MIT License",
    licenseSpdx: "MIT",
    archived: false,
    disabled: false,
    topics: ["widgets"],
    createdAt: "2020-01-01T00:00:00Z",
    pushedAt: new Date(NOW - 2 * DAY).toISOString(),
    updatedAt: new Date(NOW - DAY).toISOString(),
  };
  const weeks: WeeklyActivity[] = Array.from({ length: 52 }, (_, i) => ({
    weekStart: new Date(NOW - (52 - i) * 7 * DAY).toISOString().slice(0, 10),
    commits: 8,
  }));
  return {
    repo,
    weeks,
    statsPending: false,
    releases: [
      {
        id: 1,
        tagName: "v1.2.0",
        title: "v1.2.0",
        publishedAt: new Date(NOW - 12 * DAY).toISOString(),
        htmlUrl: "https://github.com/acme/widget/releases/v1.2.0",
        prerelease: false,
        draft: false,
      },
    ],
    contributorCount: 12,
    topContributors: [
      { login: "a", avatarUrl: "", profileUrl: "", contributions: 50 },
      { login: "b", avatarUrl: "", profileUrl: "", contributions: 30 },
      { login: "c", avatarUrl: "", profileUrl: "", contributions: 20 },
    ],
    communityProfile: {
      healthPercentage: 80,
      description: "A widget",
      files: {
        readme: true,
        license: true,
        contributing: true,
        codeOfConduct: false,
        security: false,
      },
    },
    issuesSample: [
      {
        number: 1,
        state: "closed",
        createdAt: new Date(NOW - 40 * DAY).toISOString(),
        closedAt: new Date(NOW - 36 * DAY).toISOString(),
        comments: 3,
      },
    ],
    pullsSample: [
      {
        number: 2,
        state: "closed",
        createdAt: new Date(NOW - 30 * DAY).toISOString(),
        mergedAt: new Date(NOW - 28 * DAY).toISOString(),
        comments: 1,
      },
    ],
    ...overrides,
  };
}

describe("HealthRadarPanel", () => {
  it("shows an empty state when the radar could not be computed", () => {
    render(<HealthRadarPanel radar={null} />);
    expect(screen.getByText(/Health scoring is unavailable/)).toBeInTheDocument();
  });

  it("renders overall score, label, confidence, and timestamp", () => {
    const radar = scoreHealthRadar(input(), NOW);
    render(<HealthRadarPanel radar={radar} />);

    expect(screen.getByTestId("health-label")).toHaveTextContent(radar.label!);
    expect(screen.getByText("out of 100")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${radar.confidencePercent}% of weight covered`))).toBeInTheDocument();
    expect(screen.getByText(/methodology v1\.0/)).toBeInTheDocument();
  });

  it("lists all six dimensions with scores and weights", () => {
    const radar = scoreHealthRadar(input(), NOW);
    render(<HealthRadarPanel radar={radar} />);

    for (const title of [
      "Maintenance activity",
      "Release cadence",
      "Issue responsiveness",
      "Community engagement",
      "Documentation",
      "Project transparency",
    ]) {
      expect(screen.getByTestId(`dimension-toggle-${idFor(title)}`)).toBeInTheDocument();
    }
  });

  it("opens a dimension's evidence detail on click and collapses on second click", async () => {
    const user = userEvent.setup();
    const radar = scoreHealthRadar(input(), NOW);
    render(<HealthRadarPanel radar={radar} />);

    const btn = screen.getByTestId("dimension-toggle-maintenance");
    expect(btn).toHaveAttribute("aria-expanded", "false");

    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const detail = within(screen.getByTestId("dimension-detail"));
    expect(detail.getByText("Evidence")).toBeInTheDocument();
    expect(detail.getByText(/How it is scored/)).toBeInTheDocument();
    expect(detail.getByText(/Last push/)).toBeInTheDocument();

    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("dimension-detail")).not.toBeInTheDocument();
  });

  it("discloses excluded dimensions instead of scoring them zero", async () => {
    const radar = scoreHealthRadar(input({ releases: null }), NOW);
    render(<HealthRadarPanel radar={radar} />);

    const btn = screen.getByTestId("dimension-toggle-releases");
    await userEvent.click(btn);
    const detail = within(screen.getByTestId("dimension-detail"));
    expect(detail.getByText(/Excluded from the weighted total/)).toBeInTheDocument();
    expect(detail.getByText("excluded")).toBeInTheDocument();
  });

  it("documents the methodology and its non-prediction disclaimer", () => {
    const radar = scoreHealthRadar(input(), NOW);
    render(<HealthRadarPanel radar={radar} />);
    expect(screen.getByText("How is this calculated?")).toBeInTheDocument();
    expect(
      screen.getByText(/does not predict security, code quality, or the\s+future success/),
    ).toBeInTheDocument();
  });
});

function idFor(title: string): string {
  const map: Record<string, string> = {
    "Maintenance activity": "maintenance",
    "Release cadence": "releases",
    "Issue responsiveness": "issues",
    "Community engagement": "community",
    Documentation: "documentation",
    "Project transparency": "transparency",
  };
  return map[title]!;
}
