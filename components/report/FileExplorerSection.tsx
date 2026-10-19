"use client";

import { useMemo, useState } from "react";
import { File, FolderOpen, Loader2, Search } from "lucide-react";
import { Empty, Panel } from "@/components/ui";

type FileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; content: string; lines: number; truncated: boolean }
  | { status: "error"; message: string };

const EXT_NOTE = "Supported: text files up to 256 KB. Binary and larger files are refused by the API.";

export default function FileExplorerSection({
  owner,
  repo,
  defaultBranch,
  paths,
  inspected,
}: {
  owner: string;
  repo: string;
  defaultBranch: string;
  paths: string[];
  inspected: string[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [fileState, setFileState] = useState<FileState>({ status: "idle" });

  const inspectedSet = useMemo(() => new Set(inspected), [inspected]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? paths.filter((p) => p.toLowerCase().includes(q)) : paths;
    return list.slice(0, 200);
  }, [paths, query]);

  async function openFile(path: string) {
    if (path.endsWith("/")) return;
    setSelected(path);
    setFileState({ status: "loading" });
    try {
      const qs = new URLSearchParams({ owner, repo, path, ref: defaultBranch });
      const res = await fetch(`/api/file?${qs.toString()}`);
      const body = (await res.json().catch(() => ({}))) as {
        content?: string;
        lines?: number;
        truncated?: boolean;
        message?: string;
      };
      if (res.status === 413 || res.status === 415) {
        setFileState({ status: "error", message: body.message ?? EXT_NOTE });
        return;
      }
      if (!res.ok) {
        setFileState({
          status: "error",
          message: body.message ?? `Could not load file (HTTP ${res.status}).`,
        });
        return;
      }
      setFileState({
        status: "ready",
        content: body.content ?? "",
        lines: body.lines ?? 0,
        truncated: Boolean(body.truncated),
      });
    } catch {
      setFileState({ status: "error", message: "Network error while loading the file." });
    }
  }

  return (
    <div className="space-y-4">
      <Panel
        title="File explorer"
        subtitle="Browse the paths discovered during analysis. Files are fetched on demand through RepoLens — the browser never talks to GitHub directly."
      >
        <label className="mb-3 flex items-center gap-2 rounded-md border border-line bg-elev px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-mute" aria-hidden />
          <span className="sr-only">Filter paths</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter paths…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-mute"
            data-testid="file-filter"
          />
        </label>

        {filtered.length ? (
          <ul className="max-h-[28rem] overflow-y-auto rounded-md border border-line" data-testid="file-list">
            {filtered.map((p) => {
              const isDir = p.endsWith("/");
              return (
                <li key={p} className="border-b border-line last:border-0">
                  <button
                    type="button"
                    onClick={() => openFile(p)}
                    disabled={isDir}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition duration-150 ${
                      selected === p ? "bg-elev text-ink" : "text-mute hover:text-ink"
                    } ${isDir ? "cursor-default opacity-70" : ""}`}
                    data-testid={`file-${p}`}
                  >
                    {isDir ? (
                      <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    ) : (
                      <File className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    <span className="truncate">{p}</span>
                    {inspectedSet.has(p) && (
                      <span className="ml-auto shrink-0 rounded-full border border-ok/40 px-1.5 text-[10px] text-ok">
                        inspected
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No paths match “{query}”.</Empty>
        )}
        <p className="mt-3 text-xs text-mute">{EXT_NOTE}</p>
      </Panel>

      <Panel
        title={selected ?? "File contents"}
        subtitle={selected ? `refs/heads/${defaultBranch} · ${selected}` : "Select a file to view its contents."}
      >
        {fileState.status === "idle" && <Empty>Select a file from the list above.</Empty>}
        {fileState.status === "loading" && (
          <p className="flex items-center gap-2 text-sm text-mute">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
          </p>
        )}
        {fileState.status === "error" && (
          <p className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn" role="alert">
            {fileState.message}
          </p>
        )}
        {fileState.status === "ready" && (
          <>
            {fileState.truncated && (
              <p className="mb-2 text-xs text-warn">File was truncated to the viewer size limit.</p>
            )}
            <pre
              className="max-h-[32rem] overflow-auto rounded-md border border-line bg-elev p-3 font-mono text-xs leading-5"
              data-testid="file-content"
            >
              {fileState.content.split("\n").map((line, i) => (
                <div key={i} className="flex">
                  <span className="mr-4 w-10 shrink-0 select-none text-right text-mute/60">{i + 1}</span>
                  <span className="whitespace-pre-wrap break-all">{line || " "}</span>
                </div>
              ))}
            </pre>
            <p className="mt-2 text-xs text-mute">{fileState.lines} line(s) · untrusted content rendered as plain text</p>
          </>
        )}
      </Panel>
    </div>
  );
}
