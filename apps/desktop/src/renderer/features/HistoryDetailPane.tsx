import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";

import type { MessageCategory } from "@codetrail/core/browser";

import { type MessagePageSize, UI_MESSAGE_PAGE_SIZE_VALUES } from "../../shared/uiPreferences";
import { CATEGORIES } from "../app/constants";
import type { WatchLiveStatusResponse } from "../app/types";
import { AdvancedSearchToggleButton } from "../components/AdvancedSearchToggleButton";
import { HistoryExportMenu } from "../components/HistoryExportMenu";
import { ToolbarIcon } from "../components/ToolbarIcon";
import { ZoomPercentInput } from "../components/ZoomPercentInput";
import { MessageCard } from "../components/messages/MessagePresentation";
import {
  formatCompactLiveAge,
  getNextCompactLiveAgeUpdateDelayMs,
  selectRelevantLiveSession,
} from "../lib/liveSessions";
import { formatCompactInteger, formatInteger } from "../lib/numberFormatting";
import {
  getAdvancedSearchToggleTitle,
  getSearchQueryPlaceholder,
  getSearchQueryTooltip,
} from "../lib/searchLabels";
import { useShortcutRegistry } from "../lib/shortcutRegistry";
import { useTooltipFormatter } from "../lib/tooltipText";
import { toggleValue } from "../lib/viewUtils";
import type { useHistoryController } from "./useHistoryController";

type HistoryController = ReturnType<typeof useHistoryController>;

function getHistoryCategoryShortcutDigit(
  history: HistoryController,
  category: MessageCategory,
): string {
  const match = history.historyCategoriesShortcutMap[category].match(/\d$/);
  return match?.[0] ?? "";
}

function getHistoryCategoryTooltip(
  history: HistoryController,
  category: MessageCategory,
  formatTooltipLabel: ReturnType<typeof useTooltipFormatter>,
): string {
  const label = history.prettyCategory(category);
  const count = formatInteger(history.historyCategoryCounts[category]);
  return formatTooltipLabel(
    `Show or hide ${label} messages (${count})`,
    history.historyCategoriesShortcutMap[category],
  );
}

function getHistoryCategoryAriaLabel(
  history: HistoryController,
  category: MessageCategory,
): string {
  const label = history.prettyCategory(category);
  const count = formatInteger(history.historyCategoryCounts[category]);
  return `Show or hide ${label} messages (${count})`;
}

function getHistoryCategoryExpansionDefaultTooltip(
  history: HistoryController,
  category: MessageCategory,
  formatTooltipLabel: ReturnType<typeof useTooltipFormatter>,
): string {
  const label = history.prettyCategory(category);
  const nextAction = history.expandedByDefaultCategories.includes(category) ? "Collapse" : "Expand";
  return formatTooltipLabel(
    `${nextAction} ${label} messages`,
    history.historyCategoryExpandShortcutMap[category],
  );
}

function formatHistoryCategorySelection(history: HistoryController): string {
  if (history.historyCategories.length === 0) {
    return "None";
  }
  if (history.historyCategories.length === CATEGORIES.length) {
    return "All";
  }
  return history.historyCategories.map((category) => history.prettyCategory(category)).join(", ");
}

function getHistoryExportViewLabel(history: HistoryController): string {
  if (history.historyMode === "project_all") {
    return "All Sessions";
  }
  if (history.historyMode === "bookmarks") {
    return "Bookmarks";
  }
  return "Session";
}

function isInteractiveHeaderTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      'button, input, select, textarea, a, label, [role="button"], [role="menuitem"], [contenteditable="true"]',
    ),
  );
}

function selectNumericValueOrFallback<T extends number>(
  value: string,
  allowedValues: readonly T[],
  fallback: T,
): T {
  const numericValue = Number(value);
  return allowedValues.includes(numericValue as T) ? (numericValue as T) : fallback;
}

