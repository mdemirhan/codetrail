import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";

import type { MessageCategory } from "@codetrail/core/browser";

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
import {
  getAdvancedSearchToggleTitle,
  getSearchQueryPlaceholder,
  getSearchQueryTooltip,
} from "../lib/searchLabels";
import { formatTooltip } from "../lib/tooltipText";
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

function getHistoryCategoryTooltip(history: HistoryController, category: MessageCategory): string {
  const label = history.prettyCategory(category);
  return formatTooltip(
    `Show or hide ${label} messages`,
    history.historyCategoriesShortcutMap[category],
  );
}

function getHistoryCategoryExpansionDefaultTooltip(
  history: HistoryController,
  category: MessageCategory,
): string {
  const label = history.prettyCategory(category);
  const nextAction = history.expandedByDefaultCategories.includes(category) ? "Collapse" : "Expand";
  return formatTooltip(
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

  const liveTimer = liveSession
    ? formatCompactLiveAge(liveSession.lastActivityAt, liveNowMs)
    : null;
  const liveDetailText = liveSession?.detailText?.trim() ?? "";
  const liveSummary = liveSession
    ? ["Live", liveTimer, liveSession.statusText, liveDetailText].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="history-view">
      <div className="msg-header">
        <div className="msg-header-top">
          <div className="msg-header-info">
            <span className="summary-count">{history.selectedSummaryMessageCount}</span>
            {history.historyMode === "bookmarks" ? (
              <button
                type="button"
                className="msg-header-action-button msg-header-action-button-close"
                onClick={history.closeBookmarksView}
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
                onClick={() => history.selectBookmarksView()}
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
                  return;
                }
                if (history.historyMode === "bookmarks") {
                  history.setBookmarkSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                  return;
                }
                history.setMessageSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                history.setSessionPage(0);
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
                onClick={history.handleToggleAllCategoryDefaultExpansion}
                aria-label={`${history.globalExpandCollapseLabel} all messages`}
                title={formatTooltip(`${history.globalExpandCollapseLabel} all messages`, "Cmd+E")}
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
                title={formatTooltip("Zoom out", "Cmd+-")}
              >
                <ToolbarIcon name="zoomOut" />
              </button>
              <ZoomPercentInput
                value={zoomPercent}
                onCommit={(percent) => void setZoomPercent(percent)}
                ariaLabel="Zoom percentage"
                title={formatTooltip("Zoom level", "Cmd+0")}
                wrapperClassName="zoom-level-control"
                inputClassName="zoom-level-input"
              />
              <button
                type="button"
                className="toolbar-btn zoom-btn"
                onClick={() => void applyZoomAction("in")}
                disabled={!canZoomIn}
                aria-label="Zoom in"
                title={formatTooltip("Zoom in", "Cmd++")}
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
              title={getHistoryCategoryTooltip(history, category)}
              onClick={() => {
                history.setHistoryCategories((value) =>
                  toggleValue<MessageCategory>(value, category),
                );
                history.setSessionPage(0);
              }}
            >
              <span className="filter-shortcut" aria-hidden="true">
                {getHistoryCategoryShortcutDigit(history, category)}
              </span>
              <span className="filter-label">
                {history.prettyCategory(category)}
                <span className="filter-count">{history.historyCategoryCounts[category]}</span>
              </span>
            </button>
            <button
              type="button"
              className="msg-filter-expand-toggle"
              aria-label={getHistoryCategoryExpansionDefaultTooltip(history, category)}
              title={getHistoryCategoryExpansionDefaultTooltip(history, category)}
              onClick={() => {
                history.handleToggleCategoryDefaultExpansion(category);
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
              onRevealInSession={history.handleRevealInSession}
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

      <div className="msg-pagination pagination-row">
        <button
          type="button"
          className="page-btn"
          onClick={history.goToPreviousHistoryPage}
          disabled={!history.canGoToPreviousHistoryPage}
          title={formatTooltip("Previous page", "Cmd+Left")}
          aria-label="Previous page"
        >
          Previous
        </button>
        <span className="page-info">{`Page ${history.sessionPage + 1} / ${history.totalPages} (${paginationTotal} ${paginationUnit})`}</span>
        <button
          type="button"
          className="page-btn"
          onClick={history.goToNextHistoryPage}
          disabled={!history.canGoToNextHistoryPage}
          title={formatTooltip("Next page", "Cmd+Right")}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}
