import type { Dispatch, SetStateAction } from "react";

import type { MessageCategory } from "@codetrail/core";

import { CATEGORIES } from "../app/constants";
import { MessageCard } from "../components/messages/MessagePresentation";
import { ToolbarIcon } from "../components/ToolbarIcon";
import { SEARCH_PLACEHOLDERS } from "../lib/searchPlaceholders";
import { toggleValue } from "../lib/viewUtils";
import type { useHistoryController } from "./useHistoryController";

type HistoryController = ReturnType<typeof useHistoryController>;

export function HistoryDetailPane({
  history,
  advancedSearchEnabled,
  setAdvancedSearchEnabled,
  zoomPercent,
  canZoomIn,
  canZoomOut,
  applyZoomAction,
}: {
  history: HistoryController;
  advancedSearchEnabled: boolean;
  setAdvancedSearchEnabled: Dispatch<SetStateAction<boolean>>;
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  applyZoomAction: (action: "in" | "out" | "reset") => Promise<void>;
}) {
  return (
    <div className="history-view">
      <div className="msg-header">
        <div className="msg-header-top">
          <div className="msg-header-title">{history.selectedTitle}</div>
          <div className="msg-toolbar">
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
                  const nextScope = event.target.value;
                  history.setBulkExpandScope(
                    nextScope === "all" ? "all" : (nextScope as MessageCategory),
                  );
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
              <span className="zoom-level" title="Current zoom level (Cmd/Ctrl+0 resets)">
                {zoomPercent}%
              </span>
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
        <div className="msg-header-info">
          <span className="provider">{history.selectedProviderLabel}</span>
          <span>{history.selectedSummaryMessageCount}</span>
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
            title={`${history.prettyCategory(category)} messages (${history.historyCategoriesShortcutMap[category]})`}
            onClick={() => {
              history.setHistoryCategories((value) =>
                toggleValue<MessageCategory>(value, category),
              );
              history.setSessionPage(0);
            }}
          >
            {history.prettyCategory(category)}
            <span className="filter-count">{history.historyCategoryCounts[category]}</span>
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
          <button
            type="button"
            className={`search-mode-icon-btn${advancedSearchEnabled ? " active" : ""}`}
            onClick={() => {
              setAdvancedSearchEnabled((value) => !value);
              history.setSessionPage(0);
            }}
            aria-pressed={advancedSearchEnabled}
            aria-label={
              advancedSearchEnabled
                ? "Disable advanced search syntax"
                : "Enable advanced search syntax"
            }
            title={advancedSearchEnabled ? "Advanced syntax enabled" : "Advanced syntax disabled"}
          >
            <svg
              className="search-mode-glyph"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M8 8l-4 4l4 4M16 8l4 4l-4 4M13 6l-2 12" />
            </svg>
          </button>
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
              cardRef={history.focusMessageId === message.id ? history.refs.focusedMessageRef : null}
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
