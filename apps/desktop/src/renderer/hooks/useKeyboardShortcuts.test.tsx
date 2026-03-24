// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

function Harness(args: Parameters<typeof useKeyboardShortcuts>[0]) {
  useKeyboardShortcuts(args);
  return (
    <div>
      <input ref={args.searchInputRef} />
      <button ref={args.searchAdvancedToggleRef} type="button">
        advanced
      </button>
      <button ref={args.searchCollapseButtonRef} type="button">
        collapse
      </button>
      <input ref={args.searchProjectFilterInputRef} />
      <button ref={args.searchProjectSelectRef} type="button">
        project-select
      </button>
      <div ref={args.searchResultsViewRef} tabIndex={-1}>
        search-results
      </div>
      <div className="history-focus-pane">
        <button type="button">project-toggle</button>
        <div ref={args.projectListRef} tabIndex={-1}>
          project
        </div>
      </div>
      <div className="history-focus-pane">
        <button type="button">session-toggle</button>
        <div ref={args.sessionListRef} tabIndex={-1}>
          session
        </div>
      </div>
      <div className="history-focus-pane">
        <button type="button">message-toggle</button>
        <div ref={args.messageListRef} tabIndex={-1}>
          message
        </div>
      </div>
      <div>shortcuts</div>
    </div>
  );
}

function createProps(
  overrides: Partial<Parameters<typeof useKeyboardShortcuts>[0]> = {},
): Parameters<typeof useKeyboardShortcuts>[0] {
  return {
    mainView: "history",
    hasFocusedHistoryMessage: false,
    projectListRef: createRef<HTMLDivElement>(),
    sessionListRef: createRef<HTMLDivElement>(),
    messageListRef: createRef<HTMLDivElement>(),
    searchInputRef: createRef<HTMLInputElement>(),
    searchAdvancedToggleRef: createRef<HTMLButtonElement>(),
    searchCollapseButtonRef: createRef<HTMLButtonElement>(),
    searchProjectFilterInputRef: createRef<HTMLInputElement>(),
    searchProjectSelectRef: createRef<HTMLButtonElement>(),
    searchResultsViewRef: createRef<HTMLDivElement>(),
    setMainView: vi.fn(),
    clearFocusedHistoryMessage: vi.fn(),
    focusGlobalSearch: vi.fn(),
    focusSessionSearch: vi.fn(),
    toggleFocusMode: vi.fn(),
    toggleAllMessagesExpanded: vi.fn(),
    toggleHistoryCategory: vi.fn(),
    toggleHistoryCategoryDefaultExpansion: vi.fn(),
    toggleProjectPaneCollapsed: vi.fn(),
    toggleSessionPaneCollapsed: vi.fn(),
    focusPreviousHistoryMessage: vi.fn(),
    focusNextHistoryMessage: vi.fn(),
    focusPreviousSearchResult: vi.fn(),
    focusNextSearchResult: vi.fn(),
    selectPreviousSession: vi.fn(),
    selectNextSession: vi.fn(),
    selectPreviousProject: vi.fn(),
    selectNextProject: vi.fn(),
    selectPreviousFocusedSession: vi.fn(),
    selectNextFocusedSession: vi.fn(),
    selectPreviousFocusedProject: vi.fn(),
    selectNextFocusedProject: vi.fn(),
    handleProjectTreeArrow: vi.fn(),
    handleProjectTreeEnter: vi.fn(),
    pageHistoryMessagesUp: vi.fn(),
    pageHistoryMessagesDown: vi.fn(),
    pageSearchResultsUp: vi.fn(),
    pageSearchResultsDown: vi.fn(),
    goToPreviousHistoryPage: vi.fn(),
    goToNextHistoryPage: vi.fn(),
    goToPreviousSearchPage: vi.fn(),
    goToNextSearchPage: vi.fn(),
    applyZoomAction: vi.fn(async () => undefined),
    triggerIncrementalRefresh: vi.fn(),
    togglePeriodicRefresh: vi.fn(),
    ...overrides,
  };
}

