"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, ArrowDown, CornerDownLeft, FileText, Hash, Search, X } from "lucide-react";
import indexJson from "@/lib/docs/search-index.json";
import { runSearch, type SearchHit, type SearchIndexFile } from "@/lib/docs/search-core";

const index = indexJson as unknown as SearchIndexFile;

/** Full-screen search dialog with keyboard navigation. Opens from the header
 * button or ⌘K / Ctrl+K; Escape closes; arrows move; Enter navigates. */
export default function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const hits: SearchHit[] = useMemo(() => runSearch(index.docs, query, 12), [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const navigate = useCallback(
    (hit: SearchHit) => {
      onClose();
      router.push(hit.href);
    },
    [onClose, router],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && hits[cursor]) {
      e.preventDefault();
      navigate(hits[cursor]!);
    }
  }

  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search documentation"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-line bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="h-4 w-4 shrink-0 text-mute" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search documentation…"
            aria-label="Search documentation"
            className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-mute"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="rounded-md p-1.5 text-mute hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {query.trim().length < 2 ? (
          <div className="px-4 py-8 text-center text-sm text-mute">
            <p>Type at least 2 characters to search.</p>
            <p className="mt-3 flex items-center justify-center gap-2 text-xs">
              <kbd className="kbd">↑</kbd>
              <kbd className="kbd">↓</kbd> to navigate ·
              <kbd className="kbd">Enter</kbd> to open ·
              <kbd className="kbd">Esc</kbd> to close
            </p>
          </div>
        ) : hits.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-mute">
            <p>
              No results for <span className="font-medium text-ink">“{query.trim()}”</span>.
            </p>
            <p className="mt-2 text-xs">Try a feature name, command, or error message.</p>
          </div>
        ) : (
          <ul ref={listRef} className="max-h-[50vh] overflow-y-auto p-2" role="listbox" aria-label="Search results">
            {hits.map((hit, i) => (
              <li key={`${hit.href}-${i}`} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  onClick={() => navigate(hit)}
                  onMouseEnter={() => setCursor(i)}
                  className={`flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-100 ${
                    i === cursor ? "bg-elev" : ""
                  }`}
                >
                  {hit.kind === "section" ? (
                    <Hash className="mt-0.5 h-4 w-4 shrink-0 text-mute" aria-hidden />
                  ) : (
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-mute" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{hit.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-mute">{hit.context}</span>
                  </span>
                  {i === cursor && (
                    <CornerDownLeft className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-mute" aria-hidden />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-mute">
          <span className="flex items-center gap-1">
            <ArrowUp className="h-3 w-3" aria-hidden />
            <ArrowDown className="h-3 w-3" aria-hidden /> navigate
          </span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" aria-hidden /> open
          </span>
          <span className="ml-auto">{hits.length > 0 ? `${hits.length} result${hits.length === 1 ? "" : "s"}` : ""}</span>
        </div>
      </div>
    </div>
  );
}
