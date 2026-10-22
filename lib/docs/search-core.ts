/* Pure documentation search logic — no fs, no server-only imports.
 * Safe to bundle into client components. The on-disk index is produced by
 * scripts/build-docs-index.mjs; the fs loaders live in lib/docs/search.ts. */

import type { DocPage } from "./registry";
import { slugify } from "./slug";

export type SearchDoc = {
  slug: string;
  title: string;
  description: string;
  headings: Array<{ title: string; id: string }>;
  body: string;
};

export type SearchHit = {
  href: string;
  title: string;
  context: string;
  kind: "page" | "section";
};

/** Shape of lib/docs/search-index.json (written at build time). */
export type SearchIndexFile = { version: 1; docs: SearchDoc[] };

/** Reduce raw MDX to searchable plain text (imports/exports/code kept, markup stripped). */
export function stripMarkdown(src: string): string {
  return src
    .replace(/^import\s.+$/gm, " ")
    .replace(/^export\s.+$/gm, " ")
    .replace(/```[a-z]*\n/gi, "\n")
    .replace(/```/g, "\n")
    .replace(/^\s*[-*+]\s+/gm, " ")
    .replace(/^\s*\d+\.\s+/gm, " ")
    .replace(/[#>`*_~]/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractHeadings(src: string): Array<{ title: string; id: string }> {
  const out: Array<{ title: string; id: string }> = [];
  let inFence = false;
  for (const line of src.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+)$/.exec(line);
    if (m) {
      const title = m[2].replace(/[`*]/g, "").trim();
      out.push({ title, id: slugify(title) });
    }
  }
  return out;
}

export function searchIndex(pages: Array<{ page: DocPage; src: string }>): SearchDoc[] {
  return pages.map(({ page, src }) => ({
    slug: page.slug,
    title: page.title,
    description: page.description,
    headings: extractHeadings(src),
    body: stripMarkdown(src),
  }));
}

function snippetAround(text: string, needle: string, radius = 90): string {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function runSearch(docs: SearchDoc[], query: string, limit = 10): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: Array<SearchHit & { score: number; pos: number }> = [];

  for (const d of docs) {
    const titleHit = d.title.toLowerCase().includes(q);
    const descHit = d.description.toLowerCase().includes(q);
    const sectionHit = d.headings.find((h) => h.title.toLowerCase().includes(q));

    if (titleHit || descHit) {
      hits.push({
        href: `/docs/${d.slug}`,
        title: d.title,
        context: snippetAround(d.description, q),
        kind: "page",
        score: titleHit ? 100 : 60,
        pos: d.slug.length,
      });
    }
    if (sectionHit) {
      hits.push({
        href: `/docs/${d.slug}#${sectionHit.id}`,
        title: `${sectionHit.title}`,
        context: `in ${d.title}`,
        kind: "section",
        score: 80,
        pos: d.slug.length,
      });
    }
    const i = d.body.toLowerCase().indexOf(q);
    if (i >= 0 && !titleHit && !sectionHit) {
      hits.push({
        href: `/docs/${d.slug}`,
        title: d.title,
        context: snippetAround(d.body, q),
        kind: "page",
        score: 40,
        pos: i,
      });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || a.pos - b.pos)
    .slice(0, limit)
    .map(({ score: _score, pos: _pos, ...h }) => h);
}
