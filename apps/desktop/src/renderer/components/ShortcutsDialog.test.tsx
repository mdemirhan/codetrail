// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ShortcutsDialog } from "./ShortcutsDialog";

describe("ShortcutsDialog", () => {
  it("renders shortcut items and closes via button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <ShortcutsDialog shortcutItems={["Cmd/Ctrl+F: Search", "Esc: Close"]} onClose={onClose} />,
    );

    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Cmd/Ctrl+F: Search")).toBeInTheDocument();
    expect(screen.getByText("Esc: Close")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close shortcuts" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
