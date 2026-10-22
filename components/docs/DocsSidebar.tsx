"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { DOC_PAGES, NAV, docPage } from "@/lib/docs/registry";

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="space-y-6">
      {NAV.map((group) => (
        <div key={group.label}>
          <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-mute">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.slugs.map((slug) => {
              const page = docPage(slug);
              if (!page) return null;
              const href = `/docs/${page.slug}`;
              const active = pathname === href;
              return (
                <li key={slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-md px-2 py-1.5 text-sm transition-colors duration-150 ${
                      active ? "bg-elev font-medium text-ink" : "text-mute hover:bg-elev/60 hover:text-ink"
                    }`}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p className="border-t border-line px-2 pt-4 text-xs text-mute">
        {DOC_PAGES.length} pages ·{" "}
        <a
          href="https://github.com/dipeshdarks/DipAi"
          target="_blank"
          rel="noopener noreferrer"
          className="text-info hover:underline"
        >
          Source on GitHub
        </a>
      </p>
    </nav>
  );
}

/** Documentation sidebar. Sticky column on xl+; slide-over drawer on smaller
 * screens, opened by the menu button rendered in the docs layout. */
export default function DocsSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm text-mute hover:text-ink xl:hidden"
        aria-expanded={open}
        aria-controls="docs-sidebar"
      >
        <Menu className="h-4 w-4" aria-hidden />
        Menu
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 xl:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <aside
        id="docs-sidebar"
        className={
          open
            ? "fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r border-line bg-card p-4 xl:hidden"
            : "hidden w-60 shrink-0 xl:block"
        }
      >
        <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-1">
          {open && (
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">Documentation</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-md border border-line p-1.5 text-mute hover:text-ink"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
          <NavList onNavigate={() => setOpen(false)} />
        </div>
      </aside>
    </>
  );
}
