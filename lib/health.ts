import type { Report, Signal, SignalLabel } from "@/types/report";

export function daysSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

function activityLabel(days: number | null): SignalLabel {
  if (days === null) return "Unknown";
  if (days <= 30) return "Active";
  if (days <= 180) return "Moderate";
  return "Needs attention";
}

export function healthSignals(r: Report, now: number = Date.now()): Signal[] {
  const pushed = daysSince(r.repo.pushedAt, now);
  const latest = r.releases?.find((x) => x.publishedAt)?.publishedAt ?? null;
  const releaseDays = daysSince(latest, now);

  const meta: SignalLabel = r.repo.archived
    ? "Needs attention"
    : r.repo.licenseSpdx && r.repo.description
      ? "Active"
      : "Moderate";

  const interest: SignalLabel =
    r.repo.stars + r.repo.forks >= 100 ? "Active" : "Moderate";

  const signals: Signal[] = [
    {
      title: "Recent activity",
      label: activityLabel(pushed),
      detail:
        pushed === null
          ? "No push timestamp available."
          : `Last push ${pushed} day${pushed === 1 ? "" : "s"} ago (active ≤30d, moderate ≤180d).`,
    },
    releaseDays === null
      ? {
          title: "Release recency",
          label: "Unknown",
          detail: r.releases
            ? "No published releases."
            : "Release data unavailable.",
        }
      : {
          title: "Release recency",
          label: activityLabel(releaseDays),
          detail: `Latest release ${releaseDays} day${releaseDays === 1 ? "" : "s"} ago.`,
        },
    {
      title: "Community interest",
      label: interest,
      detail: `${r.repo.stars.toLocaleString("en-US")} stars, ${r.repo.forks.toLocaleString("en-US")} forks. Popularity is not a quality measure.`,
    },
    {
      title: "Repository maintenance",
      label: meta,
      detail: r.repo.archived
        ? "Repository is archived."
        : `${r.repo.licenseSpdx ? `License: ${r.repo.licenseSpdx}` : "No license detected"}; ${r.repo.description ? "has" : "missing"} description.`,
    },
  ];

  return signals;
}

export type WeekSummary = {
  total: number;
  peak: { weekStart: string; commits: number } | null;
  quiet: { weekStart: string; commits: number } | null;
  weeks: number;
  activeWeeks: number;
};

export function summarizeWeeks(
  weeks: { weekStart: string; commits: number }[] | null,
): WeekSummary | null {
  if (!weeks || weeks.length === 0) return null;
  let total = 0;
  let peak = weeks[0]!;
  let quiet = weeks[0]!;
  let activeWeeks = 0;
  for (const w of weeks) {
    total += w.commits;
    if (w.commits > peak.commits) peak = w;
    if (w.commits < quiet.commits) quiet = w;
    if (w.commits > 0) activeWeeks += 1;
  }
  return { total, peak, quiet, weeks: weeks.length, activeWeeks };
}
