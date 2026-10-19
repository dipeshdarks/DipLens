import type {
  AnalysisCategory,
  Coverage,
  CoverageStatus,
  DeepAnalysis,
  DeepIndicator,
  FileSnapshot,
  Finding,
  IndicatorStatus,
  SkippedFile,
  TreeEntry,
} from "@/types/analysis";
import { DEFAULT_BUDGET, budgetView, type AnalysisBudget } from "@/lib/analysis/budgets";
import {
  detectDirectories,
  detectEcosystems,
  classifyPath,
  prioritizeFiles,
} from "@/lib/analysis/discovery";
import { buildDependencyReport } from "@/lib/analysis/dependencies";
import { buildArchitectureReport } from "@/lib/analysis/architecture";
import { buildSecurityReport } from "@/lib/analysis/security";
import { buildQualityReport } from "@/lib/analysis/quality";
import { buildActivityReport } from "@/lib/analysis/activity";
import { buildTestsCiReport } from "@/lib/analysis/tests-ci";
import { makeFinding, sortFindings } from "@/lib/analysis/evidence";
import {
  getHeadSha,
  getTree,
  listDirectory,
  listBranches,
  listTags,
  listWorkflows,
  getFileContent,
  getRecentCommits,
  probeCodeScanning,
  type CodeScanningStatus,
} from "@/lib/github/endpoints";
import type { Report } from "@/types/report";
import type { GhResult, GitHubError } from "@/lib/github";

const WORKFLOW_PATH_RE = /^\.github\/workflows\/[^/]+\.ya?ml$/i;

export type AnalysisOptions = { budget?: AnalysisBudget };

