export function ToolbarIcon({
  name,
}: {
  name:
    | "history"
    | "search"
    | "refresh"
    | "reindex"
    | "focus"
    | "closeFocus"
    | "copy"
    | "shortcuts"
    | "help"
    | "settings"
    | "zoomIn"
    | "zoomOut"
    | "zoomReset"
    | "expandAll"
    | "collapseAll"
    | "chevronLeft"
    | "bookmark"
    | "folderOpen"
    | "sortAsc"
    | "sortDesc"
;
}) {
  const title = (() => {
    if (name === "closeFocus") {
      return "Close focus";
    }
    if (name === "zoomIn") {
      return "Zoom in";
    }
    if (name === "zoomOut") {
      return "Zoom out";
    }
    if (name === "zoomReset") {
      return "Reset zoom";
    }
    if (name === "expandAll") {
      return "Expand all";
    }
    if (name === "collapseAll") {
      return "Collapse all";
    }
    if (name === "chevronLeft") {
      return "Back";
    }
    if (name === "folderOpen") {
      return "Open folder";
    }
    if (name === "sortAsc") {
      return "Sort ascending";
    }
    if (name === "sortDesc") {
      return "Sort descending";
    }
    return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  })();
  const path = (() => {
    if (name === "history") {
      return "M4 3h16v4H4zM4 10h16v4H4zM4 17h16v4H4z";
    }
    if (name === "search") {
      return "M9 3a6 6 0 1 0 0 12a6 6 0 0 0 0-12m0 2a4 4 0 1 1 0 8a4 4 0 0 1 0-8m6.5 9.1l1.4-1.4L22 18l-1.4 1.4z";
    }
    if (name === "refresh") {
      return "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4";
    }
    if (name === "reindex") {
      return "M4 4h16v6H4zM4 14h10v6H4zM16 14h4v6h-4z";
    }
    if (name === "focus") {
      return "M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5M8 8h8v8H8z";
    }
    if (name === "closeFocus") {
      return "M4 4l16 16M20 4L4 20";
    }
    if (name === "copy") {
      return "M8 8h11v13H8zM5 3h11v3H8v2H5z";
    }
    if (name === "help") {
      return "M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4M12 17h.01";
    }
    if (name === "settings") {
      return "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 1 0-6a3 3 0 0 1 0 6z";
    }
    if (name === "zoomIn") {
      return "M12 7v10M7 12h10";
    }
    if (name === "zoomOut") {
      return "M7 12h10";
    }
    if (name === "zoomReset") {
      return "M12 6v5l3 2M6 5h12v14H6z";
    }
    if (name === "expandAll") {
      return "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5";
    }
    if (name === "collapseAll") {
      return "M7 7h10v10H7z";
    }
    if (name === "chevronLeft") {
      return "M15 5l-6 7 6 7";
    }
    if (name === "bookmark") {
      return "M6 4h12v16l-6-4-6 4z";
    }
    if (name === "folderOpen") {
      return "M3 8h7l2 2h9v9H3zM3 8V6h6l2 2";
    }
    if (name === "sortAsc") {
      return "M7 17V6M7 6l-3 3M7 6l3 3M12 17h8M12 13h6M12 9h4M12 5h2";
    }
    if (name === "sortDesc") {
      return "M7 6v11M7 17l-3-3M7 17l3-3M12 17h2M12 13h4M12 9h6M12 5h8";
    }
    return "M4 7h16M4 12h16M4 17h10";
  })();

  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden>
      <title>{title}</title>
      <path d={path} />
    </svg>
  );
}
