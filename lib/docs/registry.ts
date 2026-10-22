/* Canonical documentation registry: navigation, page metadata, and GitHub links.
 * Titles/descriptions come from lib/docs/pages.json (shared with the search-index
 * build script). Section lists are parsed from the MDX source at build time
 * (lib/docs/search.ts), so headings never drift from the table of contents. */

import pkg from "../../package.json";
import pagesJson from "./pages.json";

export const GITHUB = {
  repo: "https://github.com/dipeshdarks/DipAi",
  issues: "https://github.com/dipeshdarks/DipAi/issues",
  pulls: "https://github.com/dipeshdarks/DipAi/pulls",
  source: "https://github.com/dipeshdarks/DipAi/tree/main",
  readme: "https://github.com/dipeshdarks/DipAi/blob/main/README.md",
  author: "https://github.com/dipeshdarks",
  /** Verified default branch of dipeshdarks/DipAi. */
  branch: "main",
  blob(path: string): string {
    return `https://github.com/dipeshdarks/DipAi/blob/main/${path.split("/").map(encodeURIComponent).join("/")}`;
  },
} as const;

export type DocPage = {
  slug: string;
  title: string;
  description: string;
  /** Primary source file for the "View source" link, when one applies. */
  source?: string;
};

/** Flat order used by previous/next navigation and the sitemap. */
export const DOC_PAGES: DocPage[] = pagesJson;

export type NavGroup = { label: string; slugs: string[] };

/** Sidebar structure. Every entry resolves to a real page above. */
export const NAV: NavGroup[] = [
  { label: "Getting Started", slugs: ["getting-started", "installation", "quick-start"] },
  { label: "Build With It", slugs: ["core-concepts", "features", "architecture"] },
  { label: "Reference", slugs: ["api-reference", "configuration", "examples"] },
  { label: "Project", slugs: ["troubleshooting", "contributing"] },
];

export function docPage(slug: string): DocPage | null {
  return DOC_PAGES.find((p) => p.slug === slug) ?? null;
}

export function prevNext(slug: string): { prev: DocPage | null; next: DocPage | null } {
  const i = DOC_PAGES.findIndex((p) => p.slug === slug);
  if (i < 0) return { prev: null, next: null };
  return { prev: DOC_PAGES[i - 1] ?? null, next: DOC_PAGES[i + 1] ?? null };
}

/** Real version from package.json (single source of truth). */
export const APP_VERSION = pkg.version;