/** Bounded-concurrency map preserving input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function worst(a: CoverageStatus, b: CoverageStatus): CoverageStatus {
  const rank: Record<CoverageStatus, number> = { complete: 0, partial: 1, unavailable: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export async function runDeepAnalysis(
  report: Report,
  options: AnalysisOptions = {},
): Promise<DeepAnalysis> {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const owner = report.repo.owner;
  const repo = report.repo.name;
  const branch = report.repo.defaultBranch;

  let requestsUsed = 0;
  const skipped: SkippedFile[] = [];
  let rateLimitNote: string | null = null;

  const withinBudget = (): boolean => requestsUsed < budget.maxApiRequests && !rateLimitNote;

  /** Budget-gated API call. Returns null when the request budget is exhausted. */
  async function call<T>(fn: () => Promise<GhResult<T>>): Promise<GhResult<T> | null> {
    if (!withinBudget()) return null;
    requestsUsed += 1;
    const r = await fn();
    if (!r.ok && r.error.kind === "rate_limited") {
      rateLimitNote = "GitHub rate limit reached mid-analysis; remaining sections are incomplete.";
    }
    return r;
  }

  /* ---------- discovery ---------- */

  let headSha: string | null = null;
  let treeEntries: TreeEntry[] = [];
  let treeTruncated = false;
  let treeStatus: CoverageStatus = "complete";
  let treeError: GitHubError | null = null;

  const shaRes = await call(() => getHeadSha(owner, repo, branch));
  if (shaRes?.ok) headSha = shaRes.data;

  const treeRes = await call(() => getTree(owner, repo, branch));
  if (treeRes?.ok) {
    treeEntries = treeRes.data.entries;
    treeTruncated = treeRes.data.truncated;
    if (treeTruncated) treeStatus = "partial";
  } else {
    treeStatus = "unavailable";
    treeError = treeRes && !treeRes.ok ? treeRes.error : null;
    skipped.push({ path: "(repository tree)", reason: "fetch-failed" });
  }

  /* Bounded traversal when GitHub truncated the recursive tree. */
  if (treeTruncated) {
    const dirCandidates = detectDirectories(treeEntries, 8).filter((d) =>
      ["src", "app", "lib", "packages", "pages", "api", "cmd", "tests", "test", ".github"].some(
        (k) => d === k || d.startsWith(`${k}/`),
      ),
    );
    const wantedDirs = [".github/workflows", ...dirCandidates].slice(0, budget.maxDirTraversals);
    const knownDirs = new Set(treeEntries.filter((e) => e.type === "tree").map((e) => e.path));
    for (const dir of wantedDirs) {
      if (!withinBudget()) break;
      if (knownDirs.has(dir)) continue;
      const res = await call(() => listDirectory(owner, repo, dir, branch));
      if (res?.ok) {
        for (const e of res.data) {
          if (!treeEntries.some((t) => t.path === e.path)) treeEntries.push(e);
        }
      }
    }
  }

  const allPaths = treeEntries.filter((e) => e.type === "blob").map((e) => e.path);
  const ecosystems = detectEcosystems(treeEntries);
  const directories = detectDirectories(treeEntries, 30);
  const importantFiles = allPaths
    .filter((p) => classifyPath(p).length > 0)
    .filter((p) => !p.includes("node_modules"))
    .slice(0, 60);

  /* ---------- file retrieval (budgeted) ---------- */

  const { selected, skipped: budgetSkipped } = prioritizeFiles(treeEntries, budget);
  skipped.push(...budgetSkipped.filter((s) => s.reason === "too-large"));

  // Force workflow files into the selection (security + CI analysis need them), within capacity.
  const workflowPaths = allPaths.filter((p) => WORKFLOW_PATH_RE.test(p)).slice(0, 3);
  const selection = selected.map((s) => s.path);
  for (const wf of workflowPaths) {
    if (selection.length >= budget.maxFiles) break;
    if (!selection.includes(wf)) selection.push(wf);
  }

  const snapshots: FileSnapshot[] = [];
  await mapLimit(selection, 4, async (path) => {
    if (!withinBudget()) {
      skipped.push({ path, reason: "budget-exhausted" });
      return;
    }
    requestsUsed += 1;
    const res = await getFileContent(owner, repo, path, branch, budget.maxFileBytes);
    if (res.ok) {
      snapshots.push({ path, content: res.content, size: res.size, truncated: res.truncated });
      if (res.truncated) skipped.push({ path, reason: "too-large" });
    } else {
      const reason =
        res.reason === "too-large" ? "too-large" : res.reason === "binary" ? "binary" : "fetch-failed";
      skipped.push({ path, reason });
      if (res.error?.kind === "rate_limited") {
        rateLimitNote = "GitHub rate limit reached mid-analysis; remaining sections are incomplete.";
      }
    }
  });

  const workflowSnapshots = snapshots.filter((s) => WORKFLOW_PATH_RE.test(s.path));
  const pkgSnap = snapshots.find((s) => s.path.endsWith("package.json"));
  let pkgScripts: Record<string, string> = {};
  if (pkgSnap) {
    try {
      pkgScripts = (JSON.parse(pkgSnap.content) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {
      /* malformed package.json — dependencies analyzer reports it */
    }
  }

  /* ---------- analyzers ---------- */

  const depOut = buildDependencyReport(snapshots, allPaths);
  const archOut = buildArchitectureReport({
    entries: treeEntries,
    snapshots,
    sets: depOut.report.sets,
    languages: (report.languages ?? []).map((l) => l.name),
  });

  let csStatus: { status: CodeScanningStatus; note: string };
  if (withinBudget()) {
    requestsUsed += 1;
    csStatus = await probeCodeScanning(owner, repo);
    if (rateLimitNote) csStatus = { status: "unknown", note: rateLimitNote };
  } else {
    csStatus = { status: "unknown", note: "Request budget exhausted before code-scanning status could be probed." };
  }

  const secOut = buildSecurityReport({
    snapshots,
    workflowSnapshots,
    owner,
    repo,
    ref: branch,
    treePaths: allPaths,
    codeScanning: csStatus,
  });

  const qualOut = buildQualityReport({ snapshots, treePaths: allPaths, owner, repo, ref: branch });

  /* ---------- activity ---------- */

  const commitsRes = await call(() => getRecentCommits(owner, repo, branch));
  const tagsRes = await call(() => listTags(owner, repo));
  const branchRes = await call(() => listBranches(owner, repo));

  const actOut = buildActivityReport({
    commits: commitsRes?.ok ? commitsRes.data : null,
    commitError: !commitsRes
      ? "budget exhausted"
      : commitsRes.ok
        ? null
        : commitsRes.error.message,
    tags: tagsRes?.ok ? tagsRes.data : null,
    tagError: !tagsRes ? "budget exhausted" : tagsRes.ok ? null : tagsRes.error.message,
    branchCount: branchRes?.ok ? branchRes.data : null,
    branchError: !branchRes ? "budget exhausted" : branchRes.ok ? null : branchRes.error.message,
    releases: report.releases,
  });

  const workflowsApi = await call(() => listWorkflows(owner, repo));

  const testsOut = buildTestsCiReport({
    entries: treeEntries,
    workflowSnapshots,
    pkgScripts,
    owner,
    repo,
    ref: branch,
    workflowApiNames: workflowsApi?.ok ? workflowsApi.data.map((w) => w.name) : null,
  });

  /* ---------- governance finding: license ---------- */

  const findings: Finding[] = [
    ...archOut.findings,
    ...depOut.findings,
    ...secOut.findings,
    ...qualOut.findings,
    ...testsOut.findings,
  ];

  if (!report.repo.licenseSpdx && !allPaths.some((p) => /(^|\/)(license|copying)(\.[a-z]+)?$/i.test(p))) {
    findings.push(
      makeFinding({
        category: "governance",
        severity: "low",
        title: "No license detected",
        summary:
          "No SPDX license is reported by GitHub and no LICENSE file was found in the inspected tree. Without a license, default copyright restrictions apply.",
        evidence: [],
        confidence: treeStatus === "complete" ? "high" : "medium",
        status: treeStatus === "complete" ? "verified" : "heuristic",
        recommendation: "Add a LICENSE file (e.g. MIT, Apache-2.0) so others know how they may use the code.",
      }),
    );
  }

  /* ---------- section statuses ---------- */

  const snapshotCount = snapshots.length;
  const anyManifest = depOut.report.sets.length > 0;
  const codeOk = treeStatus !== "unavailable" && snapshotCount > 0;
  const codeStatus: CoverageStatus = !codeOk ? "unavailable" : treeTruncated ? "partial" : "complete";

  const sectionStatus: Record<AnalysisCategory, { status: CoverageStatus; note?: string }> = {
    discovery: {
      status: treeStatus,
      note:
        treeStatus === "unavailable"
          ? rateLimitNote ?? treeError?.message ?? "Repository tree could not be retrieved."
          : treeTruncated
            ? "GitHub truncated the recursive tree; bounded traversal covered key directories only."
            : undefined,
    },
    architecture: {
      status: codeStatus,
      note:
        snapshotCount === 0
          ? "No source files were retrieved; architecture is inferred from manifests and tree shape only."
          : undefined,
    },
    dependencies: {
      status: treeStatus === "unavailable" ? "unavailable" : treeTruncated ? "partial" : "complete",
      note: anyManifest ? undefined : "No package manifest found in the inspected tree.",
    },
    security: {
      status: codeStatus,
      note: rateLimitNote ?? (snapshotCount === 0 ? "No files retrieved for secret scanning." : undefined),
    },
    quality: {
      status: codeStatus,
      note: `Analyzed ${snapshotCount} retrieved file(s); budget-skipped files were not inspected.`,
    },
    activity: {
      status: !commitsRes ? "unavailable" : commitsRes.ok ? "complete" : "unavailable",
      note: !commitsRes
        ? "Request budget exhausted before commit history was retrieved."
        : commitsRes.ok
          ? undefined
          : commitsRes.error.message,
    },
    testing: {
      status:
        treeStatus === "unavailable"
          ? "unavailable"
          : workflowSnapshots.length > 0 || workflowsApi?.ok
            ? treeTruncated && !workflowSnapshots.length
              ? "partial"
              : "complete"
            : "partial",
      note: workflowSnapshots.length
        ? undefined
        : "Workflow files were not retrieved; CI test steps may be missing from this report.",
    },
  };

  /* ---------- coverage ---------- */

  const categories: Coverage["categories"] = (
    Object.entries(sectionStatus) as Array<[AnalysisCategory, { status: CoverageStatus; note?: string }]>
  ).map(([category, v]) => ({
    category,
    status: v.status,
    inspected:
      category === "activity"
        ? actOut.report.recentCommits.length
        : category === "testing"
          ? testsOut.report.testFileCount
          : category === "dependencies"
            ? depOut.report.sets.length
            : snapshotCount,
    ...(v.note ? { note: v.note } : {}),
  }));

  const overall = (Object.values(sectionStatus) as Array<{ status: CoverageStatus }>).reduce<CoverageStatus>(
    (acc, s) => worst(acc, s.status),
    "complete",
  );

  const coverage: Coverage = {
    treeTruncated,
    treeEntries: treeEntries.length,
    treeStatus,
    filesInspected: snapshots.map((s) => s.path).sort(),
    filesSkipped: skipped.sort((a, b) => a.path.localeCompare(b.path)),
    categories,
    budget: budgetView(budget),
    apiRequestsUsed: requestsUsed,
    disclosure: buildDisclosure({ treeStatus, treeTruncated, inspected: snapshots.length, requestsUsed, rateLimitNote }),
  };

  /* ---------- deep health indicators ---------- */

  const indicators = buildIndicators({
    report,
    snapshots,
    treePaths: allPaths,
    dep: depOut.report,
    tests: testsOut.report,
    sec: secOut.report,
    arch: archOut.report,
    treeStatus,
  });

  const browsePaths = [
    ...new Set([...importantFiles, ...snapshots.map((s) => s.path), ...directories.map((d) => `${d}/`)]),
  ]
    .sort()
    .slice(0, 300);

  return {
    analyzedAt: new Date().toISOString(),
    overall,
    sectionStatus,
    discovery: {
      defaultBranch: branch,
      commitSha: headSha,
      ecosystems,
      importantFiles,
      directories,
      treeTruncated,
    },
    browsePaths,
    architecture: archOut.report,
    dependencies: depOut.report,
    security: secOut.report,
    quality: qualOut.report,
    activity: actOut.report,
    testsCi: testsOut.report,
    findings: sortFindings(findings).slice(0, 80),
    indicators,
    coverage,
  };
}

function buildDisclosure(input: {
  treeStatus: CoverageStatus;
  treeTruncated: boolean;
  inspected: number;
  requestsUsed: number;
  rateLimitNote: string | null;
}): string {
  const parts: string[] = [];
  if (input.treeStatus === "unavailable") {
    parts.push("The repository tree could not be retrieved, so no files were inspected.");
  } else if (input.treeTruncated) {
    parts.push(
      "GitHub truncated the repository tree; directory traversal was bounded, so some files are missing from this report.",
    );
  } else {
    parts.push("The full repository tree was mapped.");
  }
  parts.push(
    `${input.inspected} file${input.inspected === 1 ? "" : "s"} inspected within budget; ${input.requestsUsed} GitHub API request(s) used.`,
  );
  if (input.rateLimitNote) parts.push(input.rateLimitNote);
  parts.push("Files never retrieved are reported as not inspected — never as empty or clean.");
  return parts.join(" ");
}

type IndicatorInput = {
  report: Report;
  snapshots: FileSnapshot[];
  treePaths: string[];
  dep: ReturnType<typeof buildDependencyReport>["report"];
  tests: ReturnType<typeof buildTestsCiReport>["report"];
  sec: ReturnType<typeof buildSecurityReport>["report"];
  arch: ReturnType<typeof buildArchitectureReport>["report"];
  treeStatus: CoverageStatus;
};

const DAY = 86_400_000;

function daysSinceISO(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / DAY);
}

