import DocsSidebar from "@/components/docs/DocsSidebar";

/** Shared chrome for every /docs page: left navigation plus the content column.
 * The right-hand table of contents is rendered per page (it depends on the
 * page's own headings). */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-6">
      <div className="flex gap-10">
        <DocsSidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
