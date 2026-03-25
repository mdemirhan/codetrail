import { isPathWithinRoot, normalizePathForComparison } from "@codetrail/core/browser";

import type {
  HistorySelectionMode,
  ProjectSummary,
  SessionSummary,
  WatchLiveStatusResponse,
} from "../app/types";

type LiveSession = WatchLiveStatusResponse["sessions"][number];

function normalizePath(value: string | null | undefined): string | null {
  return typeof value === "string" ? normalizePathForComparison(value) : null;
}

function matchesPathPrefix(filePath: string | null | undefined, basePath: string | null): boolean {
  if (!filePath || !basePath) {
    return false;
  }
  return isPathWithinRoot(filePath, basePath);
}

function matchesSelectedSession(
  session: LiveSession,
  selectedSession: SessionSummary | null,
): boolean {
  if (!selectedSession || session.provider !== selectedSession.provider) {
    return false;
  }
  if (
    selectedSession.sessionIdentity &&
    session.sessionIdentity === selectedSession.sessionIdentity
  ) {
    return true;
  }
  if (
    selectedSession.providerSessionId &&
    session.sourceSessionId === selectedSession.providerSessionId
  ) {
    return true;
  }
  if (normalizePath(session.filePath) === normalizePath(selectedSession.filePath)) {
    return true;
  }
  return false;
}

function matchesSelectedProject(
  session: LiveSession,
  selectedProject: ProjectSummary | null,
): boolean {
  if (!selectedProject || session.provider !== selectedProject.provider) {
    return false;
  }
  const projectPath = normalizePath(selectedProject.path);
  if (!projectPath) {
    return false;
  }
  return (
    normalizePath(session.projectPath) === projectPath ||
    normalizePath(session.cwd) === projectPath ||
    matchesPathPrefix(session.filePath, projectPath)
  );
}

export function selectRelevantLiveSession({
  sessions,
  selectionMode,
  selectedProject,
  selectedSession,
}: {
  sessions: LiveSession[];
  selectionMode: HistorySelectionMode;
  selectedProject: ProjectSummary | null;
  selectedSession: SessionSummary | null;
}): LiveSession | null {
  if (sessions.length === 0) {
    return null;
  }

  let bestSessionMatch: LiveSession | null = null;
  let bestProjectMatch: LiveSession | null = null;
  let bestSessionMatchAtMs = Number.NEGATIVE_INFINITY;
  let bestProjectMatchAtMs = Number.NEGATIVE_INFINITY;

  for (const session of sessions) {
    const sessionLastActivityAtMs = new Date(session.lastActivityAt).valueOf();
    if (
      matchesSelectedSession(session, selectedSession) &&
      sessionLastActivityAtMs > bestSessionMatchAtMs
    ) {
      bestSessionMatch = session;
      bestSessionMatchAtMs = sessionLastActivityAtMs;
      continue;
    }
    if (
      selectionMode !== "session" &&
      matchesSelectedProject(session, selectedProject) &&
      sessionLastActivityAtMs > bestProjectMatchAtMs
    ) {
      bestProjectMatch = session;
      bestProjectMatchAtMs = sessionLastActivityAtMs;
    }
  }

  return bestSessionMatch ?? bestProjectMatch;
}

export function formatCompactLiveAge(isoTimestamp: string, nowMs = Date.now()): string {
  const timestampMs = new Date(isoTimestamp).valueOf();
  const ageMs = Number.isFinite(timestampMs) ? Math.max(0, nowMs - timestampMs) : 0;
  if (ageMs < 1_000) {
    return "just now";
  }
  if (ageMs < 60_000) {
    return `${Math.floor(ageMs / 1000)}s ago`;
  }
  if (ageMs < 3_600_000) {
    return `${Math.floor(ageMs / 60_000)}m ago`;
  }
  return `${Math.floor(ageMs / 3_600_000)}h ago`;
}

export function getNextCompactLiveAgeUpdateDelayMs(
  isoTimestamp: string,
  nowMs = Date.now(),
): number {
  const timestampMs = new Date(isoTimestamp).valueOf();
  if (!Number.isFinite(timestampMs)) {
    return 1_000;
  }
  const ageMs = Math.max(0, nowMs - timestampMs);
  if (ageMs < 60_000) {
    return Math.max(250, 1_000 - (ageMs % 1_000));
  }
  if (ageMs < 3_600_000) {
    return Math.max(250, 60_000 - (ageMs % 60_000));
  }
  return Math.max(250, 3_600_000 - (ageMs % 3_600_000));
}
