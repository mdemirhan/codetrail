// @vitest-environment jsdom

import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithPaneFocus } from "../test/renderWithPaneFocus";
import { DeleteIndexedHistoryDialog } from "./DeleteIndexedHistoryDialog";

function installDialogMock(): void {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
      Object.defineProperty(this, "open", {
        configurable: true,
        writable: true,
        value: true,
      });
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
      Object.defineProperty(this, "open", {
        configurable: true,
        writable: true,
        value: false,
      });
      this.dispatchEvent(new Event("close"));
    },
  });
}

describe("DeleteIndexedHistoryDialog", () => {
  it("renders session-specific delete guidance and confirms", async () => {
    installDialogMock();
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    renderWithPaneFocus(
      <DeleteIndexedHistoryDialog
        open
        target={{
          kind: "session",
          provider: "claude",
          title: "Review session",
          path: "/workspace/project/session.jsonl",
          messageCount: 42,
        }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Delete Session From Code Trail?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "If the same JSONL transcript file only grows by appending new content, Code Trail will ingest only the new tail.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Session" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter while open instead of confirming or closing", () => {
    installDialogMock();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithPaneFocus(
      <DeleteIndexedHistoryDialog
        open
        target={{
          kind: "session",
          provider: "claude",
          title: "Review session",
          path: "/workspace/project/session.jsonl",
          messageCount: 42,
        }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const confirmButton = screen.getByRole("button", { name: "Delete Session" });
    confirmButton.focus();
    fireEvent.keyDown(confirmButton, { key: "Enter" });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText("Delete Session From Code Trail?")).toBeInTheDocument();
  });

  it("closes on Escape and backdrop click when idle", () => {
    installDialogMock();
    const onCancel = vi.fn();
    renderWithPaneFocus(
      <DeleteIndexedHistoryDialog
        open
        target={{
          kind: "project",
          provider: "gemini",
          title: "Gemini Project",
          path: "/workspace/gemini-project",
          sessionCount: 2,
          messageCount: 8,
        }}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("shows inline errors and blocks closing while busy", () => {
    installDialogMock();
    const onCancel = vi.fn();
    renderWithPaneFocus(
      <DeleteIndexedHistoryDialog
        open
        busy
        errorMessage="Delete failed because the transcript metadata is incomplete."
        target={{
          kind: "project",
          provider: "codex",
          title: "Codex Project",
          path: "/workspace/codex-project",
          sessionCount: 3,
          messageCount: 12,
        }}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Delete failed because the transcript metadata is incomplete.",
    );
    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
