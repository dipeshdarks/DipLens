"use client";
import { useRef, type ReactNode } from "react";
import CopyButton from "./CopyButton";

function languageOf(node: ReactNode): string {
  const child = Array.isArray(node) ? node[0] : node;
  if (child && typeof child === "object" && "props" in (child as object)) {
    const cls = (child as { props?: { className?: string } }).props?.className ?? "";
    const m = /language-([\w+-]+)/.exec(cls);
    if (m) return m[1]!;
  }
  return "";
}

/** Wraps an MDX code fence (rehype-highlight output) with a language label
 * and a working copy button. Highlighting itself happens at build time. */
export default function CodeBlock({ children, className, ...rest }: { children?: ReactNode; className?: string }) {
  const preRef = useRef<HTMLPreElement>(null);
  const lang = languageOf(children);

  return (
    <div className="group relative">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
        {lang && (
          <span className="rounded-md border border-line bg-card px-2 py-1 font-mono text-[11px] text-mute">
            {lang}
          </span>
        )}
        <CopyButton getText={() => preRef.current?.innerText ?? ""} />
      </div>
      <pre ref={preRef} className={className} {...rest}>
        {children}
      </pre>
    </div>
  );
}
