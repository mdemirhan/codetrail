// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithPaneFocus } from "../test/renderWithPaneFocus";
import { TopBar } from "./TopBar";

describe("TopBar", () => {
  it("renders actions and forwards toolbar interactions", async () => {
    const user = userEvent.setup();
    const onToggleSearchView = vi.fn();
    const onThemeChange = vi.fn();
    const onThemePreview = vi.fn();
    const onThemePreviewReset = vi.fn();
    const onShikiThemeChange = vi.fn();
    const onShikiThemePreview = vi.fn();
    const onShikiThemePreviewReset = vi.fn();
    const onToggleDashboard = vi.fn();
    const onIncrementalRefresh = vi.fn();
    const onToggleFocus = vi.fn();
    const onToggleHelp = vi.fn();
    const onToggleSettings = vi.fn();

    const { container } = renderWithPaneFocus(
      <TopBar
        mainView="history"
        theme="light"
        shikiTheme="github-light-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleDashboard={onToggleDashboard}
        onToggleSearchView={onToggleSearchView}
        onThemeChange={onThemeChange}
        onThemePreview={onThemePreview}
        onThemePreviewReset={onThemePreviewReset}
        onShikiThemeChange={onShikiThemeChange}
        onShikiThemePreview={onShikiThemePreview}
        onShikiThemePreviewReset={onShikiThemePreviewReset}
        onIncrementalRefresh={onIncrementalRefresh}
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

    expect(screen.getByText("Code Trail")).toBeInTheDocument();
    expect(container.querySelector(".app-title-suffix")).toBeNull();
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute(
      "title",
      "Toggle Search  ⌘⇧F",
    );
    expect(screen.getByRole("button", { name: "Enter focus mode" })).toHaveAttribute(
      "title",
      "Toggle Focus mode",
    );
    expect(screen.getByRole("button", { name: "Open settings" })).toHaveAttribute(
      "title",
      "Toggle Settings  ⌘,",
    );

    await user.click(screen.getByRole("button", { name: "Open dashboard" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(screen.getByRole("button", { name: "Incremental refresh" }));
    await user.click(screen.getByRole("button", { name: "Enter focus mode" }));
    await user.click(screen.getByRole("button", { name: "Open help" }));
    await user.click(screen.getByRole("button", { name: "Choose theme" }));
    await user.click(screen.getByRole("button", { name: "Tomorrow Night" }));
    await user.click(screen.getByRole("button", { name: "Choose text viewer theme" }));
    expect(screen.getByRole("button", { name: "Light Plus" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Night Owl" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Light Plus" }));
    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(onToggleDashboard).toHaveBeenCalledTimes(1);
    expect(onToggleSearchView).toHaveBeenCalledTimes(1);
    expect(onIncrementalRefresh).toHaveBeenCalledTimes(1);
    expect(onToggleFocus).toHaveBeenCalledTimes(1);
    expect(onToggleHelp).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("tomorrow-night");
    expect(onShikiThemeChange).toHaveBeenCalledWith("light-plus");
    expect(onToggleSettings).toHaveBeenCalledTimes(1);
  });

  it("previews and restores the regular theme on hover without committing", async () => {
    const user = userEvent.setup();
    const onThemeChange = vi.fn();
    const onThemePreview = vi.fn();
    const onThemePreviewReset = vi.fn();

    renderWithPaneFocus(
      <TopBar
        mainView="history"
        theme="light"
        shikiTheme="github-light-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleDashboard={vi.fn()}
        onToggleSearchView={vi.fn()}
        onThemeChange={onThemeChange}
        onThemePreview={onThemePreview}
        onThemePreviewReset={onThemePreviewReset}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={vi.fn()}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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

    await user.click(screen.getByRole("button", { name: "Choose theme" }));
    await user.hover(screen.getByRole("button", { name: "Tomorrow Night" }));

    expect(onThemePreview).toHaveBeenCalledWith("tomorrow-night");
    expect(onThemeChange).not.toHaveBeenCalled();

    fireEvent.mouseLeave(screen.getByLabelText("Theme"));

    expect(onThemePreviewReset).toHaveBeenCalledTimes(1);
    expect(onThemeChange).not.toHaveBeenCalled();
  });

  it("previews and restores the text viewer theme on hover without committing", async () => {
    const user = userEvent.setup();
    const onShikiThemeChange = vi.fn();
    const onShikiThemePreview = vi.fn();
    const onShikiThemePreviewReset = vi.fn();

    renderWithPaneFocus(
      <TopBar
        mainView="history"
        theme="light"
        shikiTheme="github-light-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleDashboard={vi.fn()}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={vi.fn()}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={onShikiThemeChange}
        onShikiThemePreview={onShikiThemePreview}
        onShikiThemePreviewReset={onShikiThemePreviewReset}
        onIncrementalRefresh={vi.fn()}
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

    await user.click(screen.getByRole("button", { name: "Choose text viewer theme" }));
    await user.hover(screen.getByRole("button", { name: "Light Plus" }));

    expect(onShikiThemePreview).toHaveBeenCalledWith("light-plus");
    expect(onShikiThemeChange).not.toHaveBeenCalled();

    fireEvent.mouseLeave(screen.getByLabelText("Text viewer theme"));

    expect(onShikiThemePreviewReset).toHaveBeenCalledTimes(1);
    expect(onShikiThemeChange).not.toHaveBeenCalled();
  });

  it("supports arrow-key navigation and escape for the regular theme menu", async () => {
    const user = userEvent.setup();
    const onThemePreview = vi.fn();
    const onThemePreviewReset = vi.fn();

    renderWithPaneFocus(
      <TopBar
        mainView="history"
        theme="light"
        shikiTheme="github-light-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleDashboard={vi.fn()}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={onThemePreview}
        onThemePreviewReset={onThemePreviewReset}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={vi.fn()}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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

    const trigger = screen.getByRole("button", { name: "Choose theme" });
    await user.click(trigger);

    const lightButton = screen.getByRole("button", { name: /Light/, pressed: true });
    await waitFor(() => expect(lightButton).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Clean White" })).toHaveFocus());
    expect(onThemePreview).toHaveBeenCalledWith("clean-white");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByLabelText("Theme")).not.toBeInTheDocument();
    expect(onThemePreviewReset).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the regular theme trigger when the menu closes with Tab", async () => {
    const user = userEvent.setup();

    renderWithPaneFocus(
      <TopBar
        mainView="history"
        theme="light"
        shikiTheme="github-light-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleDashboard={vi.fn()}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={vi.fn()}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={vi.fn()}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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

    const trigger = screen.getByRole("button", { name: "Choose theme" });
    await user.click(trigger);

    const selectedButton = screen.getByRole("button", { name: /Light/, pressed: true });
    await waitFor(() => expect(selectedButton).toHaveFocus());

    await user.keyboard("{Tab}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByLabelText("Theme")).not.toBeInTheDocument();
  });

  it("continues regular theme keyboard navigation from the hovered item", async () => {
    const user = userEvent.setup();
    const onThemePreview = vi.fn();

    renderWithPaneFocus(
      <TopBar
        mainView="history"
        theme="light"
        shikiTheme="github-light-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={onThemePreview}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={vi.fn()}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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

    await user.click(screen.getByRole("button", { name: "Choose theme" }));
    await user.hover(screen.getByRole("button", { name: "Clean White" }));

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Warm Paper" })).toHaveFocus());
    expect(onThemePreview).toHaveBeenLastCalledWith("warm-paper");
  });

  it("ignores passive mouse-enter events after keyboard navigation takes over in the theme menu", async () => {
    const user = userEvent.setup();
    const onThemePreview = vi.fn();

    renderWithPaneFocus(
      <TopBar
        mainView="history"
        theme="light"
        shikiTheme="github-light-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={onThemePreview}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={vi.fn()}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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

    await user.click(screen.getByRole("button", { name: "Choose theme" }));
    await user.hover(screen.getByRole("button", { name: "Clean White" }));
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Warm Paper" })).toHaveFocus());

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Sand" }));
    await user.keyboard("{ArrowDown}");

    await waitFor(() => expect(screen.getByRole("button", { name: "Stone" })).toHaveFocus());
    expect(onThemePreview).toHaveBeenLastCalledWith("stone");
  });

  it("supports arrow-key navigation and escape for the text viewer theme menu", async () => {
    const user = userEvent.setup();
    const onShikiThemePreview = vi.fn();
    const onShikiThemePreviewReset = vi.fn();

    renderWithPaneFocus(
      <TopBar
        mainView="history"
        theme="light"
        shikiTheme="github-light-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={vi.fn()}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={onShikiThemePreview}
        onShikiThemePreviewReset={onShikiThemePreviewReset}
        onIncrementalRefresh={vi.fn()}
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

    const trigger = screen.getByRole("button", { name: "Choose text viewer theme" });
    await user.click(trigger);

    const selectedButton = screen.getByRole("button", {
      name: /GitHub Light Default/,
      pressed: true,
    });
    await waitFor(() => expect(selectedButton).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "GitHub Light High Contrast" })).toHaveFocus(),
    );
    expect(onShikiThemePreview).toHaveBeenCalledWith("github-light-high-contrast");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByLabelText("Text viewer theme")).not.toBeInTheDocument();
    expect(onShikiThemePreviewReset).toHaveBeenCalledTimes(1);
  });

  it("continues text viewer theme keyboard navigation from the hovered item", async () => {
    const user = userEvent.setup();
    const onShikiThemePreview = vi.fn();

    renderWithPaneFocus(
      <TopBar
        mainView="history"
        theme="light"
        shikiTheme="github-light-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={vi.fn()}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={onShikiThemePreview}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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

    await user.click(screen.getByRole("button", { name: "Choose text viewer theme" }));
    await user.hover(screen.getByRole("button", { name: "Light Plus" }));

    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Material Theme Lighter" })).toHaveFocus(),
    );
    expect(onShikiThemePreview).toHaveBeenLastCalledWith("material-theme-lighter");
  });

  it("ignores passive mouse-enter events after keyboard navigation takes over in the text viewer theme menu", async () => {
    const user = userEvent.setup();
    const onShikiThemePreview = vi.fn();

    renderWithPaneFocus(
      <TopBar
        mainView="history"
        theme="light"
        shikiTheme="github-light-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={vi.fn()}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={onShikiThemePreview}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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

    await user.click(screen.getByRole("button", { name: "Choose text viewer theme" }));
    await user.hover(screen.getByRole("button", { name: "Light Plus" }));
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Material Theme Lighter" })).toHaveFocus(),
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Vitesse Light" }));
    await user.keyboard("{ArrowDown}");

    await waitFor(() => expect(screen.getByRole("button", { name: "Min Light" })).toHaveFocus());
    expect(onShikiThemePreview).toHaveBeenLastCalledWith("min-light");
  });

  it("reflects disabled and active states", () => {
    renderWithPaneFocus(
      <TopBar
        mainView="search"
        theme="dark"
        shikiTheme="github-dark-default"
        indexing={true}
        focusMode={true}
        focusDisabled={true}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={vi.fn()}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={vi.fn()}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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

    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute(
      "title",
      "Toggle Search  ⌘⇧F",
    );
    expect(screen.getByRole("button", { name: "Exit focus mode" })).toHaveAttribute(
      "title",
      "Toggle Focus mode",
    );
    expect(screen.getByRole("button", { name: "Indexing in progress" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Exit focus mode" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose text viewer theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open settings" })).toHaveAttribute(
      "title",
      "Toggle Settings  ⌘,",
    );
  });

  it("shows contextual toolbar title suffixes for search, settings, and help", () => {
    const { container, rerender } = renderWithPaneFocus(
      <TopBar
        mainView="search"
        theme="dark"
        shikiTheme="github-dark-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={vi.fn()}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={vi.fn()}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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

    expect(screen.getByText("Code Trail")).toBeInTheDocument();
    expect(container.querySelector(".app-title-suffix-search")?.textContent).toBe("Search");

    rerender(
      <TopBar
        mainView="settings"
        theme="dark"
        shikiTheme="github-dark-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={vi.fn()}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={vi.fn()}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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

    expect(container.querySelector(".app-title-suffix-settings")?.textContent).toBe("Settings");

    rerender(
      <TopBar
        mainView="help"
        theme="dark"
        shikiTheme="github-dark-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={vi.fn()}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={vi.fn()}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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

    expect(container.querySelector(".app-title-suffix-help")?.textContent).toBe("Help");
  });

  it("shows the mixed watch and scan auto-refresh options", async () => {
    const user = userEvent.setup();

    renderWithPaneFocus(
      <TopBar
        mainView="history"
        theme="light"
        shikiTheme="github-light-default"
        indexing={false}
        focusMode={false}
        focusDisabled={false}
        onToggleSearchView={vi.fn()}
        onThemeChange={vi.fn()}
        onThemePreview={vi.fn()}
        onThemePreviewReset={vi.fn()}
        onShikiThemeChange={vi.fn()}
        onShikiThemePreview={vi.fn()}
        onShikiThemePreviewReset={vi.fn()}
        onIncrementalRefresh={vi.fn()}
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
