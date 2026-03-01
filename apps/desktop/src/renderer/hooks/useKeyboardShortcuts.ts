import { useEffect } from "react";
import type { MessageCategory } from "@codetrail/core";

type MainView = "history" | "search" | "settings";

export function useKeyboardShortcuts(args: {
  mainView: MainView;
  showShortcuts: boolean;
  hasFocusedHistoryMessage: boolean;
  setMainView: (view: MainView | ((value: MainView) => MainView)) => void;
  setShowShortcuts: (value: boolean | ((current: boolean) => boolean)) => void;
  clearFocusedHistoryMessage: () => void;
  focusGlobalSearch: () => void;
  focusSessionSearch: () => void;
  toggleFocusMode: () => void;
  toggleScopedMessagesExpanded: () => void;
  toggleHistoryCategory: (category: MessageCategory) => void;
  toggleProjectPaneCollapsed: () => void;
  toggleSessionPaneCollapsed: () => void;
  applyZoomAction: (action: "in" | "out" | "reset") => Promise<void>;
}): void {
  const {
    mainView,
    showShortcuts,
    hasFocusedHistoryMessage,
    setMainView,
    setShowShortcuts,
    clearFocusedHistoryMessage,
    focusGlobalSearch,
    focusSessionSearch,
    toggleFocusMode,
    toggleScopedMessagesExpanded,
    toggleHistoryCategory,
    toggleProjectPaneCollapsed,
    toggleSessionPaneCollapsed,
    applyZoomAction,
  } = args;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "?") {
        setShowShortcuts(true);
      } else if (event.key === "Escape") {
        if (showShortcuts) {
          event.preventDefault();
          setShowShortcuts(false);
        } else if (mainView === "search" || mainView === "settings") {
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
      } else if (mainView === "history" && command && shift && key === "m") {
        event.preventDefault();
        toggleFocusMode();
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
  }, [
    applyZoomAction,
    clearFocusedHistoryMessage,
    focusGlobalSearch,
    focusSessionSearch,
    hasFocusedHistoryMessage,
    mainView,
    setMainView,
    setShowShortcuts,
    showShortcuts,
    toggleFocusMode,
    toggleHistoryCategory,
    toggleProjectPaneCollapsed,
    toggleScopedMessagesExpanded,
    toggleSessionPaneCollapsed,
  ]);
}
