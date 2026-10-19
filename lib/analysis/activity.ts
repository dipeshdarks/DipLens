import type { ActivityReport, CommitSummary } from "@/types/analysis";
import type { ReleaseSummary } from "@/types/report";

export function buildActivityReport(input: {
  commits: CommitSummary[] | null;
  commitError: string | null;
  tags: string[] | null;
  tagError: string | null;
  branchCount: number | null;
  branchError: string | null;
  releases: ReleaseSummary[] | null;
}): { report: ActivityReport; notes: string[] } {
  const { commits, commitError, tags, tagError, branchCount, branchError, releases } = input;
  const notes: string[] = [];

  const windowStart = commits?.length
    ? new Date(commits[commits.length - 1].date)
    : null;
  const commitWindowDays = windowStart
    ? Math.max(1, Math.round((Date.now() - windowStart.getTime()) / 86_400_000))
    : 0;

  if (commitError) notes.push(`Recent commits unavailable: ${commitError}`);
  else if (commits) {
    notes.push(
      `Commit timeline shows the ${commits.length} most recent commits on the default branch (first page; older history not paginated).`,
    );
  }

  let releaseCadence: string | null = null;
  if (releases && releases.length >= 2) {
    const dated = releases.filter((r) => r.publishedAt).map((r) => new Date(r.publishedAt!).getTime());
    if (dated.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < dated.length; i++) gaps.push(dated[i] - dated[i - 1]);
      const avgDays = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length / 86_400_000);
      releaseCadence = `≈ every ${avgDays} days (mean gap across the ${dated.length} latest dated releases)`;
    }
  }

  if (tagError) notes.push(`Tags unavailable: ${tagError}`);
  if (branchError) notes.push(`Branch count unavailable: ${branchError}`);
  if (releases && !releases.some((r) => r.publishedAt)) notes.push("No dated releases were retrieved.");
  if (releaseCadence) notes.push(`Release cadence: ${releaseCadence}.`);
  notes.push(
    "Commit counts describe repository activity, not productivity or code quality.",
  );

  return {
    report: {
      recentCommits: commits ?? [],
      commitWindowDays,
      commitSampleLimited: true,
      tags: tags ?? [],
      branchCount,
      observationNote:
        "Observation window: the most recent commits (first API page), releases and tags as returned by GitHub. Pagination beyond the first page was not performed.",
    },
    notes,
  };
}
