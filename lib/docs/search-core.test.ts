import { describe, expect, it } from "vitest";
import {
  extractHeadings,
  runSearch,
  searchIndex,
  stripMarkdown,
  type SearchDoc,
} from "@/lib/docs/search-core";

const SRC = `# Title

## Install the app

Run \`npm install\`.

\`\`\`
## not-a-heading
\`\`\`

### Nested details

- item one
`;

describe("stripMarkdown", () => {
  it("keeps plain words and code identifiers", () => {
    const out = stripMarkdown("## Hello **world**\n\n- npm run build");
    expect(out).toContain("Hello world");
    expect(out).toContain("npm run build");
  });

  it("removes import/export lines and link targets", () => {
    const out = stripMarkdown('import x from "y";\n[Docs](https://example.com)');
    expect(out).not.toContain("import");
    expect(out).not.toContain("https://example.com");
    expect(out).toContain("Docs");
  });
});

describe("extractHeadings", () => {
  it("extracts h2/h3 headings outside code fences", () => {
    expect(extractHeadings(SRC)).toEqual([
      { title: "Install the app", id: "install-the-app" },
      { title: "Nested details", id: "nested-details" },
    ]);
  });

  it("ignores h1 and empty input", () => {
    expect(extractHeadings("# Only h1\n")).toEqual([]);
    expect(extractHeadings("")).toEqual([]);
  });
});

describe("searchIndex", () => {
  it("builds docs with headings and body text", () => {
    const [doc] = searchIndex([
      {
        page: { slug: "getting-started", title: "Getting Started", description: "Intro" },
        src: SRC,
      },
    ]);
    expect(doc!.slug).toBe("getting-started");
    expect(doc!.headings[0]!.id).toBe("install-the-app");
    expect(doc!.body).toContain("npm install");
  });
});

describe("runSearch", () => {
  const docs: SearchDoc[] = searchIndex([
    {
      page: {
        slug: "installation",
        title: "Installation",
        description: "Prerequisites, clone, install, environment setup, and first run.",
      },
      src: "## Environment variables\n\nGITHUB_TOKEN raises the rate limit.\n",
    },
    {
      page: {
        slug: "troubleshooting",
        title: "Troubleshooting",
        description: "Verified failure modes with causes and fixes.",
      },
      src: "## Rate limit reached\n\nAdd a GITHUB_TOKEN to .env.local.\n",
    },
  ]);

  it("returns nothing for short queries", () => {
    expect(runSearch(docs, "a")).toEqual([]);
    expect(runSearch(docs, "  ")).toEqual([]);
  });

  it("matches page titles", () => {
    const hits = runSearch(docs, "installation");
    expect(hits[0]!.href).toBe("/docs/installation");
    expect(hits[0]!.kind).toBe("page");
  });

  it("matches section headings with anchors", () => {
    const hits = runSearch(docs, "Rate limit");
    const section = hits.find((h) => h.kind === "section");
    expect(section?.href).toBe("/docs/troubleshooting#rate-limit-reached");
  });

  it("matches body text when title and headings do not", () => {
    const hits = runSearch(docs, "env.local");
    expect(hits.some((h) => h.href === "/docs/troubleshooting")).toBe(true);
  });

  it("returns [] for no matches and respects limit", () => {
    expect(runSearch(docs, "zzzznope")).toEqual([]);
    expect(runSearch(docs, "token", 1).length).toBeLessThanOrEqual(1);
  });
});
