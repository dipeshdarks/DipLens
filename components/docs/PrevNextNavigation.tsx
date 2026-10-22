import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { DocPage } from "@/lib/docs/registry";

/** Previous/next page navigation, driven by the flat DOC_PAGES order. */
export default function PrevNextNavigation({ prev, next }: { prev: DocPage | null; next: DocPage | null }) {
  if (!prev && !next) return null;
  return (
    <nav aria-label="Documentation pages" className="mt-12 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
      {prev ? (
        <Link
          href={`/docs/${prev.slug}`}
          className="group rounded-lg border border-line p-4 transition-colors duration-150 hover:border-info/40"
        >
          <span className="flex items-center gap-1.5 text-xs text-mute">
            <ArrowLeft className="h-3 w-3" aria-hidden /> Previous
          </span>
          <span className="mt-1 block text-sm font-medium text-ink group-hover:text-info">{prev.title}</span>
        </Link>
      ) : (
        <span aria-hidden />
      )}
      {next && (
        <Link
          href={`/docs/${next.slug}`}
          className="group rounded-lg border border-line p-4 text-right transition-colors duration-150 hover:border-info/40 sm:col-start-2"
        >
          <span className="flex items-center justify-end gap-1.5 text-xs text-mute">
            Next <ArrowRight className="h-3 w-3" aria-hidden />
          </span>
          <span className="mt-1 block text-sm font-medium text-ink group-hover:text-info">{next.title}</span>
        </Link>
      )}
    </nav>
  );
}
