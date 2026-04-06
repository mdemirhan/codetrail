import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";

import type { IpcRequestInput, MessageCategory } from "@codetrail/core/browser";

import { type MessagePageSize, UI_MESSAGE_PAGE_SIZE_VALUES } from "../../shared/uiPreferences";
import { CATEGORIES } from "../app/constants";
import type { WatchLiveStatusResponse } from "../app/types";
import { AdvancedSearchToggleButton } from "../components/AdvancedSearchToggleButton";
import { HistoryExportMenu } from "../components/HistoryExportMenu";
import { ToolbarIcon } from "../components/ToolbarIcon";
import { ZoomPercentInput } from "../components/ZoomPercentInput";
import { MessageCard } from "../components/messages/MessagePresentation";
import {
  buildLiveSummary,
  createLiveUiTracePayload,
  formatCompactLiveAge,
  getNextCompactLiveAgeUpdateDelayMs,
  selectRelevantLiveSessionCandidate,
} from "../lib/liveSessions";
import { formatCompactInteger, formatInteger } from "../lib/numberFormatting";
import { usePaneFocus } from "../lib/paneFocusController";
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
  shortcuts: ReturnType<typeof useShortcutRegistry>,
  formatTooltipLabel: ReturnType<typeof useTooltipFormatter>,
): string {
  const label = history.prettyCategory(category);
  const count = formatInteger(history.historyCategoryCounts[category]);
  return [
    formatTooltipLabel(
      `Show or hide ${label} messages (${count})`,
      history.historyCategoriesShortcutMap[category],
    ),
    formatTooltipLabel(
      `${shortcuts.labels.categoryClickModifier}+Click Focus only ${label} messages`,
      history.historyCategorySoloShortcutMap[category],
    ),
  ].join("\n");
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
  recordLiveUiTrace,
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
  recordLiveUiTrace?: (payload: IpcRequestInput<"debug:recordLiveUiTrace">) => void;
}) {
  const paneFocus = usePaneFocus();
  const shortcuts = useShortcutRegistry();
  const formatTooltipLabel = useTooltipFormatter();
  const focusMessagePane = () => paneFocus.focusHistoryPane("message");
  const messagePaneChromeProps = paneFocus.getPaneChromeProps("message");
  const preserveMessagePaneFocusProps = paneFocus.getPreservePaneFocusProps("message");
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
  const expandScopeLabel = `${history.globalExpandCollapseLabel} shown message types`;
  const historySearchPlaceholder = getSearchQueryPlaceholder(advancedSearchEnabled);
  const historySearchTooltip = getSearchQueryTooltip(advancedSearchEnabled);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const [pageInputValue, setPageInputValue] = useState(() => `${history.sessionPage + 1}`);
  const skipNextPageInputBlurResetRef = useRef(false);
  const lastLiveUiTraceRef = useRef<string | null>(null);
  const handledCtrlFilterMouseDownRef = useRef<MessageCategory | null>(null);
  const liveSessionSelection = useMemo(
    () =>
      selectRelevantLiveSessionCandidate({
        sessions: liveSessions,
        selectionMode: history.historyMode,
        selectedProject: history.selectedProject,
        selectedSession: history.selectedSession,
      }),
    [history.historyMode, history.selectedProject, history.selectedSession, liveSessions],
  );
  const liveSession = liveSessionSelection.session;
  const liveUiTracePayload = useMemo(() => {
    if (!recordLiveUiTrace) {
      return null;
    }
    return createLiveUiTracePayload({
      sessions: liveSessions,
      selectionMode: history.historyMode,
      selectedProject: history.selectedProject,
      selectedSession: history.selectedSession,
      selection: liveSessionSelection,
    });
  }, [
    history.historyMode,
    history.selectedProject,
    history.selectedSession,
    liveSessions,
    liveSessionSelection,
    recordLiveUiTrace,
  ]);

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
    if (!recordLiveUiTrace) {
      return;
    }
    if (!liveUiTracePayload) {
      return;
    }
    const serialized = JSON.stringify(liveUiTracePayload);
    if (lastLiveUiTraceRef.current === serialized) {
      return;
    }
    lastLiveUiTraceRef.current = serialized;
    recordLiveUiTrace(liveUiTracePayload);
  }, [liveUiTracePayload, recordLiveUiTrace]);

  useEffect(() => {
    setPageInputValue(`${history.sessionPage + 1}`);
  }, [history.sessionPage]);

  const liveTimer = liveSession
    ? formatCompactLiveAge(liveSession.lastActivityAt, liveNowMs)
    : null;
  const liveDetailText = liveSession?.detailText?.trim() ?? "";
  // The live row is intentionally single-line. Timer and status stay stable; detail is the only
  // field that gives way, and it should carry the best current or last meaningful activity rather
  // than collapsing to a blank "Working" row.
  const liveSummary = liveSession ? buildLiveSummary(liveSession, liveTimer) : null;

  const resetPageInputValue = () => {
    setPageInputValue(`${history.sessionPage + 1}`);
  };

  const commitPageInputValue = () => {
    const parsedValue = Number.parseInt(pageInputValue.trim(), 10);
    skipNextPageInputBlurResetRef.current = true;
    if (!Number.isFinite(parsedValue)) {
      resetPageInputValue();
      focusMessagePane();
      return;
    }
    const nextPageNumber = Math.max(1, Math.min(history.totalPages, parsedValue));
    setPageInputValue(`${nextPageNumber}`);
    if (nextPageNumber !== history.sessionPage + 1) {
      history.goToHistoryPage(nextPageNumber - 1);
    }
    focusMessagePane();
  };

  return (
    <div className="history-view">
      <div className="msg-header" {...messagePaneChromeProps}>
        <div className="msg-header-top">
          <div className="msg-header-info">
            <span className="summary-count">{history.selectedSummaryMessageCount}</span>
            {history.historyMode === "bookmarks" ? (
              <button
                type="button"
                className="msg-header-action-button msg-header-action-button-close"
                {...preserveMessagePaneFocusProps}
                onClick={() => {
                  history.closeBookmarksView();
                  focusMessagePane();
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
                {...preserveMessagePaneFocusProps}
                onClick={() => {
                  history.selectBookmarksView();
                  focusMessagePane();
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
              {...preserveMessagePaneFocusProps}
              onClick={() => {
                if (history.historyMode === "project_all") {
                  history.setProjectAllSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                  history.setSessionPage(0);
                  focusMessagePane();
                  return;
                }
                if (history.historyMode === "bookmarks") {
                  history.setBookmarkSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                  focusMessagePane();
                  return;
                }
                history.setMessageSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                history.setSessionPage(0);
                focusMessagePane();
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
                {...preserveMessagePaneFocusProps}
                onClick={() => {
                  history.handleToggleAllCategoryDefaultExpansion();
                  focusMessagePane();
                }}
                aria-label={expandScopeLabel}
                title={formatTooltipLabel(
                  expandScopeLabel,
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
                {...preserveMessagePaneFocusProps}
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
                {...preserveMessagePaneFocusProps}
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
              {...preserveMessagePaneFocusProps}
              aria-label={getHistoryCategoryAriaLabel(history, category)}
              title={getHistoryCategoryTooltip(history, category, shortcuts, formatTooltipLabel)}
              onMouseDown={(event) => {
                if (!shortcuts.matches.isCategoryExpansionClick(event) || event.button !== 0) {
                  handledCtrlFilterMouseDownRef.current = null;
                  return;
                }
                handledCtrlFilterMouseDownRef.current = category;
                event.preventDefault();
                history.handleSoloHistoryCategoryShortcut(category);
                focusMessagePane();
              }}
              onContextMenu={(event) => {
                if (shortcuts.matches.isCategoryExpansionClick(event)) {
                  event.preventDefault();
                }
              }}
              onClick={(event) => {
                if (shortcuts.matches.isCategoryExpansionClick(event)) {
                  if (handledCtrlFilterMouseDownRef.current === category) {
                    handledCtrlFilterMouseDownRef.current = null;
                    return;
                  }
                  history.handleSoloHistoryCategoryShortcut(category);
                } else {
                  handledCtrlFilterMouseDownRef.current = null;
                  history.handleToggleHistoryCategoryShortcut(category);
                }
                focusMessagePane();
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
              {...preserveMessagePaneFocusProps}
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
                focusMessagePane();
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
              aria-label="Search current history view"
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
        ref={(element) => {
          history.refs.messageListRef.current = element;
          paneFocus.registerHistoryPaneTarget("message", element);
        }}
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
              cardRef={
                history.focusMessageId === message.id ? history.refs.focusedMessageRef : null
              }
              {...(history.historyMode === "session"
                ? {}
                : { onRevealInSession: history.handleRevealInSession })}
              {...(history.historyMode === "project_all"
                ? {}
                : { onRevealInProject: history.handleRevealInProject })}
              {...(history.historyMode === "bookmarks"
                ? {}
                : history.bookmarkedMessageIds.has(message.id)
                  ? { onRevealInBookmarks: history.handleRevealInBookmarks }
                  : {})}
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

      <div className="msg-pagination pagination-row" {...messagePaneChromeProps}>
        <div className="msg-pagination-group msg-pagination-summary">
          <span className="page-total">{`${paginationTotal} ${paginationUnit}`}</span>
        </div>

        <div className="msg-pagination-group msg-pagination-controls">
          <button
            type="button"
            className="page-btn page-icon-btn"
            {...preserveMessagePaneFocusProps}
            onClick={() => {
              history.goToFirstHistoryPage();
              focusMessagePane();
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
            {...preserveMessagePaneFocusProps}
            onClick={() => {
              history.goToPreviousHistoryPage();
              focusMessagePane();
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
                if (event.key === "Escape") {
                  event.preventDefault();
                  resetPageInputValue();
                  focusMessagePane();
                }
              }}
              aria-label="Page number"
            />
            <span className="page-jump-total">{`of ${history.totalPages}`}</span>
          </label>

          <button
            type="button"
            className="page-btn page-icon-btn"
            {...preserveMessagePaneFocusProps}
            onClick={() => {
              history.goToNextHistoryPage();
              focusMessagePane();
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
            {...preserveMessagePaneFocusProps}
            onClick={() => {
              history.goToLastHistoryPage();
              focusMessagePane();
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
                  focusMessagePane();
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
