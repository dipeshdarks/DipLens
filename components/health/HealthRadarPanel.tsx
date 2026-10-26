"use client";

import { useMemo, useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Activity, ChevronDown, Info } from "lucide-react";
import type { DimensionId, DimensionScore, HealthRadar } from "@/types/health";
import { HEALTH_DIMENSIONS } from "@/lib/health-radar/scoring";
import { Empty } from "@/components/ui";

const LABEL_TONE: Record<HealthRadar["label"], string> = {
  Healthy: "border-ok/40 text-ok",
  Watch: "border-warn/50 text-warn",
  "Needs Attention": "border-bad/50 text-bad",
  "Insufficient data": "border-line text-mute",
};

const SCORE_TONE = (score: number | null): string => {
  if (score === null) return "text-mute";
  if (score >= 70) return "text-ok";
  if (score >= 40) return "text-warn";
  return "text-bad";
};

const STATUS_LABEL: Record<DimensionScore["status"], string> = {
  scored: "scored",
  neutral: "neutral",
  unavailable: "unavailable",
};

function ConfidenceHint({ radar }: { radar: HealthRadar }) {
  const detail =
    radar.confidence === "high"
      ? "Most scoring weight was backed by retrieved data."
      : radar.confidence === "medium"
        ? "Some dimensions were excluded and their weights renormalized."
        : "Significant data was missing — treat the score as provisional.";
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-mute"
      title={`${radar.confidencePercent}% of scoring weight had data. ${detail}`}
    >
      <Info className="h-3.5 w-3.5" aria-hidden />
      {radar.confidence} confidence · {radar.confidencePercent}% of weight covered
    </span>
  );
}

type ChartPoint = { id: DimensionId; title: string; short: string; score: number };

const SHORT: Record<DimensionId, string> = {
  maintenance: "Maint.",
  releases: "Releases",
  issues: "Issues",
  community: "Community",
  documentation: "Docs",
  transparency: "Transparency",
};

