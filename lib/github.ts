import { encodeRepoPath } from "@/lib/validation";
import type {
  ContributorSummary,
  LanguageStat,
  ReleaseSummary,
  RepoSummary,
  Report,
  WeeklyActivity,
} from "@/types/report";

const API = "https://api.github.com";
/** Verified 2026-10: 2022-11-28 is supported until 2028-03-10 (docs.github.com/en/rest/about-the-rest-api/api-versions). */
const API_VERSION = "2022-11-28";
const TIMEOUT_MS = 8_000;

export type GitHubErrorKind =
  | "not_found"
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "upstream"
  | "timeout"
  | "network";

export class GitHubError extends Error {
  constructor(
    public kind: GitHubErrorKind,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

function authHeaders(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
  if (process.env.GITHUB_TOKEN) {
    h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return h;
}

function rateLimitSeconds(res: Response): number | undefined {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) {
    const n = Number(retryAfter);
    if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  }
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset) {
    const t = Number(reset) * 1000;
    if (Number.isFinite(t) && t > Date.now()) {
      return Math.ceil((t - Date.now()) / 1000);
    }
  }
  return undefined;
}

function isRateLimited(res: Response): boolean {
  return (
    res.status === 429 ||
    (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") ||
    (res.status === 403 && res.headers.has("retry-after"))
  );
}

function errorFromResponse(res: Response): GitHubError {
  if (isRateLimited(res)) {
    return new GitHubError(
      "rate_limited",
      "GitHub rate limit reached. Try again in a few minutes.",
      rateLimitSeconds(res),
    );
  }
  switch (res.status) {
    case 400:
      return new GitHubError("invalid", "GitHub rejected the request.");
    case 401:
      return new GitHubError(
        "unauthorized",
        "GitHub authentication failed. Check the server GITHUB_TOKEN.",
      );
    case 403:
      return new GitHubError(
        "forbidden",
        "GitHub denied access to this repository.",
      );
    case 404:
      return new GitHubError("not_found", "Repository not found.");
    case 422:
      return new GitHubError(
        "invalid",
        "GitHub could not process this repository's statistics.",
      );
    default:
      return new GitHubError(
        "upstream",
        "GitHub is temporarily unavailable. Try again shortly.",
      );
  }
}

export type GhResult<T> =
  | { ok: true; data: T; res: Response }
  | { ok: false; error: GitHubError; pending?: boolean };

export async function gh<T>(path: string, revalidate: number): Promise<GhResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate },
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return {
        ok: false,
        error: new GitHubError("timeout", "GitHub request timed out. Try again."),
      };
    }
    return {
      ok: false,
      error: new GitHubError("network", "Could not reach GitHub. Try again."),
    };
  }
  if (res.status === 202) return { ok: false, error: errorFromResponse(res), pending: true };
  if (!res.ok) return { ok: false, error: errorFromResponse(res) };
  try {
    const data = (await res.json()) as T;
    return { ok: true, data, res };
  } catch {
    return {
      ok: false,
      error: new GitHubError("upstream", "GitHub returned an unreadable response."),
    };
  }
}

/* ---------- raw GitHub payload shapes (never exposed to UI) ---------- */

type RawRepo = {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  pushed_at: string | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  disabled?: boolean;
  topics?: string[];
  license: { spdx_id: string | null; name: string | null } | null;
  owner: { login: string; avatar_url: string };
};

type RawRelease = {
  id: number;
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
};

type RawContributor = {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
};

type RawWeek = { week: number; total: number; days?: number[] };

/* ---------- normalizers (exported for tests) ---------- */

