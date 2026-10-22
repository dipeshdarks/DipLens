"use client";
import { useRef, useState, type DragEvent } from "react";
import { IMPORT_MAX_BYTES } from "@/lib/diplens/schemas";

function readFileAsText(file: File): Promise<string> {
  // FileReader instead of File.text(): jsdom (vitest) does not implement Blob.text().
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.readAsText(file);
  });
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Shared JSON file import control for the Evaluation Lab and future imports.
 * Enforces the 2 MB import cap before reading; import-kind errors
 * (invalid / unsupported) are owned by the parent and shown via `error`.
 */
export default function ImportDropzone({
  id,
  label,
  hint,
  error,
  onFile,
  testId,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  onFile: (file: File, text: string) => void;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const message = error ?? localError;

  async function handleFile(file: File | undefined | null) {
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      setLocalError(
        `"${file.name}" is ${formatBytes(file.size)} — the import cap is ${formatBytes(IMPORT_MAX_BYTES)}`
      );
      return;
    }
    setLocalError(null);
    let text: string;
    try {
      text = await readFileAsText(file);
    } catch {
      setLocalError(`could not read "${file.name}"`);
      return;
    }
    onFile(file, text);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    void handleFile(file);
  }

  return (
    <div data-testid={testId}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-lg border border-dashed p-5 text-center transition-colors ${
          dragging ? "border-info bg-elev" : "border-line"
        }`}
      >
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept=".json,application/json"
            className="mt-2 block w-full text-xs text-mute file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-elev file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink hover:file:border-info"
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {hint && <p className="text-xs text-mute">{hint}</p>}
        <p className="text-xs text-mute">
          or drop a file here — JSON only, up to {formatBytes(IMPORT_MAX_BYTES)}
        </p>
      </div>
      <div aria-live="polite" role={message ? "alert" : undefined} className="mt-2">
        {message && <p className="text-xs text-warn">{message}</p>}
      </div>
    </div>
  );
}
