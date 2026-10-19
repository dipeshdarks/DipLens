"use client";
import Link from "next/link";

export default function ErrorPanel({ error, reset }: { error: Error; reset: () => void }) {
  const msg = error?.message ?? "";
  const isRate = /rate limit/i.test(msg);
  const isTimeout = /timed out/i.test(msg);
  const isNetwork = /reach GitHub|unavailable/i.test(msg);

  const title = isRate
    ? "GitHub rate limit reached"
    : isTimeout
      ? "Request timed out"
      : isNetwork
        ? "GitHub is unavailable"
        : "Couldn’t load this report";

  const detail = msg || "GitHub didn’t return data. This is usually temporary.";

  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-xl font-semibold text-bad">{title}</h1>
      <p className="mt-2 text-sm text-mute">{detail}</p>
      {isRate && (
        <p className="mt-2 text-xs text-mute">
          Unauthenticated requests are limited to 60/hour. Set a free{" "}
          <code className="font-mono">GITHUB_TOKEN</code> on the server to raise the limit to
          5,000/hour.
        </p>
      )}
      <div className="mt-6 flex justify-center gap-3">
        <button onClick={reset} className="btn">
          Retry
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md border border-line bg-elev px-4 py-2.5 text-sm transition duration-150 hover:border-info"
        >
          Search another repository
        </Link>
      </div>
    </main>
  );
}