describe("useKeyboardShortcuts", () => {
  it("routes search, zoom, and history shortcuts", () => {
    const props = createProps();

    render(<Harness {...props} />);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", metaKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", metaKey: true }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", code: "Digit1", metaKey: true, altKey: true }),
    );
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
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "u", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", metaKey: true, shiftKey: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", metaKey: true, shiftKey: true }),
    );

    expect(props.focusGlobalSearch).toHaveBeenCalledTimes(1);
    expect(props.focusSessionSearch).toHaveBeenCalledTimes(1);
    expect(props.setMainView).toHaveBeenCalledWith("settings");
    expect(props.applyZoomAction).toHaveBeenCalledWith("in");
    expect(props.toggleFocusMode).toHaveBeenCalledTimes(1);
    expect(props.toggleAllMessagesExpanded).toHaveBeenCalledTimes(1);
    expect(props.toggleHistoryCategory).toHaveBeenCalledWith("user");
    expect(props.toggleHistoryCategoryDefaultExpansion).toHaveBeenCalledWith("user");
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
    expect(props.pageHistoryMessagesUp).toHaveBeenCalledTimes(2);
    expect(props.pageHistoryMessagesDown).toHaveBeenCalledTimes(2);
    expect(props.goToPreviousSearchPage).not.toHaveBeenCalled();
    expect(props.goToNextSearchPage).not.toHaveBeenCalled();
    expect(props.setMainView).not.toHaveBeenCalledWith("history");
  });

  it("routes page shortcuts to global search pagination in search view", () => {
    const props = createProps({ mainView: "search" });

    render(<Harness {...props} />);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "u", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", metaKey: true }));

    expect(props.focusGlobalSearch).toHaveBeenCalledTimes(1);
    expect(props.focusSessionSearch).not.toHaveBeenCalled();
    expect(props.toggleHistoryCategory).toHaveBeenCalledWith("user");
    expect(props.pageSearchResultsUp).toHaveBeenCalledTimes(2);
    expect(props.pageSearchResultsDown).toHaveBeenCalledTimes(2);
    expect(props.focusPreviousSearchResult).toHaveBeenCalledTimes(1);
    expect(props.focusNextSearchResult).toHaveBeenCalledTimes(1);
    expect(props.goToPreviousSearchPage).toHaveBeenCalledTimes(1);
    expect(props.goToNextSearchPage).toHaveBeenCalledTimes(1);
    expect(props.goToPreviousHistoryPage).not.toHaveBeenCalled();
    expect(props.goToNextHistoryPage).not.toHaveBeenCalled();
    expect(props.toggleHistoryCategoryDefaultExpansion).not.toHaveBeenCalled();
    expect(props.pageHistoryMessagesUp).not.toHaveBeenCalled();
    expect(props.pageHistoryMessagesDown).not.toHaveBeenCalled();
  });

  it("pages the currently focused history pane with bare PageUp and PageDown", () => {
    const props = createProps();

    render(<Harness {...props} />);

    const projectList = props.projectListRef.current;
    const sessionList = props.sessionListRef.current;
    const messageList = props.messageListRef.current;
    if (!projectList || !sessionList || !messageList) {
      throw new Error("Expected pane refs to be attached");
    }

    for (const pane of [projectList, sessionList, messageList]) {
      Object.defineProperty(pane, "clientHeight", {
        value: 320,
        configurable: true,
      });
      Object.defineProperty(pane, "scrollTop", {
        value: 40,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(pane, "scrollTo", {
        value: ({ top }: { top: number }) => {
          pane.scrollTop = top;
        },
        configurable: true,
      });
    }

    projectList.focus();
    projectList.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
    expect(projectList.scrollTop).toBe(340);
    expect(sessionList.scrollTop).toBe(40);
    expect(messageList.scrollTop).toBe(40);

    sessionList.focus();
    sessionList.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    expect(sessionList.scrollTop).toBe(0);
    expect(projectList.scrollTop).toBe(340);
    expect(messageList.scrollTop).toBe(40);

    expect(props.pageHistoryMessagesUp).not.toHaveBeenCalled();
    expect(props.pageHistoryMessagesDown).not.toHaveBeenCalled();
  });

  it("falls back to paging the message pane when no history pane is focused", () => {
    const props = createProps();

    render(<Harness {...props} />);

    const messageList = props.messageListRef.current;
    if (!messageList) {
      throw new Error("Expected message pane ref to be attached");
    }

    Object.defineProperty(messageList, "clientHeight", {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(messageList, "scrollTop", {
      value: 40,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(messageList, "scrollTo", {
      value: ({ top }: { top: number }) => {
        messageList.scrollTop = top;
      },
      configurable: true,
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));

    expect(messageList.scrollTop).toBe(340);
    expect(props.pageHistoryMessagesDown).not.toHaveBeenCalled();
  });

  it("keeps search paging shortcuts active from search inputs and cycles the search tab order", () => {
    const props = createProps({ mainView: "search" });

    render(<Harness {...props} />);

    const searchInput = props.searchInputRef.current;
    const advancedToggle = props.searchAdvancedToggleRef.current;
    const collapseButton = props.searchCollapseButtonRef.current;
    const projectInput = props.searchProjectFilterInputRef.current;
    const projectSelect = props.searchProjectSelectRef.current;
    const resultsView = props.searchResultsViewRef.current;
    if (
      !searchInput ||
      !advancedToggle ||
      !collapseButton ||
      !projectInput ||
      !projectSelect ||
      !resultsView
    ) {
      throw new Error("Expected search refs to be attached");
    }

    searchInput.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "u", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true }));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(advancedToggle);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(collapseButton);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(projectInput);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(projectSelect);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(resultsView);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
    expect(document.activeElement).toBe(projectSelect);

    expect(props.pageSearchResultsUp).toHaveBeenCalledTimes(1);
    expect(props.pageSearchResultsDown).toHaveBeenCalledTimes(1);
  });

  it("handles escape and question-mark help shortcuts", () => {
    const setMainView = vi.fn();

    const { rerender } = render(<Harness {...createProps({ mainView: "search", setMainView })} />);

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
    input?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        metaKey: true,
        shiftKey: true,
      }),
    );
    input?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        metaKey: true,
        shiftKey: true,
      }),
    );

    expect(props.setMainView).not.toHaveBeenCalledWith("help");
    expect(props.focusNextHistoryMessage).not.toHaveBeenCalled();
    expect(props.selectNextSession).not.toHaveBeenCalled();
    expect(props.selectNextProject).not.toHaveBeenCalled();
    expect(props.pageHistoryMessagesUp).not.toHaveBeenCalled();
    expect(props.pageHistoryMessagesDown).not.toHaveBeenCalled();
  });

  it("preserves focus while routing Ctrl+U and Ctrl+D from the history search input", () => {
    const props = createProps();

    render(
      <div>
        <div className="msg-search">
          <input id="query-input" className="search-input" />
        </div>
        <Harness {...props} />
      </div>,
    );

    const input = document.getElementById("query-input");
    input?.focus();
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "u", bubbles: true, ctrlKey: true }));
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true, ctrlKey: true }));

    expect(props.pageHistoryMessagesUp).toHaveBeenCalledWith({ preserveFocus: true });
    expect(props.pageHistoryMessagesDown).toHaveBeenCalledWith({ preserveFocus: true });
    expect(document.activeElement).toBe(input);
  });

  it("routes Cmd+Up and Cmd+Down from the history search input to history message focus", () => {
    const props = createProps();

    render(
      <div>
        <div className="msg-search">
          <input id="query-input" className="search-input" />
        </div>
        <Harness {...props} />
      </div>,
    );

    const input = document.getElementById("query-input");
    input?.focus();
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, metaKey: true }),
    );
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, metaKey: true }),
    );

    expect(props.focusPreviousHistoryMessage).toHaveBeenCalledTimes(1);
    expect(props.focusNextHistoryMessage).toHaveBeenCalledTimes(1);
  });

  it("cycles pane focus with Tab and routes plain Up/Down on focused project and session panes", () => {
    const props = createProps();

    render(<Harness {...props} />);

    const projectList = props.projectListRef.current;
    const sessionList = props.sessionListRef.current;
    const messageList = props.messageListRef.current;
    if (!projectList || !sessionList || !messageList) {
      throw new Error("Expected pane refs to be attached");
    }

    projectList.focus();
    projectList.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    projectList.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    sessionList.focus();
    sessionList.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));

    expect(props.selectNextFocusedProject).toHaveBeenCalledTimes(1);
    expect(props.handleProjectTreeArrow).toHaveBeenCalledWith("right");
    expect(props.selectPreviousFocusedSession).toHaveBeenCalledTimes(1);

    projectList.focus();
    projectList.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(sessionList);

    sessionList.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, shiftKey: true }),
    );
    expect(document.activeElement).toBe(projectList);

    projectList.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    sessionList.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(messageList);
  });

  it("routes Enter on the focused project pane to the tree enter handler", () => {
    const props = createProps();

    render(<Harness {...props} />);

    const projectList = props.projectListRef.current;
    if (!projectList) {
      throw new Error("Expected project pane ref to be attached");
    }

    projectList.focus();
    projectList.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(props.handleProjectTreeEnter).toHaveBeenCalledTimes(1);
  });

  it("skips collapsed pane targets when cycling with Tab", () => {
    const props = createProps();

    render(<Harness {...props} />);

    const projectList = props.projectListRef.current;
    const sessionList = props.sessionListRef.current;
    const messageList = props.messageListRef.current;
    if (!projectList || !sessionList || !messageList) {
      throw new Error("Expected pane refs to be attached");
    }

    projectList.style.display = "none";

    sessionList.focus();
    sessionList.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(messageList);

    messageList.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(sessionList);
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
