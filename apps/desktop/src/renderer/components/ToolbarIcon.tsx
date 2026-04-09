export type ToolbarIconName =
  | "history"
  | "turns"
  | "search"
  | "refresh"
  | "reindex"
  | "focus"
  | "closeFocus"
  | "copy"
  | "shortcuts"
  | "help"
  | "theme"
  | "codeTheme"
  | "settings"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "expandAll"
  | "collapseAll"
  | "chevronsLeft"
  | "chevronLeft"
  | "chevronRight"
  | "chevronsRight"
  | "bookmark"
  | "folderOpen"
  | "trash"
  | "export"
  | "sortAsc"
  | "sortDesc"
  | "turn"
  | "project"
  | "messages"
  | "splitView"
  | "unifiedView"
  | "wrapText"
  | "noWrapText"
  | "openExternal"
  | "diff"
  | "reveal"
  | "chevronDown";

const TOOLBAR_ICON_PATHS = {
  history: "M4 3h16v4H4zM4 10h16v4H4zM4 17h16v4H4z",
  turns: "M6 4h12a2 2 0 0 1 2 2v12H8a2 2 0 0 1-2-2zm0 0v10a2 2 0 0 0 2 2h10",
  search:
    "M9 3a6 6 0 1 0 0 12a6 6 0 0 0 0-12m0 2a4 4 0 1 1 0 8a4 4 0 0 1 0-8m6.5 9.1l1.4-1.4L22 18l-1.4 1.4z",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4",
  reindex: "M4 4h16v6H4zM4 14h10v6H4zM16 14h4v6h-4z",
  focus: "M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5M8 8h8v8H8z",
  closeFocus: "M4 4l16 16M20 4L4 20",
  shortcuts: "M4 7h16M4 12h16M4 17h10",
  help: "M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4M12 17h.01",
  theme:
    "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8",
  codeTheme:
    "M5 9.5c1.5-2 3.3-3 5.4-3 2.7 0 4.4 1.2 6.5 1.2 1 0 1.9-.3 2.9-.9M5 14.5c1.5-2 3.3-3 5.4-3 2.7 0 4.4 1.2 6.5 1.2 1 0 1.9-.3 2.9-.9M5 19.5c1.5-2 3.3-3 5.4-3 2.7 0 4.4 1.2 6.5 1.2 1 0 1.9-.3 2.9-.9",
  settings:
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 1 0-6a3 3 0 0 1 0 6z",
  zoomIn: "M12 7v10M7 12h10",
  zoomOut: "M7 12h10",
  zoomReset: "M12 6v5l3 2M6 5h12v14H6z",
  expandAll: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  collapseAll: "M7 7h10v10H7z",
  chevronsLeft: "M11 5l-6 7 6 7M19 5l-6 7 6 7",
  chevronLeft: "M15 5l-6 7 6 7",
  chevronRight: "M9 5l6 7-6 7",
  bookmark: "M6 4h12v16l-6-4-6 4z",
  chevronsRight: "M5 5l6 7-6 7M13 5l6 7-6 7",
  export: "M12 3v11M8 10l4 4 4-4M5 19h14",
  sortAsc: "M7 17V6M7 6l-3 3M7 6l3 3M12 17h8M12 13h6M12 9h4M12 5h2",
  sortDesc: "M7 6v11M7 17l-3-3M7 17l3-3M12 17h2M12 13h4M12 9h6M12 5h8",
  turn: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  project: "M3 6l9-3 9 3M3 6v12l9 3 9-3V6M3 6l9 3 9-3M12 9v12",
  messages:
    "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z",
  splitView: "M3 3h8v18H3zM13 3h8v18h-8z",
  unifiedView: "M3 3h18v18H3z",
  wrapText: "M3 6h18M3 12h15a3 3 0 1 1 0 6H9M12 15l-3 3 3 3",
  noWrapText: "M3 6h18M3 12h18M3 18h18",
  openExternal: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3",
  diff: "M10 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M14 3h4a2 2 0 0 0 2 2v14a2 2 0 0 0-2 2h-4M9 12h6",
  reveal: "M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v2M14 15l3 3 3-3M17 18v-7",
  chevronDown: "M6 9l6 6 6-6",
} satisfies Record<Exclude<ToolbarIconName, "copy" | "folderOpen" | "trash">, string>;

const TOOLBAR_ICON_TITLES: Record<ToolbarIconName, string> = {
  history: "History",
  turns: "Turns",
  search: "Search",
  refresh: "Refresh",
  reindex: "Reindex",
  focus: "Focus",
  closeFocus: "Close focus",
  copy: "Copy",
  shortcuts: "Shortcuts",
  help: "Help",
  theme: "Theme",
  codeTheme: "Text viewer theme",
  settings: "Settings",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomReset: "Reset zoom",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  chevronsLeft: "First page",
  chevronLeft: "Back",
  chevronRight: "Next",
  chevronsRight: "Last page",
  bookmark: "Bookmark",
  folderOpen: "Open folder",
  trash: "Delete",
  export: "Export",
  sortAsc: "Sort ascending",
  sortDesc: "Sort descending",
  turn: "Turn",
  project: "Project",
  messages: "Messages",
  splitView: "Split view",
  unifiedView: "Unified view",
  wrapText: "Wrap text",
  noWrapText: "No wrap",
  openExternal: "Open",
  diff: "Diff",
  reveal: "Reveal",
  chevronDown: "Menu",
};

function isPathToolbarIconName(name: ToolbarIconName): name is keyof typeof TOOLBAR_ICON_PATHS {
  return name in TOOLBAR_ICON_PATHS;
}

export function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  const title = TOOLBAR_ICON_TITLES[name];

  if (name === "copy") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 12 12" aria-hidden>
        <title>{title}</title>
        <rect
          x="4"
          y="1"
          width="7"
          height="7"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M3 4H2.5A1.5 1.5 0 0 0 1 5.5v5A1.5 1.5 0 0 0 2.5 12h5A1.5 1.5 0 0 0 9 10.5V10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
    );
  }

  if (name === "folderOpen") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden>
        <title>{title}</title>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <path d="M15 3h6v6" />
        <path d="m10 14 11-11" />
      </svg>
    );
  }

  if (name === "trash") {
    return (
      <svg className="toolbar-icon toolbar-icon-trash" viewBox="0 0 12 12" aria-hidden>
        <title>{title}</title>
        <path
          d="M1.5 3h9M4.5 3V2a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M3 3v7a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V3M5 5.5v3M7 5.5v3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (!isPathToolbarIconName(name)) {
    return null;
  }

  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden>
      <title>{title}</title>
      <path d={TOOLBAR_ICON_PATHS[name]} />
    </svg>
  );
}
