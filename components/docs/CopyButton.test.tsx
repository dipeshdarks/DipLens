import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CopyButton from "@/components/docs/CopyButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CopyButton", () => {
  it("copies the provided text and shows success feedback", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(<CopyButton getText={() => "npm install"} />);
    await user.click(screen.getByRole("button", { name: /copy code/i }));
    expect(writeText).toHaveBeenCalledWith("npm install");
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });

  it("reads the text lazily at click time", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    let value = "first";
    render(<CopyButton getText={() => value} />);
    value = "second";
    await user.click(screen.getByRole("button", { name: /copy code/i }));
    expect(writeText).toHaveBeenCalledWith("second");
  });

  it("falls back to execCommand when the clipboard API rejects", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    // jsdom does not implement execCommand; define it so the fallback can be observed.
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    render(<CopyButton getText={() => "fallback"} />);
    await user.click(screen.getByRole("button", { name: /copy code/i }));
    expect(exec).toHaveBeenCalledWith("copy");
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });
});
