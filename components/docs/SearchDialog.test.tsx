import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchDialog from "@/components/docs/SearchDialog";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog(onClose = vi.fn()) {
  render(<SearchDialog open onClose={onClose} />);
  return onClose;
}

describe("SearchDialog", () => {
  it("renders nothing when closed", () => {
    render(<SearchDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("prompts for at least two characters", () => {
    renderDialog();
    expect(screen.getByText(/type at least 2 characters/i)).toBeInTheDocument();
  });

  it("shows results for a matching query", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole("textbox"), "installation");
    expect(await screen.findByText("Installation", { selector: ".block" })).toBeInTheDocument();
  });

  it("shows a no-results state", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole("textbox"), "zzzznope");
    expect(await screen.findByText(/no results for/i)).toBeInTheDocument();
  });

  it("navigates with Enter on the first hit", async () => {
    const user = userEvent.setup();
    const onClose = renderDialog();
    await user.type(screen.getByRole("textbox"), "installation");
    await screen.findAllByRole("option");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/docs/installation");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = renderDialog();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
