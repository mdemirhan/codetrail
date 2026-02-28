import type { IpcResponse } from "@codetrail/core";
import { useEffect, useRef } from "react";

import { deriveSessionTitle, formatDate, sessionActivityOf } from "../../lib/viewUtils";

type SessionSummary = IpcResponse<"sessions:list">["sessions"][number];

export function SessionPane({
  sortedSessions,
  selectedSessionId,
  onSelectSession,
}: {
  sortedSessions: SessionSummary[];
  selectedSessionId: string;
  onSelectSession: (sessionId: string) => void;
}) {
  const selectedSessionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }
    selectedSessionRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedSessionId, sortedSessions]);

  return (
    <aside className="panel session-pane">
      <div className="panel-header">
        <span className="panel-title">Sessions</span>
        <span className="panel-count">{sortedSessions.length}</span>
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
