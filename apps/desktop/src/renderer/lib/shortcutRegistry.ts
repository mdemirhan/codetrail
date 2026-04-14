import { useMemo } from "react";

import type { MessageCategory } from "@codetrail/core/browser";

import { type DesktopPlatform, isMacPlatform } from "../../shared/desktopPlatform";
import { useDesktopPlatform } from "./codetrailClient";

const CATEGORY_DIGIT_SHORTCUTS: ReadonlyArray<readonly [MessageCategory, string]> = [
  ["user", "1"],
  ["assistant", "2"],
  ["tool_edit", "3"],
  ["tool_use", "4"],
  ["tool_result", "5"],
  ["thinking", "6"],
  ["system", "7"],
];

function getPrimaryModifierLabel(platform: DesktopPlatform): "Cmd" | "Ctrl" {
  return isMacPlatform(platform) ? "Cmd" : "Ctrl";
}

function getAlternateModifierLabel(platform: DesktopPlatform): "Option" | "Alt" {
  return isMacPlatform(platform) ? "Option" : "Alt";
}

function getHistoryCategoryShortcuts(platform: DesktopPlatform): Record<MessageCategory, string> {
  const modifier = getPrimaryModifierLabel(platform);
  return Object.fromEntries(
    CATEGORY_DIGIT_SHORTCUTS.map(([category, digit]) => [category, `${modifier}+${digit}`]),
  ) as Record<MessageCategory, string>;
}

function getHistoryCategoryExpandShortcuts(
  platform: DesktopPlatform,
): Record<MessageCategory, string> {
  const modifier = getPrimaryModifierLabel(platform);
  const alternateModifier = getAlternateModifierLabel(platform);
  return Object.fromEntries(
    CATEGORY_DIGIT_SHORTCUTS.map(([category, digit]) => [
      category,
      `${modifier}+${alternateModifier}+${digit}`,
    ]),
  ) as Record<MessageCategory, string>;
}

function getHistoryCategorySoloShortcuts(
  platform: DesktopPlatform,
): Record<MessageCategory, string> {
  const modifier = getPrimaryModifierLabel(platform);
  const isMac = isMacPlatform(platform);
  return Object.fromEntries(
    CATEGORY_DIGIT_SHORTCUTS.map(([category, digit]) => [
      category,
      isMac ? `Ctrl+${digit}` : `${modifier}+Shift+${digit}`,
    ]),
  ) as Record<MessageCategory, string>;
}

function getPageTraversalShortcutRank(shortcut: string): number {
  if (shortcut === "Page Up" || shortcut === "Page Down") {
    return 0;
  }
  if (shortcut === "Ctrl+U" || shortcut === "Ctrl+D") {
    return 1;
  }
  return 2;
}