export function normalizeRepo(raw: RawRepo): RepoSummary {
  return {
    owner: raw.owner.login,
    name: raw.name,
    fullName: raw.full_name,
    description: raw.description ?? null,
    htmlUrl: raw.html_url,
    avatarUrl: raw.owner.avatar_url,
    stars: raw.stargazers_count ?? 0,
    forks: raw.forks_count ?? 0,
    openIssues: raw.open_issues_count ?? 0,
    defaultBranch: raw.default_branch ?? "main",
    primaryLanguage: raw.language ?? null,
    licenseName: raw.license?.name ?? null,
    licenseSpdx:
      raw.license?.spdx_id && raw.license.spdx_id !== "NOASSERTION"
        ? raw.license.spdx_id
        : null,
    archived: raw.archived ?? false,
    disabled: raw.disabled ?? false,
    topics: Array.isArray(raw.topics) ? raw.topics.filter((t) => typeof t === "string") : [],
    createdAt: raw.created_at,
    pushedAt: raw.pushed_at ?? null,
    updatedAt: raw.updated_at,
  };
}

export function normalizeRelease(raw: RawRelease): ReleaseSummary {
  return {
    id: raw.id,
    tagName: raw.tag_name,
    title: raw.name ?? null,
    publishedAt: raw.published_at ?? null,
    htmlUrl: raw.html_url,
    prerelease: raw.prerelease ?? false,
    draft: raw.draft ?? false,
  };
}

export function normalizeContributor(raw: RawContributor): ContributorSummary {
  return {
    login: raw.login,
    avatarUrl: raw.avatar_url,
    profileUrl: raw.html_url,
    contributions: raw.contributions ?? 0,
  };
}

export function normalizeActivity(raw: RawWeek[]): WeeklyActivity[] {
  return raw.map((w) => ({
    weekStart: new Date(w.week * 1000).toISOString().slice(0, 10),
    commits: w.total ?? 0,
    ...(Array.isArray(w.days) && w.days.length === 7
      ? { daily: w.days.map((d) => (typeof d === "number" && Number.isFinite(d) ? d : 0)) }
      : {}),
  }));
}

export function normalizeLanguages(
  raw: Record<string, number>,
): LanguageStat[] {
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return Object.entries(raw)
    .map(([name, bytes]) => ({
      name,
      bytes,
      percent: Math.round((bytes / total) * 1000) / 10,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

function parseLastPage(link: string | null): number | undefined {
  return link?.match(/[?&]page=(\d+)>; rel="last"/)?.[1]
    ? Number(link.match(/[?&]page=(\d+)>; rel="last"/)?.[1])
    : undefined;
}

/* ---------- report assembly ---------- */

export async function getReport(
  owner: string,
  repo: string,
): Promise<Report> {
  const base = `/repos/${encodeRepoPath(owner, repo)}`;
  const r = await gh<RawRepo>(base, 300);
  if (!r.ok) throw r.error;

  const [contributors, count, stats, releases, languages] = await Promise.all([
    gh<RawContributor[]>(`${base}/contributors?per_page=8`, 600),
    gh<RawContributor[]>(`${base}/contributors?per_page=1&anon=true`, 600),
    gh<RawWeek[]>(`${base}/stats/commit_activity`, 900),
    gh<RawRelease[]>(`${base}/releases?per_page=5`, 600),
    gh<Record<string, number>>(`${base}/languages`, 900),
  ]);

  const sectionErrors: Report["sectionErrors"] = {};
  if (!contributors.ok) sectionErrors.contributors = "Contributor data is unavailable.";
  if (!releases.ok) sectionErrors.releases = "Release data is unavailable.";
  if (!stats.ok && !stats.pending) sectionErrors.stats = "Commit activity is unavailable.";
  if (!languages.ok) sectionErrors.languages = "Language data is unavailable.";

  const contributorCount = count.ok
    ? parseLastPage(count.res.headers.get("link")) ?? count.data.length
    : null;

  const weeks =
    stats.ok && stats.data.length
      ? normalizeActivity(stats.data)
      : null;

  const checkedAt = new Date().toISOString();

  return {
    repo: normalizeRepo(r.data),
    contributors: contributors.ok
      ? contributors.data.map(normalizeContributor)
      : null,
    contributorCount,
    weeks,
    statsPending: !stats.ok && stats.pending === true,
    releases: releases.ok
      ? releases.data
          .filter((x) => !x.draft)
          .map(normalizeRelease)
      : null,
    languages: languages.ok ? normalizeLanguages(languages.data) : null,
    sectionErrors,
    checkedAt,
  };
}
