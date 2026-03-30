// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithPaneFocus } from "../../test/renderWithPaneFocus";
import { HistoryListContextMenu } from "./HistoryListContextMenu";

describe("HistoryListContextMenu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clamps its position to the viewport after measuring the menu", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });

    const { rerender } = renderWithPaneFocus(
      <HistoryListContextMenu
        open
        x={390}
        y={290}
        onClose={vi.fn()}
        groups={[
          [
            {
              id: "copy",
              label: "Copy",
              icon: "copy",
              onSelect: vi.fn(),
            },
          ],
        ]}
      />,
    );

    const menu = screen.getByRole("menu");
    Object.defineProperty(menu, "offsetWidth", { configurable: true, value: 120 });
    Object.defineProperty(menu, "offsetHeight", { configurable: true, value: 80 });

    rerender(
      <HistoryListContextMenu
        open
        x={389}
        y={289}
        onClose={vi.fn()}
        groups={[
          [
            {
              id: "copy",
              label: "Copy",
              icon: "copy",
              onSelect: vi.fn(),
            },
          ],
        ]}
      />,
    );

    await waitFor(() => {
      expect(menu).toHaveStyle({ left: "272px", top: "212px" });
    });
  });

  it("closes on Escape and viewport scroll", () => {
    const onClose = vi.fn();

    renderWithPaneFocus(
      <HistoryListContextMenu
        open
        x={40}
        y={24}
        onClose={onClose}
        groups={[
          [
            {
              id: "copy",
              label: "Copy",
              icon: "copy",
              onSelect: vi.fn(),
            },
          ],
        ]}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("dispatches the item action and then closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    renderWithPaneFocus(
      <HistoryListContextMenu
        open
        x={24}
        y={24}
        onClose={onClose}
        groups={[
          [
            {
              id: "delete",
              label: "Delete",
              icon: "trash",
              tone: "danger",
              onSelect,
            },
          ],
        ]}
      />,
    );

    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