export function HistoryDetailPane({
  history,
  advancedSearchEnabled,
  setAdvancedSearchEnabled,
  zoomPercent,
  canZoomIn,
  canZoomOut,
  applyZoomAction,
  setZoomPercent,
  liveSessions = [],
  liveRowHasBackground = true,
}: {
  history: HistoryController;
  advancedSearchEnabled: boolean;
  setAdvancedSearchEnabled: Dispatch<SetStateAction<boolean>>;
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  applyZoomAction: (action: "in" | "out" | "reset") => Promise<void>;
  setZoomPercent: (percent: number) => Promise<void>;
  liveSessions?: WatchLiveStatusResponse["sessions"];
  liveRowHasBackground?: boolean;
}) {
  const shortcuts = useShortcutRegistry();
  const formatTooltipLabel = useTooltipFormatter();
  const exportAllPagesCount =
    history.historyMode === "bookmarks"
      ? history.bookmarksResponse.filteredCount
      : history.historyMode === "project_all"
        ? (history.projectCombinedDetail?.totalCount ?? 0)
        : (history.sessionDetail?.totalCount ?? 0);
  const exportCurrentPageCount = history.activeHistoryMessages.length;
  const exportSortLabel =
    history.activeMessageSortDirection === "asc" ? "Oldest to newest" : "Newest to oldest";
  const paginationTotal =
    history.historyMode === "bookmarks"
      ? history.bookmarksResponse.filteredCount
      : history.historyMode === "project_all"
        ? (history.projectCombinedDetail?.totalCount ?? 0)
        : (history.sessionDetail?.totalCount ?? 0);
  const paginationUnit = history.historyMode === "bookmarks" ? "bookmarks" : "messages";
  const messageSortScopeSuffix =
    history.historyMode === "project_all"
      ? "all sessions"
      : history.historyMode === "bookmarks"
        ? "bookmarks"
        : "session";
  const messageSortAriaLabel =
    history.activeMessageSortDirection === "asc"
      ? `Oldest first (${messageSortScopeSuffix}). Switch to newest first`
      : `Newest first (${messageSortScopeSuffix}). Switch to oldest first`;
  const historySearchPlaceholder = getSearchQueryPlaceholder(advancedSearchEnabled);
  const historySearchTooltip = getSearchQueryTooltip(advancedSearchEnabled);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const [pageInputValue, setPageInputValue] = useState(() => `${history.sessionPage + 1}`);
  const skipNextPageInputBlurResetRef = useRef(false);
  const liveSession = useMemo(
    () =>
      selectRelevantLiveSession({
        sessions: liveSessions,
        selectionMode: history.historyMode,
        selectedProject: history.selectedProject,
        selectedSession: history.selectedSession,
      }),
    [history.historyMode, history.selectedProject, history.selectedSession, liveSessions],
  );

  useEffect(() => {
    if (!liveSession) {
      return;
    }

    let cancelled = false;
    const tick = () => {
      if (cancelled) {
        return;
      }
      const nextNowMs = Date.now();
      setLiveNowMs(nextNowMs);
      const nextDelayMs = getNextCompactLiveAgeUpdateDelayMs(liveSession.lastActivityAt, nextNowMs);
      timeoutId = window.setTimeout(tick, nextDelayMs);
    };

    setLiveNowMs(Date.now());
    let timeoutId = window.setTimeout(
      tick,
      getNextCompactLiveAgeUpdateDelayMs(liveSession.lastActivityAt),
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [liveSession]);

  useEffect(() => {
    setPageInputValue(`${history.sessionPage + 1}`);
  }, [history.sessionPage]);

  const liveTimer = liveSession
    ? formatCompactLiveAge(liveSession.lastActivityAt, liveNowMs)
    : null;
  const liveDetailText = liveSession?.detailText?.trim() ?? "";
  const liveSummary = liveSession
    ? ["Live", liveTimer, liveSession.statusText, liveDetailText].filter(Boolean).join(" · ")
    : null;

  const resetPageInputValue = () => {
    setPageInputValue(`${history.sessionPage + 1}`);
  };

  const commitPageInputValue = () => {
    const parsedValue = Number.parseInt(pageInputValue.trim(), 10);
    skipNextPageInputBlurResetRef.current = true;
    if (!Number.isFinite(parsedValue)) {
      resetPageInputValue();
      history.focusMessagePane();
      return;
    }
    const nextPageNumber = Math.max(1, Math.min(history.totalPages, parsedValue));
    setPageInputValue(`${nextPageNumber}`);
    if (nextPageNumber !== history.sessionPage + 1) {
      history.goToHistoryPage(nextPageNumber - 1);
    }
    history.focusMessagePane();
  };

  return (
    <div className="history-view">
      <div
        className="msg-header"
        onMouseDown={(event) => {
          if (isInteractiveHeaderTarget(event.target)) {
            return;
          }
          history.focusMessagePane();
        }}
      >
        <div className="msg-header-top">
          <div className="msg-header-info">
            <span className="summary-count">{history.selectedSummaryMessageCount}</span>
            {history.historyMode === "bookmarks" ? (
              <button
                type="button"
                className="msg-header-action-button msg-header-action-button-close"
                onClick={() => {
                  history.closeBookmarksView();
                  history.focusMessagePane();
                }}
                aria-label="Close bookmarks"
                title="Close bookmarks"
              >
                <ToolbarIcon name="closeFocus" />
                Close bookmarks
              </button>
            ) : history.currentViewBookmarkCount > 0 ? (
              <button
                type="button"
                className="msg-header-action-button"
                onClick={() => {
                  history.selectBookmarksView();
                  history.focusMessagePane();
                }}
                aria-label={`${history.currentViewBookmarkCount} ${history.currentViewBookmarkCount === 1 ? "bookmark" : "bookmarks"}`}
                title="Open bookmarked messages"
              >
                <ToolbarIcon name="bookmark" />
                {history.currentViewBookmarkCount}{" "}
                {history.currentViewBookmarkCount === 1 ? "bookmark" : "bookmarks"}
              </button>
            ) : null}
          </div>
          <div className="msg-toolbar">
            <HistoryExportMenu
              disabled={exportCurrentPageCount === 0}
              viewLabel={getHistoryExportViewLabel(history)}
              currentPageCount={exportCurrentPageCount}
              allPagesCount={exportAllPagesCount}
              categoryLabel={formatHistoryCategorySelection(history)}
              sortLabel={exportSortLabel}
              onExport={async ({ scope }) => {
                await history.handleExportMessages({ scope });
              }}
            />
            <button
              type="button"
              className="toolbar-btn msg-sort-btn"
              onClick={() => {
                if (history.historyMode === "project_all") {
                  history.setProjectAllSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                  history.setSessionPage(0);
                  history.focusMessagePane();
                  return;
                }
                if (history.historyMode === "bookmarks") {
                  history.setBookmarkSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                  history.focusMessagePane();
                  return;
                }
                history.setMessageSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                history.setSessionPage(0);
                history.focusMessagePane();
              }}
              aria-label={messageSortAriaLabel}
              title={history.messageSortTooltip}
            >
              <ToolbarIcon
                name={history.activeMessageSortDirection === "asc" ? "sortAsc" : "sortDesc"}
              />
            </button>
            <div className="expand-scope-control">
              <button
                type="button"
                className="toolbar-btn expand-scope-action"
                onClick={() => {
                  history.handleToggleAllCategoryDefaultExpansion();
                  history.focusMessagePane();
                }}
                aria-label={`${history.globalExpandCollapseLabel} all messages`}
                title={formatTooltipLabel(
                  `${history.globalExpandCollapseLabel} all messages`,
                  shortcuts.actions.toggleAllMessagesExpanded,
                )}
              >
                <ToolbarIcon name={history.areAllMessagesExpanded ? "collapseAll" : "expandAll"} />
                {history.globalExpandCollapseLabel}
              </button>
            </div>
            <div className="toolbar-zoom-group">
              <button
                type="button"
                className="toolbar-btn zoom-btn"
                onClick={() => void applyZoomAction("out")}
                disabled={!canZoomOut}
                aria-label="Zoom out"
                title={formatTooltipLabel("Zoom out", shortcuts.actions.zoomOut)}
              >
                <ToolbarIcon name="zoomOut" />
              </button>
              <ZoomPercentInput
                value={zoomPercent}
                onCommit={(percent) => void setZoomPercent(percent)}
                ariaLabel="Zoom percentage"
                title={formatTooltipLabel("Zoom level", shortcuts.actions.zoomReset)}
                wrapperClassName="zoom-level-control"
                inputClassName="zoom-level-input"
              />
              <button
                type="button"
                className="toolbar-btn zoom-btn"
                onClick={() => void applyZoomAction("in")}
                disabled={!canZoomIn}
                aria-label="Zoom in"
                title={formatTooltipLabel("Zoom in", shortcuts.actions.zoomIn)}
              >
                <ToolbarIcon name="zoomIn" />
              </button>
            </div>
          </div>
        </div>
        {liveSession && liveTimer ? (
          <div
            className={`msg-live-row${liveRowHasBackground ? "" : " is-flat"}`}
            title={liveSummary ?? undefined}
          >
            <span className="msg-live-label">Live</span>
            <span className="msg-live-separator" aria-hidden="true">
              ·
            </span>
            <span className="msg-live-timer">{liveTimer}</span>
            <span className="msg-live-separator" aria-hidden="true">
              ·
            </span>
            <span className={`msg-live-status msg-live-status-${liveSession.statusKind}`}>
              {liveSession.statusText}
            </span>
            {liveDetailText ? (
              <>
                <span className="msg-live-separator" aria-hidden="true">
                  ·
                </span>
                <span className="msg-live-detail">{liveDetailText}</span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="msg-filters">
        {CATEGORIES.map((category) => (
          <div
            key={category}
            className={`msg-filter ${category}-filter${
              history.historyCategories.includes(category) ? " active" : ""
            }`}
          >
            <button
              type="button"
              className="msg-filter-main"
              aria-label={getHistoryCategoryAriaLabel(history, category)}
              title={getHistoryCategoryTooltip(history, category, formatTooltipLabel)}
              onClick={() => {
                history.setHistoryCategories((value) =>
                  toggleValue<MessageCategory>(value, category),
                );
                history.setSessionPage(0);
                history.focusMessagePane();
              }}
            >
              <span className="filter-shortcut" aria-hidden="true">
                {getHistoryCategoryShortcutDigit(history, category)}
              </span>
              <span className="filter-label">
                {history.prettyCategory(category)}
                <span className="filter-count" aria-hidden="true">
                  {formatCompactInteger(history.historyCategoryCounts[category])}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="msg-filter-expand-toggle"
              aria-label={getHistoryCategoryExpansionDefaultTooltip(
                history,
                category,
                formatTooltipLabel,
              )}
              title={getHistoryCategoryExpansionDefaultTooltip(
                history,
                category,
                formatTooltipLabel,
              )}
              onClick={() => {
                history.handleToggleCategoryDefaultExpansion(category);
                history.focusMessagePane();
              }}
            >
              <svg
                className={`msg-chevron filter-expand-chevron${
                  history.expandedByDefaultCategories.includes(category) ? "" : " is-collapsed"
                }`}
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="msg-search">
        <div className={history.historyQueryError ? "search-box invalid" : "search-box"}>
          <div className="search-input-shell">
            <ToolbarIcon name="search" />
            <input
              ref={history.refs.sessionSearchInputRef}
              className="search-input"
              value={
                history.historyMode === "bookmarks"
                  ? history.bookmarkQueryInput
                  : history.sessionQueryInput
              }
              onKeyDown={history.handleHistorySearchKeyDown}
              onChange={(event) => {
                if (history.historyMode === "bookmarks") {
                  history.setBookmarkQueryInput(event.target.value);
                  return;
                }
                history.setSessionQueryInput(event.target.value);
                history.setSessionPage(0);
              }}
              placeholder={historySearchPlaceholder}
              title={history.historyQueryError ?? historySearchTooltip}
            />
          </div>
          <AdvancedSearchToggleButton
            enabled={advancedSearchEnabled}
            variant="history"
            onToggle={() => {
              setAdvancedSearchEnabled((value) => !value);
              history.setSessionPage(0);
            }}
            title={getAdvancedSearchToggleTitle(advancedSearchEnabled)}
          />
        </div>
        {history.historyQueryError ? (
          <p className="search-error" title={history.historyQueryError}>
            {history.historyQueryError}
          </p>
        ) : null}
      </div>

      <div
        className="msg-scroll message-list"
        ref={history.refs.messageListRef}
        tabIndex={-1}
        onScroll={history.handleMessageListScroll}
      >
        {history.activeHistoryMessages.length ? (
          history.activeHistoryMessages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              query={
                history.historyMode === "bookmarks"
                  ? history.effectiveBookmarkQuery
                  : history.effectiveSessionQuery
              }
              highlightPatterns={history.historyHighlightPatterns}
              pathRoots={history.messagePathRoots}
              isFocused={message.id === history.focusMessageId}
              isBookmarked={history.bookmarkedMessageIds.has(message.id)}
              isOrphaned={
                history.historyMode === "bookmarks"
                  ? (history.bookmarkOrphanedByMessageId.get(message.id) ?? false)
                  : false
              }
              isExpanded={
                history.messageExpansionOverrides[message.id] ??
                history.isExpandedByDefault(message.category)
              }
              onToggleExpanded={history.handleToggleMessageExpanded}
              onToggleCategoryExpanded={history.handleToggleVisibleCategoryMessagesExpanded}
              onToggleBookmark={history.handleToggleBookmark}
              onRevealInSession={
                history.historyMode === "session" ? undefined : history.handleRevealInSession
              }
              onRevealInProject={
                history.historyMode === "project_all" ? undefined : history.handleRevealInProject
              }
              onPreservePaneFocus={history.focusMessagePane}
              cardRef={
                history.focusMessageId === message.id ? history.refs.focusedMessageRef : null
              }
            />
          ))
        ) : (
          <p className="empty-state">
            {history.historyMode === "bookmarks"
              ? "No bookmarked messages match current filters."
              : "No messages match current filters."}
          </p>
        )}
      </div>

      <div
        className="msg-pagination pagination-row"
        onMouseDown={(event) => {
          if (isInteractiveHeaderTarget(event.target)) {
            return;
          }
          history.focusMessagePane();
        }}
      >
        <div className="msg-pagination-group msg-pagination-summary">
          <span className="page-total">{`${paginationTotal} ${paginationUnit}`}</span>
        </div>

        <div className="msg-pagination-group msg-pagination-controls">
          <button
            type="button"
            className="page-btn page-icon-btn"
            onClick={() => {
              history.goToFirstHistoryPage();
              history.focusMessagePane();
            }}
            disabled={!history.canGoToPreviousHistoryPage}
            title="First page"
            aria-label="First page"
          >
            <ToolbarIcon name="chevronsLeft" />
          </button>
          <button
            type="button"
            className="page-btn page-icon-btn"
            onClick={() => {
              history.goToPreviousHistoryPage();
              history.focusMessagePane();
            }}
            disabled={!history.canGoToPreviousHistoryPage}
            title={formatTooltipLabel("Previous page", shortcuts.actions.previousPage)}
            aria-label="Previous page"
          >
            <ToolbarIcon name="chevronLeft" />
          </button>

          <label className="page-jump-control">
            <span className="page-jump-label-text">Page</span>
            <input
              className="page-jump-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pageInputValue}
              onChange={(event) => {
                setPageInputValue(event.target.value);
              }}
              onBlur={() => {
                if (skipNextPageInputBlurResetRef.current) {
                  skipNextPageInputBlurResetRef.current = false;
                  return;
                }
                resetPageInputValue();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPageInputValue();
                  return;
                }
                if (event.key === "Escape" || event.key === "Tab") {
                  event.preventDefault();
                  resetPageInputValue();
                  history.focusMessagePane();
                }
              }}
              aria-label="Page number"
            />
            <span className="page-jump-total">{`of ${history.totalPages}`}</span>
          </label>

          <button
            type="button"
            className="page-btn page-icon-btn"
            onClick={() => {
              history.goToNextHistoryPage();
              history.focusMessagePane();
            }}
            disabled={!history.canGoToNextHistoryPage}
            title={formatTooltipLabel("Next page", shortcuts.actions.nextPage)}
            aria-label="Next page"
          >
            <ToolbarIcon name="chevronRight" />
          </button>
          <button
            type="button"
            className="page-btn page-icon-btn"
            onClick={() => {
              history.goToLastHistoryPage();
              history.focusMessagePane();
            }}
            disabled={!history.canGoToNextHistoryPage}
            title="Last page"
            aria-label="Last page"
          >
            <ToolbarIcon name="chevronsRight" />
          </button>
        </div>

        <div className="msg-pagination-group msg-pagination-page-size">
          <label className="page-size-control">
            <span className="page-size-label-text">Per page</span>
            <div className="pagination-select-wrap">
              <select
                className="pagination-select"
                aria-label="Messages per page"
                value={history.messagePageSize}
                onChange={(event) => {
                  history.setMessagePageSize(
                    selectNumericValueOrFallback(
                      event.target.value,
                      UI_MESSAGE_PAGE_SIZE_VALUES,
                      history.messagePageSize as MessagePageSize,
                    ),
                  );
                  history.focusMessagePane();
                }}
              >
                {UI_MESSAGE_PAGE_SIZE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <span className="pagination-select-chevron" aria-hidden>
                <svg viewBox="0 0 12 12">
                  <title>Open menu</title>
                  <path d="M3 4.5L6 7.5L9 4.5" />
                </svg>
              </span>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
