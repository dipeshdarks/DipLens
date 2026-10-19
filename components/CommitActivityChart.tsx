"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WeeklyActivity } from "@/types/report";

export default function CommitActivityChart({ data }: { data: WeeklyActivity[] }) {
  if (data.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-mute">
        No weekly commit data for this period.
      </p>
    );
  }
  return (
    <div className="h-64 w-full" role="img" aria-label="Weekly commits over the last 52 weeks">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -16, right: 4, top: 4 }}>
          <CartesianGrid stroke="#29313B" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="weekStart"
            tick={{ fill: "#9AA6B2", fontSize: 11 }}
            tickFormatter={(d: string) => d.slice(5)}
            interval={7}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={{ fill: "#9AA6B2", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "#191F27" }}
            contentStyle={{ background: "#191F27", border: "1px solid #29313B", borderRadius: 8, color: "#F4F7FA" }}
            labelFormatter={(d) => `Week of ${d}`}
            formatter={(v) => [v, "Commits"]}
          />
          <Bar dataKey="commits" fill="#7CB7FF" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
