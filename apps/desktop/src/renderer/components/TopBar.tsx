import {
  type Dispatch,
  Fragment,
  type KeyboardEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  type ShikiThemeId,
  THEME_GROUPS,
  THEME_OPTIONS,
  type ThemeMode,
  getShikiThemeGroupForUiTheme,
  getShikiThemeLabel,
  getThemeLabel,
} from "../../shared/uiPreferences";
import { REFRESH_STRATEGY_OPTIONS, type RefreshStrategy } from "../app/autoRefresh";
import { useClickOutside } from "../hooks/useClickOutside";
import { formatTooltip } from "../lib/tooltipText";
import { ToolbarIcon } from "./ToolbarIcon";

function wrapMenuIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

function clampMenuIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), count - 1);
}

function useToolbarDropdownKeyboardNavigation({
  open,
  setOpen,
  itemCount,
  defaultIndex,
  closeDropdown,
}: {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  itemCount: number;
  defaultIndex: number;
  closeDropdown: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const navigationModeRef = useRef<"pointer" | "keyboard">("pointer");
  const hoveredIndexRef = useRef<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const resolveInitialIndex = useCallback(
    (preferredIndex?: number) => {
      if (itemCount === 0) {
        return null;
      }
      const fallbackIndex = defaultIndex >= 0 ? defaultIndex : 0;
      return clampMenuIndex(preferredIndex ?? fallbackIndex, itemCount);
    },
    [defaultIndex, itemCount],
  );

  const focusItem = useCallback((index: number) => {
    itemRefs.current[index]?.focus();
  }, []);

  useEffect(() => {
    if (!open || focusedIndex === null) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      focusItem(focusedIndex);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [focusItem, focusedIndex, open]);

  const openDropdown = useCallback(
    (preferredIndex?: number) => {
      navigationModeRef.current = "pointer";
      hoveredIndexRef.current = null;
      setFocusedIndex(resolveInitialIndex(preferredIndex));
      setOpen(true);
    },
    [resolveInitialIndex, setOpen],
  );

  const closeDropdownMenu = useCallback(() => {
    navigationModeRef.current = "pointer";
    hoveredIndexRef.current = null;
    setFocusedIndex(null);
    closeDropdown();
  }, [closeDropdown]);

  const closeDropdownAndFocusTrigger = useCallback(() => {
    closeDropdownMenu();
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, [closeDropdownMenu]);

  const moveFocus = useCallback(
    (delta: number) => {
      if (itemCount === 0) {
        return;
      }
      setFocusedIndex((current) => {
        navigationModeRef.current = "keyboard";
        const startIndex = current ?? hoveredIndexRef.current ?? resolveInitialIndex() ?? 0;
        hoveredIndexRef.current = null;
        return wrapMenuIndex(startIndex + delta, itemCount);
      });
    },
    [itemCount, resolveInitialIndex],
  );

  const handleTriggerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!open) {
          openDropdown();
          return;
        }
        moveFocus(1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!open) {
          openDropdown(itemCount - 1);
          return;
        }
        moveFocus(-1);
        return;
      }

      if (event.key === "Escape" && open) {
        event.preventDefault();
        closeDropdownMenu();
      }
    },
    [closeDropdownMenu, itemCount, moveFocus, open, openDropdown],
  );

  const handleItemKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        navigationModeRef.current = "keyboard";
        const startIndex = hoveredIndexRef.current ?? index;
        hoveredIndexRef.current = null;
        setFocusedIndex(wrapMenuIndex(startIndex + 1, itemCount));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        navigationModeRef.current = "keyboard";
        const startIndex = hoveredIndexRef.current ?? index;
        hoveredIndexRef.current = null;
        setFocusedIndex(wrapMenuIndex(startIndex - 1, itemCount));
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        navigationModeRef.current = "keyboard";
        hoveredIndexRef.current = null;
        setFocusedIndex(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        navigationModeRef.current = "keyboard";
        hoveredIndexRef.current = null;
        setFocusedIndex(itemCount - 1);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeDropdownAndFocusTrigger();
        return;
      }

      if (event.key === "Tab") {
        closeDropdownMenu();
      }
    },
    [closeDropdownAndFocusTrigger, closeDropdownMenu, itemCount],
  );

  const setItemRef = useCallback((index: number, node: HTMLButtonElement | null) => {
    itemRefs.current[index] = node;
  }, []);

  const setHoveredIndex = useCallback((index: number | null) => {
    hoveredIndexRef.current = index;
  }, []);

  const activatePointerIndex = useCallback((index: number) => {
    const changed = navigationModeRef.current !== "pointer" || hoveredIndexRef.current !== index;
    navigationModeRef.current = "pointer";
    hoveredIndexRef.current = index;
    return changed;
  }, []);

  return {
    triggerRef,
    openDropdown,
    closeDropdownMenu,
    handleTriggerKeyDown,
    handleItemKeyDown,
    setItemRef,
    activatePointerIndex,
    setHoveredIndex,
  };
}

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
        title={formatTooltip(`Auto-refresh: ${selectedLabel}`, "Cmd+Shift+R")}
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
  onPreview,
  onPreviewReset,
}: {
  value: ThemeMode;
  onChange: (theme: ThemeMode) => void;
  onPreview: (theme: ThemeMode) => void;
  onPreviewReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previewActiveRef = useRef(false);
  const themeOptions = THEME_OPTIONS;
  const selectedIndex = themeOptions.findIndex((option) => option.value === value);
  const restorePreview = useCallback(() => {
    if (!previewActiveRef.current) {
      return;
    }
    previewActiveRef.current = false;
    onPreviewReset();
  }, [onPreviewReset]);
  const closeDropdown = useCallback(() => {
    restorePreview();
    setOpen(false);
  }, [restorePreview]);
  const {
    triggerRef,
    openDropdown,
    closeDropdownMenu,
    handleTriggerKeyDown,
    handleItemKeyDown,
    setItemRef,
    activatePointerIndex,
    setHoveredIndex,
  } = useToolbarDropdownKeyboardNavigation({
    open,
    setOpen,
    itemCount: themeOptions.length,
    defaultIndex: selectedIndex,
    closeDropdown,
  });
  useClickOutside(containerRef, open, closeDropdown);

  return (
    <div className="tb-dropdown" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={open ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
        onClick={() => {
          if (open) {
            closeDropdownMenu();
            return;
          }
          openDropdown();
        }}
        onKeyDown={handleTriggerKeyDown}
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
          onMouseLeave={() => {
            setHoveredIndex(null);
            restorePreview();
          }}
        >
          {THEME_GROUPS.map((group, groupIndex) => (
            <Fragment key={group.value}>
              {groupIndex > 0 ? <div className="tb-dropdown-separator" aria-hidden /> : null}
              <div className="tb-dropdown-group-label">{group.label}</div>
              {group.options.map((option) => {
                const optionIndex = themeOptions.findIndex((item) => item.value === option.value);
                return (
                  <button
                    key={option.value}
                    ref={(node) => {
                      setItemRef(optionIndex, node);
                    }}
                    type="button"
                    aria-pressed={option.value === value}
                    className={`tb-dropdown-item tb-dropdown-item-checkable${
                      option.value === value ? " selected" : ""
                    }`}
                    onFocus={() => {
                      setHoveredIndex(null);
                      if (option.value === value) {
                        restorePreview();
                        return;
                      }
                      previewActiveRef.current = true;
                      onPreview(option.value);
                    }}
                    onMouseMove={() => {
                      if (!activatePointerIndex(optionIndex)) {
                        return;
                      }
                      if (option.value === value) {
                        restorePreview();
                        return;
                      }
                      previewActiveRef.current = true;
                      onPreview(option.value);
                    }}
                    onKeyDown={(event) => {
                      handleItemKeyDown(event, optionIndex);
                    }}
                    onClick={() => {
                      setHoveredIndex(null);
                      previewActiveRef.current = false;
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span>{option.label}</span>
                    {option.value === value ? <span className="tb-dropdown-check">✓</span> : null}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ShikiThemeDropdown({
  value,
  theme,
  onChange,
  onPreview,
  onPreviewReset,
}: {
  value: ShikiThemeId;
  theme: ThemeMode;
  onChange: (theme: ShikiThemeId) => void;
  onPreview: (theme: ShikiThemeId) => void;
  onPreviewReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previewActiveRef = useRef(false);
  const restorePreview = useCallback(() => {
    if (!previewActiveRef.current) {
      return;
    }
    previewActiveRef.current = false;
    onPreviewReset();
  }, [onPreviewReset]);
  const closeDropdown = useCallback(() => {
    restorePreview();
    setOpen(false);
  }, [restorePreview]);
  const shikiThemeGroup = getShikiThemeGroupForUiTheme(theme);
  const selectedIndex = shikiThemeGroup.options.findIndex((option) => option.value === value);
  const {
    triggerRef,
    openDropdown,
    closeDropdownMenu,
    handleTriggerKeyDown,
    handleItemKeyDown,
    setItemRef,
    activatePointerIndex,
    setHoveredIndex,
  } = useToolbarDropdownKeyboardNavigation({
    open,
    setOpen,
    itemCount: shikiThemeGroup.options.length,
    defaultIndex: selectedIndex,
    closeDropdown,
  });
  useClickOutside(containerRef, open, closeDropdown);

  return (
    <div className="tb-dropdown" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={open ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
        onClick={() => {
          if (open) {
            closeDropdownMenu();
            return;
          }
          openDropdown();
        }}
        onKeyDown={handleTriggerKeyDown}
        aria-label="Choose text viewer theme"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Code theme: ${getShikiThemeLabel(value)}`}
      >
        <ToolbarIcon name="codeTheme" />
      </button>
      {open ? (
        <div
          className="tb-dropdown-menu tb-dropdown-menu-wide tb-dropdown-menu-right tb-dropdown-menu-scrollable"
          aria-label="Text viewer theme"
          onMouseLeave={() => {
            setHoveredIndex(null);
            restorePreview();
          }}
        >
          <div className="tb-dropdown-group-label">{shikiThemeGroup.label}</div>
          {shikiThemeGroup.options.map((option) => (
            <button
              key={option.value}
              ref={(node) => {
                const optionIndex = shikiThemeGroup.options.findIndex(
                  (item) => item.value === option.value,
                );
                setItemRef(optionIndex, node);
              }}
              type="button"
              aria-pressed={option.value === value}
              className={`tb-dropdown-item tb-dropdown-item-checkable${
                option.value === value ? " selected" : ""
              }`}
              onFocus={() => {
                setHoveredIndex(null);
                if (option.value === value) {
                  restorePreview();
                  return;
                }
                previewActiveRef.current = true;
                onPreview(option.value);
              }}
              onMouseMove={() => {
                const optionIndex = shikiThemeGroup.options.findIndex(
                  (item) => item.value === option.value,
                );
                if (!activatePointerIndex(optionIndex)) {
                  return;
                }
                if (option.value === value) {
                  restorePreview();
                  return;
                }
                previewActiveRef.current = true;
                onPreview(option.value);
              }}
              onKeyDown={(event) => {
                const optionIndex = shikiThemeGroup.options.findIndex(
                  (item) => item.value === option.value,
                );
                handleItemKeyDown(event, optionIndex);
              }}
              onClick={() => {
                setHoveredIndex(null);
                previewActiveRef.current = false;
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <span className="tb-dropdown-check">✓</span> : null}
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
  shikiTheme,
  indexing,
  focusMode,
  focusDisabled,
  onToggleSearchView,
  onThemeChange,
  onThemePreview,
  onThemePreviewReset,
  onShikiThemeChange,
  onShikiThemePreview,
  onShikiThemePreviewReset,
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
  shikiTheme: ShikiThemeId;
  indexing: boolean;
  focusMode: boolean;
  focusDisabled: boolean;
  onToggleSearchView: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  onThemePreview: (theme: ThemeMode) => void;
  onThemePreviewReset: () => void;
  onShikiThemeChange: (theme: ShikiThemeId) => void;
  onShikiThemePreview: (theme: ShikiThemeId) => void;
  onShikiThemePreviewReset: () => void;
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
    mainView === "search"
      ? "Search"
      : mainView === "settings"
        ? "Settings"
        : mainView === "help"
          ? "Help"
          : null;

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="app-title">
          <strong>Code Trail</strong>
          {activeTitleSuffix ? (
            <span className={`app-title-suffix app-title-suffix-${mainView}`}>
              {activeTitleSuffix}
            </span>
          ) : null}
        </div>
      </div>
      <div className="titlebar-actions">
        <button
          type="button"
          className={mainView === "search" ? "tb-btn active" : "tb-btn"}
          onClick={onToggleSearchView}
          aria-label="Search"
          title={
            mainView === "search"
              ? formatTooltip("Return to History", "Esc")
              : formatTooltip("Open Search", "Cmd+Shift+F")
          }
        >
          <ToolbarIcon name="search" />
          Search
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={onIncrementalRefresh}
          disabled={indexing}
          aria-label={indexing ? "Indexing in progress" : "Incremental refresh"}
          title={indexing ? "Indexing in progress" : formatTooltip("Refresh now", "Cmd+R")}
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
            focusMode
              ? formatTooltip("Exit Focus mode", "Cmd+Shift+M")
              : formatTooltip("Enter Focus mode", "Cmd+Shift+M")
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
          title={
            mainView === "help"
              ? formatTooltip("Return to History", "Esc")
              : formatTooltip("Open Help", "?")
          }
        >
          <ToolbarIcon name="help" />
          Help
        </button>
        <ThemeDropdown
          value={theme}
          onChange={onThemeChange}
          onPreview={onThemePreview}
          onPreviewReset={onThemePreviewReset}
        />
        <ShikiThemeDropdown
          value={shikiTheme}
          theme={theme}
          onChange={onShikiThemeChange}
          onPreview={onShikiThemePreview}
          onPreviewReset={onShikiThemePreviewReset}
        />
        <span className="titlebar-divider" aria-hidden />
        <button
          type="button"
          className={mainView === "settings" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleSettings}
          aria-label={mainView === "settings" ? "Return to history view" : "Open settings"}
          title={
            mainView === "settings"
              ? formatTooltip("Return to History", "Esc")
              : formatTooltip("Open Settings", "Cmd+,")
          }
        >
          <ToolbarIcon name="settings" />
        </button>
      </div>
    </header>
  );
}
