import type { IpcResponse } from "@codetrail/core";
import { useCallback, useEffect, useState } from "react";

import { deriveSessionTitle, formatDate, sessionActivityOf } from "../../lib/viewUtils";
import { ToolbarIcon } from "../ToolbarIcon";
import { scheduleSelectedSessionScroll } from "./sessionAutoScroll";

type SessionSummary = IpcResponse<"sessions:list">["sessions"][number];

export function SessionPane({
  sortedSessions,
  selectedSessionId,
  allSessionsCount,
  allSessionsSelected,
  bookmarksCount,
  bookmarksSelected,
  collapsed,
  onToggleCollapsed,
  onSelectAllSessions,
  onSelectBookmarks,
  onSelectSession,
}: {
  sortedSessions: SessionSummary[];
  selectedSessionId: string;
  allSessionsCount: number;
  allSessionsSelected: boolean;
  bookmarksCount: number;
  bookmarksSelected: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectAllSessions: () => void;
  onSelectBookmarks: () => void;
  onSelectSession: (sessionId: string) => void;
}) {
  const [selectedSessionElement, setSelectedSessionElement] = useState<HTMLButtonElement | null>(
    null,
  );
  const selectedSessionRef = useCallback((node: HTMLButtonElement | null) => {
    setSelectedSessionElement(node);
  }, []);

  useEffect(() => {
    return scheduleSelectedSessionScroll({
      selectedSessionId,
      collapsed,
      selectedSessionElement,
    });
  }, [collapsed, selectedSessionElement, selectedSessionId]);

  return (
    <aside className={`panel session-pane${collapsed ? " collapsed" : ""}`}>
      <div className="panel-header">
        <div className="panel-header-left">
          <span className="panel-title">Sessions</span>
          <span className="panel-count">{sortedSessions.length}</span>
        </div>
        <button
          type="button"
          className="collapse-btn"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand Sessions pane" : "Collapse Sessions pane"}
          title={collapsed ? "Expand Sessions" : "Collapse Sessions"}
        >
          <ToolbarIcon name="chevronLeft" />
        </button>
      </div>
      <div className="list-scroll session-list">
        <button
          type="button"
          className={
            allSessionsSelected ? "session-item all-sessions-item active" : "session-item all-sessions-item"
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
            className={
              bookmarksSelected
                ? "session-item bookmarks-item active"
                : "session-item bookmarks-item"
            }
            onClick={onSelectBookmarks}
          >
            <div className="session-preview">Bookmarked messages</div>
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
            onClick={() => onSelectSession(session.id)}
          >
            <div className="session-preview">{deriveSessionTitle(session)}</div>
            <div className="session-meta">
              <span className="msg-count">{session.messageCount} msgs</span>
              <span className="session-time">{formatDate(sessionActivityOf(session))}</span>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
