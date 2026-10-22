/* Server-side documentation loaders (fs access) plus re-exports of the pure
 * search helpers from search-core. The MDX sources live under content/docs. */

import fs from "node:fs";
import path from "node:path";
import { DOC_PAGES, type DocPage } from "./registry";
import { extractHeadings, searchIndex } from "./search-core";

export * from "./search-core";

const CONTENT_DIR = path.join(process.cwd(), "content", "docs");

/** Load every docs MDX file from disk (server-only). */
export function loadDocSources(): Array<{ page: DocPage; src: string }> {
  const out: Array<{ page: DocPage; src: string }> = [];
  for (const page of DOC_PAGES) {
    try {
      const src = fs.readFileSync(path.join(CONTENT_DIR, `${page.slug}.mdx`), "utf8");
      out.push({ page, src });
    } catch {
      /* page listed but file missing — skipped rather than fabricated */
    }
  }
  return out;
}

/** Build the full search index from disk (server-only; used by tests and scripts). */
export function buildSearchIndex() {
  return searchIndex(loadDocSources());
}

/** Section headings for one page, parsed from its MDX source (server-only). */
export function loadSections(slug: string): Array<{ title: string; id: string }> {
  try {
    const src = fs.readFileSync(path.join(CONTENT_DIR, `${slug}.mdx`), "utf8");
    return extractHeadings(src).filter((h) => h.title.length > 0);
  } catch {
    return [];
  }
}
