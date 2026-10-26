import type { ReleaseSummary, WeeklyActivity } from "@/types/report";
import type {
  CommunityProfile,
  DimensionId,
  DimensionScore,
  EvidenceItem,
  HealthConfidence,
  HealthInput,
  HealthLabel,
  HealthRadar,
  IssueSampleItem,
  PullSampleItem,
  Recommendation,
} from "@/types/health";

export const METHODOLOGY_VERSION = "1.0";

/**
 * Documented scoring model. Weights sum to 100 and are renormalized over the
 * dimensions that actually have data — a missing endpoint never counts as a
 * zero, and the exclusion is disclosed in the result.
 */
export const HEALTH_DIMENSIONS: Record<DimensionId, { title: string; weight: number }> = {
  maintenance: { title: "Maintenance activity", weight: 25 },
  issues: { title: "Issue responsiveness", weight: 20 },
  releases: { title: "Release cadence", weight: 15 },
  community: { title: "Community engagement", weight: 15 },
  documentation: { title: "Documentation", weight: 15 },
  transparency: { title: "Project transparency", weight: 10 },
};

export const DIMENSION_ORDER: DimensionId[] = [
  "maintenance",
  "releases",
  "issues",
  "community",
  "documentation",
  "transparency",
];

export const TOTAL_WEIGHT = DIMENSION_ORDER.reduce(
  (sum, id) => sum + HEALTH_DIMENSIONS[id].weight,
  0,
);

const DAY_MS = 86_400_000;

export function daysBetween(iso: string, now: number): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

/** Linear-free banding helper: returns the first matching score. */
function band(value: number, bands: Array<[number, number]>): number {
  for (const [threshold, score] of bands) {
    if (value >= threshold) return score;
  }
  return bands[bands.length - 1]![1];
}

function daysScore(days: number, bands: Array<[maxDays: number, score: number]>): number {
  for (const [maxDays, score] of bands) {
    if (days <= maxDays) return score;
  }
  return bands[bands.length - 1]![1];
}

const RECENCY_BANDS: Array<[number, number]> = [
  [7, 100],
  [30, 90],
  [90, 70],
  [180, 50],
  [365, 30],
  [Infinity, 15],
];

/* ---------- individual dimensions ---------- */

