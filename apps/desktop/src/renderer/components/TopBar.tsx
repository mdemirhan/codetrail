import { ToolbarIcon } from "./ToolbarIcon";

export function TopBar({
  mainView,
  theme,
  refreshing,
  focusMode,
  focusDisabled,
  onToggleSearchView,
  onThemeChange,
  onIncrementalRefresh,
  onToggleFocus,
  onToggleShortcuts,
}: {
  mainView: "history" | "search";
  theme: "light" | "dark";
  refreshing: boolean;
  focusMode: boolean;
  focusDisabled: boolean;
  onToggleSearchView: () => void;
  onThemeChange: (theme: "light" | "dark") => void;
  onIncrementalRefresh: () => void;
  onToggleFocus: () => void;
  onToggleShortcuts: () => void;
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
        >
          <ToolbarIcon name="search" />
          Global Search
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={onIncrementalRefresh}
          disabled={refreshing}
        >
          <ToolbarIcon name="refresh" />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
        <button type="button" className="tb-btn" onClick={onToggleFocus} disabled={focusDisabled}>
          <ToolbarIcon name={focusMode ? "closeFocus" : "focus"} />
          Focus
        </button>
        <select
          className="theme-select"
          value={theme}
          onChange={(event) => onThemeChange(event.target.value as "light" | "dark")}
          aria-label="Theme"
          title="Theme"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <button type="button" className="tb-btn primary" onClick={onToggleShortcuts}>
          <ToolbarIcon name="shortcuts" />
          Shortcuts
        </button>
      </div>
    </header>
  );
}
