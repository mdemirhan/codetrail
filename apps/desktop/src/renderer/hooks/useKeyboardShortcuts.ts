import type { MessageCategory } from "@codetrail/core/browser";
import { type RefObject, useEffect, useRef } from "react";

import type { MainView } from "../app/types";

type HistoryPane = "project" | "session" | "message";
type ShortcutArgs = Parameters<typeof useKeyboardShortcuts>[0];
type ShortcutContext = ShortcutArgs & {
  event: KeyboardEvent;
  shortcutTarget: HTMLElement | null;
  focusedPane: HistoryPane | null;
  command: boolean;
  shift: boolean;
  key: string;
  code: string;
  isHistoryArrowNavigation: boolean;
};

const HISTORY_CATEGORY_SHORTCUTS = [
  { code: "Digit1", category: "user" },
  { code: "Digit2", category: "assistant" },
  { code: "Digit3", category: "tool_edit" },
  { code: "Digit4", category: "tool_use" },
  { code: "Digit5", category: "tool_result" },
  { code: "Digit6", category: "thinking" },
  { code: "Digit7", category: "system" },
] as const satisfies ReadonlyArray<{ code: string; category: MessageCategory }>;

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
      const args = latestArgs.current;
      const shortcutTarget = resolveShortcutTarget(event.target);
      const focusedPane =
        args.mainView === "history"
          ? getFocusedHistoryPane(shortcutTarget, {
              project: args.projectListRef.current,
              session: args.sessionListRef.current,
              message: args.messageListRef.current,
            })
          : null;
      const command = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();
      const code = event.code;
      const isHistoryArrowNavigation =
        args.mainView === "history" && !shift && !isEditableTarget(shortcutTarget);
      const context: ShortcutContext = {
        ...args,
        event,
        shortcutTarget,
        focusedPane,
        command,
        shift,
        key,
        code,
        isHistoryArrowNavigation,
      };
      if (event.defaultPrevented) {
        return;
      }
      const handledExpandedCategory = handleHistoryCategoryShortcut({
        event,
        mainView: args.mainView,
        command,
        requireAlt: true,
        code,
        onToggleCategory: args.toggleHistoryCategoryExpanded,
      });
      if (handledExpandedCategory) {
        return;
      }
      const handledCategory = handleHistoryCategoryShortcut({
        event,
        mainView: args.mainView,
        command,
        requireAlt: false,
        code,
        onToggleCategory: args.toggleHistoryCategory,
      });
      if (handledCategory) {
        return;
      }
      for (const handler of SHORTCUT_HANDLERS) {
        if (handler(context)) {
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

type ShortcutHandler = (context: ShortcutContext) => boolean;

const SHORTCUT_HANDLERS: readonly ShortcutHandler[] = [
  handleSettingsShortcut,
  handleHelpShortcut,
  handleEscapeShortcut,
  handleSearchShortcut,
  handleZoomShortcut,
  handleFocusedPaneArrowShortcut,
  handleTabFocusShortcut,
  handleHistoryNavigationShortcut,
  handlePageNavigationShortcut,
  handleHistoryCommandShortcut,
];

function handleSettingsShortcut(context: ShortcutContext): boolean {
  if (!context.command || context.shift || context.event.altKey || context.key !== ",") {
    return false;
  }
  context.event.preventDefault();
  context.setMainView("settings");
  return true;
}

function handleHelpShortcut(context: ShortcutContext): boolean {
  if (context.event.key !== "?" || isEditableTarget(context.event.target)) {
    return false;
  }
  context.event.preventDefault();
  context.setMainView("help");
  return true;
}

function handleEscapeShortcut(context: ShortcutContext): boolean {
  if (context.event.key !== "Escape") {
    return false;
  }
  if (
    context.mainView === "search" ||
    context.mainView === "settings" ||
    context.mainView === "help"
  ) {
    context.event.preventDefault();
    context.setMainView("history");
    return true;
  }
  if (context.mainView === "history" && context.hasFocusedHistoryMessage) {
    context.event.preventDefault();
    context.clearFocusedHistoryMessage();
    return true;
  }
  return false;
}

function handleSearchShortcut(context: ShortcutContext): boolean {
  if (!context.command || context.key !== "f") {
    return false;
  }
  context.event.preventDefault();
  if (context.shift) {
    context.focusGlobalSearch();
  } else {
    context.focusSessionSearch();
  }
  return true;
}

function handleZoomShortcut(context: ShortcutContext): boolean {
  if (!context.command) {
    return false;
  }
  if (context.event.key === "+" || context.event.key === "=") {
    context.event.preventDefault();
    void context.applyZoomAction("in");
    return true;
  }
  if (context.event.key === "-" || context.event.key === "_") {
    context.event.preventDefault();
    void context.applyZoomAction("out");
    return true;
  }
  if (context.event.key === "0") {
    context.event.preventDefault();
    void context.applyZoomAction("reset");
    return true;
  }
  return false;
}

function handleFocusedPaneArrowShortcut(context: ShortcutContext): boolean {
  if (context.mainView !== "history" || context.command || context.event.altKey || context.shift) {
    return false;
  }
  if (context.focusedPane === "project" && context.event.key === "ArrowUp") {
    context.event.preventDefault();
    context.selectPreviousProject();
    return true;
  }
  if (context.focusedPane === "project" && context.event.key === "ArrowDown") {
    context.event.preventDefault();
    context.selectNextProject();
    return true;
  }
  if (context.focusedPane === "session" && context.event.key === "ArrowUp") {
    context.event.preventDefault();
    context.selectPreviousSession();
    return true;
  }
  if (context.focusedPane === "session" && context.event.key === "ArrowDown") {
    context.event.preventDefault();
    context.selectNextSession();
    return true;
  }
  return false;
}

function handleTabFocusShortcut(context: ShortcutContext): boolean {
  if (
    context.mainView !== "history" ||
    context.event.key !== "Tab" ||
    isEditableTarget(context.shortcutTarget)
  ) {
    return false;
  }
  const panes = [
    context.projectListRef.current,
    context.sessionListRef.current,
    context.messageListRef.current,
  ].filter(isVisiblePaneTarget);
  if (panes.length === 0) {
    return false;
  }

  context.event.preventDefault();
  const currentPaneContainer = context.shortcutTarget?.closest(".history-focus-pane");
  const currentIndex = currentPaneContainer
    ? panes.findIndex((pane) => pane.closest(".history-focus-pane") === currentPaneContainer)
    : -1;
  const nextIndex =
    currentIndex === -1
      ? context.shift
        ? panes.length - 1
        : 0
      : (currentIndex + (context.shift ? -1 : 1) + panes.length) % panes.length;
  panes[nextIndex]?.focus({ preventScroll: true });
  return true;
}

function handleHistoryNavigationShortcut(context: ShortcutContext): boolean {
  if (context.mainView !== "history" || isEditableTarget(context.event.target)) {
    return false;
  }
  if (
    context.event.ctrlKey &&
    !context.event.metaKey &&
    !context.event.altKey &&
    !context.shift &&
    context.key === "u"
  ) {
    context.event.preventDefault();
    context.pageHistoryMessagesUp();
    return true;
  }
  if (
    context.event.ctrlKey &&
    !context.event.metaKey &&
    !context.event.altKey &&
    !context.shift &&
    context.key === "d"
  ) {
    context.event.preventDefault();
    context.pageHistoryMessagesDown();
    return true;
  }
  if (
    context.event.metaKey &&
    !context.event.ctrlKey &&
    !context.event.altKey &&
    context.shift &&
    context.event.key === "ArrowUp"
  ) {
    context.event.preventDefault();
    context.pageHistoryMessagesUp();
    return true;
  }
  if (
    context.event.metaKey &&
    !context.event.ctrlKey &&
    !context.event.altKey &&
    context.shift &&
    context.event.key === "ArrowDown"
  ) {
    context.event.preventDefault();
    context.pageHistoryMessagesDown();
    return true;
  }
  if (!context.isHistoryArrowNavigation) {
    return false;
  }
  if (context.event.metaKey && !context.event.altKey && !context.event.ctrlKey) {
    if (context.event.key === "ArrowUp") {
      context.event.preventDefault();
      context.focusPreviousHistoryMessage();
      return true;
    }
    if (context.event.key === "ArrowDown") {
      context.event.preventDefault();
      context.focusNextHistoryMessage();
      return true;
    }
  }
  if (context.event.altKey && !context.event.metaKey && !context.event.ctrlKey) {
    if (context.event.key === "ArrowUp") {
      context.event.preventDefault();
      context.selectPreviousSession();
      return true;
    }
    if (context.event.key === "ArrowDown") {
      context.event.preventDefault();
      context.selectNextSession();
      return true;
    }
  }
  if (context.event.ctrlKey && !context.event.metaKey && !context.event.altKey) {
    if (context.event.key === "ArrowUp") {
      context.event.preventDefault();
      context.selectPreviousProject();
      return true;
    }
    if (context.event.key === "ArrowDown") {
      context.event.preventDefault();
      context.selectNextProject();
      return true;
    }
  }
  return false;
}

function handlePageNavigationShortcut(context: ShortcutContext): boolean {
  if (
    !context.command ||
    context.shift ||
    context.event.altKey ||
    isEditableTarget(context.event.target)
  ) {
    return false;
  }
  if (context.event.key === "ArrowLeft") {
    if (context.mainView === "history") {
      context.event.preventDefault();
      context.goToPreviousHistoryPage();
      return true;
    }
    if (context.mainView === "search") {
      context.event.preventDefault();
      context.goToPreviousSearchPage();
      return true;
    }
    return false;
  }
  if (context.event.key === "ArrowRight") {
    if (context.mainView === "history") {
      context.event.preventDefault();
      context.goToNextHistoryPage();
      return true;
    }
    if (context.mainView === "search") {
      context.event.preventDefault();
      context.goToNextSearchPage();
      return true;
    }
    return false;
  }
  return false;
}

function handleHistoryCommandShortcut(context: ShortcutContext): boolean {
  if (!context.command) {
    return false;
  }
  if (context.mainView === "history" && context.shift && context.key === "m") {
    context.event.preventDefault();
    context.toggleFocusMode();
    return true;
  }
  if (!context.shift && context.key === "r") {
    context.event.preventDefault();
    context.triggerIncrementalRefresh();
    return true;
  }
  if (context.shift && context.key === "r") {
    context.event.preventDefault();
    context.togglePeriodicRefresh();
    return true;
  }
  if (context.mainView === "history" && context.key === "e") {
    context.event.preventDefault();
    context.toggleScopedMessagesExpanded();
    return true;
  }
  if (context.mainView === "history" && context.shift && context.key === "b") {
    context.event.preventDefault();
    context.toggleSessionPaneCollapsed();
    return true;
  }
  if (context.mainView === "history" && context.key === "b") {
    context.event.preventDefault();
    context.toggleProjectPaneCollapsed();
    return true;
  }
  return false;
}

function handleHistoryCategoryShortcut(args: {
  event: KeyboardEvent;
  mainView: MainView;
  command: boolean;
  requireAlt: boolean;
  code: string;
  onToggleCategory: (category: MessageCategory) => void;
}): boolean {
  if (args.mainView !== "history" || !args.command) {
    return false;
  }
  if (args.requireAlt !== args.event.altKey || args.event.shiftKey) {
    return false;
  }

  const match = HISTORY_CATEGORY_SHORTCUTS.find((shortcut) => shortcut.code === args.code);
  if (!match) {
    return false;
  }

  args.event.preventDefault();
  args.onToggleCategory(match.category);
  return true;
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
