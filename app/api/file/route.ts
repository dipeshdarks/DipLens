import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseFilePath, parseRepo } from "@/lib/validation";
import { getFileContent } from "@/lib/github/endpoints";
import { GitHubError } from "@/lib/github";

export const dynamic = "force-dynamic";

const MAX_VIEW_BYTES = 262_144;

const querySchema = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(140),
  path: z.string().min(1).max(500),
  ref: z.string().min(1).max(255),
});

/**
 * GET /api/file?owner=&repo=&path=&ref=
 * Returns a text file from a public repository, size-capped and path-validated.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    owner: sp.get("owner") ?? "",
    repo: sp.get("repo") ?? "",
    path: sp.get("path") ?? "",
    ref: sp.get("ref") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", message: "owner, repo, path and ref query parameters are required." },
      { status: 400 },
    );
  }
  const { owner, repo, path, ref } = parsed.data;
  if (!parseRepo(`${owner}/${repo}`)) {
    return NextResponse.json({ error: "invalid", message: "Invalid repository identifier." }, { status: 400 });
  }
  const safePath = parseFilePath(path);
  if (!safePath) {
    return NextResponse.json({ error: "invalid", message: "Invalid file path." }, { status: 400 });
  }

  try {
    const r = await getFileContent(owner, repo, safePath, ref, MAX_VIEW_BYTES);
    if (r.ok) {
      return NextResponse.json({
        path: safePath,
        content: r.content,
        size: r.size,
        truncated: r.truncated,
        lines: r.content.split("\n").length,
      });
    }
    if (r.reason === "too-large") {
      return NextResponse.json(
        { error: "too-large", message: `File exceeds the ${MAX_VIEW_BYTES / 1024} KB viewer limit.` },
        { status: 413 },
      );
    }
    if (r.reason === "binary") {
      return NextResponse.json(
        { error: "binary", message: "Binary files cannot be displayed in the text viewer." },
        { status: 415 },
      );
    }
    if (r.error?.kind === "not_found") {
      return NextResponse.json({ error: "not-found", message: "File not found." }, { status: 404 });
    }
    if (r.error?.kind === "rate_limited") {
      return NextResponse.json({ error: "rate-limited", message: r.error.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: "upstream", message: r.error?.message ?? "Upstream fetch failed." },
      { status: 502 },
    );
  } catch (e) {
    if (e instanceof GitHubError) {
      const status = e.kind === "timeout" ? 504 : e.kind === "rate_limited" ? 429 : 502;
      return NextResponse.json({ error: e.kind, message: e.message }, { status });
    }
    return NextResponse.json({ error: "internal", message: "Unexpected error." }, { status: 500 });
  }
}
