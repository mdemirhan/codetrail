import { ToolbarIcon } from "./ToolbarIcon";

export function TopBar({
  mainView,
  refreshing,
  focusMode,
  focusDisabled,
  onToggleSearchView,
  onIncrementalRefresh,
  onToggleFocus,
  onToggleShortcuts,
}: {
  mainView: "history" | "search";
  refreshing: boolean;
  focusMode: boolean;
  focusDisabled: boolean;
  onToggleSearchView: () => void;
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
        <button type="button" className="tb-btn primary" onClick={onToggleShortcuts}>
          <ToolbarIcon name="shortcuts" />
          Shortcuts
        </button>
      </div>
    </header>
  );
}
