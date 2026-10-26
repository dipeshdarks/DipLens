import { getReport, type GitHubError } from "@/lib/github";
import {
  getCommunityProfile,
  getIssuesSample,
  getPullsSample,
  getRootDocSignals,
} from "@/lib/github/endpoints";
import { scoreHealthRadar } from "@/lib/health-radar/scoring";
import type { Report } from "@/types/report";
import type { HealthInput, HealthRadar } from "@/types/health";

export type HealthRadarResult = {
  radar: HealthRadar;
  report: Report;
};

function note(error: GitHubError, what: string): string {
  if (error.kind === "rate_limited") {
    return `${what} unavailable: GitHub rate limit reached.`;
  }
  if (error.kind === "not_found") {
    return `${what} unavailable: GitHub returned not-found for this endpoint.`;
  }
  return `${what} unavailable: ${error.message}`;
}

/**
 * Fetch the extra evidence needed for the health radar and score it.
 * Never throws for supporting endpoints — failures become `null` inputs so the
 * scoring engine can exclude the dimension and lower confidence instead.
 * When a `Report` is supplied it is reused (no duplicate base fetches).
 */
export async function getHealthRadar(
  owner: string,
  repo: string,
  existingReport?: Report,
): Promise<HealthRadarResult> {
  const report = existingReport ?? (await getReport(owner, repo));

  const [profile, issues, pulls] = await Promise.all([
    getCommunityProfile(owner, repo),
    getIssuesSample(owner, repo),
    getPullsSample(owner, repo),
  ]);

  const fetchNotes: string[] = [];

  let communityProfile = profile.ok ? profile.data : null;
  if (!profile.ok) {
    const rootSignals = await getRootDocSignals(owner, repo, report.repo.defaultBranch);
    if (rootSignals.ok) {
      communityProfile = rootSignals.data;
    } else {
      fetchNotes.push(note(profile.error, "Community profile"));
      fetchNotes.push(note(rootSignals.error, "Root-contents documentation probe"));
    }
  }

  if (!issues.ok) fetchNotes.push(note(issues.error, "Issue sample"));
  if (!pulls.ok) fetchNotes.push(note(pulls.error, "Pull-request sample"));

  const input: HealthInput = {
    repo: report.repo,
    weeks: report.weeks,
    statsPending: report.statsPending,
    releases: report.releases,
    contributorCount: report.contributorCount,
    topContributors: report.contributors,
    communityProfile,
    issuesSample: issues.ok ? issues.data : null,
    pullsSample: pulls.ok ? pulls.data : null,
    fetchNotes,
  };

  return { radar: scoreHealthRadar(input), report };
}
