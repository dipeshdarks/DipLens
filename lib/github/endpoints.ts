import { GitHubError, gh, type GhResult } from "@/lib/github";
import { encodeRepoPath } from "@/lib/validation";
import type {
  ActivityReport,
  CommitSummary,
  TreeEntry,
} from "@/types/analysis";
import type {
  CommunityProfile,
  IssueSampleItem,
  PullSampleItem,
} from "@/types/health";

/* Raw payload shapes (never exposed to the UI). */

type RawRef = { object: { sha: string; type: string } };

type RawTreeEntry = {
  path: string;
  type: string;
  size?: number;
  sha?: string;
};

type RawTree = {
  sha: string;
  truncated: boolean;
  tree: RawTreeEntry[];
};

type RawContent = {
  type: string;
  encoding: string;
  content?: string;
  size: number;
  sha: string;
  path: string;
};

type RawDirItem = { name: string; path: string; type: string; size?: number };

type RawCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
  };
  author: { login: string } | null;
};

type RawWorkflow = { id: number; name: string; path: string | null; state: string };

type RawWorkflowRuns = {
  workflow_runs: Array<{
    id: number;
    name: string;
    path: string;
    status: string | null;
    conclusion: string | null;
    html_url: string;
    created_at: string;
  }>;
};

type RawBranch = { name: string; protected?: boolean };
type RawTag = { name: string };

function base(owner: string, repo: string): string {
  return `/repos/${encodeRepoPath(owner, repo)}`;
}

