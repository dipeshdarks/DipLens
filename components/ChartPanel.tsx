"use client";
import type { WeekSummary } from "@/lib/health";
import type { WeeklyActivity } from "@/types/report";
import CommitActivityChart from "./CommitActivityChart";

export default function ChartPanel({
  weeks,
  summary,
}: {
  weeks: WeeklyActivity[] | null;
  summary: WeekSummary | null;
}) {
  if (!weeks || weeks.length === 0 || !summary) {
    return (
      <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-mute">
        Weekly activity is not available yet.
      </p>
    );
  }
  const range = `${weeks[0]!.weekStart} → ${weeks[weeks.length - 1]!.weekStart}`;
  return (
    <div>
      <CommitActivityChart data={weeks} />
      <p className="mt-3 text-xs text-mute" data-testid="chart-summary">
        {summary.total.toLocaleString("en-US")} commits across {summary.weeks} weeks (
        {summary.activeWeeks} active). Peak: {summary.peak?.commits.toLocaleString("en-US")}{" "}
        commits the week of {summary.peak?.weekStart}. Quietest:{" "}
        {summary.quiet?.commits.toLocaleString("en-US")} commits the week of{" "}
        {summary.quiet?.weekStart}. Coverage: {range}.
      </p>
    </div>
  );
}
