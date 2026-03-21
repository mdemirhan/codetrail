export type ToolbarIconName =
  | "history"
  | "search"
  | "refresh"
  | "reindex"
  | "focus"
  | "closeFocus"
  | "copy"
  | "shortcuts"
  | "help"
  | "theme"
  | "settings"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "expandAll"
  | "collapseAll"
  | "chevronLeft"
  | "bookmark"
  | "folderOpen"
  | "export"
  | "sortAsc"
  | "sortDesc";

const TOOLBAR_ICON_PATHS: Record<ToolbarIconName, string> = {
  history: "M4 3h16v4H4zM4 10h16v4H4zM4 17h16v4H4z",
  search:
    "M9 3a6 6 0 1 0 0 12a6 6 0 0 0 0-12m0 2a4 4 0 1 1 0 8a4 4 0 0 1 0-8m6.5 9.1l1.4-1.4L22 18l-1.4 1.4z",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4",
  reindex: "M4 4h16v6H4zM4 14h10v6H4zM16 14h4v6h-4z",
  focus: "M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5M8 8h8v8H8z",
  closeFocus: "M4 4l16 16M20 4L4 20",
  copy: "",
  shortcuts: "M4 7h16M4 12h16M4 17h10",
  help: "M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4M12 17h.01",
  theme:
    "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8",
  settings:
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 1 0-6a3 3 0 0 1 0 6z",
  zoomIn: "M12 7v10M7 12h10",
  zoomOut: "M7 12h10",
  zoomReset: "M12 6v5l3 2M6 5h12v14H6z",
  expandAll: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  collapseAll: "M7 7h10v10H7z",
  chevronLeft: "M15 5l-6 7 6 7",
  bookmark: "M6 4h12v16l-6-4-6 4z",
  folderOpen: "",
  export: "M12 3v11M8 10l4 4 4-4M5 19h14",
  sortAsc: "M7 17V6M7 6l-3 3M7 6l3 3M12 17h8M12 13h6M12 9h4M12 5h2",
  sortDesc: "M7 6v11M7 17l-3-3M7 17l3-3M12 17h2M12 13h4M12 9h6M12 5h8",
};

const TOOLBAR_ICON_TITLES: Record<ToolbarIconName, string> = {
  history: "History",
  search: "Search",
  refresh: "Refresh",
  reindex: "Reindex",
  focus: "Focus",
  closeFocus: "Close focus",
  copy: "Copy",
  shortcuts: "Shortcuts",
  help: "Help",
  theme: "Theme",
  settings: "Settings",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomReset: "Reset zoom",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  chevronLeft: "Back",
  bookmark: "Bookmark",
  folderOpen: "Open folder",
  export: "Export",
  sortAsc: "Sort ascending",
  sortDesc: "Sort descending",
};

export function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  const title = TOOLBAR_ICON_TITLES[name];
  const path = TOOLBAR_ICON_PATHS[name];

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

  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden>
      <title>{title}</title>
      <path d={path} />
    </svg>
  );
}
