"use client";
import { useState } from "react";
import { Check, Link2 } from "lucide-react";

export default function ShareReportButton() {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState("ok");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-md border border-line bg-elev px-3 py-2 text-sm transition duration-150 hover:border-info active:scale-[.98]"
      aria-live="polite"
    >
      {state === "ok" ? (
        <Check className="h-4 w-4 text-ok" data-testid="share-check" />
      ) : (
        <Link2 className="h-4 w-4" />
      )}
      {state === "ok" ? "Link copied" : state === "fail" ? "Copy failed" : "Share report"}
    </button>
  );
}