function scoreMaintenance(input: HealthInput, now: number): DimensionScore {
  const base = HEALTH_DIMENSIONS.maintenance;
  const evidence: EvidenceItem[] = [];
  const parts: Array<{ score: number; label: string }> = [];

  const pushedDays = input.repo.pushedAt ? daysBetween(input.repo.pushedAt, now) : null;
  if (pushedDays !== null) {
    const s = daysScore(pushedDays, RECENCY_BANDS);
    parts.push({ score: s, label: "recency" });
    evidence.push({
      label: "Last push",
      value: `${pushedDays} day${pushedDays === 1 ? "" : "s"} ago`,
      note: `Scored ${s}/100 (≤7d: 100, ≤30d: 90, ≤90d: 70, ≤180d: 50, ≤365d: 30, older: 15).`,
    });
  } else {
    evidence.push({ label: "Last push", value: "No push timestamp available" });
  }

  const weeks = input.weeks;
  if (weeks && weeks.length >= 4) {
    const activeWeeks = weeks.filter((w) => w.commits > 0).length;
    const ratio = activeWeeks / weeks.length;
    const s = band(ratio, [
      [0.75, 100],
      [0.5, 85],
      [0.25, 65],
      [0.001, 40],
      [0, 0],
    ]);
    parts.push({ score: s, label: "consistency" });
    evidence.push({
      label: "Active weeks",
      value: `${activeWeeks} of ${weeks.length} weeks with commits`,
      note: `Scored ${s}/100 from the share of weeks with at least one commit (trailing ~52 weeks).`,
    });
  } else if (input.statsPending) {
    evidence.push({
      label: "Commit statistics",
      value: "GitHub is still computing",
      note: "Consistency could not be scored until statistics finish computing.",
    });
  } else {
    evidence.push({ label: "Commit statistics", value: "Unavailable" });
  }

  if (input.repo.archived) {
    evidence.push({
      label: "Archived",
      value: "Repository is archived",
      note: "Archived repositories are capped at 30 — maintenance is suspended by definition, not abandoned.",
    });
  }

  if (parts.length === 0) {
    return {
      id: "maintenance",
      title: base.title,
      weight: base.weight,
      score: null,
      status: "unavailable",
      summary: "Neither push timestamps nor commit statistics were available.",
      evidence,
      explanation:
        "Combines push recency (50%) and weekly commit consistency (50%). Either part alone can produce a score.",
      excludedReason: "No push timestamp and no commit activity statistics were retrievable.",
    };
  }

  let score = Math.round(parts.reduce((a, p) => a + p.score, 0) / parts.length);
  if (input.repo.archived) score = Math.min(score, 30);

  return {
    id: "maintenance",
    title: base.title,
    weight: base.weight,
    score,
    status: "scored",
    summary: `${score}/100 — last push ${pushedDays === null ? "unknown" : `${pushedDays}d ago`}, ${
      weeks ? `${weeks.filter((w) => w.commits > 0).length}/${weeks.length} active weeks` : "consistency unavailable"
    }.`,
    evidence,
    explanation:
      "Recency of the last push (50%) plus the share of recent weeks with at least one commit (50%). " +
      "Archived repositories are capped at 30 with an explanatory note rather than zeroed. " +
      "When statistics are unavailable, recency alone decides the score and confidence is reduced.",
  };
}

function medianGapDays(releases: ReleaseSummary[]): number | null {
  const dates = releases
    .filter((r) => r.publishedAt)
    .map((r) => Date.parse(r.publishedAt!))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (dates.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push((dates[i]! - dates[i - 1]!) / DAY_MS);
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid]! : Math.round((gaps[mid - 1]! + gaps[mid]!) / 2);
}

function scoreReleases(input: HealthInput, now: number): DimensionScore {
  const base = HEALTH_DIMENSIONS.releases;
  const evidence: EvidenceItem[] = [];

  if (input.releases === null) {
    return {
      id: "releases",
      title: base.title,
      weight: base.weight,
      score: null,
      status: "unavailable",
      summary: "Release data could not be retrieved.",
      evidence: [{ label: "Releases endpoint", value: "Unavailable" }],
      explanation:
        "Latest-release recency (60%) plus median gap between recent releases (40%). " +
        "Absence of releases is not unhealthy by itself — many projects version via tags or packages.",
      excludedReason: "The releases endpoint did not return data.",
    };
  }

  const dated = input.releases.filter((r) => r.publishedAt);
  evidence.push({
    label: "Published releases",
    value: `${input.releases.length} in the latest page${input.releases.length === 1 ? "" : "s"}`,
  });

  if (dated.length === 0) {
    evidence.push({
      label: "Release pattern",
      value: "No published GitHub releases",
      note: "Projects that version via tags or package registries commonly have none — scored neutrally, not as a failure.",
    });
    return {
      id: "releases",
      title: base.title,
      weight: base.weight,
      score: 50,
      status: "neutral",
      summary: "50/100 (neutral) — no published releases; this is common for healthy projects.",
      evidence,
      explanation:
        "Release cadence is scored from GitHub releases. A repository with no releases receives a neutral midpoint " +
        "because release practices vary widely; tag- or package-based versioning is not penalized.",
    };
  }

  const latest = dated[0]!;
  const latestDays = daysBetween(latest.publishedAt!, now)!;
  const recencyScore = daysScore(latestDays, RECENCY_BANDS);
  evidence.push({
    label: "Latest release",
    value: `${latest.tagName} — ${latestDays} day${latestDays === 1 ? "" : "s"} ago`,
    note: `Scored ${recencyScore}/100.`,
  });

  const gap = medianGapDays(dated);
  let score: number;
  if (gap === null) {
    score = recencyScore;
    evidence.push({
      label: "Release regularity",
      value: "Not enough dated releases",
      note: "Recency alone decides the score.",
    });
  } else {
    const gapScore = daysScore(gap, [
      [30, 100],
      [60, 85],
      [120, 70],
      [240, 50],
      [Infinity, 30],
    ]);
    score = Math.round(recencyScore * 0.6 + gapScore * 0.4);
    evidence.push({
      label: "Median gap between releases",
      value: `${Math.round(gap)} days`,
      note: `Scored ${gapScore}/100.`,
    });
  }

  return {
    id: "releases",
    title: base.title,
    weight: base.weight,
    score,
    status: "scored",
    summary: `${score}/100 — latest release ${latestDays}d ago${gap === null ? "" : `, median gap ${Math.round(gap)}d`}.`,
    evidence,
    explanation:
      "Latest-release recency (60%) plus the median gap across recent dated releases (40%). " +
      "Zero releases with a working endpoint scores a neutral 50, never a penalty.",
  };
}