export function buildIndicators(input: IndicatorInput): DeepIndicator[] {
  const { report, snapshots, treePaths, dep, tests, sec, arch, treeStatus } = input;
  const noData = treeStatus === "unavailable";
  const pushedDays = daysSinceISO(report.repo.pushedAt);

  const maintenance: DeepIndicator = noData
    ? { name: "Maintenance activity", status: "unknown", detail: "Repository metadata unavailable.", basis: null }
    : report.repo.archived
      ? {
          name: "Maintenance activity",
          status: "partial",
          detail:
            "Repository is archived — maintenance is suspended by definition. This is not the same as an active project going stale.",
          basis: "archived flag",
        }
      : pushedDays === null
        ? { name: "Maintenance activity", status: "unknown", detail: "No push timestamp available.", basis: null }
        : pushedDays <= 60
          ? { name: "Maintenance activity", status: "good", detail: `Last push ${pushedDays} day(s) ago.`, basis: "pushed_at" }
          : pushedDays <= 365
            ? {
                name: "Maintenance activity",
                status: "partial",
                detail: `Last push ${pushedDays} day(s) ago — slower cadence, which can be normal for stable libraries.`,
                basis: "pushed_at",
              }
            : {
                name: "Maintenance activity",
                status: "missing",
                detail: `Last push ${pushedDays} day(s) ago. A long-dormant repository may simply be complete, not abandoned.`,
                basis: "pushed_at",
              };

  const datedReleases = (report.releases ?? []).filter((r) => r.publishedAt);
  const releaseStatus: IndicatorStatus =
    report.releases === null ? "unknown" : datedReleases.length > 0 ? "good" : "partial";
  const releases: DeepIndicator = {
    name: "Release practices",
    status: releaseStatus,
    detail:
      report.releases === null
        ? "Release data unavailable."
        : datedReleases.length > 0
          ? `${datedReleases.length} dated release(s); latest ${datedReleases[0].tagName}.`
          : "No GitHub releases with dates — tags alone may still mark versions.",
    basis: report.releases === null ? null : "releases endpoint",
  };

  const hasTests = tests.testFileCount > 0;
  const hasCiTests = tests.workflows.some((w) => w.testSteps.length > 0);
  const testing: DeepIndicator = noData
    ? { name: "Testing & CI evidence", status: "unknown", detail: "Repository tree unavailable.", basis: null }
    : hasTests && hasCiTests
      ? {
          name: "Testing & CI evidence",
          status: "good",
          detail: `${tests.testFileCount} test file(s) and CI test steps detected. Pass/fail status is not verified — RepoLens does not execute code.`,
          basis: "tree + workflow files",
        }
      : hasTests
        ? {
            name: "Testing & CI evidence",
            status: "partial",
            detail: "Test files exist but no CI test step was detected in retrieved workflows.",
            basis: "tree",
          }
        : hasCiTests
          ? {
              name: "Testing & CI evidence",
              status: "partial",
              detail: "CI runs tests, but no test files were found in the inspected tree.",
              basis: "workflow files",
            }
          : {
              name: "Testing & CI evidence",
              status: "missing",
              detail: "No test files or CI test steps detected in inspected data.",
              basis: "tree + workflow files",
            };

  const lockfiles = dep.sets.filter((s) => s.lockfilePath).length;
  const depMgmt: DeepIndicator =
    noData || !dep.sets.length
      ? {
          name: "Dependency management",
          status: "unknown",
          detail: dep.sets.length ? "Tree unavailable." : "No package manifest retrieved.",
          basis: null,
        }
      : lockfiles === dep.sets.length
        ? {
            name: "Dependency management",
            status: "good",
            detail: `Lockfile present for all ${dep.sets.length} manifest(s).`,
            basis: "manifest + lockfile paths",
          }
        : lockfiles > 0
          ? {
              name: "Dependency management",
              status: "partial",
              detail: `${lockfiles}/${dep.sets.length} manifest(s) have a lockfile.`,
              basis: "manifest + lockfile paths",
            }
          : {
              name: "Dependency management",
              status: "missing",
              detail: "No lockfile found alongside the retrieved manifests — version resolution may drift between installs.",
              basis: "manifest + lockfile paths",
            };

  const hasReadme = treePaths.some((p) => /(^|\/)readme(\.[a-z]+)?$/i.test(p));
  const hasDocs = treePaths.some((p) => /(^|\/)(docs?)\//i.test(p));
  const docs: DeepIndicator = noData
    ? { name: "Documentation", status: "unknown", detail: "Repository tree unavailable.", basis: null }
    : hasReadme && hasDocs
      ? { name: "Documentation", status: "good", detail: "README and a docs directory are present.", basis: "tree paths" }
      : hasReadme
        ? { name: "Documentation", status: "partial", detail: "README present; no dedicated docs directory in the tree.", basis: "tree paths" }
        : { name: "Documentation", status: "missing", detail: "No README detected in the inspected tree.", basis: "tree paths" };

  const policySignals = [sec.policyFiles.securityPolicy, sec.policyFiles.dependabot, sec.policyFiles.codeowners].filter(
    Boolean,
  ).length;
  const workflowPermCoverage = sec.workflowAudit.length
    ? sec.workflowAudit.filter((w) => w.hasPermissionsBlock && !w.permissiveWrite).length / sec.workflowAudit.length
    : 0;
  const secConfig: DeepIndicator = noData
    ? { name: "Security configuration", status: "unknown", detail: "Repository tree unavailable.", basis: null }
    : policySignals >= 2 && workflowPermCoverage >= 0.5
      ? {
          name: "Security configuration",
          status: "good",
          detail:
            "Security policy / dependency-update config / workflow permission blocks found. Configuration presence ≠ absence of vulnerabilities.",
          basis: "SECURITY.md, dependabot/renovate, workflow files",
        }
      : policySignals >= 1 || sec.workflowAudit.length > 0
        ? {
            name: "Security configuration",
            status: "partial",
            detail:
              "Some security configuration found. Missing items are observations, not vulnerabilities.",
            basis: "tree paths + workflow files",
          }
        : {
            name: "Security configuration",
            status: "missing",
            detail: "No security policy, dependency-update config, or audited workflow files retrieved.",
            basis: "tree paths",
          };

  const nodeCount = arch.nodes.length;
  const complexity: DeepIndicator =
    noData || !snapshots.length
      ? { name: "Architectural complexity", status: "unknown", detail: "No inspected sources to estimate module structure.", basis: null }
      : nodeCount < 80
        ? {
            name: "Architectural complexity",
            status: "good",
            detail: `Small module graph (${nodeCount} nodes, ${arch.edges.length} import edges) across inspected files.`,
            basis: "import graph from inspected files",
          }
        : nodeCount < 250
          ? {
              name: "Architectural complexity",
              status: "partial",
              detail: `Medium module graph (${nodeCount} nodes) — worth structure review as it grows.`,
              basis: "import graph from inspected files",
            }
          : {
              name: "Architectural complexity",
              status: "missing",
              detail: `Large module graph (${nodeCount} nodes) — high structural complexity indicator (not a defect by itself).`,
              basis: "import graph from inspected files",
            };

  const jsSet = dep.sets.find((s) => s.ecosystem === "javascript");
  const reproducible =
    dep.sets.length > 0 && dep.sets.every((s) => s.lockfilePath) && Boolean(jsSet?.packageManager);
  const build: DeepIndicator =
    noData || !dep.sets.length
      ? { name: "Build reproducibility", status: "unknown", detail: "No manifest retrieved.", basis: null }
      : reproducible
        ? {
            name: "Build reproducibility",
            status: "good",
            detail: "Lockfiles plus a declared package manager support repeatable installs.",
            basis: "lockfiles + packageManager field",
          }
        : dep.sets.some((s) => s.lockfilePath)
          ? {
              name: "Build reproducibility",
              status: "partial",
              detail: "Some lockfiles present; package manager or engine constraints incomplete.",
              basis: "lockfiles + engines",
            }
          : {
              name: "Build reproducibility",
              status: "missing",
              detail: "No lockfiles detected — builds may resolve different dependency versions over time.",
              basis: "lockfiles",
            };

  const governanceBits = [
    treePaths.some((p) => /(^|\/)contributing(\.[a-z]+)?$/i.test(p)) ? "CONTRIBUTING" : null,
    treePaths.some((p) => /(^|\/)codeowners$/i.test(p)) ? "CODEOWNERS" : null,
    report.repo.licenseSpdx ? `license ${report.repo.licenseSpdx}` : null,
    sec.policyFiles.securityPolicy ? "SECURITY.md" : null,
  ].filter(Boolean) as string[];
  const governance: DeepIndicator = noData
    ? { name: "Repository governance", status: "unknown", detail: "Repository tree unavailable.", basis: null }
    : governanceBits.length >= 3
      ? {
          name: "Repository governance",
          status: "good",
          detail: `Governance files present: ${governanceBits.join(", ")}.`,
          basis: "tree paths + license metadata",
        }
      : governanceBits.length >= 1
        ? {
            name: "Repository governance",
            status: "partial",
            detail: `Partial governance: ${governanceBits.join(", ")}.`,
            basis: "tree paths + license metadata",
          }
        : {
            name: "Repository governance",
            status: "missing",
            detail: "No license, contributing guide, code owners, or security policy detected.",
            basis: "tree paths + license metadata",
          };

  return [maintenance, releases, testing, depMgmt, docs, secConfig, complexity, build, governance];
}
