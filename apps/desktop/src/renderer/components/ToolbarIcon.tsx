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
    | "settings"
    | "zoomIn"
    | "zoomOut"
    | "zoomReset"
    | "expandAll"
    | "collapseAll";
}) {
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
    return "M4 7h16M4 12h16M4 17h10";
  })();

  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden>
      <title>{name}</title>
      <path d={path} />
    </svg>
  );
}
