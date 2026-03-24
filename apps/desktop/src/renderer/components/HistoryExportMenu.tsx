import { useRef, useState } from "react";

import type { HistoryExportScope } from "../app/types";
import { useClickOutside } from "../hooks/useClickOutside";
import { ToolbarIcon } from "./ToolbarIcon";

export function HistoryExportMenu({
  disabled,
  viewLabel,
  currentPageCount,
  allPagesCount,
  categoryLabel,
  sortLabel,
  onExport,
}: {
  disabled: boolean;
  viewLabel: string;
  currentPageCount: number;
  allPagesCount: number;
  categoryLabel: string;
  sortLabel: string;
  onExport: (args: { scope: HistoryExportScope }) => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scope, setScope] = useState<HistoryExportScope>("current_page");
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useClickOutside(menuRef, menuOpen, () => {
    if (!exporting) {
      setMenuOpen(false);
    }
  });

  const visibleCount = scope === "all_pages" ? allPagesCount : currentPageCount;
  const visibleCountLabel =
    scope === "all_pages"
      ? `${allPagesCount} visible across all pages`
      : `${currentPageCount} visible on this page`;

  const handleExport = async () => {
    setMenuOpen(false);
    setExporting(true);
    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      await onExport({ scope });
    } catch {
      return;
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="tb-dropdown history-export-dropdown" ref={menuRef}>
      <button
        type="button"
        className="toolbar-btn tb-dropdown-trigger history-export-trigger"
        onClick={() => {
          setMenuOpen((value) => !value);
        }}
        disabled={disabled || exporting}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        title="Export messages"
      >
        <ToolbarIcon name="export" />
        Export
      </button>
      {menuOpen ? (
        <dialog
          className="tb-dropdown-menu tb-dropdown-menu-wide history-export-menu"
          open
          aria-label="Export messages"
        >
          <div className="tb-dropdown-group-label">Scope</div>
          <button
            type="button"
            className={`tb-dropdown-item tb-dropdown-item-checkable${
              scope === "current_page" ? " selected" : ""
            }`}
            onClick={() => {
              setScope("current_page");
            }}
          >
            <span>Current page</span>
            {scope === "current_page" ? <span className="tb-dropdown-check">✓</span> : null}
          </button>
          <button
            type="button"
            className={`tb-dropdown-item tb-dropdown-item-checkable${
              scope === "all_pages" ? " selected" : ""
            }`}
            onClick={() => {
              setScope("all_pages");
            }}
          >
            <span>All pages</span>
            {scope === "all_pages" ? <span className="tb-dropdown-check">✓</span> : null}
          </button>
          <div className="tb-dropdown-separator" />
          <div className="history-export-summary">
            <div className="history-export-summary-line">
              {viewLabel} · {visibleCountLabel}
            </div>
            <div className="history-export-summary-line">Filters: {categoryLabel}</div>
            <div className="history-export-summary-line">Sort: {sortLabel}</div>
            <div className="history-export-summary-line">Format: Markdown (.md)</div>
          </div>
          <div className="tb-dropdown-separator" />
          <button
            type="button"
            className="tb-dropdown-item history-export-action"
            onClick={() => {
              void handleExport();
            }}
            disabled={visibleCount === 0 || exporting}
          >
            {exporting ? "Exporting…" : "Export"}
          </button>
        </dialog>
      ) : null}
    </div>
  );
}
