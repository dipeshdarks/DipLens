import type {
  Finding,
  FileSnapshot,
  SecurityReport,
  SecretMatch,
} from "@/types/analysis";
import { makeFinding, githubBlobUrl } from "@/lib/analysis/evidence";
import { scanLine, placeholder } from "@/lib/analysis/redact";

/* ---------- workflow YAML heuristics (line-oriented, no YAML parser needed) ---------- */

export type WorkflowAudit = SecurityReport["workflowAudit"][number];

export function auditWorkflow(path: string, text: string): WorkflowAudit {
  const hasPermissionsBlock = /^\s*permissions\s*:/m.test(text);
  const permissiveWrite = /permissions\s*:[\s\S]{0,60}write-all/.test(text) || /(^|\s)write-all\s*$/m.test(text);
  const riskyTriggers: string[] = [];
  if (/^\s*pull_request_target\s*:/m.test(text)) riskyTriggers.push("pull_request_target");
  if (/^\s*schedule\s*:/m.test(text)) riskyTriggers.push("schedule");
  const untrustedContextUse =
    /\$\{\{\s*github\.event\.(issue|pull_request|comment|head_commit|workflow_run)/.test(text) ||
    /\$\{\{\s*github\.event\.pull_request\.title/.test(text) ||
    /\$\{\{\s*github\.head_ref/.test(text);

  return {
    path,
    hasPermissionsBlock,
    permissiveWrite,
    riskyTriggers,
    untrustedContextUse,
  };
}

/* ---------- secret scanning ---------- */

export function scanForSecrets(
  snapshots: FileSnapshot[],
  owner: string,
  repo: string,
  ref: string,
): { matches: SecretMatch[]; findings: Finding[] } {
  const matches: SecretMatch[] = [];
  const findings: Finding[] = [];
  const envLike = /\.(env|pem|key|p12|pfx|keystore|jks|asc|gpg)$/i;

  for (const snap of snapshots) {
    const lines = snap.content.split(/\r?\n/);
    const maxLines = Math.min(lines.length, 4_000);
    for (let i = 0; i < maxLines; i++) {
      const hits = scanLine(lines[i]);
      for (const hit of hits) {
        matches.push({
          path: snap.path,
          line: i + 1,
          kind: hit.kind,
          redacted: hit.redacted, // value itself is never stored or returned
        });
      }
    }

    // Committed env/private-key-like files are a finding regardless of pattern match.
    if (envLike.test(snap.path) && !/\.example$|\.sample$|\.template$/i.test(snap.path)) {
      findings.push(
        makeFinding({
          category: "security",
          severity: "medium",
          title: `Sensitive-looking file committed: ${snap.path}`,
          summary:
            "A file with an environment or private-key extension was retrieved from the repository. This is an observation, not a confirmed secret — the file may contain placeholders.",
          evidence: [
            {
              path: snap.path,
              excerpt: snap.content.slice(0, 160).replace(/\r?\n/g, " "),
              sourceUrl: githubBlobUrl(owner, repo, ref, snap.path),
            },
          ],
          confidence: "medium",
          status: "heuristic",
          recommendation:
            "Verify the file contains no real credentials; move real values to a secret manager and keep only a redacted example in the repo.",
        }),
      );
    }
  }

  // Group secret matches into one finding (never printing values).
  if (matches.length) {
    const byKind = new Map<string, SecretMatch[]>();
    for (const m of matches) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m]);
    for (const [kind, ms] of byKind) {
      const first = ms[0];
      findings.push(
        makeFinding({
          category: "security",
          severity: "high",
          title: `Possible ${kind} found in retrieved files`,
          summary: `${ms.length} occurrence${ms.length === 1 ? "" : "s"} of a token-like string matching the ${kind} pattern were found in files retrieved during this analysis. Values are redacted. This is a heuristic detection — some matches are placeholders or test fixtures.`,
          evidence: ms.slice(0, 5).map((m) => ({
            path: m.path,
            startLine: m.line,
            endLine: m.line,
            excerpt: placeholder(kind, ""),
            sourceUrl: githubBlobUrl(owner, repo, ref, m.path, m.line),
          })),
          confidence: kind.includes("AWS") || kind.includes("GitHub") ? "high" : "medium",
          status: "heuristic",
          recommendation:
            "Rotate the credential if real, purge it from history, and load secrets from environment variables or a secrets manager.",
        }),
      );
    }
  }

  return { matches, findings };
}

/* ---------- full security report ---------- */

export function buildSecurityReport(input: {
  snapshots: FileSnapshot[];
  workflowSnapshots: FileSnapshot[];
  owner: string;
  repo: string;
  ref: string;
  treePaths: string[];
  codeScanning: SecurityReport["codeScanning"];
}): { report: SecurityReport; findings: Finding[] } {
  const { snapshots, workflowSnapshots, owner, repo, ref, treePaths, codeScanning } = input;
  const { matches, findings } = scanForSecrets(snapshots, owner, repo, ref);

  const find = (re: RegExp) => treePaths.find((p) => re.test(p)) ?? null;
  const policyFiles = {
    securityPolicy: find(/(^|\/)(SECURITY|security)\.md$/i),
    dependabot: find(/^\.github\/dependabot\.ya?ml$/i) ?? find(/(^|\/)renovate\.(json|json5|yaml|yml)$/i),
    codeowners: find(/(^|\/)CODEOWNERS$/i),
  };

  const workflowAudit = workflowSnapshots.map((s) => auditWorkflow(s.path, s.content));

  for (const w of workflowAudit) {
    if (w.permissiveWrite) {
      findings.push(
        makeFinding({
          category: "security",
          severity: "medium",
          title: `Broad write permissions in ${w.path}`,
          summary: "The workflow does not clearly restrict its token permissions to read, granting broader write access than necessary.",
          evidence: [{ path: w.path, excerpt: "permissions: write-all (or unspecified with write)", sourceUrl: githubBlobUrl(owner, repo, ref, w.path) }],
          confidence: "medium",
          status: "heuristic",
          recommendation: "Declare a least-privilege `permissions:` block at the workflow or job level.",
        }),
      );
    }
    if (w.riskyTriggers.includes("pull_request_target")) {
      findings.push(
        makeFinding({
          category: "security",
          severity: "high",
          title: `pull_request_target trigger in ${w.path}`,
          summary: "`pull_request_target` runs with write access to the base repository while checking out contributor-controlled code, a common privilege-escalation pattern.",
          evidence: [{ path: w.path, excerpt: "on: pull_request_target", sourceUrl: githubBlobUrl(owner, repo, ref, w.path) }],
          confidence: "medium",
          status: "heuristic",
          recommendation: "Review the workflow to ensure untrusted code is never checked out or executed with elevated privileges.",
        }),
      );
    }
    if (w.untrustedContextUse && w.riskyTriggers.includes("pull_request_target")) {
      findings.push(
        makeFinding({
          category: "security",
          severity: "high",
          title: `Untrusted context interpolation in ${w.path}`,
          summary: "Expression interpolation of event-controlled fields (issue/PR title, head ref) inside a privileged workflow can enable script/command injection.",
          evidence: [{ path: w.path, excerpt: "${{ github.event.* }} / ${{ github.head_ref }}", sourceUrl: githubBlobUrl(owner, repo, ref, w.path) }],
          confidence: "medium",
          status: "heuristic",
          recommendation: "Pass untrusted values through environment variables and quote them, or avoid interpolating them into shell commands.",
        }),
      );
    }
  }

  if (!policyFiles.securityPolicy) {
    findings.push(
      makeFinding({
        category: "governance",
        severity: "info",
        title: "No security policy file detected",
        summary: "No SECURITY.md (or equivalent) was found in the repository tree. A missing policy is an observation, not a vulnerability.",
        evidence: [],
        confidence: "high",
        status: "verified",
        recommendation: "Add a SECURITY.md describing how to report vulnerabilities privately.",
      }),
    );
  }

  if (codeScanning.status === "inaccessible" || codeScanning.status === "not-enabled") {
    findings.push(
      makeFinding({
        category: "security",
        severity: "info",
        title: "Code scanning results unavailable",
        summary: codeScanning.note,
        evidence: [],
        confidence: "high",
        status: "unavailable",
        recommendation: "Enable GitHub code scanning (e.g. CodeQL) if the project wants automated alert coverage.",
      }),
    );
  }

  const envExamplePresent = treePaths.some((p) => /^\.env\.(example|sample|template|dist)$/i.test(p));

  const notes: string[] = [
    "Secret detection is heuristic and limited to files retrieved within the analysis budget; absence of findings is not a clean bill of health.",
    "Repository content is treated as untrusted data and is never executed by RepoLens.",
  ];
  if (!workflowSnapshots.length) {
    notes.push("No CI workflow files were retrieved, so workflow permissions were not audited.");
  }

  return {
    report: { secrets: matches, policyFiles, workflowAudit, codeScanning, envExamplePresent, notes },
    findings,
  };
}
