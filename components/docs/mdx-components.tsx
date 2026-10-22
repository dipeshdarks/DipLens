import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { slugify, textOf } from "@/lib/docs/slug";
import CodeBlock from "./CodeBlock";
import Callout from "./Callout";
import Mermaid from "./Mermaid";

function languageOf(node: ReactNode): string {
  const child = Array.isArray(node) ? node[0] : node;
  if (child && typeof child === "object" && "props" in (child as object)) {
    const cls = (child as { props?: { className?: string } }).props?.className ?? "";
    const m = /language-([\w+-]+)/.exec(cls);
    if (m) return m[1]!;
  }
  return "";
}

function textOfNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOfNode).join("");
  if (typeof node === "object" && "props" in node) {
    const el = node as { props?: { children?: ReactNode } };
    return textOfNode(el.props?.children);
  }
  return "";
}

function MdxPre({ children, className, ...rest }: ComponentProps<"pre">) {
  if (languageOf(children) === "mermaid") {
    return <Mermaid chart={textOfNode(children)} />;
  }
  return (
    <CodeBlock className={className} {...rest}>
      {children}
    </CodeBlock>
  );
}

function MdxHeading({ level, children, ...rest }: { level: 2 | 3 | 4; children?: ReactNode } & ComponentProps<"h2">) {
  const title = textOf(children);
  const id = slugify(title);
  const Tag = (level === 2 ? "h2" : level === 3 ? "h3" : "h4") as "h2";
  return (
    <Tag id={id} {...rest}>
      {children}
    </Tag>
  );
}

function MdxLink({ href = "", children, ...rest }: ComponentProps<"a">) {
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  if (href.startsWith("#") || href.startsWith("/")) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

/** Component map applied to every MDX page via `<Content components={…} />`. */
export const mdxComponents = {
  pre: MdxPre,
  h2: (p: ComponentProps<"h2">) => <MdxHeading level={2} {...p} />,
  h3: (p: ComponentProps<"h3">) => <MdxHeading level={3} {...p} />,
  h4: (p: ComponentProps<"h4">) => <MdxHeading level={4} {...p} />,
  a: MdxLink,
  Callout,
  Mermaid,
};

export { textOf as mdxTextOf };