function resolutionPercent(issues: IssueSampleItem[]): number | null {
  const closed = issues.filter((i) => i.state === "closed" && i.closedAt);
  if (closed.length === 0) return null;
  const quick = closed.filter((i) => {
    const created = Date.parse(i.createdAt);
    const closedAt = Date.parse(i.closedAt!);
    return Number.isFinite(created) && Number.isFinite(closedAt) && closedAt - created <= 30 * DAY_MS;
  });
  return (quick.length / closed.length) * 100;
}

function commentPercent(items: Array<{ comments: number }>): number | null {
  if (items.length === 0) return null;
  return (items.filter((i) => i.comments >= 1).length / items.length) * 100;
}

function mergePercent(pulls: PullSampleItem[]): number | null {
  const closed = pulls.filter((p) => p.state === "closed");
  if (closed.length === 0) return null;
  return (closed.filter((p) => p.mergedAt).length / closed.length) * 100;
}

function scoreIssues(input: HealthInput): DimensionScore {
  const base = HEALTH_DIMENSIONS.issues;
  const evidence: EvidenceItem[] = [];
  const issues = input.issuesSample;
  const pulls = input.pullsSample;

  if (issues === null && pulls === null) {
    return {
      id: "issues",
      title: base.title,
      weight: base.weight,
      score: null,
      status: "unavailable",
      summary: "Issue and pull-request samples could not be retrieved.",
      evidence: [{ label: "Issues / pulls endpoints", value: "Unavailable" }],
      explanation:
        "Sample-based proxies: share of closed issues resolved within 30 days, share of items with at least one " +
        "comment, and share of closed pull requests that were merged — measured on the most recently updated items, " +
        "not the full history.",
      excludedReason: "Both the issues and pull-request samples failed to load.",
    };
  }

  const allItems = [...(issues ?? []), ...(pulls ?? [])];
  evidence.push({
    label: "Sample size",
    value: `${issues?.length ?? 0} issue(s), ${pulls?.length ?? 0} pull request(s)`,
    note: "Most recently updated items — a bounded sample, not the complete tracker history.",
  });

  if (allItems.length === 0) {
    evidence.push({
      label: "Tracker activity",
      value: "No issues or pull requests in the sample",
      note: "The tracker is reachable but returned no recent items — scored neutrally.",
    });
    return {
      id: "issues",
      title: base.title,
      weight: base.weight,
      score: 50,
      status: "neutral",
      summary: "50/100 (neutral) — tracker reachable, no recent items in the sample.",
      evidence,
      explanation:
        "Sample-based responsiveness proxies. With a reachable tracker but no recent items, a neutral midpoint is " +
        "used because low tracker volume is common for healthy libraries.",
    };
  }

  const parts: Array<{ score: number; label: string }> = [];

  const res = issues ? resolutionPercent(issues) : null;
  if (res !== null) {
    const s = band(res, [
      [70, 100],
      [50, 85],
      [30, 65],
      [0.001, 45],
      [0, 25],
    ]);
    parts.push({ score: s, label: "resolution" });
    evidence.push({
      label: "Closed issues resolved ≤30 days",
      value: `${Math.round(res)}%`,
      note: `Scored ${s}/100, measured on closed issues in the sample.`,
    });
  }

  const cmt = commentPercent(allItems);
  if (cmt !== null) {
    const s = band(cmt, [
      [50, 100],
      [30, 85],
      [15, 65],
      [0.001, 45],
      [0, 25],
    ]);
    parts.push({ score: s, label: "engagement" });
    evidence.push({
      label: "Items with ≥1 comment",
      value: `${Math.round(cmt)}%`,
      note: `Scored ${s}/100 — a visible-discussion proxy, not a full response-time analysis.`,
    });
  }

  const merge = pulls ? mergePercent(pulls) : null;
  if (merge !== null) {
    const s = band(merge, [
      [80, 100],
      [60, 85],
      [40, 65],
      [0.001, 45],
      [0, 25],
    ]);
    parts.push({ score: s, label: "merge" });
    evidence.push({
      label: "Closed pull requests merged",
      value: `${Math.round(merge)}%`,
      note: `Scored ${s}/100.`,
    });
  }

  if (parts.length === 0) {
    evidence.push({ label: "Scoring inputs", value: "No closed items or comments to measure" });
    return {
      id: "issues",
      title: base.title,
      weight: base.weight,
      score: 50,
      status: "neutral",
      summary: "50/100 (neutral) — sample present but no measurable closure or discussion activity.",
      evidence,
      explanation:
        "Sample-based responsiveness proxies. With nothing measurable in the bounded sample, a neutral midpoint is used.",
    };
  }

  const score = Math.round(parts.reduce((a, p) => a + p.score, 0) / parts.length);
  return {
    id: "issues",
    title: base.title,
    weight: base.weight,
    score,
    status: "scored",
    summary: `${score}/100 — from ${allItems.length} recently updated item(s).`,
    evidence,
    explanation:
      "Sample-based proxies from the most recently updated issues and pull requests: share of closed issues " +
      "resolved within 30 days, share of items with at least one comment, and merge rate of closed pull requests. " +
      "These are bounded samples, not complete tracker history or true first-response times.",
  };
}

