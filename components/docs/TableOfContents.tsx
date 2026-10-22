"use client";
import { useEffect, useState } from "react";
import { List } from "lucide-react";

export type TocSection = { title: string; id: string };

/**
 * "On this page" table of contents.
 * - `variant="aside"`: sticky right column with active-section highlighting.
 * - `variant="details"`: collapsible block for small screens (no highlighting).
 */
export default function TableOfContents({
  sections,
  variant = "aside",
}: {
  sections: TocSection[];
  variant?: "aside" | "details";
}) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (variant !== "aside" || sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: [0, 1] },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections, variant]);

  if (sections.length === 0) return null;

  const list = (
    <ul className="space-y-1.5 border-l border-line pl-3">
      {sections.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            className={`block -ml-px border-l-2 py-0.5 pl-3 text-[13px] leading-5 transition-colors duration-150 ${
              active === s.id
                ? "border-info font-medium text-ink"
                : "border-transparent text-mute hover:text-ink"
            }`}
          >
            {s.title}
          </a>
        </li>
      ))}
    </ul>
  );

  if (variant === "details") {
    return (
      <details className="mb-8 rounded-lg border border-line bg-card p-4 xl:hidden">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
          <List className="h-4 w-4 text-mute" aria-hidden />
          On this page
        </summary>
        <div className="mt-3">{list}</div>
      </details>
    );
  }

  return (
    <nav aria-label="On this page" className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-mute">On this page</p>
      {list}
    </nav>
  );
}