function getShortcutItems(platform: DesktopPlatform) {
  const modifier = getPrimaryModifierLabel(platform);
  const alternateModifier = getAlternateModifierLabel(platform);
  const soloShortcuts = getHistoryCategorySoloShortcuts(platform);
  const projectNavigationModifier = isMacPlatform(platform) ? "Ctrl" : `${modifier}+Shift`;
  const pageTraversalShortcuts = isMacPlatform(platform)
    ? [
        {
          group: "Search & Navigation",
          shortcut: `${modifier}+Shift+Up`,
          description: "Page up in current list",
        },
        {
          group: "Search & Navigation",
          shortcut: `${modifier}+Shift+Down`,
          description: "Page down in current list",
        },
      ]
    : [
        {
          group: "Search & Navigation",
          shortcut: `${modifier}+Page Up`,
          description: "Page up in current list",
        },
        {
          group: "Search & Navigation",
          shortcut: `${modifier}+Page Down`,
          description: "Page down in current list",
        },
      ];

  return [
    { group: "Search & Navigation", shortcut: `${modifier}+F`, description: "Search current view" },
    {
      group: "Search & Navigation",
      shortcut: `${modifier}+Shift+F`,
      description: "Open global search",
    },
    {
      group: "Search & Navigation",
      shortcut: `${modifier}+Left`,
      description: "Previous page or turn",
    },
    {
      group: "Search & Navigation",
      shortcut: `${modifier}+Right`,
      description: "Next page or turn",
    },
    {
      group: "Search & Navigation",
      shortcut: `${modifier}+T`,
      description: "Cycle Flat and Turns",
    },
    {
      group: "Search & Navigation",
      shortcut: `${modifier}+Shift+M`,
      description: "Show Flat view",
    },
    {
      group: "Search & Navigation",
      shortcut: `${modifier}+Shift+T`,
      description: "Show Turns view",
    },
    {
      group: "Search & Navigation",
      shortcut: `${modifier}+Shift+B`,
      description: "Show Bookmarks view",
    },
    {
      group: "Search & Navigation",
      shortcut: `${modifier}+Up`,
      description: "Previous message or result",
    },
    {
      group: "Search & Navigation",
      shortcut: `${modifier}+Down`,
      description: "Next message or result",
    },
    {
      group: "Search & Navigation",
      shortcut: `${alternateModifier}+Up`,
      description:
        "Previous session, or previous project when Sessions pane is collapsed or hidden",
    },
    {
      group: "Search & Navigation",
      shortcut: `${alternateModifier}+Down`,
      description: "Next session, or next project when Sessions pane is collapsed or hidden",
    },
    {
      group: "Search & Navigation",
      shortcut: `${projectNavigationModifier}+Up`,
      description: "Previous project",
    },
    {
      group: "Search & Navigation",
      shortcut: `${projectNavigationModifier}+Down`,
      description: "Next project",
    },
    {
      group: "Search & Navigation",
      shortcut: "Ctrl+U",
      description: "Page up in current list",
    },
    {
      group: "Search & Navigation",
      shortcut: "Ctrl+D",
      description: "Page down in current list",
    },
    {
      group: "Search & Navigation",
      shortcut: "Page Up",
      description: "Page up in current list",
    },
    {
      group: "Search & Navigation",
      shortcut: "Page Down",
      description: "Page down in current list",
    },
    ...pageTraversalShortcuts,
    { group: "Search & Navigation", shortcut: "Tab", description: "Next pane" },
    { group: "Search & Navigation", shortcut: "Shift+Tab", description: "Previous pane" },
    { group: "Panels", shortcut: `${modifier}+B`, description: "Toggle Projects pane" },
    {
      group: "Panels",
      shortcut: `${modifier}+Alt+B`,
      description: "Toggle Sessions pane",
    },
    {
      group: "Panels",
      shortcut: `${modifier}+E`,
      description: "Expand, collapse, or restore shown items",
    },
    {
      group: "Panels",
      shortcut: isMacPlatform(platform) ? "Cmd+D / Cmd+Shift+D" : `${modifier}+Shift+D`,
      description: "Expand or collapse Combined Changes diffs",
    },
    ...CATEGORY_DIGIT_SHORTCUTS.flatMap(([category, digit]) => {
      const categoryLabel =
        category === "tool_edit"
          ? "Write"
          : category === "tool_use"
            ? "Tool Use"
            : category === "tool_result"
              ? "Tool Result"
              : category.charAt(0).toUpperCase() + category.slice(1);
      return [
        {
          group: "Message Filters",
          shortcut: `${modifier}+${digit}`,
          description: `Show or hide ${categoryLabel} messages`,
        },
        {
          group: "Message Filters",
          shortcut: `${modifier}+${alternateModifier}+${digit}`,
          description: `Expand or collapse ${categoryLabel} messages`,
        },
        {
          group: "Message Filters",
          shortcut: soloShortcuts[category],
          description: `Show only ${categoryLabel} messages`,
        },
      ];
    }),
    {
      group: "Message Filters",
      shortcut: `${modifier}+8`,
      description: "Toggle User, Assistant, and Write messages",
    },
    {
      group: "Message Filters",
      shortcut: isMacPlatform(platform) ? "Ctrl+8" : `${modifier}+Shift+8`,
      description: "Focus User, Assistant, and Write messages",
    },
    {
      group: "Message Filters",
      shortcut: `${modifier}+9`,
      description: "Toggle all message types",
    },
    {
      group: "Message Filters",
      shortcut: isMacPlatform(platform) ? "Ctrl+9" : `${modifier}+Shift+9`,
      description: "Focus all message types",
    },
    { group: "Refresh", shortcut: `${modifier}+R`, description: "Refresh now" },
    {
      group: "Refresh",
      shortcut: `${modifier}+Shift+R`,
      description: "Toggle auto-refresh",
    },
    { group: "System", shortcut: `${modifier}+,`, description: "Open settings" },
    { group: "System", shortcut: `${modifier}++`, description: "Zoom in" },
    { group: "System", shortcut: `${modifier}+-`, description: "Zoom out" },
    { group: "System", shortcut: `${modifier}+0`, description: "Reset zoom" },
    { group: "System", shortcut: "?", description: "Open help" },
    {
      group: "System",
      shortcut: "Esc",
      description:
        "Close help or clear message focus; press twice to reset the current message search",
    },
  ] as const;
}

