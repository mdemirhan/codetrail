import type { IpcResponse } from "@codetrail/core";
import { useCallback, useEffect, useState } from "react";

import { deriveSessionTitle, formatDate, sessionActivityOf } from "../../lib/viewUtils";
import { ToolbarIcon } from "../ToolbarIcon";
import { scheduleSelectedSessionScroll } from "./sessionAutoScroll";

type SessionSummary = IpcResponse<"sessions:list">["sessions"][number];

export function SessionPane({
  sortedSessions,
  selectedSessionId,
  collapsed,
  onToggleCollapsed,
  onSelectSession,
}: {
  sortedSessions: SessionSummary[];
  selectedSessionId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
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
        {sortedSessions.map((session) => (
          <button
            key={session.id}
            type="button"
            ref={session.id === selectedSessionId ? selectedSessionRef : null}
            className={session.id === selectedSessionId ? "session-item active" : "session-item"}
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
