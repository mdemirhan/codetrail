import { isPathWithinRoot, normalizePathForComparison } from "@codetrail/core/browser";
import type { IpcRequestInput } from "@codetrail/core/browser";

import type {
  HistorySelectionMode,
  ProjectSummary,
  SessionSummary,
  WatchLiveStatusResponse,
} from "../app/types";

type LiveSession = WatchLiveStatusResponse["sessions"][number];
export type RelevantLiveSessionSelection = {
  session: LiveSession | null;
  matchType: "session" | "project" | "none";
};

const SESSION_RANK_WEIGHTS: Record<LiveSession["statusKind"], number> = {
  waiting_for_approval: 700,
  waiting_for_input: 690,
  running_tool: 600,
  thinking: 520,
  working: 500,
  active_recently: 420,
  idle: 120,
  unknown: 0,
};

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
  if (!selectedProject) {
    return false;
  }
  if (session.provider !== selectedProject.provider) {
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

// Project-level live view follows the selected project record, not just the workspace path.
// Multiple providers can index the same path as separate project rows, so project matching must
// stay provider-scoped or the live row leaks activity across sibling project entries.

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
  return selectRelevantLiveSessionCandidate({
    sessions,
    selectionMode,
    selectedProject,
    selectedSession,
  }).session;
}

export function createLiveUiTracePayload({
  sessions,
  selectionMode,
  selectedProject,
  selectedSession,
  selection,
}: {
  sessions: LiveSession[];
  selectionMode: HistorySelectionMode;
  selectedProject: ProjectSummary | null;
  selectedSession: SessionSummary | null;
  selection?: RelevantLiveSessionSelection;
}): IpcRequestInput<"debug:recordLiveUiTrace"> {
  const selected =
    selection ??
    selectRelevantLiveSessionCandidate({
      sessions,
      selectionMode,
      selectedProject,
      selectedSession,
    });
  const displayedSession = selected.session ? serializeLiveSession(selected.session) : null;
  return {
    selectionMode,
    selectedProjectId: selectedProject?.id ?? null,
    selectedProjectPath: selectedProject?.path ?? null,
    selectedSessionId: selectedSession?.id ?? null,
    selectedSessionIdentity: selectedSession?.sessionIdentity ?? null,
    displayedMatchType: selected.matchType,
    displayedSession,
    displayedRankingReason: selected.session ? getLiveSessionRankingReason(selected.session) : null,
    candidateSessions: sessions.slice(0, 20).map(serializeLiveSession),
    renderedSummary: displayedSession ? buildLiveSummary(displayedSession) : null,
  };
}

export function selectRelevantLiveSessionCandidate({
  sessions,
  selectionMode,
  selectedProject,
  selectedSession,
}: {
  sessions: LiveSession[];
  selectionMode: HistorySelectionMode;
  selectedProject: ProjectSummary | null;
  selectedSession: SessionSummary | null;
}): RelevantLiveSessionSelection {
  if (sessions.length === 0) {
    return {
      session: null,
      matchType: "none",
    };
  }

  let bestSessionMatch: LiveSession | null = null;
  let bestProjectMatch: LiveSession | null = null;
  let bestSessionMatchAtMs = Number.NEGATIVE_INFINITY;

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
    if (selectionMode !== "session" && matchesSelectedProject(session, selectedProject)) {
      if (!bestProjectMatch || compareLiveSessions(session, bestProjectMatch) < 0) {
        bestProjectMatch = session;
      }
    }
  }

  if (bestSessionMatch) {
    return {
      session: bestSessionMatch,
      matchType: "session",
    };
  }
  if (bestProjectMatch) {
    return {
      session: bestProjectMatch,
      matchType: "project",
    };
  }
  return {
    session: null,
    matchType: "none",
  };
}

export function buildLiveSummary(
  session: Pick<LiveSession, "provider" | "statusText" | "detailText">,
  liveTimer?: string | null,
): string {
  return [
    "Live",
    formatProviderLabel(session.provider),
    liveTimer ?? "",
    session.statusText,
    session.detailText ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function compareLiveSessions(left: LiveSession, right: LiveSession): number {
  const scoreDifference = getLiveSessionScore(right) - getLiveSessionScore(left);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }
  const activityDifference =
    new Date(right.lastActivityAt).valueOf() - new Date(left.lastActivityAt).valueOf();
  if (activityDifference !== 0) {
    return activityDifference;
  }
  const precisionDifference = getPrecisionWeight(right) - getPrecisionWeight(left);
  if (precisionDifference !== 0) {
    return precisionDifference;
  }
  const bestEffortDifference = Number(left.bestEffort) - Number(right.bestEffort);
  if (bestEffortDifference !== 0) {
    return bestEffortDifference;
  }
  return 0;
}

function getLiveSessionScore(session: LiveSession): number {
  const base = SESSION_RANK_WEIGHTS[session.statusKind];
  if (session.statusKind === "working") {
    if (session.detailText && !session.detailText.startsWith("Last ")) {
      return base + 20;
    }
    if (session.detailText?.startsWith("Last ")) {
      return base - 30;
    }
    if (!session.detailText) {
      return base - 90;
    }
  }
  if (session.statusKind === "active_recently" && session.detailText) {
    return base + 30;
  }
  if (session.statusKind === "active_recently" && !session.detailText) {
    return base - 40;
  }
  if (session.statusKind === "thinking" && !session.detailText) {
    return base - 20;
  }
  return base + (session.detailText ? 10 : 0);
}

function getLiveSessionRankingReason(session: LiveSession): string {
  if (session.statusKind === "waiting_for_approval") {
    return "waiting_for_approval priority";
  }
  if (session.statusKind === "waiting_for_input") {
    return "waiting_for_input priority";
  }
  if (session.statusKind === "running_tool") {
    return "running_tool priority";
  }
  if (session.statusKind === "working") {
    if (session.detailText?.startsWith("Last ")) {
      return "working with last-action fallback";
    }
    if (session.detailText) {
      return "working with current detail";
    }
    return "generic working";
  }
  if (session.statusKind === "thinking") {
    return session.detailText ? "thinking with detail" : "generic thinking";
  }
  if (session.statusKind === "active_recently") {
    return session.detailText ? "active_recently with detail" : "generic active_recently";
  }
  if (session.statusKind === "idle") {
    return "idle";
  }
  return "unknown";
}

function getPrecisionWeight(session: LiveSession): number {
  return session.sourcePrecision === "hook" ? 1 : 0;
}

function formatProviderLabel(provider: LiveSession["provider"]): string {
  if (provider === "codex") {
    return "Codex";
  }
  if (provider === "claude") {
    return "Claude";
  }
  return provider[0]?.toUpperCase() + provider.slice(1);
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

function serializeLiveSession(
  session: LiveSession,
): IpcRequestInput<"debug:recordLiveUiTrace">["candidateSessions"][number] {
  return {
    provider: session.provider,
    sessionIdentity: session.sessionIdentity,
    sourceSessionId: session.sourceSessionId,
    filePath: session.filePath,
    projectName: session.projectName,
    projectPath: session.projectPath,
    cwd: session.cwd,
    statusKind: session.statusKind,
    statusText: session.statusText,
    detailText: session.detailText,
    sourcePrecision: session.sourcePrecision,
    lastActivityAt: session.lastActivityAt,
    bestEffort: session.bestEffort,
  };
}
