import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ThemeToggle from "@/components/docs/ThemeToggle";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("light");
  localStorage.clear();
});

beforeEach(() => {
  document.documentElement.classList.remove("light");
  localStorage.clear();
});

describe("ThemeToggle", () => {
  it("toggles the light class on <html> and persists the choice", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: /switch to light theme/i });
    await user.click(btn);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(localStorage.getItem("diplens-theme")).toBe("light");
  });

  it("toggles back to dark and clears storage", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: /switch to light theme/i });
    await user.click(btn);
    const back = screen.getByRole("button", { name: /switch to dark theme/i });
    await user.click(back);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(localStorage.getItem("diplens-theme")).toBeNull();
  });

  it("reflects an already-light document on mount", () => {
    document.documentElement.classList.add("light");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /switch to dark theme/i })).toBeInTheDocument();
  });
});
