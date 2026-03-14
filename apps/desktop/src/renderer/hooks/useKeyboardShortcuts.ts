import type { MessageCategory } from "@codetrail/core";
import { useEffect, useRef } from "react";

type MainView = "history" | "search" | "settings" | "help";

export function useKeyboardShortcuts(args: {
  mainView: MainView;
  hasFocusedHistoryMessage: boolean;
  setMainView: (view: MainView | ((value: MainView) => MainView)) => void;
  clearFocusedHistoryMessage: () => void;
  focusGlobalSearch: () => void;
  focusSessionSearch: () => void;
  toggleFocusMode: () => void;
  toggleScopedMessagesExpanded: () => void;
  toggleHistoryCategory: (category: MessageCategory) => void;
  toggleProjectPaneCollapsed: () => void;
  toggleSessionPaneCollapsed: () => void;
  focusPreviousHistoryMessage: () => void;
  focusNextHistoryMessage: () => void;
  selectPreviousSession: () => void;
  selectNextSession: () => void;
  selectPreviousProject: () => void;
  selectNextProject: () => void;
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
        setMainView,
        clearFocusedHistoryMessage,
        focusGlobalSearch,
        focusSessionSearch,
        toggleFocusMode,
        toggleScopedMessagesExpanded,
        toggleHistoryCategory,
        toggleProjectPaneCollapsed,
        toggleSessionPaneCollapsed,
        focusPreviousHistoryMessage,
        focusNextHistoryMessage,
        selectPreviousSession,
        selectNextSession,
        selectPreviousProject,
        selectNextProject,
        goToPreviousHistoryPage,
        goToNextHistoryPage,
        goToPreviousSearchPage,
        goToNextSearchPage,
        applyZoomAction,
        triggerIncrementalRefresh,
        togglePeriodicRefresh,
      } = latestArgs.current;
      const command = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();
      const isHistoryArrowNavigation =
        mainView === "history" && !shift && !isEditableTarget(event.target);
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
      } else if (mainView === "history" && command && event.key === "1") {
        event.preventDefault();
        toggleHistoryCategory("user");
      } else if (mainView === "history" && command && event.key === "2") {
        event.preventDefault();
        toggleHistoryCategory("assistant");
      } else if (mainView === "history" && command && event.key === "3") {
        event.preventDefault();
        toggleHistoryCategory("tool_edit");
      } else if (mainView === "history" && command && event.key === "4") {
        event.preventDefault();
        toggleHistoryCategory("tool_use");
      } else if (mainView === "history" && command && event.key === "5") {
        event.preventDefault();
        toggleHistoryCategory("tool_result");
      } else if (mainView === "history" && command && event.key === "6") {
        event.preventDefault();
        toggleHistoryCategory("thinking");
      } else if (mainView === "history" && command && event.key === "7") {
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
