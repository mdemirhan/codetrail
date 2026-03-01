// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TopBar } from "./TopBar";

describe("TopBar", () => {
  it("renders actions and forwards toolbar interactions", async () => {
    const user = userEvent.setup();
    const onToggleSearchView = vi.fn();
    const onThemeChange = vi.fn();
    const onIncrementalRefresh = vi.fn();
    const onForceRefresh = vi.fn();
    const onToggleFocus = vi.fn();
    const onToggleShortcuts = vi.fn();
    const onToggleSettings = vi.fn();

    render(
      <TopBar
        mainView="history"
        theme="light"
        refreshing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={onToggleSearchView}
        onThemeChange={onThemeChange}
        onIncrementalRefresh={onIncrementalRefresh}
        onForceRefresh={onForceRefresh}
        onToggleFocus={onToggleFocus}
        onToggleShortcuts={onToggleShortcuts}
        onToggleSettings={onToggleSettings}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Global Search" }));
    await user.click(screen.getByRole("button", { name: "Refresh index" }));
    await user.click(screen.getByRole("button", { name: "Force reindex" }));
    await user.click(screen.getByRole("button", { name: "Enter focus mode" }));
    await user.click(screen.getByRole("button", { name: "Show keyboard shortcuts" }));
    await user.click(screen.getByRole("button", { name: "Switch to Dark theme" }));
    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(onToggleSearchView).toHaveBeenCalledTimes(1);
    expect(onIncrementalRefresh).toHaveBeenCalledTimes(1);
    expect(onForceRefresh).toHaveBeenCalledTimes(1);
    expect(onToggleFocus).toHaveBeenCalledTimes(1);
    expect(onToggleShortcuts).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("dark");
    expect(onToggleSettings).toHaveBeenCalledTimes(1);
  });

  it("reflects disabled and active states", () => {
    render(
      <TopBar
        mainView="search"
        theme="dark"
        refreshing={true}
        focusMode={true}
        focusDisabled={true}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onIncrementalRefresh={vi.fn()}
        onForceRefresh={vi.fn()}
        onToggleFocus={vi.fn()}
        onToggleShortcuts={vi.fn()}
        onToggleSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Refreshing index" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Force reindex" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Exit focus mode" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Switch to Light theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
  });
});