function enc(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/* ---------- repository structure ---------- */

/** Resolve the branch tip SHA. Returns null for empty/unresolvable repos. */
export async function getHeadSha(
  owner: string,
  repo: string,
  branch: string,
): Promise<GhResult<string | null>> {
  const r = await gh<RawRef>(`${base(owner, repo)}/git/ref/heads/${encodeURIComponent(branch)}`, 300);
  if (!r.ok) {
    // 404 on the ref = empty repository or unknown branch; treat as "no head" rather than failure.
    if (r.error.kind === "not_found") {
      return { ok: true, data: null, res: new Response(null, { status: 200 }) };
    }
    return r;
  }
  return { ok: true, data: r.data.object?.sha ?? null, res: r.res };
}

/** Recursive git tree. `truncated` means GitHub cut the response off. */
export async function getTree(
  owner: string,
  repo: string,
  ref: string,
): Promise<GhResult<{ entries: TreeEntry[]; truncated: boolean; treeSha: string }>> {
  const r = await gh<RawTree>(`${base(owner, repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`, 600);
  if (!r.ok) return r;
  const entries: TreeEntry[] = [];
  for (const t of r.data.tree ?? []) {
    if (t.type !== "blob" && t.type !== "tree") continue;
    if (typeof t.path !== "string") continue;
    entries.push({
      path: t.path,
      type: t.type === "tree" ? "tree" : "blob",
      ...(typeof t.size === "number" ? { size: t.size } : {}),
    });
  }
  return {
    ok: true,
    data: { entries, truncated: Boolean(r.data.truncated), treeSha: r.data.sha },
    res: r.res,
  };
}

/** Bounded directory listing used when the recursive tree was truncated. */
export async function listDirectory(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<GhResult<TreeEntry[]>> {
  const suffix = path ? `/${enc(path)}` : "";
  const r = await gh<RawDirItem[]>(`${base(owner, repo)}/contents${suffix}?ref=${encodeURIComponent(ref)}`, 600);
  if (!r.ok) return r;
  const entries: TreeEntry[] = [];
  for (const item of Array.isArray(r.data) ? r.data : []) {
    entries.push({
      path: item.path,
      type: item.type === "dir" ? "tree" : "blob",
      ...(typeof item.size === "number" ? { size: item.size } : {}),
    });
  }
  return { ok: true, data: entries, res: r.res };
}

export type FileFetch =
  | { ok: true; content: string; size: number; truncated: boolean }
  | { ok: false; reason: "too-large" | "binary" | "not-file"; error?: GitHubError };

/**
 * Retrieve a text file through the Contents API (≤1 MB per GitHub's limit).
 * Secrets are NOT stripped here — analyzers redact before reporting.
 */
export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  maxBytes: number,
): Promise<FileFetch> {
  const r = await gh<RawContent>(
    `${base(owner, repo)}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`,
    600,
  );
  if (!r.ok) {
    return { ok: false, reason: "not-file", error: r.error };
  }
  const raw = r.data;
  if (raw.type !== "file" || typeof raw.content !== "string") {
    return { ok: false, reason: "not-file" };
  }
  if (typeof raw.size === "number" && raw.size > maxBytes) {
    return { ok: false, reason: "too-large" };
  }
  const decoded = Buffer.from(raw.content.replace(/\n/g, ""), "base64").toString("utf8");
  if (decoded.includes("\u0000")) return { ok: false, reason: "binary" };
  if (decoded.length > maxBytes) {
    return { ok: true, content: decoded.slice(0, maxBytes), size: raw.size, truncated: true };
  }
  return { ok: true, content: decoded, size: raw.size ?? decoded.length, truncated: false };
}

/* ---------- history & refs ---------- */

export async function getRecentCommits(
  owner: string,
  repo: string,
  branch: string,
  perPage = 30,
): Promise<GhResult<CommitSummary[]>> {
  const r = await gh<RawCommit[]>(
    `${base(owner, repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`,
    600,
  );
  if (!r.ok) return r;
  const commits: CommitSummary[] = [];
  for (const c of r.data ?? []) {
    if (!c?.sha || !c.commit) continue;
    commits.push({
      sha: c.sha,
      message: (c.commit.message ?? "").split("\n")[0].slice(0, 120),
      author: c.author?.login ?? c.commit.author?.name ?? null,
      date: c.commit.author?.date ?? "",
      htmlUrl: c.html_url ?? `https://github.com/${owner}/${repo}/commit/${c.sha}`,
    });
  }
  return { ok: true, data: commits, res: r.res };
}

export async function listBranches(owner: string, repo: string): Promise<GhResult<number | null>> {
  const r = await gh<RawBranch[]>(`${base(owner, repo)}/branches?per_page=1`, 600);
  if (!r.ok) return r;
  const last = r.res.headers.get("link")?.match(/[?&]page=(\d+)>; rel="last"/)?.[1];
  const count = last ? Number(last) : r.data.length;
  return { ok: true, data: Number.isFinite(count) && count > 0 ? count : r.data.length, res: r.res };
}

export async function listTags(owner: string, repo: string, perPage = 10): Promise<GhResult<string[]>> {
  const r = await gh<RawTag[]>(`${base(owner, repo)}/tags?per_page=${perPage}`, 900);
  if (!r.ok) return r;
  return { ok: true, data: (r.data ?? []).map((t) => t.name).filter(Boolean), res: r.res };
}

/* ---------- CI/CD ---------- */

export async function listWorkflows(
  owner: string,
  repo: string,
): Promise<GhResult<Array<{ name: string; path: string | null; state: string }>>> {
  const r = await gh<{ workflows?: RawWorkflow[] }>(`${base(owner, repo)}/actions/workflows?per_page=20`, 600);
  if (!r.ok) {
    // Actions disabled for the repo/account surfaces as 404/403 — caller marks unavailable.
    return r;
  }
  const list = (r.data.workflows ?? [])
    .filter((w) => w && w.name)
    .map((w) => ({ name: w.name, path: w.path ?? null, state: w.state ?? "unknown" }));
  return { ok: true, data: list, res: r.res };
}

export async function listWorkflowRuns(
  owner: string,
  repo: string,
  perPage = 10,
): Promise<GhResult<RawWorkflowRuns["workflow_runs"]>> {
  const r = await gh<RawWorkflowRuns>(`${base(owner, repo)}/actions/runs?per_page=${perPage}`, 300);
  if (!r.ok) return r;
  return { ok: true, data: r.data.workflow_runs ?? [], res: r.res };
}

/* ---------- health-radar support ---------- */

type RawCommunityProfile = {
  health_percentage?: number | null;
  description?: string | null;
  files?: {
    readme?: { path: string } | null;
    license?: { path: string } | null;
    contributing?: { path: string } | null;
    code_of_conduct?: { path: string } | null;
    security?: { path: string } | null;
  } | null;
};

type RawIssue = {
  number: number;
  state: string;
  created_at: string;
  closed_at: string | null;
  comments?: number;
  pull_request?: unknown;
};

type RawPull = {
  number: number;
  state: string;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
  comments?: number;
};

type RawContentItem = { name: string; path: string; type: string };

/**
 * Community profile: README/license/contributing/CoC/security presence in one call.
 * 404 means the endpoint is unavailable for this repository — caller marks docs data null.
 */
export async function getCommunityProfile(
  owner: string,
  repo: string,
): Promise<GhResult<CommunityProfile>> {
  const r = await gh<RawCommunityProfile>(`${base(owner, repo)}/community/profile`, 900);
  if (!r.ok) return r;
  const f = r.data.files ?? {};
  return {
    ok: true,
    data: {
      healthPercentage: typeof r.data.health_percentage === "number" ? r.data.health_percentage : null,
      description: r.data.description ?? null,
      files: {
        readme: Boolean(f.readme),
        license: Boolean(f.license),
        contributing: Boolean(f.contributing),
        codeOfConduct: Boolean(f.code_of_conduct),
        security: Boolean(f.security),
      },
    },
    res: r.res,
  };
}

/** Fallback documentation probe via the repository root listing. */
export async function getRootDocSignals(
  owner: string,
  repo: string,
  branch: string,
): Promise<GhResult<CommunityProfile>> {
  const r = await gh<RawContentItem[]>(
    `${base(owner, repo)}/contents?ref=${encodeURIComponent(branch)}`,
    900,
  );
  if (!r.ok) return r;
  const names = (Array.isArray(r.data) ? r.data : []).map((i) => (i.name ?? "").toLowerCase());
  const has = (re: RegExp) => names.some((n) => re.test(n));
  return {
    ok: true,
    data: {
      healthPercentage: null,
      description: null,
      files: {
        readme: has(/^readme(\.[a-z0-9]+)?$/),
        license: has(/^(license|copying)(\.[a-z0-9]+)?$/),
        contributing: has(/^contributing(\.[a-z0-9]+)?$/),
        codeOfConduct: has(/^code_of_conduct(\.[a-z0-9]+)?$/),
        security: has(/^security(\.[a-z0-9]+)?$/),
      },
      fromContentsFallback: true,
    },
    res: r.res,
  };
}

/**
 * Recent issues sample (pull requests are excluded server-side so callers
 * never have to re-filter). Sorted by most recently updated.
 */
export async function getIssuesSample(
  owner: string,
  repo: string,
  perPage = 30,
): Promise<GhResult<IssueSampleItem[]>> {
  const r = await gh<RawIssue[]>(
    `${base(owner, repo)}/issues?state=all&sort=updated&direction=desc&per_page=${perPage}`,
    300,
  );
  if (!r.ok) return r;
  const items: IssueSampleItem[] = [];
  for (const i of r.data ?? []) {
    if (!i || typeof i.number !== "number" || i.pull_request) continue;
    items.push({
      number: i.number,
      state: i.state === "closed" ? "closed" : "open",
      createdAt: i.created_at ?? "",
      closedAt: i.closed_at ?? null,
      comments: typeof i.comments === "number" ? i.comments : 0,
    });
  }
  return { ok: true, data: items, res: r.res };
}

/** Recent pull-request sample (includes merged_at for merge-rate evidence). */
export async function getPullsSample(
  owner: string,
  repo: string,
  perPage = 20,
): Promise<GhResult<PullSampleItem[]>> {
  const r = await gh<RawPull[]>(
    `${base(owner, repo)}/pulls?state=all&sort=updated&direction=desc&per_page=${perPage}`,
    300,
  );
  if (!r.ok) return r;
  const items: PullSampleItem[] = [];
  for (const p of r.data ?? []) {
    if (!p || typeof p.number !== "number") continue;
    items.push({
      number: p.number,
      state: p.state === "closed" ? "closed" : "open",
      createdAt: p.created_at ?? "",
      mergedAt: p.merged_at ?? null,
      comments: typeof p.comments === "number" ? p.comments : 0,
    });
  }
  return { ok: true, data: items, res: r.res };
}

/* ---------- security ---------- */

export type CodeScanningStatus = "available" | "inaccessible" | "not-enabled" | "unknown";

/** Probe code-scanning access. An inaccessible endpoint never means "no vulnerabilities". */
export async function probeCodeScanning(
  owner: string,
  repo: string,
): Promise<{ status: CodeScanningStatus; note: string }> {
  const r = await gh<unknown>(`${base(owner, repo)}/code-scanning/alerts?per_page=1`, 300);
  if (r.ok) {
    return {
      status: "available",
      note: "Code scanning alerts endpoint is accessible for this repository.",
    };
  }
  const kind = r.error.kind;
  if (kind === "not_found") {
    return {
      status: "not-enabled",
      note: "Code scanning is not enabled (or the repository has no alerts endpoint). This does not prove the absence of vulnerabilities.",
    };
  }
  if (kind === "forbidden" || kind === "unauthorized" || kind === "rate_limited") {
    return {
      status: "inaccessible",
      note: "Code scanning results require additional permissions and could not be retrieved. This does not prove the absence of vulnerabilities.",
    };
  }
  return {
    status: "unknown",
    note: "The code scanning endpoint could not be reached.",
  };
}

/** Convenience re-export so orchestrators can interpret activity helpers. */
export type { ActivityReport };
