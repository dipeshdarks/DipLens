import type { Report } from "@/types/report";
import { Empty, Panel } from "@/components/ui";

export default function ContributorsSection({ report }: { report: Report }) {
  const contributors = report.contributors;
  const max = Math.max(1, ...(contributors ?? []).map((c) => c.contributions));

  return (
    <div className="space-y-4">
      <Panel
        title="Top contributors"
        subtitle="Counts are GitHub's reported commit totals and do not capture every kind of contribution (issues, reviews, docs). The list is the first API page only — not a complete roster."
      >
        {contributors?.length ? (
          <ol className="space-y-3">
            {contributors.map((c) => (
              <li key={c.login} className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.avatarUrl} alt="" width={28} height={28} className="rounded-full" />
                <a
                  href={c.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-24 shrink-0 truncate text-sm hover:text-info sm:w-32"
                >
                  {c.login}
                </a>
                <div className="h-1.5 flex-1 rounded bg-elev">
                  <div className="h-full rounded bg-ok" style={{ width: `${(c.contributions / max) * 100}%` }} />
                </div>
                <span className="w-14 shrink-0 text-right text-xs text-mute">
                  {c.contributions.toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>{report.sectionErrors.contributors ?? "Contributor data is unavailable."}</Empty>
        )}
      </Panel>

      {report.contributorCount !== null && (
        <p className="text-xs text-mute">
          GitHub reports {report.contributorCount.toLocaleString("en-US")} total contributor(s) (from pagination,
          including anonymous contributors where counted).
        </p>
      )}
    </div>
  );
}
