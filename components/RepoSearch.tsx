"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { parseRepo } from "@/lib/validation";

export default function RepoSearch() {
  const router = useRouter();
  const [v, setV] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function go(value: string) {
    const p = parseRepo(value);
    if (!p) {
      setErr("Enter owner/repo or a github.com URL.");
      return;
    }
    setErr("");
    router.push(`/repo/${p.owner}/${p.repo}`);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="w-full max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(v);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label className="relative flex-1">
          <span className="sr-only">Repository</span>
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute"
            aria-hidden
          />
          <input
            ref={inputRef}
            value={v}
            onChange={(e) => setV(e.target.value)}
            placeholder="owner/repo or GitHub URL"
            aria-invalid={!!err}
            aria-describedby={err ? "repo-search-error" : undefined}
            className="h-12 w-full rounded-md border border-line bg-card pl-10 pr-3 font-mono text-sm outline-none transition-colors duration-150 placeholder:text-mute focus:border-info"
          />
        </label>
        <button type="submit" className="btn h-12">
          Analyze repository
        </button>
      </form>
      {err && (
        <p id="repo-search-error" role="alert" className="mt-2 text-sm text-bad">
          {err}
        </p>
      )}
      <p className="mt-3 text-sm text-mute">
        Try{" "}
        <button
          type="button"
          onClick={() => go("vercel/next.js")}
          className="font-mono text-info hover:underline"
        >
          vercel/next.js
        </button>
        . Public repositories only. No sign-in required. Press{" "}
        <kbd className="rounded border border-line px-1 font-mono text-xs">/</kbd> to
        focus search.
      </p>
    </div>
  );
}
