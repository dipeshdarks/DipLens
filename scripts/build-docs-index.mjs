#!/usr/bin/env node
/* Builds lib/docs/search-index.json from pages.json + content/docs/*.mdx.
 * Runs via npm predev/prebuild. Mirrors the pure helpers in
 * lib/docs/search-core.ts / lib/docs/slug.ts (kept in sync by hand — the
 * script cannot import TypeScript). Writes { version: 1, docs: [...] }. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(root, "content", "docs");
const pagesPath = path.join(root, "lib", "docs", "pages.json");
const outPath = path.join(root, "lib", "docs", "search-index.json");

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripMarkdown(src) {
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

function extractHeadings(src) {
  const out = [];
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

const pages = JSON.parse(fs.readFileSync(pagesPath, "utf8"));
const docs = [];
let missing = 0;

for (const page of pages) {
  const file = path.join(contentDir, `${page.slug}.mdx`);
  let src;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch {
    missing += 1;
    continue;
  }
  docs.push({
    slug: page.slug,
    title: page.title,
    description: page.description,
    headings: extractHeadings(src),
    body: stripMarkdown(src),
  });
}

fs.writeFileSync(outPath, `${JSON.stringify({ version: 1, docs }, null, 2)}\n`, "utf8");
console.log(
  `[docs-index] wrote ${docs.length} page(s) to lib/docs/search-index.json` +
    (missing ? ` (${missing} page(s) missing from content/docs)` : ""),
);
