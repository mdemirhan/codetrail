import type { Dispatch, SetStateAction } from "react";

import type { MessageCategory } from "@codetrail/core/browser";

import { CATEGORIES } from "../app/constants";
import type { BulkExpandScope } from "../app/types";
import { AdvancedSearchToggleButton } from "../components/AdvancedSearchToggleButton";
import { HistoryExportMenu } from "../components/HistoryExportMenu";
import { ToolbarIcon } from "../components/ToolbarIcon";
import { ZoomPercentInput } from "../components/ZoomPercentInput";
import { MessageCard } from "../components/messages/MessagePresentation";
import { SEARCH_PLACEHOLDERS } from "../lib/searchPlaceholders";
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
  return `Toggle ${label} messages on or off (${history.historyCategoriesShortcutMap[category]})
(${history.historyCategoryExpandShortcutMap[category]} to expand or collapse ${label} messages)`;
}

function parseBulkExpandScope(value: string): BulkExpandScope {
  if (value === "all") {
    return "all";
  }
  return CATEGORIES.find((category) => category === value) ?? "all";
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
}: {
  history: HistoryController;
  advancedSearchEnabled: boolean;
  setAdvancedSearchEnabled: Dispatch<SetStateAction<boolean>>;
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  applyZoomAction: (action: "in" | "out" | "reset") => Promise<void>;
  setZoomPercent: (percent: number) => Promise<void>;
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

  return (
    <div className="history-view">
      <div className="msg-header">
        <div className="msg-header-top">
          <div className="msg-header-info">
            <span className="summary-count">{history.selectedSummaryMessageCount}</span>
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
              className="toolbar-btn sort-btn msg-sort-btn"
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
              aria-label={
                history.activeMessageSortDirection === "asc"
                  ? `Sort ${history.messageSortScopeLabel} descending`
                  : `Sort ${history.messageSortScopeLabel} ascending`
              }
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
                onClick={history.handleToggleScopedMessagesExpanded}
                disabled={history.scopedMessages.length === 0}
                aria-label={history.scopedExpandCollapseLabel}
                title={`${history.scopedExpandCollapseLabel} (Cmd/Ctrl+E)`}
              >
                <ToolbarIcon
                  name={history.areScopedMessagesExpanded ? "collapseAll" : "expandAll"}
                />
                {history.scopedActionLabel}
              </button>
              <select
                className="expand-scope-select"
                value={history.bulkExpandScope}
                onChange={(event) => {
                  history.setBulkExpandScope(parseBulkExpandScope(event.target.value));
                }}
                aria-label="Select expand and collapse scope"
                title="Choose which message type expand/collapse applies to"
              >
                <option value="all">All</option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {history.prettyCategory(category)}
                  </option>
                ))}
              </select>
            </div>
            <div className="toolbar-zoom-group">
              <button
                type="button"
                className="toolbar-btn zoom-btn"
                onClick={() => void applyZoomAction("out")}
                disabled={!canZoomOut}
                aria-label="Zoom out"
                title="Zoom out (Cmd/Ctrl+-)"
              >
                <ToolbarIcon name="zoomOut" />
              </button>
              <ZoomPercentInput
                value={zoomPercent}
                onCommit={(percent) => void setZoomPercent(percent)}
                ariaLabel="Zoom percentage"
                title="Zoom level (60%-175%; Enter applies, Cmd/Ctrl+0 resets)"
                wrapperClassName="zoom-level-control"
                inputClassName="zoom-level-input"
              />
              <button
                type="button"
                className="toolbar-btn zoom-btn"
                onClick={() => void applyZoomAction("in")}
                disabled={!canZoomIn}
                aria-label="Zoom in"
                title="Zoom in (Cmd/Ctrl++)"
              >
                <ToolbarIcon name="zoomIn" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="msg-filters">
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            className={`msg-filter ${category}-filter${
              history.historyCategories.includes(category) ? " active" : ""
            }`}
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
              placeholder={
                history.historyMode === "bookmarks"
                  ? SEARCH_PLACEHOLDERS.historyBookmarks
                  : history.historyMode === "project_all"
                    ? SEARCH_PLACEHOLDERS.historyProjectSessions
                    : SEARCH_PLACEHOLDERS.historySession
              }
              title={history.historyQueryError ?? undefined}
            />
          </div>
          <AdvancedSearchToggleButton
            enabled={advancedSearchEnabled}
            onToggle={() => {
              setAdvancedSearchEnabled((value) => !value);
              history.setSessionPage(0);
            }}
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
                history.messageExpanded[message.id] ?? history.isExpandedByDefault(message.category)
              }
              onToggleExpanded={history.handleToggleMessageExpanded}
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

      {history.historyMode !== "bookmarks" ? (
        <div className="msg-pagination pagination-row">
          <button
            type="button"
            className="page-btn"
            onClick={history.goToPreviousHistoryPage}
            disabled={!history.canGoToPreviousHistoryPage}
            title="Previous page (Cmd/Ctrl+Left)"
            aria-label="Previous page"
          >
            Previous
          </button>
          <span className="page-info">
            Page {history.sessionPage + 1} / {history.totalPages} (
            {history.historyMode === "project_all"
              ? (history.projectCombinedDetail?.totalCount ?? 0)
              : (history.sessionDetail?.totalCount ?? 0)}{" "}
            messages)
          </span>
          <button
            type="button"
            className="page-btn"
            onClick={history.goToNextHistoryPage}
            disabled={!history.canGoToNextHistoryPage}
            title="Next page (Cmd/Ctrl+Right)"
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
