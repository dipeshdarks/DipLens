"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import SearchDialog from "./SearchDialog";

/** Header controls: documentation search (⌘K / Ctrl+K) and theme toggle. */
export default function HeaderActions() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search documentation"
        className="inline-flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-mute transition-colors duration-150 hover:border-info/40 hover:text-ink"
      >
        <Search className="h-4 w-4" aria-hidden />
        <span className="hidden text-sm sm:inline">Search</span>
        <kbd className="kbd hidden sm:inline-flex" aria-hidden>
          ⌘K
        </kbd>
      </button>
      <ThemeToggle />
      <SearchDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
