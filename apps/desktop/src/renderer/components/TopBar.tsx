import { type Dispatch, Fragment, type SetStateAction, useCallback, useRef, useState } from "react";

import { THEME_GROUPS, type ThemeMode, getThemeLabel } from "../../shared/uiPreferences";
import { REFRESH_STRATEGY_OPTIONS, type RefreshStrategy } from "../app/autoRefresh";
import { useClickOutside } from "../hooks/useClickOutside";
import { ToolbarIcon } from "./ToolbarIcon";

function RefreshStrategyDropdown({
  value,
  onChange,
  statusLabel,
  statusTone,
  statusTooltip,
}: {
  value: RefreshStrategy;
  onChange: Dispatch<SetStateAction<RefreshStrategy>>;
  statusLabel: string | null;
  statusTone: "queued" | "running" | null;
  statusTooltip: string | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedLabel = REFRESH_STRATEGY_OPTIONS.find((o) => o.value === value)?.label ?? "Off";
  const closeDropdown = useCallback(() => {
    setOpen(false);
  }, []);
  useClickOutside(containerRef, open, closeDropdown);

  return (
    <div className="tb-dropdown" ref={containerRef}>
      <button
        type="button"
        className={`tb-btn tb-dropdown-trigger${value !== "off" ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Auto-refresh strategy"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Toggle auto-refresh (Cmd/Ctrl+Shift+R)"
      >
        <ToolbarIcon name="refresh" />
        {selectedLabel}
        {statusLabel ? (
          <span
            className={`tb-refresh-status tb-refresh-status-${statusTone ?? "queued"}`}
            aria-live="polite"
            title={statusTooltip ?? undefined}
          >
            {statusLabel}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="tb-dropdown-menu tb-dropdown-menu-auto-refresh"
          aria-label="Auto-refresh strategy"
        >
          {REFRESH_STRATEGY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={opt.value === value}
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

function ThemeDropdown({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (theme: ThemeMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeDropdown = useCallback(() => {
    setOpen(false);
  }, []);
  useClickOutside(containerRef, open, closeDropdown);

  return (
    <div className="tb-dropdown" ref={containerRef}>
      <button
        type="button"
        className={open ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
        onClick={() => setOpen((current) => !current)}
        aria-label="Choose theme"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Theme: ${getThemeLabel(value)}`}
      >
        <ToolbarIcon name="theme" />
      </button>
      {open ? (
        <div
          className="tb-dropdown-menu tb-dropdown-menu-wide tb-dropdown-menu-right tb-dropdown-menu-scrollable"
          aria-label="Theme"
        >
          {THEME_GROUPS.map((group, groupIndex) => (
            <Fragment key={group.value}>
              {groupIndex > 0 ? <div className="tb-dropdown-separator" aria-hidden /> : null}
              <div className="tb-dropdown-group-label">{group.label}</div>
              {group.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={option.value === value}
                  className={`tb-dropdown-item tb-dropdown-item-checkable${
                    option.value === value ? " selected" : ""
                  }`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === value ? <span className="tb-dropdown-check">✓</span> : null}
                </button>
              ))}
            </Fragment>
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
  refreshStrategy,
  onRefreshStrategyChange,
  autoRefreshStatusLabel,
  autoRefreshStatusTone,
  autoRefreshStatusTooltip,
  onToggleFocus,
  onToggleHelp,
  onToggleSettings,
}: {
  mainView: "history" | "search" | "settings" | "help";
  theme: ThemeMode;
  indexing: boolean;
  focusMode: boolean;
  focusDisabled: boolean;
  onToggleSearchView: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  onIncrementalRefresh: () => void;
  refreshStrategy: RefreshStrategy;
  onRefreshStrategyChange: Dispatch<SetStateAction<RefreshStrategy>>;
  autoRefreshStatusLabel: string | null;
  autoRefreshStatusTone: "queued" | "running" | null;
  autoRefreshStatusTooltip: string | null;
  onToggleFocus: () => void;
  onToggleHelp: () => void;
  onToggleSettings: () => void;
}) {
  const activeTitleSuffix =
    mainView === "settings" ? "Settings" : mainView === "help" ? "Help" : null;

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="app-title">
          <strong>Code Trail</strong>
          {activeTitleSuffix ? (
            <span className={`app-title-suffix app-title-suffix-${mainView}`}>{activeTitleSuffix}</span>
          ) : null}
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
        <RefreshStrategyDropdown
          value={refreshStrategy}
          onChange={onRefreshStrategyChange}
          statusLabel={autoRefreshStatusLabel}
          statusTone={autoRefreshStatusTone}
          statusTooltip={autoRefreshStatusTooltip}
        />
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
        <ThemeDropdown value={theme} onChange={onThemeChange} />
        <span className="titlebar-divider" aria-hidden />
        <button
          type="button"
          className={mainView === "settings" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleSettings}
          aria-label={mainView === "settings" ? "Return to history view" : "Open settings"}
          title={
            mainView === "settings" ? "Return to history view (Esc)" : "Open settings (Cmd/Ctrl+,)"
          }
        >
          <ToolbarIcon name="settings" />
        </button>
      </div>
    </header>
  );
}
