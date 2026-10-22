import type { ReactNode } from "react";
import type { Signal } from "@/types/report";

export const num = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US");

export const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Unpublished";

export function MetricCard({
  label,
  value,
  icon,
  hint,
  display,
}: {
  label: string;
  value: number | null;
  icon: ReactNode;
  hint?: string;
  display?: string;
}) {
  return (
    <div className="panel flex items-center gap-4">
      <div className="rounded-md bg-elev p-2.5 text-info">{icon}</div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm text-mute">
          {label}
          {hint && (
            <span title={hint} className="cursor-help text-xs" aria-label={hint}>
              ⓘ
            </span>
          )}
        </p>
        <p className="truncate text-2xl font-semibold">{display ?? num(value)}</p>
      </div>
    </div>
  );
}

export function Panel({
  title,
  children,
  className = "",
  subtitle,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  subtitle?: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="mb-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-mute">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-mute">
      {children}
    </p>
  );
}

export function Chip({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "info" | "warn";
}) {
  const tones = {
    default: "border-line text-mute",
    info: "border-info/40 text-info",
    warn: "border-warn/50 text-warn",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

const toneMap: Record<Signal["label"], string> = {
  Active: "text-ok",
  Moderate: "text-info",
  "Needs attention": "text-warn",
  Unknown: "text-mute",
};

export function HealthSignal({ s }: { s: Signal }) {
  return (
    <li className="flex items-start justify-between gap-4 border-t border-line py-3 first:border-0 first:pt-0">
      <div>
        <p className="text-sm">{s.title}</p>
        <p className="text-xs text-mute">{s.detail}</p>
      </div>
      <span className={`shrink-0 text-sm font-medium ${toneMap[s.label]}`}>
        {s.label}
      </span>
    </li>
  );
}
