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
    const onToggleHelp = vi.fn();
    const onToggleSettings = vi.fn();

    render(
      <TopBar
        mainView="history"
        theme="light"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={onToggleSearchView}
        onThemeChange={onThemeChange}
        onIncrementalRefresh={onIncrementalRefresh}
        onForceRefresh={onForceRefresh}
        refreshStrategy="off"
        onRefreshStrategyChange={vi.fn()}
        autoRefreshStatusLabel={null}
        autoRefreshStatusTone={null}
        autoRefreshStatusTooltip={null}
        onToggleFocus={onToggleFocus}
        onToggleHelp={onToggleHelp}
        onToggleSettings={onToggleSettings}
      />,
    );

    expect(screen.getByRole("button", { name: "Global Search" })).toHaveAttribute(
      "title",
      "Open global search (Cmd/Ctrl+Shift+F)",
    );
    expect(screen.getByRole("button", { name: "Enter focus mode" })).toHaveAttribute(
      "title",
      "Enter focus mode (Cmd/Ctrl+Shift+M)",
    );

    await user.click(screen.getByRole("button", { name: "Global Search" }));
    await user.click(screen.getByRole("button", { name: "Incremental refresh" }));
    await user.click(screen.getByRole("button", { name: "Force reindex" }));
    await user.click(screen.getByRole("button", { name: "Enter focus mode" }));
    await user.click(screen.getByRole("button", { name: "Open help" }));
    await user.click(screen.getByRole("button", { name: "Choose theme" }));
    await user.click(screen.getByRole("button", { name: "Tomorrow Night" }));
    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(onToggleSearchView).toHaveBeenCalledTimes(1);
    expect(onIncrementalRefresh).toHaveBeenCalledTimes(1);
    expect(onForceRefresh).toHaveBeenCalledTimes(1);
    expect(onToggleFocus).toHaveBeenCalledTimes(1);
    expect(onToggleHelp).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("tomorrow-night");
    expect(onToggleSettings).toHaveBeenCalledTimes(1);
  });

  it("reflects disabled and active states", () => {
    render(
      <TopBar
        mainView="search"
        theme="dark"
        indexing={true}
        focusMode={true}
        focusDisabled={true}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onIncrementalRefresh={vi.fn()}
        onForceRefresh={vi.fn()}
        refreshStrategy="off"
        onRefreshStrategyChange={vi.fn()}
        autoRefreshStatusLabel={null}
        autoRefreshStatusTone={null}
        autoRefreshStatusTooltip={null}
        onToggleFocus={vi.fn()}
        onToggleHelp={vi.fn()}
        onToggleSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Global Search" })).toHaveAttribute(
      "title",
      "Return to history view (Esc)",
    );
    expect(screen.getByRole("button", { name: "Exit focus mode" })).toHaveAttribute(
      "title",
      "Exit focus mode (Cmd/Ctrl+Shift+M)",
    );
    expect(screen.getByRole("button", { name: "Indexing in progress" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Force reindex" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Exit focus mode" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
  });

  it("shows the mixed watch and scan auto-refresh options", async () => {
    const user = userEvent.setup();

    render(
      <TopBar
        mainView="history"
        theme="light"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onIncrementalRefresh={vi.fn()}
        onForceRefresh={vi.fn()}
        refreshStrategy="watch-5s"
        onRefreshStrategyChange={vi.fn()}
        autoRefreshStatusLabel="3"
        autoRefreshStatusTone="queued"
        autoRefreshStatusTooltip="Number of changed files currently queued by the watcher before auto-refresh runs."
        onToggleFocus={vi.fn()}
        onToggleHelp={vi.fn()}
        onToggleSettings={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));

    expect(screen.getByRole("button", { name: "Watch (1s debounce)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Watch (3s debounce)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Watch (5s debounce)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5s scan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10s scan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30s scan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 min scan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5 min scan" })).toBeInTheDocument();
    expect(screen.getByText("3")).toHaveAttribute(
      "title",
      "Number of changed files currently queued by the watcher before auto-refresh runs.",
    );
  });
});
