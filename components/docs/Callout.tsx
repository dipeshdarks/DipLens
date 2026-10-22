import type { ReactNode } from "react";
import { AlertTriangle, Info, Lightbulb } from "lucide-react";

const styles = {
  info: { border: "border-info/40", text: "text-info", Icon: Info, label: "Note" },
  tip: { border: "border-ok/40", text: "text-ok", Icon: Lightbulb, label: "Tip" },
  warning: { border: "border-warn/50", text: "text-warn", Icon: AlertTriangle, label: "Warning" },
} as const;

export type CalloutType = keyof typeof styles;

/** MDX callout: <Callout type="warning">…</Callout> (type defaults to "info"). */
export default function Callout({
  type = "info",
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
}) {
  const s = styles[type] ?? styles.info;
  const { Icon } = s;
  return (
    <div className={`my-5 rounded-lg border ${s.border} bg-card p-4 text-[15px] leading-7 text-mute`}>
      <p className={`mb-1 flex items-center gap-2 text-sm font-semibold ${s.text}`}>
        <Icon className="h-4 w-4" aria-hidden />
        {title ?? s.label}
      </p>
      <div className="[&_p]:my-2 [&_a]:text-info [&_strong]:text-ink">{children}</div>
    </div>
  );
}
