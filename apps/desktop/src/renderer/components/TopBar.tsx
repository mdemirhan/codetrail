import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

import { ToolbarIcon } from "./ToolbarIcon";

const PERIODIC_REFRESH_OPTIONS: { label: string; value: number }[] = [
  { label: "Off", value: 0 },
  { label: "3s", value: 3_000 },
  { label: "5s", value: 5_000 },
  { label: "10s", value: 10_000 },
  { label: "30s", value: 30_000 },
  { label: "1min", value: 60_000 },
  { label: "5min", value: 300_000 },
];

function PeriodicRefreshDropdown({
  value,
  onChange,
}: {
  value: number;
  onChange: Dispatch<SetStateAction<number>>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedLabel = PERIODIC_REFRESH_OPTIONS.find((o) => o.value === value)?.label ?? "Off";

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="tb-dropdown" ref={containerRef}>
      <button
        type="button"
        className={`tb-btn tb-dropdown-trigger${value > 0 ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Periodic refresh interval"
        aria-expanded={open}
        title="Toggle auto-refresh (Cmd/Ctrl+Shift+R)"
      >
        <ToolbarIcon name="refresh" />
        {selectedLabel}
      </button>
      {open ? (
        <div className="tb-dropdown-menu" role="listbox" aria-label="Auto-refresh interval">
          {PERIODIC_REFRESH_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              className={`tb-dropdown-item${opt.value === value ? " selected" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TopBar({
  mainView,
  theme,
  indexing,
  focusMode,
  focusDisabled,
  onToggleSearchView,
  onThemeChange,
  onIncrementalRefresh,
  onForceRefresh,
  periodicRefreshInterval,
  onPeriodicRefreshIntervalChange,
  onToggleFocus,
  onToggleHelp,
  onToggleSettings,
}: {
  mainView: "history" | "search" | "settings" | "help";
  theme: "light" | "dark";
  indexing: boolean;
  focusMode: boolean;
  focusDisabled: boolean;
  onToggleSearchView: () => void;
  onThemeChange: (theme: "light" | "dark") => void;
  onIncrementalRefresh: () => void;
  onForceRefresh: () => void;
  periodicRefreshInterval: number;
  onPeriodicRefreshIntervalChange: Dispatch<SetStateAction<number>>;
  onToggleFocus: () => void;
  onToggleHelp: () => void;
  onToggleSettings: () => void;
}) {
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="app-title">
          <strong>Code Trail</strong>
        </div>
      </div>
      <div className="titlebar-actions">
        <button
          type="button"
          className={mainView === "search" ? "tb-btn active" : "tb-btn"}
          onClick={onToggleSearchView}
          aria-label="Global Search"
          title={
            mainView === "search"
              ? "Return to history view (Esc)"
              : "Open global search (Cmd/Ctrl+Shift+F)"
          }
        >
          <ToolbarIcon name="search" />
          Global Search
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={onIncrementalRefresh}
          disabled={indexing}
          aria-label={indexing ? "Indexing in progress" : "Incremental refresh"}
          title={indexing ? "Indexing in progress..." : "Incremental refresh (Cmd/Ctrl+R)"}
        >
          <ToolbarIcon name="refresh" />
          {indexing ? "Indexing..." : "Refresh"}
        </button>
        <PeriodicRefreshDropdown
          value={periodicRefreshInterval}
          onChange={onPeriodicRefreshIntervalChange}
        />
        <button
          type="button"
          className="tb-btn"
          onClick={onForceRefresh}
          disabled={indexing || periodicRefreshInterval > 0}
          aria-label="Force reindex"
          title={
            periodicRefreshInterval > 0
              ? "Disable periodic refresh before reindexing"
              : indexing
                ? "Indexing in progress..."
                : "Force full reindex"
          }
        >
          <ToolbarIcon name="reindex" />
          Reindex
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={onToggleFocus}
          disabled={focusDisabled}
          aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
          title={
            focusMode ? "Exit focus mode (Cmd/Ctrl+Shift+M)" : "Enter focus mode (Cmd/Ctrl+Shift+M)"
          }
        >
          <ToolbarIcon name={focusMode ? "closeFocus" : "focus"} />
          Focus
        </button>
        <button
          type="button"
          className={mainView === "help" ? "tb-btn active" : "tb-btn"}
          onClick={onToggleHelp}
          aria-label={mainView === "help" ? "Return to history view" : "Open help"}
          title={mainView === "help" ? "Return to history view (Esc)" : "Open help (?)"}
        >
          <ToolbarIcon name="help" />
          Help
        </button>
        <div className="theme-toggle" aria-label="Theme toggle">
          <svg
            className={`toggle-icon ${theme === "dark" ? "active" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <title>Dark theme</title>
            <path d="M21 12.79A9 9 0 1111.21 3A7 7 0 0021 12.79z" />
          </svg>
          <button
            type="button"
            className="toggle-track"
            onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "Light" : "Dark"} theme`}
            title={`Switch to ${theme === "dark" ? "Light" : "Dark"} theme`}
          >
            <span className="toggle-thumb" />
          </button>
          <svg
            className={`toggle-icon ${theme === "light" ? "active" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <title>Light theme</title>
            <circle cx="12" cy="12" r="5" />
            <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </div>
        <span className="titlebar-divider" aria-hidden />
        <button
          type="button"
          className={mainView === "settings" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleSettings}
          aria-label={mainView === "settings" ? "Return to history view" : "Open settings"}
          title={mainView === "settings" ? "Return to history view (Esc)" : "Open settings"}
        >
          <ToolbarIcon name="settings" />
        </button>
      </div>
    </header>
  );
}
