import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RepoSearch from "@/components/RepoSearch";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockClear();
});

describe("RepoSearch", () => {
  it("navigates on Enter with valid owner/repo", async () => {
    const user = userEvent.setup();
    render(<RepoSearch />);
    const input = screen.getByPlaceholderText(/owner\/repo/i);
    await user.type(input, "vercel/next.js{Enter}");
    expect(push).toHaveBeenCalledWith("/repo/vercel/next.js");
  });

  it("navigates on valid GitHub URL", async () => {
    const user = userEvent.setup();
    render(<RepoSearch />);
    await user.type(
      screen.getByPlaceholderText(/owner\/repo/i),
      "https://github.com/vercel/next.js/{Enter}",
    );
    expect(push).toHaveBeenCalledWith("/repo/vercel/next.js");
  });

  it("shows an error and does not navigate on invalid input", async () => {
    const user = userEvent.setup();
    render(<RepoSearch />);
    await user.type(screen.getByPlaceholderText(/owner\/repo/i), "not-a-repo{Enter}");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/owner\/repo/i);
  });

  it("navigates when the example button is clicked", async () => {
    const user = userEvent.setup();
    render(<RepoSearch />);
    await user.click(screen.getByRole("button", { name: /vercel\/next\.js/i }));
    expect(push).toHaveBeenCalledWith("/repo/vercel/next.js");
  });
});