export type ShortcutRegistry = {
  platform: DesktopPlatform;
  labels: {
    categoryClickModifier: "Cmd" | "Ctrl";
  };
  actions: {
    openGlobalSearch: string;
    openSettings: string;
    refreshNow: string;
    toggleAutoRefresh: string;
    toggleAllMessagesExpanded: string;
    toggleCombinedChangesDiffsExpanded: string;
    toggleFocusMode: string;
    toggleProjectPane: string;
    toggleSessionPane: string;
    previousPage: string;
    nextPage: string;
    cycleMessagesTurnsView: string;
    showMessagesView: string;
    showTurnsView: string;
    showBookmarksView: string;
    zoomIn: string;
    zoomOut: string;
    zoomReset: string;
  };
  searchNavigationHint: string;
  historyCategoryShortcuts: Record<MessageCategory, string>;
  historyCategoryExpandShortcuts: Record<MessageCategory, string>;
  historyCategorySoloShortcuts: Record<MessageCategory, string>;
  shortcutItems: ReturnType<typeof getShortcutItems>;
  rankPageTraversalShortcut: (shortcut: string) => number;
  matches: {
    isPrimaryModifierPressed: (event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">) => boolean;
    isProjectNavigationShortcut: (
      event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
    ) => boolean;
    isModifierFree: (
      event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
    ) => boolean;
    isPageTraversalShortcut: (
      event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
      direction: "up" | "down",
    ) => boolean;
    isCategoryExpansionClick: (event: Pick<MouseEvent, "metaKey" | "ctrlKey">) => boolean;
    isHistoryCategorySoloShortcut: (
      event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
    ) => boolean;
  };
};

export function createShortcutRegistry(platform: DesktopPlatform): ShortcutRegistry {
  const modifier = getPrimaryModifierLabel(platform);
  const isMac = isMacPlatform(platform);
  return {
    platform,
    labels: {
      categoryClickModifier: isMac ? "Cmd" : "Ctrl",
    },
    actions: {
      openGlobalSearch: `${modifier}+Shift+F`,
      openSettings: `${modifier}+,`,
      refreshNow: `${modifier}+R`,
      toggleAutoRefresh: `${modifier}+Shift+R`,
      toggleAllMessagesExpanded: `${modifier}+E`,
      toggleCombinedChangesDiffsExpanded: isMac ? "Cmd+D / Cmd+Shift+D" : `${modifier}+Shift+D`,
      toggleFocusMode: "",
      toggleProjectPane: `${modifier}+B`,
      toggleSessionPane: `${modifier}+Alt+B`,
      previousPage: `${modifier}+Left`,
      nextPage: `${modifier}+Right`,
      cycleMessagesTurnsView: `${modifier}+T`,
      showMessagesView: `${modifier}+Shift+M`,
      showTurnsView: `${modifier}+Shift+T`,
      showBookmarksView: `${modifier}+Shift+B`,
      zoomIn: `${modifier}++`,
      zoomOut: `${modifier}+-`,
      zoomReset: `${modifier}+0`,
    },
    searchNavigationHint: isMac
      ? "Cmd+Left/Right • Cmd+Up/Down • Ctrl+D/U • Page Up/Down"
      : "Ctrl+Left/Right • Ctrl+Up/Down • Ctrl+D/U • Page Up/Down • Ctrl+Page Up/Down",
    historyCategoryShortcuts: getHistoryCategoryShortcuts(platform),
    historyCategoryExpandShortcuts: getHistoryCategoryExpandShortcuts(platform),
    historyCategorySoloShortcuts: getHistoryCategorySoloShortcuts(platform),
    shortcutItems: getShortcutItems(platform),
    rankPageTraversalShortcut: (shortcut) => getPageTraversalShortcutRank(shortcut),
    matches: {
      isPrimaryModifierPressed: (event) =>
        isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey,
      isProjectNavigationShortcut: (event) =>
        isMac
          ? event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
          : event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey,
      isModifierFree: (event) =>
        !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey,
      isPageTraversalShortcut: (event, direction) => {
        if (isMac) {
          return (
            event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            event.shiftKey &&
            event.key === (direction === "up" ? "ArrowUp" : "ArrowDown")
          );
        }
        return (
          event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey &&
          event.key === (direction === "up" ? "PageUp" : "PageDown")
        );
      },
      isCategoryExpansionClick: (event) =>
        isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey,
      isHistoryCategorySoloShortcut: (event) =>
        isMac
          ? event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
          : event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey,
    },
  };
}

export function useShortcutRegistry(): ShortcutRegistry {
  const desktopPlatform = useDesktopPlatform();
  return useMemo(() => createShortcutRegistry(desktopPlatform), [desktopPlatform]);
}
