"use client";
import { useEffect, useId, useRef } from "react";

/** Renders a Mermaid diagram from the code-fence contents. The mermaid library
 * is dynamically imported so it only loads on pages that contain diagrams. */
export default function Mermaid({ chart, caption }: { chart: string; caption?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rawId = useId();
  const id = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const el = ref.current;
      if (!el) return;
      try {
        const mermaid = (await import("mermaid")).default;
        const light = document.documentElement.classList.contains("light");
        mermaid.initialize({ startOnLoad: false, theme: light ? "default" : "dark", securityLevel: "strict" });
        const { svg } = await mermaid.render(id, chart.trim());
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = "";
          const pre = document.createElement("pre");
          pre.className = "hljs";
          pre.textContent = chart.trim();
          ref.current.appendChild(pre);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  return (
    <figure className="my-6">
      <div ref={ref} className="overflow-x-auto rounded-lg border border-line bg-card p-4" />
      {caption && <figcaption className="mt-2 text-center text-xs text-mute">{caption}</figcaption>}
    </figure>
  );
}
