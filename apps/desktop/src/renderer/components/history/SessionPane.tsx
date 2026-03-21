import { type Ref, useCallback, useEffect, useRef, useState } from "react";

import type { SessionSummary } from "../../app/types";
import { useClickOutside } from "../../hooks/useClickOutside";
import { deriveSessionTitle, formatDate, sessionActivityOf } from "../../lib/viewUtils";
import { ToolbarIcon } from "../ToolbarIcon";
import { HistoryListContextMenu } from "./HistoryListContextMenu";
import { scheduleSelectedSessionScroll } from "./sessionAutoScroll";

function SessionPaneMenuIcon() {
  return (
    <svg className="project-pane-inline-icon" viewBox="0 0 16 16" aria-hidden>
      <title>More options</title>
      <circle cx="3.25" cy="8" r="1.1" fill="currentColor" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" />
      <circle cx="12.75" cy="8" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function SessionPane({
  sortedSessions,
  selectedSessionId,
  sortDirection,
  allSessionsCount,
  allSessionsSelected,
  bookmarksCount,
  bookmarksSelected,
  collapsed,
  canCopySession,
  canOpenSessionLocation,
  canDeleteSession,
  onToggleCollapsed,
  onToggleSortDirection,
  onCopySession,
  onOpenSessionLocation,
  onDeleteSession,
  onSelectAllSessions,
  onSelectBookmarks,
  onSelectSession,
  listRef,
}: {
  sortedSessions: SessionSummary[];
  selectedSessionId: string;
  sortDirection: "asc" | "desc";
  allSessionsCount: number;
  allSessionsSelected: boolean;
  bookmarksCount: number;
  bookmarksSelected: boolean;
  collapsed: boolean;
  canCopySession: boolean;
  canOpenSessionLocation: boolean;
  canDeleteSession: boolean;
  onToggleCollapsed: () => void;
  onToggleSortDirection: () => void;
  onCopySession: (sessionId?: string) => void;
  onOpenSessionLocation: (sessionId?: string) => void;
  onDeleteSession: (sessionId?: string) => void;
  onSelectAllSessions: () => void;
  onSelectBookmarks: () => void;
  onSelectSession: (sessionId: string) => void;
  listRef?: Ref<HTMLDivElement>;
}) {
  const [selectedSessionElement, setSelectedSessionElement] = useState<HTMLButtonElement | null>(
    null,
  );
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const selectedItemId = allSessionsSelected
    ? "__project_all__"
    : bookmarksSelected
      ? "__bookmarks__"
      : selectedSessionId;
  const sortTooltip =
    sortDirection === "asc"
      ? "Oldest first (sessions). Click to switch to newest first."
      : "Newest first (sessions). Click to switch to oldest first.";
  const sortAriaLabel =
    sortDirection === "asc"
      ? "Oldest first (sessions). Switch to newest first"
      : "Newest first (sessions). Switch to oldest first";
  const selectedSessionRef = useCallback((node: HTMLButtonElement | null) => {
    setSelectedSessionElement(node);
  }, []);

  useClickOutside(overflowMenuRef, overflowMenuOpen, () => setOverflowMenuOpen(false));

  useEffect(() => {
    return scheduleSelectedSessionScroll({
      selectedItemId,
      collapsed,
      selectedSessionElement,
    });
  }, [collapsed, selectedItemId, selectedSessionElement]);

  return (
    <aside className={`panel history-focus-pane session-pane${collapsed ? " collapsed" : ""}`}>
      <div className="panel-header">
        <div className="panel-header-left">
          <span className="panel-title">Sessions</span>
          {!collapsed ? <span className="panel-count">{sortedSessions.length}</span> : null}
        </div>
        <div className="pane-head-controls">
          {!collapsed ? (
            <>
              <button
                type="button"
                className="collapse-btn"
                onClick={onToggleSortDirection}
                aria-label={sortAriaLabel}
                title={sortTooltip}
              >
                <ToolbarIcon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} />
              </button>
              <div className="tb-dropdown session-pane-overflow-dropdown" ref={overflowMenuRef}>
                <button
                  type="button"
                  className="collapse-btn tb-dropdown-trigger"
                  onClick={() => setOverflowMenuOpen((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={overflowMenuOpen}
                  aria-label="Session options"
                  title="Session actions"
                >
                  <SessionPaneMenuIcon />
                </button>
                {overflowMenuOpen ? (
                  <dialog
                    className="tb-dropdown-menu tb-dropdown-menu-right project-pane-header-menu project-pane-overflow-menu"
                    open
                    aria-label="Session options"
                  >
                    <button
                      type="button"
                      className="tb-dropdown-item project-pane-overflow-item"
                      onClick={() => {
                        onCopySession();
                        setOverflowMenuOpen(false);
                      }}
                      disabled={!canCopySession}
                    >
                      <span className="project-pane-overflow-icon" aria-hidden>
                        <ToolbarIcon name="copy" />
                      </span>
                      <span>Copy</span>
                    </button>
                    <button
                      type="button"
                      className="tb-dropdown-item project-pane-overflow-item"
                      onClick={() => {
                        onOpenSessionLocation();
                        setOverflowMenuOpen(false);
                      }}
                      disabled={!canOpenSessionLocation}
                    >
                      <span className="project-pane-overflow-icon" aria-hidden>
                        <ToolbarIcon name="folderOpen" />
                      </span>
                      <span>Open Folder</span>
                    </button>
                    <div className="tb-dropdown-separator" />
                    <button
                      type="button"
                      className="tb-dropdown-item project-pane-overflow-item project-pane-overflow-item-danger"
                      onClick={() => {
                        onDeleteSession();
                        setOverflowMenuOpen(false);
                      }}
                      disabled={!canDeleteSession}
                    >
                      <span className="project-pane-overflow-icon" aria-hidden>
                        <ToolbarIcon name="trash" />
                      </span>
                      <span>Delete</span>
                    </button>
                  </dialog>
                ) : null}
              </div>
            </>
          ) : null}
          <button
            type="button"
            className="collapse-btn pane-collapse-btn"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand Sessions pane" : "Collapse Sessions pane"}
            title={
              collapsed
                ? "Expand Sessions (Cmd/Ctrl+Shift+B)"
                : "Collapse Sessions (Cmd/Ctrl+Shift+B)"
            }
          >
            <ToolbarIcon name="chevronLeft" />
          </button>
        </div>
      </div>
      <div className="list-scroll session-list" ref={listRef} tabIndex={-1}>
        <button
          type="button"
          ref={allSessionsSelected ? selectedSessionRef : null}
          className={
            allSessionsSelected
              ? "session-item all-sessions-item active"
              : "session-item all-sessions-item"
          }
          onClick={onSelectAllSessions}
        >
          <div className="session-preview">All Sessions</div>
          <div className="session-meta">
            <span className="msg-count">{allSessionsCount} msgs</span>
            <span className="session-time">Project-wide</span>
          </div>
        </button>
        {bookmarksCount > 0 ? (
          <button
            type="button"
            ref={bookmarksSelected ? selectedSessionRef : null}
            className={
              bookmarksSelected
                ? "session-item bookmarks-item active"
                : "session-item bookmarks-item"
            }
            onClick={onSelectBookmarks}
          >
            <div className="session-preview">Bookmarked Messages</div>
            <div className="session-meta">
              <span className="msg-count">{bookmarksCount} msgs</span>
              <span className="session-time">Project-wide</span>
            </div>
          </button>
        ) : null}
        {sortedSessions.map((session) => (
          <button
            key={session.id}
            type="button"
            ref={session.id === selectedSessionId && !bookmarksSelected ? selectedSessionRef : null}
            className={
              session.id === selectedSessionId && !bookmarksSelected
                ? "session-item active"
                : "session-item"
            }
            onClick={() => {
              setContextMenu(null);
              onSelectSession(session.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelectSession(session.id);
              setContextMenu({
                sessionId: session.id,
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <div className="session-preview">{deriveSessionTitle(session)}</div>
            <div className="session-meta">
              <span className="msg-count">{session.messageCount} msgs</span>
              <span className="session-time">{formatDate(sessionActivityOf(session))}</span>
            </div>
          </button>
        ))}
      </div>
      <HistoryListContextMenu
        open={Boolean(contextMenu)}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        onClose={() => setContextMenu(null)}
        groups={
          contextMenu
            ? [
                [
                  {
                    id: "copy-session",
                    label: "Copy",
                    icon: "copy",
                    onSelect: () => onCopySession(contextMenu.sessionId),
                  },
                  {
                    id: "open-session-folder",
                    label: "Open Folder",
                    icon: "folderOpen",
                    onSelect: () => onOpenSessionLocation(contextMenu.sessionId),
                  },
                ],
                [
                  {
                    id: "delete-session",
                    label: "Delete",
                    icon: "trash",
                    tone: "danger",
                    onSelect: () => onDeleteSession(contextMenu.sessionId),
                  },
                ],
              ]
            : []
        }
      />
    </aside>
  );
}
