/* Raw source acquisition, pinned to a commit SHA.
 *
 * Files are fetched from raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>,
 * which serves the exact bytes of one commit and costs no GitHub API rate
 * budget. The SHA pin means an analysis can never straddle two revisions.
 *
 * Repo content is untrusted: nothing here executes it, and binary detection
 * rejects anything containing NUL bytes before it reaches an analyzer.
 */

export type AcquiredFile = {
  path: string;
  content: string;
  /** Byte length as reported by the server; falls back to UTF-8 length. */
  size: number;
  sha: string | null;
  truncated: boolean;
};

export type AcquireSkip = {
  path: string;
  reason: "too-large" | "binary" | "http-error" | "timeout" | "empty" | "budget" | "rate-limited";
  detail?: string;
};

export type AcquireResult = {
  files: AcquiredFile[];
  skipped: AcquireSkip[];
  requestsUsed: number;
  rateLimitNote: string | null;
};

export type AcquireOptions = {
  owner: string;
  repo: string;
  /** Full 40-char commit SHA. Analysis is pinned to this. */
  sha: string;
  paths: string[];
  maxFileBytes: number;
  maxTotalChars: number;
  concurrency?: number;
  timeoutMs?: number;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

export const RAW_HOSTS = ["raw.githubusercontent.com"];

function rawUrl(owner: string, repo: string, sha: string, filePath: string): string {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(sha)}/${encodedPath}`;
}

const NUL = String.fromCharCode(0);

/** Reject anything that is not plainly text. */
function looksBinary(text: string): boolean {
  return text.indexOf(NUL) !== -1;
}

function isTimeoutError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === "TimeoutError" || e.name === "AbortError" || /timeout|abort/i.test(e.message);
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Fetch text files at a pinned SHA. Never throws; failures are reported per
 * file so the pipeline can show exactly what was and was not inspected.
 */
export async function acquireRaw(options: AcquireOptions): Promise<AcquireResult> {
  const {
    owner,
    repo,
    sha,
    paths,
    maxFileBytes,
    maxTotalChars,
    concurrency = 6,
    timeoutMs = 10_000,
    fetchImpl = fetch,
  } = options;

  const files: AcquiredFile[] = [];
  const skipped: AcquireSkip[] = [];
  const requests: Array<{ used: number; limited: boolean }> = [];
  let totalChars = 0;

  await mapLimit(paths, concurrency, async (filePath) => {
    if (totalChars >= maxTotalChars) {
      skipped.push({ path: filePath, reason: "budget", detail: "total character budget exhausted" });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let used = 0;
    try {
      const res = await fetchImpl(rawUrl(owner, repo, sha, filePath), {
        signal: controller.signal,
        headers: { Accept: "text/plain,*/*;q=0.8" },
        cache: "no-store",
      });
      used = 1;
      const remaining = res.headers.get("x-ratelimit-remaining");
      const limited = res.status === 429 || remaining === "0";
      requests.push({ used, limited });

      if (limited) {
        skipped.push({ path: filePath, reason: "rate-limited", detail: "raw host rate limit hit" });
        return;
      }
      if (res.status === 404) {
        skipped.push({ path: filePath, reason: "http-error", detail: "404 not found at pinned SHA" });
        return;
      }
      if (res.status === 403) {
        skipped.push({ path: filePath, reason: "http-error", detail: "403 forbidden" });
        return;
      }
      if (!res.ok) {
        skipped.push({ path: filePath, reason: "http-error", detail: `HTTP ${res.status}` });
        return;
      }

      const declared = Number(res.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > maxFileBytes) {
        skipped.push({ path: filePath, reason: "too-large", detail: `${declared} bytes > ${maxFileBytes}` });
        return;
      }

      const text = await res.text();
      if (!text.length) {
        skipped.push({ path: filePath, reason: "empty" });
        return;
      }
      if (looksBinary(text)) {
        skipped.push({ path: filePath, reason: "binary", detail: "NUL byte in payload" });
        return;
      }
      const remainingChars = maxTotalChars - totalChars;
      if (text.length > maxFileBytes) {
        const content = text.slice(0, Math.min(maxFileBytes, remainingChars));
        if (!content.length) {
          skipped.push({ path: filePath, reason: "budget", detail: "no character budget left" });
          return;
        }
        totalChars += content.length;
        files.push({ path: filePath, content, size: text.length, sha: null, truncated: true });
        return;
      }
      if (text.length > remainingChars) {
        const content = text.slice(0, Math.max(0, remainingChars));
        if (!content.length) {
          skipped.push({ path: filePath, reason: "budget", detail: "no character budget left" });
          return;
        }
        totalChars += content.length;
        files.push({ path: filePath, content, size: text.length, sha: null, truncated: true });
        return;
      }
      totalChars += text.length;
      files.push({ path: filePath, content: text, size: text.length, sha: null, truncated: false });
    } catch (e) {
      requests.push({ used, limited: false });
      if (isTimeoutError(e)) {
        skipped.push({ path: filePath, reason: "timeout", detail: `>${timeoutMs}ms` });
      } else {
        skipped.push({ path: filePath, reason: "http-error", detail: e instanceof Error ? e.message : "fetch failed" });
      }
    } finally {
      clearTimeout(timer);
    }
  });

  const requestsUsed = requests.reduce((n, r) => n + r.used, 0);
  const anyLimited = requests.some((r) => r.limited);
  return {
    files,
    skipped,
    requestsUsed,
    rateLimitNote: anyLimited ? "Raw host rate limit was hit; some files were not retrieved." : null,
  };
}

/** Validate a SHA-1 hex string (GitHub commit SHAs). */
export function isValidSha(sha: string | null | undefined): sha is string {
  return typeof sha === "string" && /^[0-9a-f]{40}$/i.test(sha);
}
