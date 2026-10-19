import type { FileSnapshot, Finding, TestsCiReport, TreeEntry } from "@/types/analysis";
import { makeFinding, githubBlobUrl } from "@/lib/analysis/evidence";

const TEST_FILE_RE =
  /(^|\/)(__tests__|tests?|spec|e2e|integration)(\/|$)|\.(test|spec)\.[a-z]+[a-z]?$/i;
const TEST_FILE_EXTS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cs)$/i;
const NON_SOURCE_TEST = /(^|\/)(tests?|__tests__)(\/|$)/i;

export function detectTestFiles(entries: TreeEntry[], limit = 100): { files: string[]; total: number; limited: boolean } {
  const files = entries
    .filter((e) => e.type === "blob" && (TEST_FILE_RE.test(e.path) && (TEST_FILE_EXTS.test(e.path) || NON_SOURCE_TEST.test(e.path))))
    .map((e) => e.path)
    .filter((p) => !p.includes("node_modules") && !p.includes("vendor/"))
    .sort();
  return { files: files.slice(0, limit), total: files.length, limited: files.length > limit };
}

const RUNNER_CONFIG_RE =
  /(jest\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|pytest\.ini|tox\.ini|phpunit\.xml|karma\.conf\.js|playwright\.config\.[cm]?[jt]s|cypress\.config\.[cm]?[jt]s|\.mocharc(\.[a-z]+)?|jest\.setup\.[jt]s)$/i;

const COVERAGE_HINTS =
  /(jest --coverage|--coverage|pytest-cov|coverage(er)?\.(json|xml)|codecov|coveralls|\.nycrc|lcov)/i;

type PkgScripts = Record<string, string>;

export function extractTestScripts(scripts: PkgScripts): Array<{ name: string; command: string }> {
  return Object.entries(scripts)
    .filter(([name, cmd]) => /\btest\b|vitest|jest|mocha|ava\b|pytest|phpunit/i.test(name) || /\b(test|vitest|jest|mocha|pytest)\b/i.test(cmd))
    .map(([name, command]) => ({ name, command }));
}

export type WorkflowInfo = {
  name: string;
  path: string;
  triggers: string[];
  testSteps: string[];
  hasPermissions: boolean;
  text?: string;
};

const TEST_CMD_RE =
  /\b(vitest|jest|mocha|ava|pytest|phpunit|phpstan|\btox\b|dotnet test)\b|\btest\b|\b(npm|pnpm|yarn|bun)\s+run\s+test/i;

export function parseWorkflow(path: string, text: string): WorkflowInfo {
  const triggers: string[] = [];
  for (const t of ["push", "pull_request", "pull_request_target", "schedule", "workflow_dispatch", "release"]) {
    if (new RegExp(`(^|\\n)\\s*${t}\\s*:`, "m").test(text)) triggers.push(t);
  }

  const testSteps: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^\s*run\s*:/.test(trimmed)) continue;
    const cmd = trimmed.replace(/^\s*run\s*:\s*/, "").replace(/^['"]|['"]$/g, "");
    if (TEST_CMD_RE.test(cmd) && !/\blint\b|\bformat\b|type-?check/i.test(cmd)) {
      testSteps.push(cmd.slice(0, 160));
    }
  }

  return {
    name: text.match(/^\s*name\s*:\s*(.+)$/m)?.[1]?.trim() || path.split("/").pop() || path,
    path,
    triggers,
    testSteps: [...new Set(testSteps)].slice(0, 6),
    hasPermissions: /^\s*permissions\s*:/m.test(text),
    text,
  };
}