function scoreCommunity(input: HealthInput): DimensionScore {
  const base = HEALTH_DIMENSIONS.community;
  const evidence: EvidenceItem[] = [];
  const count = input.contributorCount;
  const top = input.topContributors;

  if (count === null && top === null) {
    return {
      id: "community",
      title: base.title,
      weight: base.weight,
      score: null,
      status: "unavailable",
      summary: "Contributor data could not be retrieved.",
      evidence: [{ label: "Contributors endpoint", value: "Unavailable" }],
      explanation:
        "Contributor breadth (60%) from the reported contributor count, plus activity distribution (40%) " +
        "from the top contributors sample. Stars and forks are shown as context only and never scored.",
      excludedReason: "The contributors endpoint did not return data.",
    };
  }

  const parts: Array<{ score: number; label: string }> = [];

  if (count !== null) {
    const s = band(count, [
      [50, 100],
      [20, 90],
      [10, 80],
      [5, 65],
      [2, 50],
      [1, 30],
      [0, 10],
    ]);
    parts.push({ score: s, label: "breadth" });
    evidence.push({
      label: "Contributors",
      value: count.toLocaleString("en-US"),
      note: `Scored ${s}/100. GitHub's reported contributor count (commit authors), not a complete measure of contribution.`,
    });
  } else {
    evidence.push({ label: "Contributors", value: "Count unavailable" });
  }

  if (top && top.length >= 3) {
    const total = top.reduce((a, c) => a + c.contributions, 0);
    const top1 = Math.max(...top.map((c) => c.contributions));
    const share = total > 0 ? (top1 / total) * 100 : 100;
    const s = share <= 30 ? 100 : share <= 50 ? 85 : share <= 70 ? 65 : 45;
    parts.push({ score: s, label: "distribution" });
    evidence.push({
      label: "Top contributor share (sample)",
      value: `${Math.round(share)}% of sampled contributions`,
      note: `Scored ${s}/100 from the top ${top.length} contributors. Lower concentration scores higher.`,
    });
  } else {
    evidence.push({
      label: "Activity distribution",
      value: "Not enough contributors sampled",
    });
  }

  evidence.push({
    label: "Context (not scored)",
    value: `${input.repo.stars.toLocaleString("en-US")} stars · ${input.repo.forks.toLocaleString("en-US")} forks`,
    note: "Popularity metrics are context only — they are not quality or maintenance measures.",
  });

  if (parts.length === 0) {
    return {
      id: "community",
      title: base.title,
      weight: base.weight,
      score: null,
      status: "unavailable",
      summary: "Contributor count and distribution were both unavailable.",
      evidence,
      explanation:
        "Contributor breadth (60%) plus activity distribution (40%). Stars and forks are never scored.",
      excludedReason: "Neither contributor count nor a contributor sample was retrievable.",
    };
  }

  const score = Math.round(parts.reduce((a, p) => a + p.score, 0) / parts.length);
  return {
    id: "community",
    title: base.title,
    weight: base.weight,
    score,
    status: "scored",
    summary: `${score}/100 — ${count === null ? "count unavailable" : `${count} contributor(s)`}.`,
    evidence,
    explanation:
      "Contributor breadth (60%) plus how evenly recent activity is distributed across top contributors (40%). " +
      "Stars and forks are displayed as context and never influence the score.",
  };
}

