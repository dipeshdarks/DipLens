"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeepAnalysis } from "@/types/analysis";
import type { Report } from "@/types/report";
import { StatusChip } from "@/components/report/StatusBits";
import OverviewSection from "@/components/report/OverviewSection";
import ArchitectureSection from "@/components/report/ArchitectureSection";
import FileExplorerSection from "@/components/report/FileExplorerSection";
import DependenciesSection from "@/components/report/DependenciesSection";
import CodeQualitySection from "@/components/report/CodeQualitySection";
import SecuritySection from "@/components/report/SecuritySection";
import GitActivitySection from "@/components/report/GitActivitySection";
import ContributorsSection from "@/components/report/ContributorsSection";
import TestsCiSection from "@/components/report/TestsCiSection";
import FindingsSection from "@/components/report/FindingsSection";
import CoverageSection from "@/components/report/CoverageSection";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "files", label: "File explorer" },
  { id: "dependencies", label: "Dependencies" },
  { id: "quality", label: "Code quality" },
  { id: "security", label: "Security" },
  { id: "activity", label: "Git activity" },
  { id: "contributors", label: "Contributors" },
  { id: "testing", label: "Tests & CI/CD" },
  { id: "findings", label: "Findings" },
  { id: "coverage", label: "Evidence & coverage" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(v: string): v is TabId {
  return (TABS as ReadonlyArray<{ id: string }>).some((t) => t.id === v);
}

export default function ReportShell({
  report,
  analysis,
  analysisError,
}: {
  report: Report;
  analysis: DeepAnalysis | null;
  analysisError: string | null;
}) {
  const [active, setActive] = useState<TabId>("overview");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (isTabId(h)) setActive(h);
  }, []);

  const select = useCallback((id: TabId) => {
    setActive(id);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
    }
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = TABS.findIndex((t) => t.id === active);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const id = TABS[next].id;
    select(id);
    tabRefs.current[id]?.focus();
  };

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Report sections"
        onKeyDown={onKeyDown}
        className="sticky top-14 z-20 -mx-4 border-b border-line bg-base/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6"
      >
        <div className="flex gap-1 overflow-x-auto" data-testid="report-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={active === t.id ? 0 : -1}
              onClick={() => select(t.id)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition duration-150 ${
                active === t.id
                  ? "bg-elev font-medium text-ink"
                  : "text-mute hover:text-ink"
              }`}
              data-testid={`tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {!analysis && (
        <div className="rounded-md border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-warn" role="status">
          Deep analysis is unavailable: {analysisError ?? "unknown error"}. The basic report below still reflects live GitHub data.
        </div>
      )}

      {analysis && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-mute">
          <span>Deep analysis overall:</span>
          <StatusChip status={analysis.overall} />
          <span>· {analysis.coverage.disclosure}</span>
        </div>
      )}

      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        tabIndex={0}
        data-testid={`panel-${active}`}
        className="focus:outline-none"
      >
        {active === "overview" && <OverviewSection report={report} analysis={analysis} />}
        {active === "architecture" && analysis && <ArchitectureSection analysis={analysis} />}
        {active === "files" && analysis && (
          <FileExplorerSection
            owner={report.repo.owner}
            repo={report.repo.name}
            defaultBranch={analysis.discovery.defaultBranch}
            paths={analysis.browsePaths}
            inspected={analysis.coverage.filesInspected}
          />
        )}
        {active === "dependencies" && analysis && <DependenciesSection analysis={analysis} />}
        {active === "quality" && analysis && <CodeQualitySection analysis={analysis} />}
        {active === "security" && analysis && <SecuritySection analysis={analysis} />}
        {active === "activity" && <GitActivitySection report={report} analysis={analysis} />}
        {active === "contributors" && <ContributorsSection report={report} />}
        {active === "testing" && analysis && <TestsCiSection analysis={analysis} />}
        {active === "findings" && analysis && <FindingsSection analysis={analysis} />}
        {active === "coverage" && analysis && <CoverageSection analysis={analysis} />}
      </div>
    </div>
  );
}
