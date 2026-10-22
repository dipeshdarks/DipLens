import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Github, Pencil } from "lucide-react";
import { DOC_PAGES, GITHUB, docPage, prevNext } from "@/lib/docs/registry";
import { loadSections } from "@/lib/docs/search";
import { MDX_PAGES } from "@/lib/docs/mdx";
import { mdxComponents } from "@/components/docs/mdx-components";
import TableOfContents from "@/components/docs/TableOfContents";
import PrevNextNavigation from "@/components/docs/PrevNextNavigation";

export function generateStaticParams() {
  return DOC_PAGES.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const page = docPage(params.slug);
  if (!page) return {};
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `https://diplensrepo.vercel.app/docs/${page.slug}` },
    openGraph: {
      title: `${page.title} — Diplens Docs`,
      description: page.description,
      url: `https://diplensrepo.vercel.app/docs/${page.slug}`,
      siteName: "Diplens Documentation",
      type: "article",
    },
  };
}

export default function DocPage({ params }: { params: { slug: string } }) {
  const page = docPage(params.slug);
  if (!page) notFound();
  const Content = MDX_PAGES[page.slug];
  if (!Content) notFound();

  const sections = loadSections(page.slug);
  const { prev, next } = prevNext(page.slug);

  return (
    <>
      <TableOfContents sections={sections} variant="details" />
      <div className="flex gap-12">
        <article className="docs-prose min-w-0 flex-1">
          <header className="mb-8">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Documentation</p>
            <h1 className="text-3xl font-semibold tracking-tight text-ink">{page.title}</h1>
            <p className="mt-2 text-mute">{page.description}</p>
          </header>

          <Content components={mdxComponents} />

          <div className="mt-10 flex flex-wrap gap-3 border-t border-line pt-6 text-sm">
            {page.source && (
              <a
                href={GITHUB.blob(page.source)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-mute transition-colors duration-150 hover:border-info/40 hover:text-ink"
              >
                <Github className="h-4 w-4" aria-hidden />
                View source
              </a>
            )}
            <a
              href={GITHUB.blob(`content/docs/${page.slug}.mdx`)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-mute transition-colors duration-150 hover:border-info/40 hover:text-ink"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              Edit this page
            </a>
            <Link
              href="/docs"
              className="inline-flex items-center rounded-md border border-line px-3 py-1.5 text-mute transition-colors duration-150 hover:border-info/40 hover:text-ink"
            >
              All documentation
            </Link>
          </div>

          <PrevNextNavigation prev={prev} next={next} />
        </article>

        <aside className="hidden w-52 shrink-0 xl:block">
          <TableOfContents sections={sections} variant="aside" />
        </aside>
      </div>
    </>
  );
}
