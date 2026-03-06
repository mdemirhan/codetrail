// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

function Harness(args: Parameters<typeof useKeyboardShortcuts>[0]) {
  useKeyboardShortcuts(args);
  return <div>shortcuts</div>;
}

function createProps(
  overrides: Partial<Parameters<typeof useKeyboardShortcuts>[0]> = {},
): Parameters<typeof useKeyboardShortcuts>[0] {
  return {
    mainView: "history",
    hasFocusedHistoryMessage: false,
    setMainView: vi.fn(),
    clearFocusedHistoryMessage: vi.fn(),
    focusGlobalSearch: vi.fn(),
    focusSessionSearch: vi.fn(),
    toggleFocusMode: vi.fn(),
    toggleScopedMessagesExpanded: vi.fn(),
    toggleHistoryCategory: vi.fn(),
    toggleProjectPaneCollapsed: vi.fn(),
    toggleSessionPaneCollapsed: vi.fn(),
    focusPreviousHistoryMessage: vi.fn(),
    focusNextHistoryMessage: vi.fn(),
    selectPreviousSession: vi.fn(),
    selectNextSession: vi.fn(),
    selectPreviousProject: vi.fn(),
    selectNextProject: vi.fn(),
    goToPreviousHistoryPage: vi.fn(),
    goToNextHistoryPage: vi.fn(),
    goToPreviousSearchPage: vi.fn(),
    goToNextSearchPage: vi.fn(),
    applyZoomAction: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("useKeyboardShortcuts", () => {
  it("routes search, zoom, and history shortcuts", () => {
    const props = createProps();

    render(<Harness {...props} />);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", metaKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true }));

    expect(props.focusGlobalSearch).toHaveBeenCalledTimes(1);
    expect(props.focusSessionSearch).toHaveBeenCalledTimes(1);
    expect(props.applyZoomAction).toHaveBeenCalledWith("in");
    expect(props.toggleFocusMode).toHaveBeenCalledTimes(1);
    expect(props.toggleScopedMessagesExpanded).toHaveBeenCalledTimes(1);
    expect(props.toggleHistoryCategory).toHaveBeenCalledWith("user");
    expect(props.toggleProjectPaneCollapsed).toHaveBeenCalledTimes(1);
    expect(props.toggleSessionPaneCollapsed).toHaveBeenCalledTimes(1);
    expect(props.goToPreviousHistoryPage).toHaveBeenCalledTimes(1);
    expect(props.goToNextHistoryPage).toHaveBeenCalledTimes(1);
    expect(props.focusPreviousHistoryMessage).toHaveBeenCalledTimes(1);
    expect(props.focusNextHistoryMessage).toHaveBeenCalledTimes(1);
    expect(props.selectPreviousSession).toHaveBeenCalledTimes(1);
    expect(props.selectNextSession).toHaveBeenCalledTimes(1);
    expect(props.selectPreviousProject).toHaveBeenCalledTimes(1);
    expect(props.selectNextProject).toHaveBeenCalledTimes(1);
    expect(props.goToPreviousSearchPage).not.toHaveBeenCalled();
    expect(props.goToNextSearchPage).not.toHaveBeenCalled();
    expect(props.setMainView).not.toHaveBeenCalledWith("history");
  });

  it("routes page shortcuts to global search pagination in search view", () => {
    const props = createProps({ mainView: "search" });

    render(<Harness {...props} />);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", metaKey: true }));

    expect(props.goToPreviousSearchPage).toHaveBeenCalledTimes(1);
    expect(props.goToNextSearchPage).toHaveBeenCalledTimes(1);
    expect(props.goToPreviousHistoryPage).not.toHaveBeenCalled();
    expect(props.goToNextHistoryPage).not.toHaveBeenCalled();
  });

  it("handles escape and question-mark help shortcuts", () => {
    const setMainView = vi.fn();

    const { rerender } = render(
      <Harness {...createProps({ mainView: "search", setMainView })} />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(setMainView).toHaveBeenCalledWith("history");

    rerender(<Harness {...createProps({ mainView: "history", setMainView })} />);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    expect(setMainView).toHaveBeenCalledWith("help");
  });

  it("does not open help or capture arrow navigation when typing in an input", () => {
    const props = createProps();

    render(
      <div>
        <input id="query-input" />
        <Harness {...props} />
      </div>,
    );

    const input = document.getElementById("query-input");
    input?.focus();
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, metaKey: true }),
    );
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, altKey: true }),
    );
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, ctrlKey: true }),
    );

    expect(props.setMainView).not.toHaveBeenCalledWith("help");
    expect(props.focusNextHistoryMessage).not.toHaveBeenCalled();
    expect(props.selectNextSession).not.toHaveBeenCalled();
    expect(props.selectNextProject).not.toHaveBeenCalled();
  });

  it("clears focused history message on escape", () => {
    const clearFocusedHistoryMessage = vi.fn();

    render(
      <Harness
        {...createProps({
          hasFocusedHistoryMessage: true,
          clearFocusedHistoryMessage,
        })}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(clearFocusedHistoryMessage).toHaveBeenCalledTimes(1);
  });
});
