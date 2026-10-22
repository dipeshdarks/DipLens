import Link from "next/link";
import { Github, Search } from "lucide-react";

/** Global 404. The repo route has its own not-found state; this covers unknown URLs. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-[640px] flex-col items-center justify-center px-4 py-16 text-center">
      <p className="font-mono text-sm text-mute">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="mt-3 max-w-md text-mute">
        The page you requested does not exist. If you were looking for a repository report, the
        path is{" "}
        <code className="rounded bg-elev px-1.5 py-0.5 font-mono text-[0.85em] text-ink">
          /repo/&#123;owner&#125;/&#123;repo&#125;
        </code>
        .
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md bg-info/15 px-4 py-2 text-sm font-medium text-info ring-1 ring-inset ring-info/30 hover:bg-info/25"
        >
          <Search className="h-4 w-4" aria-hidden />
          Analyze a repository
        </Link>
        <Link
          href="/docs"
          className="inline-flex items-center gap-2 rounded-md border border-line bg-elev px-4 py-2 text-sm text-ink hover:border-info/40"
        >
          Documentation
        </Link>
        <a
          href="https://github.com/dipeshdarks/DipAi"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm text-mute hover:text-ink"
        >
          <Github className="h-4 w-4" aria-hidden />
          GitHub <span aria-hidden>↗</span>
        </a>
      </div>
    </main>
  );
}