function scoreDocumentation(input: HealthInput): DimensionScore {
  const base = HEALTH_DIMENSIONS.documentation;
  const profile: CommunityProfile | null = input.communityProfile;
  const evidence: EvidenceItem[] = [];

  if (profile === null) {
    return {
      id: "documentation",
      title: base.title,
      weight: base.weight,
      score: null,
      status: "unavailable",
      summary: "Documentation signals could not be retrieved.",
      evidence: [{ label: "Community profile", value: "Unavailable" }],
      explanation:
        "Presence of README (35), license (25), contributing guide (20), code of conduct (10), and " +
        "description (10), from the GitHub community profile (or a root-contents fallback).",
      excludedReason: "The community profile and the root-contents fallback both failed.",
    };
  }

  const f = profile.files;
  const parts: Array<[string, boolean, number]> = [
    ["README", f.readme, 35],
    ["License file", f.license, 25],
    ["Contributing guide", f.contributing, 20],
    ["Code of conduct", f.codeOfConduct, 10],
    ["Description", Boolean(profile.description ?? input.repo.description), 10],
  ];

  let score = 0;
  for (const [label, present, pts] of parts) {
    if (present) score += pts;
    evidence.push({ label, value: present ? "Present" : "Missing", note: `Worth ${pts} point(s).` });
  }

  if (profile.fromContentsFallback) {
    evidence.push({
      label: "Source",
      value: "Repository root listing (community profile unavailable)",
      note: "Signals were derived from a root-directory probe, which cannot see files in subdirectories.",
    });
  }

  return {
    id: "documentation",
    title: base.title,
    weight: base.weight,
    score,
    status: "scored",
    summary: `${score}/100 — ${parts.filter(([, p]) => p).length}/${parts.length} documentation signals present.`,
    evidence,
    explanation:
      "Documentation signals from the GitHub community profile: README (35), license (25), contributing guide (20), " +
      "code of conduct (10), and repository description (10). This measures presence, not documentation quality.",
  };
}

