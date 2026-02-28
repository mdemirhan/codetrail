import type { IpcResponse } from "@codetrail/core";

import { deriveSessionTitle, formatDate, sessionActivityOf } from "../../lib/viewUtils";

type SessionSortMode = "recent" | "messages";
type SessionSummary = IpcResponse<"sessions:list">["sessions"][number];

export function SessionPane({
  sortedSessions,
  selectedSessionId,
  sessionSortMode,
  onSessionSortChange,
  onSelectSession,
  onOpenSessionLocation,
}: {
  sortedSessions: SessionSummary[];
  selectedSessionId: string;
  sessionSortMode: SessionSortMode;
  onSessionSortChange: (mode: SessionSortMode) => void;
  onSelectSession: (sessionId: string) => void;
  onOpenSessionLocation: () => void;
}) {
  const selectedSession = sortedSessions.find((session) => session.id === selectedSessionId);

  return (
    <aside className="pane session-pane">
      <div className="pane-head">
        <h2>Sessions</h2>
        <div className="pane-head-controls">
          <span>{sortedSessions.length}</span>
          <select
            value={sessionSortMode}
            onChange={(event) => onSessionSortChange(event.target.value as SessionSortMode)}
          >
            <option value="recent">Recent</option>
            <option value="messages">Messages</option>
          </select>
        </div>
      </div>
      <div className="session-list">
        {sortedSessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className={session.id === selectedSessionId ? "list-item active" : "list-item"}
            onClick={() => onSelectSession(session.id)}
          >
            <span className="session-title">{deriveSessionTitle(session)}</span>
            <small>
              <span className="meta-count">{session.messageCount} msgs</span> |{" "}
              {formatDate(sessionActivityOf(session))}
            </small>
          </button>
        ))}
      </div>
      {selectedSession ? (
        <button type="button" className="context-action" onClick={onOpenSessionLocation}>
          Open Session Location
        </button>
      ) : null}
    </aside>
  );
}
