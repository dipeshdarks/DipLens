import { z } from "zod";

export type RepoRef = { owner: string; repo: string };

export const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
export const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

const ownerSchema = z
  .string()
  .regex(OWNER_RE, "Invalid GitHub owner name");

const repoSchema = z
  .string()
  .regex(REPO_RE, "Invalid GitHub repository name")
  .refine((r) => !r.startsWith(".") && !r.endsWith("."), {
    message: "Repository name cannot start or end with a dot",
  });

export const repoRefSchema = z.object({ owner: ownerSchema, repo: repoSchema });

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

function validateSegments(owner: string, repo: string): RepoRef | null {
  const cleaned = repo.replace(/\.git$/i, "");
  const parsed = repoRefSchema.safeParse({ owner, repo: cleaned });
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * Normalize user input (owner/repo or a github.com URL) into a RepoRef.
 * Returns null for anything that is not a valid public-repo identifier.
 */
export function parseRepo(input: string): RepoRef | null {
  const s = input.trim();
  if (!s) return null;

  if (/^https?:\/\//i.test(s)) {
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      return null;
    }
    if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null;
    let path = url.pathname;
    if (path.startsWith("/")) path = path.slice(1);
    if (path.endsWith("/")) path = path.slice(0, -1);
    const parts = path.split("/");
    if (parts.length !== 2 || parts.some((p) => p.length === 0)) return null;
    const decoded = parts.map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return null;
      }
    });
    if (decoded.some((p) => p === null)) return null;
    return validateSegments(decoded[0] as string, decoded[1] as string);
  }

  const parts = s.split("/");
  if (parts.length !== 2) return null;
  if (parts.some((p) => p.length === 0 || p === "." || p === "..")) return null;
  return validateSegments(parts[0] as string, parts[1] as string);
}

/** Encode owner/repo for safe use in an upstream API path. */
export function encodeRepoPath(owner: string, repo: string): string {
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/**
 * Validate a repository-relative file path for the file-viewer API.
 * Rejects traversal, absolute paths, control characters, and URL-structural chars.
 * Returns the normalized path or null.
 */
export function parseFilePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 500) return null;
  if (raw.startsWith("/") || raw.startsWith("\\")) return null;
  if (raw.includes("\\")) return null;
  const parts = raw.split("/");
  if (parts.length > 20) return null;
  for (const p of parts) {
    if (!p || p === "." || p === "..") return null;
    if (/[\x00-\x1f\x7f<>:"?#%\\]/.test(p)) return null;
  }
  return parts.join("/");
}
