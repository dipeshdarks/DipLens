export type RepoSummary = {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  avatarUrl: string;
  stars: number;
  forks: number;
  openIssues: number;
  defaultBranch: string;
  primaryLanguage: string | null;
  licenseName: string | null;
  licenseSpdx: string | null;
  archived: boolean;
  disabled: boolean;
  topics: string[];
  createdAt: string;
  pushedAt: string | null;
  updatedAt: string;
};

export type WeeklyActivity = {
  weekStart: string;
  commits: number;
  /** Daily commit counts for the week (Sun–Sat, GitHub order). Absent for older cached data. */
  daily?: number[];
};

export type ReleaseSummary = {
  id: number;
  tagName: string;
  title: string | null;
  publishedAt: string | null;
  htmlUrl: string;
  prerelease: boolean;
  draft: boolean;
};

export type ContributorSummary = {
  login: string;
  avatarUrl: string;
  profileUrl: string;
  contributions: number;
};

export type LanguageStat = { name: string; bytes: number; percent: number };

export type SectionErrors = {
  contributors?: string;
  releases?: string;
  stats?: string;
  languages?: string;
};

export type Report = {
  repo: RepoSummary;
  contributors: ContributorSummary[] | null;
  contributorCount: number | null;
  weeks: WeeklyActivity[] | null;
  statsPending: boolean;
  releases: ReleaseSummary[] | null;
  languages: LanguageStat[] | null;
  sectionErrors: SectionErrors;
  checkedAt: string;
};

export type SignalLabel = "Active" | "Moderate" | "Needs attention" | "Unknown";

export type Signal = {
  title: string;
  label: SignalLabel;
  detail: string;
};