export function buildTestsCiReport(input: {
  entries: TreeEntry[];
  workflowSnapshots: FileSnapshot[];
  pkgScripts: PkgScripts;
  owner: string;
  repo: string;
  ref: string;
  workflowApiNames: string[] | null;
}): { report: TestsCiReport; findings: Finding[] } {
  const { entries, workflowSnapshots, pkgScripts, owner, repo, ref, workflowApiNames } = input;
  const findings: Finding[] = [];
  const { files, total, limited } = detectTestFiles(entries);
  const workflows = workflowSnapshots.map((s) => {
    const info = parseWorkflow(s.path, s.content);
    return {
      name: info.name,
      path: info.path,
      triggers: info.triggers,
      testSteps: info.testSteps,
      hasPermissions: info.hasPermissions,
    };
  });

  const runnerConfig =
    entries.filter((e) => e.type === "blob" && RUNNER_CONFIG_RE.test(e.path)).map((e) => e.path)[0] ?? null;
  const coverageConfig =
    entries.filter((e) => e.type === "blob" && /(coverage|codecov|coveralls|\.nycrc)/i.test(e.path)).map((e) => e.path)[0] ?? null;

  const testScripts = extractTestScripts(pkgScripts);
  const workflowsWithTests = workflows.filter((w) => w.testSteps.length > 0);

  const notes: string[] = [
    "Diplens performs static inspection only: no repository code is executed, so no test run, coverage measurement, or build verification occurs here.",
    "Test files detected ≠ tests passed. Execution status is not claimed.",
  ];
  if (workflowApiNames && !workflowSnapshots.length) {
    notes.push(`The Actions API lists ${workflowApiNames.length} workflow(s), but their files were not retrieved within the budget.`);
  }
  if (limited) notes.push(`Test-file list truncated to ${files.length} of ${total}.`);

  // Findings: distinct evidence levels.
  if (!files.length && !testScripts.length && !workflowsWithTests.length) {
    findings.push(
      makeFinding({
        category: "testing",
        severity: "medium",
        title: "No testing evidence found",
        summary:
          "No test files, test scripts, or CI test steps were detected in the inspected tree. This does not prove tests are absent elsewhere — inspection was budget-limited.",
        evidence: [],
        confidence: "medium",
        status: "heuristic",
        recommendation: "Add automated tests and a CI job that runs them on every pull request.",
      }),
    );
  } else if (files.length && !workflowsWithTests.length && !testScripts.length) {
    findings.push(
      makeFinding({
        category: "testing",
        severity: "low",
        title: "Test files exist but no CI test step was detected",
        summary: `${files.length} test file(s) were found, but retrieved workflow files and package scripts contain no recognizable test command.`,
        evidence: files.slice(0, 3).map((p) => ({ path: p, sourceUrl: githubBlobUrl(owner, repo, ref, p) })),
        confidence: "medium",
        status: "heuristic",
        recommendation: "Wire the test command into CI so regressions are caught automatically.",
      }),
    );
  } else if (workflowsWithTests.length) {
    findings.push(
      makeFinding({
        category: "testing",
        severity: "info",
        title: `CI test steps configured in ${workflowsWithTests.length} workflow(s)`,
        summary: `Retrieved workflows contain ${workflowsWithTests.reduce((a, w) => a + w.testSteps.length, 0)} test-related run step(s). Whether they pass is not verified by Diplens.`,
        evidence: workflowsWithTests.slice(0, 3).map((w) => ({
          path: w.path,
          excerpt: w.testSteps[0],
          sourceUrl: githubBlobUrl(owner, repo, ref, w.path),
        })),
        confidence: "high",
        status: "verified",
      }),
    );
  }

  if (files.length && !coverageConfig) {
    findings.push(
      makeFinding({
        category: "testing",
        severity: "info",
        title: "No coverage configuration detected",
        summary: "No coverage configuration or report file was found in the tree. Coverage may still be produced inside CI without a committed config.",
        evidence: [],
        confidence: "medium",
        status: "verified",
        recommendation: "Add coverage configuration and publish results so coverage is visible.",
      }),
    );
  }

  return {
    report: {
      testFiles: files,
      testFileCount: total,
      testFileSampleLimited: limited,
      runnerConfig,
      testScripts,
      workflows,
      coverageConfig,
      buildVerifiedByExecution: false,
      notes,
    },
    findings,
  };
}
