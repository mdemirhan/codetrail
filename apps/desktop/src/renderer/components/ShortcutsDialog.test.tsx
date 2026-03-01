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
      <ShortcutsDialog
        shortcutItems={[
          { shortcut: "Cmd/Ctrl+F", description: "Search messages" },
          { shortcut: "Esc", description: "Close shortcuts" },
        ]}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Shortcut" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Description" })).toBeInTheDocument();
    expect(screen.getByText("Cmd/Ctrl+F")).toBeInTheDocument();
    expect(screen.getByText("Search messages")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
    expect(screen.getByText("Close shortcuts")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close shortcuts" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
