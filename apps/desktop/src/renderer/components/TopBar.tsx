import { ToolbarIcon } from "./ToolbarIcon";

export function TopBar({
  mainView,
  theme,
  refreshing,
  focusMode,
  focusDisabled,
  copyDisabled,
  onToggleSearchView,
  onThemeChange,
  onIncrementalRefresh,
  onForceRefresh,
  onCopySession,
  onToggleFocus,
  onToggleShortcuts,
  onToggleSettings,
}: {
  mainView: "history" | "search" | "settings";
  theme: "light" | "dark";
  refreshing: boolean;
  focusMode: boolean;
  focusDisabled: boolean;
  copyDisabled: boolean;
  onToggleSearchView: () => void;
  onThemeChange: (theme: "light" | "dark") => void;
  onIncrementalRefresh: () => void;
  onForceRefresh: () => void;
  onCopySession: () => void;
  onToggleFocus: () => void;
  onToggleShortcuts: () => void;
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
              ? "Return to history view (Cmd/Ctrl+1)"
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
          disabled={refreshing}
          aria-label={refreshing ? "Refreshing index" : "Refresh index"}
          title={refreshing ? "Refreshing index..." : "Refresh index (Cmd/Ctrl+R)"}
        >
          <ToolbarIcon name="refresh" />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={onForceRefresh}
          disabled={refreshing}
          aria-label="Force reindex"
          title="Force full reindex (Cmd/Ctrl+Shift+R)"
        >
          <ToolbarIcon name="reindex" />
          Reindex
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={onCopySession}
          disabled={copyDisabled}
          aria-label="Copy session details"
          title="Copy selected session details"
        >
          <ToolbarIcon name="copy" />
          Copy
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={onToggleFocus}
          disabled={focusDisabled}
          aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
          title={focusMode ? "Exit focus mode" : "Focus mode"}
        >
          <ToolbarIcon name={focusMode ? "closeFocus" : "focus"} />
          Focus
        </button>
        <button
          type="button"
          className="tb-btn primary"
          onClick={onToggleShortcuts}
          aria-label="Show keyboard shortcuts"
          title="Show keyboard shortcuts (?)"
        >
          <ToolbarIcon name="shortcuts" />
          Shortcuts
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
        <button
          type="button"
          className={mainView === "settings" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleSettings}
          aria-label={mainView === "settings" ? "Return to history view" : "Open settings"}
          title={mainView === "settings" ? "Return to history view" : "Open settings"}
        >
          <ToolbarIcon name="settings" />
        </button>
      </div>
    </header>
  );
}