function scoreTransparency(input: HealthInput): DimensionScore {
  const base = HEALTH_DIMENSIONS.transparency;
  const { repo } = input;
  const evidence: EvidenceItem[] = [];
  const parts: Array<[string, boolean, number]> = [
    ["Description", Boolean(repo.description), 30],
    ["Topics", repo.topics.length > 0, 25],
    ["License metadata", Boolean(repo.licenseSpdx), 25],
    ["Repository enabled", !repo.disabled, 20],
  ];

  let score = 0;
  for (const [label, present, pts] of parts) {
    if (present) score += pts;
    evidence.push({ label, value: present ? "Yes" : "No", note: `Worth ${pts} point(s).` });
  }

  if (repo.topics.length > 0) {
    evidence.push({ label: "Topics", value: repo.topics.slice(0, 8).join(", ") });
  }
  if (repo.archived) {
    evidence.push({
      label: "Archived",
      value: "Capped at 50",
      note: "Archived repositories are transparent about their state — capped, not zeroed.",
    });
    score = Math.min(score, 50);
  }
  if (repo.disabled) {
    evidence.push({ label: "Disabled", value: "Repository is disabled on GitHub" });
  }

  return {
    id: "transparency",
    title: base.title,
    weight: base.weight,
    score,
    status: "scored",
    summary: `${score}/100 — ${parts.filter(([, p]) => p).length}/${parts.length} public-metadata signals present.`,
    evidence,
    explanation:
      "Public metadata quality: description (30), topics (25), SPDX license metadata (25), and the repository " +
      "being enabled (20). Archived repositories are capped at 50 with an explanatory note.",
  };
}

/* ---------- signals, risks, recommendations ---------- */