function RadarGraph({
  radar,
  onSelect,
}: {
  radar: HealthRadar;
  onSelect: (id: DimensionId) => void;
}) {
  const points = useMemo<ChartPoint[]>(
    () =>
      radar.dimensions
        .filter((d) => d.score !== null)
        .map((d) => ({
          id: d.id,
          title: d.title,
          short: SHORT[d.id],
          score: d.score as number,
        })),
    [radar.dimensions],
  );

  if (points.length < 2) {
    return (
      <Empty>
        At least two scored dimensions are needed to draw the radar. See the breakdown below for
        what was available.
      </Empty>
    );
  }

  return (
    <div className="h-72 w-full" role="img" aria-label={radarAriaLabel(radar)}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={points} outerRadius="72%">
          <PolarGrid stroke="#29313B" />
          <PolarAngleAxis
            dataKey="short"
            tick={({ x, y, textAnchor, payload }: {
              x?: number;
              y?: number;
              textAnchor?: "start" | "middle" | "end";
              payload?: { value?: string };
            }) => {
              const point = points.find((p) => p.short === payload?.value);
              return (
                <text
                  x={x}
                  y={y}
                  textAnchor={textAnchor}
                  fill="#9AA6B2"
                  fontSize={11}
                  style={{ cursor: "pointer" }}
                  onClick={() => point && onSelect(point.id)}
                >
                  {payload?.value}
                </text>
              );
            }}
          />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "#191F27", fillOpacity: 0.5 }}
            contentStyle={{
              background: "#191F27",
              border: "1px solid #29313B",
              borderRadius: 8,
              color: "#F4F7FA",
              fontSize: 12,
            }}
            formatter={(value: number | string, _name: string, item: { payload?: ChartPoint }) => [
              `${value}/100`,
              item?.payload?.title ?? "Score",
            ]}
            labelFormatter={() => "Dimension score"}
          />
          <Radar
            dataKey="score"
            stroke="#7CB7FF"
            fill="#7CB7FF"
            fillOpacity={0.25}
            isAnimationActive={false}
            dot={{ r: 3, fill: "#7CB7FF", strokeWidth: 0 }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function radarAriaLabel(radar: HealthRadar): string {
  const parts = radar.dimensions
    .filter((d) => d.score !== null)
    .map((d) => `${d.title} ${d.score} of 100`);
  return `Radar chart of health dimensions: ${parts.join(", ")}.`;
}

function DimensionDetail({ d }: { d: DimensionScore }) {
  return (
    <div className="rounded-md border border-line bg-elev/50 p-4" data-testid="dimension-detail">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{d.title}</h4>
        <span className={`font-mono text-sm ${SCORE_TONE(d.score)}`}>
          {d.score === null ? "excluded" : `${d.score}/100`}
          <span className="ml-2 text-xs font-normal text-mute">
            weight {d.weight} · {STATUS_LABEL[d.status]}
          </span>
        </span>
      </div>
      <p className="mt-1.5 text-sm text-mute">{d.summary}</p>
      {d.excludedReason && (
        <p className="mt-2 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
          Excluded from the weighted total: {d.excludedReason}
        </p>
      )}
      <p className="mt-3 text-xs font-medium text-ink">Evidence</p>
      <dl className="mt-1.5 space-y-1.5">
        {d.evidence.map((e, i) => (
          <div key={i} className="text-xs">
            <dt className="inline font-medium text-ink">{e.label}: </dt>
            <dd className="inline text-mute">
              {e.value}
              {e.note && <span className="block text-mute/80">{e.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-mute">
        <span className="font-medium text-ink">How it is scored: </span>
        {d.explanation}
      </p>
    </div>
  );
}

export default function HealthRadarPanel({ radar }: { radar: HealthRadar | null }) {
  const [selected, setSelected] = useState<DimensionId | null>(null);

  if (!radar) {
    return (
      <Empty>
        Health scoring is unavailable for this repository right now. The rest of the report still
        reflects live GitHub data — try again in a few minutes.
      </Empty>
    );
  }

  const toggle = (id: DimensionId) => setSelected((cur) => (cur === id ? null : id));
  const selectedDim = radar.dimensions.find((d) => d.id === selected) ?? null;
  const computed = new Date(radar.computedAt);

  return (
    <div className="space-y-4" data-testid="health-radar-panel">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <section className="panel flex flex-col items-center justify-center py-6 text-center">
          <p className="text-xs uppercase tracking-wide text-mute">Overall health</p>
          <p className={`mt-1 font-mono text-5xl font-semibold ${SCORE_TONE(radar.overall)}`}>
            {radar.overall === null ? "—" : radar.overall}
          </p>
          <p className="mt-1 font-mono text-sm text-mute">out of 100</p>
          <span
            className={`mt-3 inline-flex rounded-full border px-3 py-1 text-sm font-medium ${LABEL_TONE[radar.label]}`}
            data-testid="health-label"
          >
            {radar.label}
          </span>
          <div className="mt-3">
            <ConfidenceHint radar={radar} />
          </div>
          <p className="mt-2 text-[11px] text-mute">
            Scored at{" "}
            {computed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{" "}
            {computed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} ·
            methodology v{radar.methodologyVersion}
          </p>
        </section>

        <section className="panel">
          <div className="mb-2">
            <h3 className="text-sm font-medium">Health dimensions</h3>
            <p className="text-xs text-mute">
              Hover a point for its score; select a label or a row below for evidence.
            </p>
          </div>
          <RadarGraph radar={radar} onSelect={toggle} />
        </section>
      </div>

      <section className="panel" aria-label="Health dimension breakdown">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium">Dimension breakdown</h3>
          <p className="text-xs text-mute">Excluded dimensions do not affect the total.</p>
        </div>
        <ul className="space-y-2">
          {radar.dimensions.map((d) => {
            const open = selected === d.id;
            return (
              <li key={d.id} className="rounded-md border border-line">
                <button
                  type="button"
                  onClick={() => toggle(d.id)}
                  aria-expanded={open}
                  aria-controls={`dim-detail-${d.id}`}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-elev/60 focus-visible:outline-offset-[-2px] ${
                    open ? "bg-elev/60" : ""
                  }`}
                  data-testid={`dimension-toggle-${d.id}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{d.title}</span>
                    <span className="block truncate text-xs text-mute">{d.summary}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className={`font-mono text-sm font-semibold ${SCORE_TONE(d.score)}`}>
                      {d.score === null ? "—" : d.score}
                    </span>
                    <span className="hidden rounded-full border border-line px-2 py-0.5 text-[11px] text-mute sm:inline">
                      {d.weight}%
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-mute transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </span>
                </button>
                {open && (
                  <div id={`dim-detail-${d.id}`} className="border-t border-line p-4">
                    <DimensionDetail d={d} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel">
        <details>
          <summary className="cursor-pointer text-sm font-medium select-none">
            How is this calculated?
          </summary>
          <div className="mt-3 space-y-3 text-sm text-mute">
            <p>
              Each dimension is scored 0–100 from specific GitHub data, then combined as a
              weighted average. Dimensions whose data could not be retrieved are excluded and
              the remaining weights are renormalized — a failed endpoint never counts as a zero.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-ink">
                    <th className="border-b border-line py-2 pr-4 font-medium">Dimension</th>
                    <th className="border-b border-line py-2 pr-4 font-medium">Weight</th>
                    <th className="border-b border-line py-2 font-medium">Based on</th>
                  </tr>
                </thead>
                <tbody>
                  {radar.dimensions.map((d) => (
                    <tr key={d.id}>
                      <td className="border-b border-line py-2 pr-4 text-ink">{d.title}</td>
                      <td className="border-b border-line py-2 pr-4 font-mono">
                        {HEALTH_DIMENSIONS[d.id].weight}
                        {d.score === null && (
                          <span className="ml-1 text-mute">(excluded)</span>
                        )}
                      </td>
                      <td className="border-b border-line py-2">{d.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs">
              Labels: <span className="text-ok">Healthy</span> ≥ 70,{" "}
              <span className="text-warn">Watch</span> 40–69,{" "}
              <span className="text-bad">Needs Attention</span> &lt; 40. Below 50% weight
              coverage the result is{" "}
              <span className="text-ink">Insufficient data</span>. This score reflects public
              repository signals only — it does not predict security, code quality, or the
              future success of the project.
            </p>
          </div>
        </details>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="panel">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-ok">
            <Activity className="h-4 w-4" aria-hidden /> Positive signals
          </h3>
          {radar.positiveSignals.length ? (
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-mute">
              {radar.positiveSignals.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mute">No strong positive signals in the retrieved data.</p>
          )}
        </section>

        <section className="panel">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-warn">
            <Activity className="h-4 w-4" aria-hidden /> Risks
          </h3>
          {radar.risks.length ? (
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-mute">
              {radar.risks.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mute">No risks surfaced from the retrieved data.</p>
          )}
        </section>

        <section className="panel">
          <h3 className="mb-2 text-sm font-medium">Missing information</h3>
          {radar.missingInformation.length ? (
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-mute">
              {radar.missingInformation.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mute">All scoring inputs were retrieved.</p>
          )}
        </section>
      </div>

      {radar.recommendations.length > 0 && (
        <section className="panel">
          <h3 className="mb-3 text-sm font-medium">Recommended next steps</h3>
          <ul className="grid gap-3 md:grid-cols-2">
            {radar.recommendations.map((r, i) => (
              <li key={i} className="rounded-md border border-line bg-elev/40 px-4 py-3">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="mt-1 text-xs text-mute">{r.detail}</p>
                <p className="mt-1.5 text-[11px] text-mute/80">
                  ties to {HEALTH_DIMENSIONS[r.dimensionId].title.toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selectedDim && (
        <p className="text-xs text-mute" aria-live="polite">
          Showing details for {selectedDim.title}. Press its row again to collapse.
        </p>
      )}
    </div>
  );
}
