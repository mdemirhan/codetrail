import type { MessageCategory } from "@codetrail/core";
import { type RefObject, useEffect, useRef } from "react";

type MainView = "history" | "search" | "settings" | "help";
type HistoryPane = "project" | "session" | "message";

export function useKeyboardShortcuts(args: {
  mainView: MainView;
  hasFocusedHistoryMessage: boolean;
  projectListRef: RefObject<HTMLDivElement | null>;
  sessionListRef: RefObject<HTMLDivElement | null>;
  messageListRef: RefObject<HTMLDivElement | null>;
  setMainView: (view: MainView | ((value: MainView) => MainView)) => void;
  clearFocusedHistoryMessage: () => void;
  focusGlobalSearch: () => void;
  focusSessionSearch: () => void;
  toggleFocusMode: () => void;
  toggleScopedMessagesExpanded: () => void;
  toggleHistoryCategory: (category: MessageCategory) => void;
  toggleHistoryCategoryExpanded: (category: MessageCategory) => void;
  toggleProjectPaneCollapsed: () => void;
  toggleSessionPaneCollapsed: () => void;
  focusPreviousHistoryMessage: () => void;
  focusNextHistoryMessage: () => void;
  selectPreviousSession: () => void;
  selectNextSession: () => void;
  selectPreviousProject: () => void;
  selectNextProject: () => void;
  pageHistoryMessagesUp: () => void;
  pageHistoryMessagesDown: () => void;
  goToPreviousHistoryPage: () => void;
  goToNextHistoryPage: () => void;
  goToPreviousSearchPage: () => void;
  goToNextSearchPage: () => void;
  applyZoomAction: (action: "in" | "out" | "reset") => Promise<void>;
  triggerIncrementalRefresh: () => void;
  togglePeriodicRefresh: () => void;
}): void {
  const latestArgs = useRef(args);

  useEffect(() => {
    latestArgs.current = args;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const {
        mainView,
        hasFocusedHistoryMessage,
        projectListRef,
        sessionListRef,
        messageListRef,
        setMainView,
        clearFocusedHistoryMessage,
        focusGlobalSearch,
        focusSessionSearch,
        toggleFocusMode,
        toggleScopedMessagesExpanded,
        toggleHistoryCategory,
        toggleHistoryCategoryExpanded,
        toggleProjectPaneCollapsed,
        toggleSessionPaneCollapsed,
        focusPreviousHistoryMessage,
        focusNextHistoryMessage,
        selectPreviousSession,
        selectNextSession,
        selectPreviousProject,
        selectNextProject,
        pageHistoryMessagesUp,
        pageHistoryMessagesDown,
        goToPreviousHistoryPage,
        goToNextHistoryPage,
        goToPreviousSearchPage,
        goToNextSearchPage,
        applyZoomAction,
        triggerIncrementalRefresh,
        togglePeriodicRefresh,
      } = latestArgs.current;
      const shortcutTarget = resolveShortcutTarget(event.target);
      const focusedPane =
        mainView === "history"
          ? getFocusedHistoryPane(shortcutTarget, {
              project: projectListRef.current,
              session: sessionListRef.current,
              message: messageListRef.current,
            })
          : null;
      const command = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();
      const code = event.code;
      const isHistoryArrowNavigation =
        mainView === "history" && !shift && !isEditableTarget(shortcutTarget);
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "?" && !isEditableTarget(event.target)) {
        event.preventDefault();
        setMainView("help");
      } else if (event.key === "Escape") {
        if (mainView === "search" || mainView === "settings" || mainView === "help") {
          event.preventDefault();
          setMainView("history");
        } else if (mainView === "history" && hasFocusedHistoryMessage) {
          event.preventDefault();
          clearFocusedHistoryMessage();
        }
      } else if (command && shift && key === "f") {
        event.preventDefault();
        focusGlobalSearch();
      } else if (command && key === "f") {
        event.preventDefault();
        focusSessionSearch();
      } else if (command && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        void applyZoomAction("in");
      } else if (command && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        void applyZoomAction("out");
      } else if (command && event.key === "0") {
        event.preventDefault();
        void applyZoomAction("reset");
      } else if (
        mainView === "history" &&
        !command &&
        !event.altKey &&
        !shift &&
        focusedPane === "project" &&
        event.key === "ArrowUp"
      ) {
        event.preventDefault();
        selectPreviousProject();
      } else if (
        mainView === "history" &&
        !command &&
        !event.altKey &&
        !shift &&
        focusedPane === "project" &&
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        selectNextProject();
      } else if (
        mainView === "history" &&
        !command &&
        !event.altKey &&
        !shift &&
        focusedPane === "session" &&
        event.key === "ArrowUp"
      ) {
        event.preventDefault();
        selectPreviousSession();
      } else if (
        mainView === "history" &&
        !command &&
        !event.altKey &&
        !shift &&
        focusedPane === "session" &&
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        selectNextSession();
      } else if (
        mainView === "history" &&
        event.key === "Tab" &&
        !isEditableTarget(shortcutTarget)
      ) {
        const panes = [
          projectListRef.current,
          sessionListRef.current,
          messageListRef.current,
        ].filter(isVisiblePaneTarget);
        if (panes.length === 0) {
          return;
        }
        event.preventDefault();
        const currentPaneContainer = shortcutTarget?.closest(".history-focus-pane");
        const currentIndex = currentPaneContainer
          ? panes.findIndex((pane) => pane.closest(".history-focus-pane") === currentPaneContainer)
          : -1;
        const nextIndex =
          currentIndex === -1
            ? shift
              ? panes.length - 1
              : 0
            : (currentIndex + (shift ? -1 : 1) + panes.length) % panes.length;
        panes[nextIndex]?.focus({ preventScroll: true });
      } else if (
        isHistoryArrowNavigation &&
        event.metaKey &&
        !event.altKey &&
        !event.ctrlKey &&
        event.key === "ArrowUp"
      ) {
        event.preventDefault();
        focusPreviousHistoryMessage();
      } else if (
        isHistoryArrowNavigation &&
        event.metaKey &&
        !event.altKey &&
        !event.ctrlKey &&
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        focusNextHistoryMessage();
      } else if (
        isHistoryArrowNavigation &&
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        event.key === "ArrowUp"
      ) {
        event.preventDefault();
        selectPreviousSession();
      } else if (
        isHistoryArrowNavigation &&
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        selectNextSession();
      } else if (
        isHistoryArrowNavigation &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key === "ArrowUp"
      ) {
        event.preventDefault();
        selectPreviousProject();
      } else if (
        isHistoryArrowNavigation &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        selectNextProject();
      } else if (
        mainView === "history" &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !shift &&
        !isEditableTarget(event.target) &&
        key === "u"
      ) {
        event.preventDefault();
        pageHistoryMessagesUp();
      } else if (
        mainView === "history" &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !shift &&
        !isEditableTarget(event.target) &&
        key === "d"
      ) {
        event.preventDefault();
        pageHistoryMessagesDown();
      } else if (
        mainView === "history" &&
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        shift &&
        !isEditableTarget(event.target) &&
        event.key === "ArrowUp"
      ) {
        event.preventDefault();
        pageHistoryMessagesUp();
      } else if (
        mainView === "history" &&
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        shift &&
        !isEditableTarget(event.target) &&
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        pageHistoryMessagesDown();
      } else if (
        command &&
        !shift &&
        !event.altKey &&
        event.key === "ArrowLeft" &&
        !isEditableTarget(event.target)
      ) {
        if (mainView === "history") {
          event.preventDefault();
          goToPreviousHistoryPage();
        } else if (mainView === "search") {
          event.preventDefault();
          goToPreviousSearchPage();
        }
      } else if (
        command &&
        !shift &&
        !event.altKey &&
        event.key === "ArrowRight" &&
        !isEditableTarget(event.target)
      ) {
        if (mainView === "history") {
          event.preventDefault();
          goToNextHistoryPage();
        } else if (mainView === "search") {
          event.preventDefault();
          goToNextSearchPage();
        }
      } else if (mainView === "history" && command && shift && key === "m") {
        event.preventDefault();
        toggleFocusMode();
      } else if (command && !shift && key === "r") {
        event.preventDefault();
        triggerIncrementalRefresh();
      } else if (command && shift && key === "r") {
        event.preventDefault();
        togglePeriodicRefresh();
      } else if (mainView === "history" && command && key === "e") {
        event.preventDefault();
        toggleScopedMessagesExpanded();
      } else if (mainView === "history" && command && shift && key === "b") {
        event.preventDefault();
        toggleSessionPaneCollapsed();
      } else if (mainView === "history" && command && key === "b") {
        event.preventDefault();
        toggleProjectPaneCollapsed();
      } else if (mainView === "history" && command && event.altKey && code === "Digit1") {
        event.preventDefault();
        toggleHistoryCategoryExpanded("user");
      } else if (mainView === "history" && command && event.altKey && code === "Digit2") {
        event.preventDefault();
        toggleHistoryCategoryExpanded("assistant");
      } else if (mainView === "history" && command && event.altKey && code === "Digit3") {
        event.preventDefault();
        toggleHistoryCategoryExpanded("tool_edit");
      } else if (mainView === "history" && command && event.altKey && code === "Digit4") {
        event.preventDefault();
        toggleHistoryCategoryExpanded("tool_use");
      } else if (mainView === "history" && command && event.altKey && code === "Digit5") {
        event.preventDefault();
        toggleHistoryCategoryExpanded("tool_result");
      } else if (mainView === "history" && command && event.altKey && code === "Digit6") {
        event.preventDefault();
        toggleHistoryCategoryExpanded("thinking");
      } else if (mainView === "history" && command && event.altKey && code === "Digit7") {
        event.preventDefault();
        toggleHistoryCategoryExpanded("system");
      } else if (
        mainView === "history" &&
        command &&
        !shift &&
        !event.altKey &&
        code === "Digit1"
      ) {
        event.preventDefault();
        toggleHistoryCategory("user");
      } else if (
        mainView === "history" &&
        command &&
        !shift &&
        !event.altKey &&
        code === "Digit2"
      ) {
        event.preventDefault();
        toggleHistoryCategory("assistant");
      } else if (
        mainView === "history" &&
        command &&
        !shift &&
        !event.altKey &&
        code === "Digit3"
      ) {
        event.preventDefault();
        toggleHistoryCategory("tool_edit");
      } else if (
        mainView === "history" &&
        command &&
        !shift &&
        !event.altKey &&
        code === "Digit4"
      ) {
        event.preventDefault();
        toggleHistoryCategory("tool_use");
      } else if (
        mainView === "history" &&
        command &&
        !shift &&
        !event.altKey &&
        code === "Digit5"
      ) {
        event.preventDefault();
        toggleHistoryCategory("tool_result");
      } else if (
        mainView === "history" &&
        command &&
        !shift &&
        !event.altKey &&
        code === "Digit6"
      ) {
        event.preventDefault();
        toggleHistoryCategory("thinking");
      } else if (
        mainView === "history" &&
        command &&
        !shift &&
        !event.altKey &&
        code === "Digit7"
      ) {
        event.preventDefault();
        toggleHistoryCategory("system");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function resolveShortcutTarget(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) {
    return target;
  }
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function getFocusedHistoryPane(
  target: HTMLElement | null,
  panes: Record<HistoryPane, HTMLDivElement | null>,
): HistoryPane | null {
  if (!target) {
    return null;
  }
  for (const [paneName, paneElement] of Object.entries(panes) as Array<
    [HistoryPane, HTMLDivElement | null]
  >) {
    if (paneElement && (paneElement === target || paneElement.contains(target))) {
      return paneName;
    }
  }
  return null;
}

function isVisiblePaneTarget(pane: HTMLDivElement | null): pane is HTMLDivElement {
  if (!pane) {
    return false;
  }
  const styles = window.getComputedStyle(pane);
  return styles.display !== "none" && styles.visibility !== "hidden";
}
