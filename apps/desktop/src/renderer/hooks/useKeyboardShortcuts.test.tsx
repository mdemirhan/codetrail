// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

function Harness(args: Parameters<typeof useKeyboardShortcuts>[0]) {
  useKeyboardShortcuts(args);
  return <div>shortcuts</div>;
}

describe("useKeyboardShortcuts", () => {
  it("routes global/session search shortcuts and zoom actions", () => {
    const setMainView = vi.fn();
    const setShowShortcuts = vi.fn();
    const focusGlobalSearch = vi.fn();
    const focusSessionSearch = vi.fn();
    const applyZoomAction = vi.fn(async () => undefined);
    const handleForceRefresh = vi.fn(async () => undefined);
    const handleIncrementalRefresh = vi.fn(async () => undefined);

    render(
      <Harness
        mainView="history"
        showShortcuts={false}
        hasFocusedHistoryMessage={false}
        setMainView={setMainView}
        setShowShortcuts={setShowShortcuts}
        clearFocusedHistoryMessage={vi.fn()}
        focusGlobalSearch={focusGlobalSearch}
        focusSessionSearch={focusSessionSearch}
        applyZoomAction={applyZoomAction}
        handleForceRefresh={handleForceRefresh}
        handleIncrementalRefresh={handleIncrementalRefresh}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", metaKey: true, shiftKey: true }));

    expect(focusGlobalSearch).toHaveBeenCalledTimes(1);
    expect(focusSessionSearch).toHaveBeenCalledTimes(1);
    expect(applyZoomAction).toHaveBeenCalledWith("in");
    expect(handleForceRefresh).toHaveBeenCalledTimes(1);
    expect(setMainView).not.toHaveBeenCalledWith("history");
    expect(setShowShortcuts).not.toHaveBeenCalledWith(false);
  });

  it("handles escape and shortcut-help interactions", () => {
    const setMainView = vi.fn();
    const setShowShortcuts = vi.fn();

    const { rerender } = render(
      <Harness
        mainView="search"
        showShortcuts={false}
        hasFocusedHistoryMessage={false}
        setMainView={setMainView}
        setShowShortcuts={setShowShortcuts}
        clearFocusedHistoryMessage={vi.fn()}
        focusGlobalSearch={vi.fn()}
        focusSessionSearch={vi.fn()}
        applyZoomAction={vi.fn(async () => undefined)}
        handleForceRefresh={vi.fn(async () => undefined)}
        handleIncrementalRefresh={vi.fn(async () => undefined)}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(setMainView).toHaveBeenCalledWith("history");

    rerender(
      <Harness
        mainView="history"
        showShortcuts={true}
        hasFocusedHistoryMessage={false}
        setMainView={setMainView}
        setShowShortcuts={setShowShortcuts}
        clearFocusedHistoryMessage={vi.fn()}
        focusGlobalSearch={vi.fn()}
        focusSessionSearch={vi.fn()}
        applyZoomAction={vi.fn(async () => undefined)}
        handleForceRefresh={vi.fn(async () => undefined)}
        handleIncrementalRefresh={vi.fn(async () => undefined)}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));

    expect(setShowShortcuts).toHaveBeenCalledWith(false);
    expect(setShowShortcuts).toHaveBeenCalledWith(true);
  });

  it("clears focused history message on escape", () => {
    const clearFocusedHistoryMessage = vi.fn();

    render(
      <Harness
        mainView="history"
        showShortcuts={false}
        hasFocusedHistoryMessage={true}
        setMainView={vi.fn()}
        setShowShortcuts={vi.fn()}
        clearFocusedHistoryMessage={clearFocusedHistoryMessage}
        focusGlobalSearch={vi.fn()}
        focusSessionSearch={vi.fn()}
        applyZoomAction={vi.fn(async () => undefined)}
        handleForceRefresh={vi.fn(async () => undefined)}
        handleIncrementalRefresh={vi.fn(async () => undefined)}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(clearFocusedHistoryMessage).toHaveBeenCalledTimes(1);
  });
});
