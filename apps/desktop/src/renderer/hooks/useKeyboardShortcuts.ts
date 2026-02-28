import { useEffect } from "react";

type MainView = "history" | "search" | "settings";

export function useKeyboardShortcuts(args: {
  mainView: MainView;
  showShortcuts: boolean;
  setMainView: (view: MainView | ((value: MainView) => MainView)) => void;
  setShowShortcuts: (value: boolean | ((current: boolean) => boolean)) => void;
  focusGlobalSearch: () => void;
  focusSessionSearch: () => void;
  applyZoomAction: (action: "in" | "out" | "reset") => Promise<void>;
  handleForceRefresh: () => Promise<void>;
  handleIncrementalRefresh: () => Promise<void>;
}): void {
  const {
    mainView,
    showShortcuts,
    setMainView,
    setShowShortcuts,
    focusGlobalSearch,
    focusSessionSearch,
    applyZoomAction,
    handleForceRefresh,
    handleIncrementalRefresh,
  } = args;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();
      if (event.key === "?") {
        setShowShortcuts(true);
      } else if (event.key === "Escape") {
        if (showShortcuts) {
          event.preventDefault();
          setShowShortcuts(false);
        } else if (mainView === "search") {
          event.preventDefault();
          setMainView("history");
        }
      } else if (command && shift && key === "f") {
        event.preventDefault();
        focusGlobalSearch();
      } else if (command && key === "f") {
        event.preventDefault();
        focusSessionSearch();
      } else if (command && event.key === "1") {
        event.preventDefault();
        setMainView("history");
      } else if (command && event.key === "2") {
        event.preventDefault();
        setMainView("search");
      } else if (command && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        void applyZoomAction("in");
      } else if (command && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        void applyZoomAction("out");
      } else if (command && event.key === "0") {
        event.preventDefault();
        void applyZoomAction("reset");
      } else if (command && shift && key === "r") {
        event.preventDefault();
        void handleForceRefresh();
      } else if (command && key === "r") {
        event.preventDefault();
        void handleIncrementalRefresh();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    applyZoomAction,
    focusGlobalSearch,
    focusSessionSearch,
    handleForceRefresh,
    handleIncrementalRefresh,
    mainView,
    setMainView,
    setShowShortcuts,
    showShortcuts,
  ]);
}
