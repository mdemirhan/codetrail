import type { SessionSummary } from "../app/types";

export function findSessionSummaryById(
  sessionId: string,
  sortedSessions: SessionSummary[],
  treeProjectSessionsByProjectId: Record<string, SessionSummary[]>,
): SessionSummary | null {
  const sortedSession = sortedSessions.find((candidate) => candidate.id === sessionId);
  if (sortedSession) {
    return sortedSession;
  }

  for (const projectSessions of Object.values(treeProjectSessionsByProjectId)) {
    const session = projectSessions.find((candidate) => candidate.id === sessionId);
    if (session) {
      return session;
    }
  }

  return null;
}
