import type {
  ContributorSummary,
  ReleaseSummary,
  RepoSummary,
  WeeklyActivity,
} from "@/types/report";

export type DimensionId =
  | "maintenance"
  | "releases"
  | "issues"
  | "community"
  | "documentation"
  | "transparency";

/**
 * scored   — real evidence produced a 0–100 value
 * neutral  — data was available but the pattern is common for healthy projects
 *            (e.g. no GitHub releases); scored at a fixed midpoint, not penalized
 * unavailable — data could not be retrieved; excluded from the weighted total
 */
export type DimensionStatus = "scored" | "neutral" | "unavailable";

export type EvidenceItem = {
  label: string;
  value: string;
  note?: string;
};

export type DimensionScore = {
  id: DimensionId;
  title: string;
  /** Configured weight of this dimension (weights sum to 100). */
  weight: number;
  /** 0–100, or null when unavailable. */
  score: number | null;
  status: DimensionStatus;
  /** One-line result shown in the breakdown list. */
  summary: string;
  evidence: EvidenceItem[];
  /** How this dimension is scored (methodology). */
  explanation: string;
  /** Present when the dimension is excluded from the weighted total. */
  excludedReason?: string;
};

export type HealthLabel = "Healthy" | "Watch" | "Needs Attention" | "Insufficient data";
export type HealthConfidence = "high" | "medium" | "low";

export type Recommendation = {
  dimensionId: DimensionId;
  title: string;
  detail: string;
};

export type HealthRadar = {
  /** Weighted 0–100 over available dimensions; null when nothing is available. */
  overall: number | null;
  label: HealthLabel;
  confidence: HealthConfidence;
  /** Share of total weight covered by available data (0–100). */
  confidencePercent: number;
  dimensions: DimensionScore[];
  positiveSignals: string[];
  risks: string[];
  missingInformation: string[];
  recommendations: Recommendation[];
  methodologyVersion: string;
  computedAt: string;
};

export type CommunityProfileFiles = {
  readme: boolean;
  license: boolean;
  contributing: boolean;
  codeOfConduct: boolean;
  security: boolean;
};

export type CommunityProfile = {
  healthPercentage: number | null;
  description: string | null;
  files: CommunityProfileFiles;
  /** True when assembled from a root-contents probe instead of the community-profile endpoint. */
  fromContentsFallback?: boolean;
};

export type IssueSampleItem = {
  number: number;
  state: "open" | "closed";
  createdAt: string;
  closedAt: string | null;
  comments: number;
};

export type PullSampleItem = {
  number: number;
  state: "open" | "closed";
  createdAt: string;
  mergedAt: string | null;
  comments: number;
};

/** Pure input to the scoring engine — no fetching inside scoring. */
export type HealthInput = {
  repo: RepoSummary;
  weeks: WeeklyActivity[] | null;
  statsPending: boolean;
  /** null = endpoint unavailable; [] = available, zero releases. */
  releases: ReleaseSummary[] | null;
  contributorCount: number | null;
  topContributors: ContributorSummary[] | null;
  communityProfile: CommunityProfile | null;
  issuesSample: IssueSampleItem[] | null;
  pullsSample: PullSampleItem[] | null;
  /** Set when a supporting endpoint failed; drives missing-information copy. */
  fetchNotes?: string[];
};