function buildSignals(
  input: HealthInput,
  dims: DimensionScore[],
  now: number,
): { positive: string[]; risks: string[]; missing: string[]; recommendations: Recommendation[] } {
  const positive: string[] = [];
  const risks: string[] = [];
  const missing: string[] = [];
  const recommendations: Recommendation[] = [];

  const pushedDays = input.repo.pushedAt ? daysBetween(input.repo.pushedAt, now) : null;
  if (pushedDays !== null && pushedDays <= 30) {
    positive.push(`Pushed to within the last ${pushedDays} day${pushedDays === 1 ? "" : "s"}.`);
  } else if (pushedDays !== null && pushedDays > 365) {
    risks.push(
      `No pushes in the last ${Math.round(pushedDays / 30)} months. A long-dormant repository may be complete rather than abandoned — consider stating its status.`,
    );
    recommendations.push({
      dimensionId: "maintenance",
      title: "State the maintenance status",
      detail:
        "If the project is stable and complete, or actively maintained elsewhere, a short status note in the README helps users judge whether that matters for them.",
    });
  }

  const doc = input.communityProfile;
  if (doc?.files.readme && doc.files.license && doc.files.contributing) {
    positive.push("README, license, and contributing guide are all present.");
  }
  if (doc && !doc.files.readme) {
    risks.push("No README was detected — new visitors cannot tell what the project does.");
    recommendations.push({
      dimensionId: "documentation",
      title: "Add a README",
      detail: "A README with a short description, install steps, and usage example is the highest-leverage documentation fix.",
    });
  }
  if (doc && !doc.files.license && !input.repo.licenseSpdx) {
    risks.push("No license was detected on GitHub or in the repository files.");
    recommendations.push({
      dimensionId: "documentation",
      title: "Add a license",
      detail: "Without a license, default copyright restrictions apply and others cannot safely use the code. Add a LICENSE file (e.g. MIT, Apache-2.0).",
    });
  }
  if (!input.repo.description) {
    recommendations.push({
      dimensionId: "transparency",
      title: "Add a repository description",
      detail: "A one-line description on GitHub helps people (and search) understand the project at a glance.",
    });
  }
  if (input.repo.topics.length === 0) {
    recommendations.push({
      dimensionId: "transparency",
      title: "Add topics",
      detail: "GitHub topics improve discoverability and communicate the project's domain in one click.",
    });
  }

  if (input.releases === null) {
    missing.push("Release data was unavailable; release cadence was not scored.");
  } else if (input.releases.length === 0) {
    missing.push(
      "No published GitHub releases. This is not scored as unhealthy — many projects version via tags or packages.",
    );
  }
  if (input.weeks === null && input.statsPending) {
    missing.push("Commit statistics are still being computed by GitHub; consistency was not scored.");
  } else if (input.weeks === null) {
    missing.push("Commit activity statistics were unavailable; maintenance consistency was not scored.");
  }
  if (input.issuesSample === null && input.pullsSample === null) {
    missing.push("Issue and pull-request samples were unavailable; responsiveness was not scored.");
  }
  if (input.communityProfile === null) {
    missing.push("Documentation signals were unavailable (community profile and root probe both failed).");
  }
  if (input.contributorCount === null && input.topContributors === null) {
    missing.push("Contributor data was unavailable; community engagement was not scored.");
  }
  for (const note of input.fetchNotes ?? []) missing.push(note);

  const issues = dims.find((d) => d.id === "issues");
  if (issues?.status === "scored" && issues.score !== null && issues.score < 45) {
    risks.push("The recent issue/PR sample shows little discussion or slow closure.");
    recommendations.push({
      dimensionId: "issues",
      title: "Set a lightweight triage rhythm",
      detail: "Even a periodic batch of replies, labels, or closures visibly improves responsiveness signals for users evaluating the project.",
    });
  }
  const rel = dims.find((d) => d.id === "releases");
  if (rel?.status === "scored" && rel.score !== null && rel.score < 40) {
    recommendations.push({
      dimensionId: "releases",
      title: "Refresh release notes",
      detail: "Publishing a release (or tagging a version) helps consumers track changes. Only do this when there is something real to ship.",
    });
  }
  const comm = dims.find((d) => d.id === "community");
  if (comm?.status === "scored" && comm.score !== null && comm.score <= 30) {
    positive.push("Contribution appears distributed across multiple contributors.");
  }

  return { positive, risks, missing, recommendations };
}

/* ---------- main entry ---------- */

export function scoreHealthRadar(input: HealthInput, now: number = Date.now()): HealthRadar {
  const dimensions: DimensionScore[] = [
    scoreMaintenance(input, now),
    scoreReleases(input, now),
    scoreIssues(input),
    scoreCommunity(input),
    scoreDocumentation(input),
    scoreTransparency(input),
  ];

  const included = dimensions.filter(
    (d): d is DimensionScore & { score: number } => d.score !== null && d.status !== "unavailable",
  );
  const totalIncludedWeight = included.reduce((a, d) => a + d.weight, 0);

  const overall =
    totalIncludedWeight === 0
      ? null
      : Math.round(
          included.reduce((a, d) => a + (d.score as number) * d.weight, 0) / totalIncludedWeight,
        );

  const confidencePercent = totalIncludedWeight;
  const confidence: HealthConfidence =
    confidencePercent >= 85 ? "high" : confidencePercent >= 60 ? "medium" : "low";

  let label: HealthLabel;
  if (overall === null || confidencePercent < 50) {
    label = "Insufficient data";
  } else if (overall >= 70) {
    label = "Healthy";
  } else if (overall >= 40) {
    label = "Watch";
  } else {
    label = "Needs Attention";
  }

  const { positive, risks, missing, recommendations } = buildSignals(input, dimensions, now);

  return {
    overall,
    label,
    confidence,
    confidencePercent,
    dimensions,
    positiveSignals: positive,
    risks,
    missingInformation: missing,
    recommendations,
    methodologyVersion: METHODOLOGY_VERSION,
    computedAt: new Date(now).toISOString(),
  };
}
