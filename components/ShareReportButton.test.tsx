import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShareReportButton from "@/components/ShareReportButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ShareReportButton", () => {
  it("shows success feedback after copying", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(<ShareReportButton />);
    await user.click(screen.getByRole("button", { name: /share report/i }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByRole("button", { name: /link copied/i })).toBeInTheDocument();
  });

  it("shows failure feedback when the clipboard rejects", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<ShareReportButton />);
    await user.click(screen.getByRole("button", { name: /share report/i }));
    expect(await screen.findByRole("button", { name: /copy failed/i })).toBeInTheDocument();
  });
});
