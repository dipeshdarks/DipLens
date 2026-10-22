/* Next.js App Router MDX convention file.
 * @next/mdx aliases `next-mdx-import-source-file` to this root module; without
 * it, compiled MDX falls back to @mdx-js/react, which calls React.createContext
 * at module scope and crashes under React Server Components. */
import type { MDXComponents } from "mdx/types";
import { mdxComponents } from "@/components/docs/mdx-components";

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...components, ...mdxComponents };
}
