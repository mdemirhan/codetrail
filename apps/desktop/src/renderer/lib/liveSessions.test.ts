import { describe, expect, it, vi } from "vitest";

import type { ProjectSummary, SessionSummary, WatchLiveStatusResponse } from "../app/types";

import {
  createLiveUiTracePayload,
  formatCompactLiveAge,
  getNextCompactLiveAgeUpdateDelayMs,
  selectRelevantLiveSession,
} from "./liveSessions";

describe("liveSessions", () => {
  it("prefers an exact selected-session match over a newer project-level match", () => {
    const selectedProject = {
      id: "project_1",
      provider: "claude",
      name: "Project One",
      path: "/workspace/project-one",
      providerProjectKey: null,
      repositoryUrl: null,
      resolutionState: null,
      resolutionSource: null,
      sessionCount: 2,
      messageCount: 20,
      bookmarkCount: 0,
      lastActivity: "2026-03-24T12:00:00.000Z",
    } satisfies ProjectSummary;
    const selectedSession = {
      id: "session_1",
      projectId: "project_1",
      provider: "claude",
      filePath: "/workspace/project-one/session-1.jsonl",
      title: "Selected session",
      modelNames: "claude-opus",
      startedAt: null,
      endedAt: null,
      durationMs: null,
      gitBranch: null,
      cwd: "/workspace/project-one",
      sessionIdentity: "selected-session",
      providerSessionId: "provider-session-1",
      sessionKind: null,
      canonicalProjectPath: null,
      repositoryUrl: null,
      gitCommitHash: null,
      lineageParentId: null,
      providerClient: null,
      providerSource: null,
      providerClientVersion: null,
      resolutionSource: null,
      worktreeLabel: null,
      worktreeSource: null,
      messageCount: 10,
      bookmarkCount: 0,
      tokenInputTotal: 0,
      tokenOutputTotal: 0,
    } satisfies SessionSummary;
    const sessions = [
      {
        provider: "claude",
        sessionIdentity: "project-other",
        sourceSessionId: "provider-session-2",
        filePath: "/workspace/project-one/session-2.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "working",
        statusText: "Responding",
        detailText: "newer project-level update",
        sourcePrecision: "passive",
        lastActivityAt: "2026-03-24T12:00:20.000Z",
        bestEffort: false,
      },
      {
        provider: "claude",
        sessionIdentity: "selected-session",
        sourceSessionId: "provider-session-1",
        filePath: "/workspace/project-one/session-1.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "waiting_for_input",
        statusText: "Waiting for input",
        detailText: "selected session update",
        sourcePrecision: "hook",
        lastActivityAt: "2026-03-24T12:00:10.000Z",
        bestEffort: false,
      },
    ] satisfies WatchLiveStatusResponse["sessions"];

    expect(
      selectRelevantLiveSession({
        sessions,
        selectionMode: "session",
        selectedProject,
        selectedSession,
      }),
    ).toMatchObject({
      sessionIdentity: "selected-session",
      sourceSessionId: "provider-session-1",
    });
  });

  it("falls back to the newest selected-project match when there is no selected-session match", () => {
    const selectedProject = {
      id: "project_1",
      provider: "codex",
      name: "Project One",
      path: "/workspace/project-one",
      providerProjectKey: null,
      repositoryUrl: null,
      resolutionState: null,
      resolutionSource: null,
      sessionCount: 2,
      messageCount: 20,
      bookmarkCount: 0,
      lastActivity: "2026-03-24T12:00:00.000Z",
    } satisfies ProjectSummary;
    const sessions = [
      {
        provider: "codex",
        sessionIdentity: "older",
        sourceSessionId: "older",
        filePath: "/workspace/project-one/.codex/sessions/older.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "working",
        statusText: "Responding",
        detailText: "older",
        sourcePrecision: "passive",
        lastActivityAt: "2026-03-24T12:00:10.000Z",
        bestEffort: false,
      },
      {
        provider: "codex",
        sessionIdentity: "newer",
        sourceSessionId: "newer",
        filePath: "/workspace/project-one/.codex/sessions/newer.jsonl",
        projectName: "Project One",
        projectPath: null,
        cwd: "/workspace/project-one",
        statusKind: "running_tool",
        statusText: "Running command",
        detailText: "newer",
        sourcePrecision: "passive",
        lastActivityAt: "2026-03-24T12:00:20.000Z",
        bestEffort: false,
      },
    ] satisfies WatchLiveStatusResponse["sessions"];

    expect(
      selectRelevantLiveSession({
        sessions,
        selectionMode: "project_all",
        selectedProject,
        selectedSession: null,
      }),
    ).toMatchObject({
      sessionIdentity: "newer",
      statusText: "Running command",
    });
  });

  it("does not leak a live session across provider-specific project rows that share a path", () => {
    const selectedProject = {
      id: "project_1",
      provider: "claude",
      name: "Project One",
      path: "/workspace/project-one",
      providerProjectKey: null,
      repositoryUrl: null,
      resolutionState: null,
      resolutionSource: null,
      sessionCount: 2,
      messageCount: 20,
      bookmarkCount: 0,
      lastActivity: "2026-03-24T12:00:00.000Z",
    } satisfies ProjectSummary;
    const sessions = [
      {
        provider: "codex",
        sessionIdentity: "codex-generic",
        sourceSessionId: "codex-generic",
        filePath: "/workspace/project-one/.codex/sessions/generic.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "working",
        statusText: "Working",
        detailText: null,
        sourcePrecision: "passive",
        lastActivityAt: "2026-03-24T12:00:21.000Z",
        bestEffort: false,
      },
      {
        provider: "gemini",
        sessionIdentity: "gemini-other",
        sourceSessionId: "gemini-other",
        filePath: "/workspace/project-one/.gemini/session.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "running_tool",
        statusText: "Running command",
        detailText: "npm test",
        sourcePrecision: "passive",
        lastActivityAt: "2026-03-24T12:00:22.000Z",
        bestEffort: false,
      },
    ] satisfies WatchLiveStatusResponse["sessions"];

    expect(
      selectRelevantLiveSession({
        sessions,
        selectionMode: "project_all",
        selectedProject,
        selectedSession: null,
      }),
    ).toBeNull();
  });

  it("prefers active_recently with detail over generic working with no detail", () => {
    const selectedProject = {
      id: "project_1",
      provider: "codex",
      name: "Project One",
      path: "/workspace/project-one",
      providerProjectKey: null,
      repositoryUrl: null,
      resolutionState: null,
      resolutionSource: null,
      sessionCount: 2,
      messageCount: 20,
      bookmarkCount: 0,
      lastActivity: "2026-03-24T12:00:00.000Z",
    } satisfies ProjectSummary;
    const sessions = [
      {
        provider: "codex",
        sessionIdentity: "generic-working",
        sourceSessionId: "generic-working",
        filePath: "/workspace/project-one/.codex/sessions/generic.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "working",
        statusText: "Working",
        detailText: null,
        sourcePrecision: "passive",
        lastActivityAt: "2026-03-24T12:00:21.000Z",
        bestEffort: false,
      },
      {
        provider: "codex",
        sessionIdentity: "recent-with-detail",
        sourceSessionId: "recent-with-detail",
        filePath: "/workspace/project-one/.codex/sessions/recent-with-detail.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "active_recently",
        statusText: "Session updated",
        detailText: "Review findings ready",
        sourcePrecision: "hook",
        lastActivityAt: "2026-03-24T12:00:20.000Z",
        bestEffort: false,
      },
    ] satisfies WatchLiveStatusResponse["sessions"];

    expect(
      selectRelevantLiveSession({
        sessions,
        selectionMode: "project_all",
        selectedProject,
        selectedSession: null,
      }),
    ).toMatchObject({
      provider: "codex",
      sessionIdentity: "recent-with-detail",
    });
  });

  it("breaks score ties in favor of hook precision", () => {
    const selectedProject = {
      id: "project_1",
      provider: "codex",
      name: "Project One",
      path: "/workspace/project-one",
      providerProjectKey: null,
      repositoryUrl: null,
      resolutionState: null,
      resolutionSource: null,
      sessionCount: 2,
      messageCount: 20,
      bookmarkCount: 0,
      lastActivity: "2026-03-24T12:00:00.000Z",
    } satisfies ProjectSummary;
    const sessions = [
      {
        provider: "codex",
        sessionIdentity: "passive-working",
        sourceSessionId: "passive-working",
        filePath: "/workspace/project-one/.codex/sessions/passive.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "working",
        statusText: "Responding",
        detailText: "Reviewing changes",
        sourcePrecision: "passive",
        lastActivityAt: "2026-03-24T12:00:21.000Z",
        bestEffort: false,
      },
      {
        provider: "codex",
        sessionIdentity: "hook-working",
        sourceSessionId: "hook-working",
        filePath: "/workspace/project-one/.codex/sessions/hook.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "working",
        statusText: "Responding",
        detailText: "Reviewing changes",
        sourcePrecision: "hook",
        lastActivityAt: "2026-03-24T12:00:21.000Z",
        bestEffort: false,
      },
    ] satisfies WatchLiveStatusResponse["sessions"];

    expect(
      selectRelevantLiveSession({
        sessions,
        selectionMode: "project_all",
        selectedProject,
        selectedSession: null,
      }),
    ).toMatchObject({
      provider: "codex",
      sessionIdentity: "hook-working",
    });
  });

  it("breaks remaining ties in favor of non-best-effort sessions", () => {
    const selectedProject = {
      id: "project_1",
      provider: "codex",
      name: "Project One",
      path: "/workspace/project-one",
      providerProjectKey: null,
      repositoryUrl: null,
      resolutionState: null,
      resolutionSource: null,
      sessionCount: 2,
      messageCount: 20,
      bookmarkCount: 0,
      lastActivity: "2026-03-24T12:00:00.000Z",
    } satisfies ProjectSummary;
    const sessions = [
      {
        provider: "codex",
        sessionIdentity: "best-effort",
        sourceSessionId: "best-effort",
        filePath: "/workspace/project-one/.codex/sessions/best-effort.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "working",
        statusText: "Responding",
        detailText: "Reviewing changes",
        sourcePrecision: "hook",
        lastActivityAt: "2026-03-24T12:00:21.000Z",
        bestEffort: true,
      },
      {
        provider: "codex",
        sessionIdentity: "clean",
        sourceSessionId: "clean",
        filePath: "/workspace/project-one/.codex/sessions/clean.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "working",
        statusText: "Responding",
        detailText: "Reviewing changes",
        sourcePrecision: "hook",
        lastActivityAt: "2026-03-24T12:00:21.000Z",
        bestEffort: false,
      },
    ] satisfies WatchLiveStatusResponse["sessions"];

    expect(
      selectRelevantLiveSession({
        sessions,
        selectionMode: "project_all",
        selectedProject,
        selectedSession: null,
      }),
    ).toMatchObject({
      provider: "codex",
      sessionIdentity: "clean",
    });
  });

  it("formats compact timer labels without zero-padded seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T12:01:05.000Z"));

    expect(formatCompactLiveAge("2026-03-24T12:01:04.500Z")).toBe("just now");
    expect(formatCompactLiveAge("2026-03-24T12:01:00.000Z")).toBe("5s ago");
    expect(formatCompactLiveAge("2026-03-24T12:00:06.000Z")).toBe("59s ago");
    expect(formatCompactLiveAge("2026-03-24T12:00:05.000Z")).toBe("1m ago");
    expect(formatCompactLiveAge("2026-03-24T11:01:05.000Z")).toBe("1h ago");

    vi.useRealTimers();
  });

  it("schedules the next timer update at the next visible boundary", () => {
    expect(
      getNextCompactLiveAgeUpdateDelayMs(
        "2026-03-24T12:01:00.000Z",
        Date.parse("2026-03-24T12:01:05.250Z"),
      ),
    ).toBe(750);
    expect(
      getNextCompactLiveAgeUpdateDelayMs(
        "2026-03-24T12:00:00.000Z",
        Date.parse("2026-03-24T12:05:12.000Z"),
      ),
    ).toBe(48_000);
  });

  it("does not fall back to a project-level live session while viewing a different session", () => {
    const selectedProject = {
      id: "project_1",
      provider: "codex",
      name: "Project One",
      path: "/workspace/project-one",
      providerProjectKey: null,
      repositoryUrl: null,
      resolutionState: null,
      resolutionSource: null,
      sessionCount: 2,
      messageCount: 20,
      bookmarkCount: 0,
      lastActivity: "2026-03-24T12:00:00.000Z",
    } satisfies ProjectSummary;
    const selectedSession = {
      id: "session_1",
      projectId: "project_1",
      provider: "codex",
      filePath: "/workspace/project-one/.codex/sessions/selected.jsonl",
      title: "Selected session",
      modelNames: "gpt-5",
      startedAt: null,
      endedAt: null,
      durationMs: null,
      gitBranch: null,
      cwd: "/workspace/project-one",
      sessionIdentity: "selected",
      providerSessionId: "selected",
      sessionKind: null,
      canonicalProjectPath: null,
      repositoryUrl: null,
      gitCommitHash: null,
      lineageParentId: null,
      providerClient: null,
      providerSource: null,
      providerClientVersion: null,
      resolutionSource: null,
      worktreeLabel: null,
      worktreeSource: null,
      messageCount: 10,
      bookmarkCount: 0,
      tokenInputTotal: 0,
      tokenOutputTotal: 0,
    } satisfies SessionSummary;
    const sessions = [
      {
        provider: "codex",
        sessionIdentity: "other-live-session",
        sourceSessionId: "other-live-session",
        filePath: "/workspace/project-one/.codex/sessions/other.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "working",
        statusText: "Responding",
        detailText: "other session is active",
        sourcePrecision: "passive",
        lastActivityAt: "2026-03-24T12:00:20.000Z",
        bestEffort: false,
      },
    ] satisfies WatchLiveStatusResponse["sessions"];

    expect(
      selectRelevantLiveSession({
        sessions,
        selectionMode: "session",
        selectedProject,
        selectedSession,
      }),
    ).toBeNull();
  });

  it("serializes the displayed live row and candidate sessions for UI tracing", () => {
    const selectedProject = {
      id: "project_1",
      provider: "codex",
      name: "Project One",
      path: "/workspace/project-one",
      providerProjectKey: null,
      repositoryUrl: null,
      resolutionState: null,
      resolutionSource: null,
      sessionCount: 2,
      messageCount: 20,
      bookmarkCount: 0,
      lastActivity: "2026-03-24T12:00:00.000Z",
    } satisfies ProjectSummary;
    const selectedSession = {
      id: "session_1",
      projectId: "project_1",
      provider: "codex",
      filePath: "/workspace/project-one/.codex/sessions/selected.jsonl",
      title: "Selected session",
      modelNames: "gpt-5",
      startedAt: null,
      endedAt: null,
      durationMs: null,
      gitBranch: null,
      cwd: "/workspace/project-one",
      sessionIdentity: "selected",
      providerSessionId: "selected",
      sessionKind: null,
      canonicalProjectPath: null,
      repositoryUrl: null,
      gitCommitHash: null,
      lineageParentId: null,
      providerClient: null,
      providerSource: null,
      providerClientVersion: null,
      resolutionSource: null,
      worktreeLabel: null,
      worktreeSource: null,
      metadataJson: null,
      messageCount: 10,
      bookmarkCount: 0,
      tokenInputTotal: 0,
      tokenOutputTotal: 0,
    } satisfies SessionSummary;
    const sessions = [
      {
        provider: "codex",
        sessionIdentity: "selected",
        sourceSessionId: "selected",
        filePath: "/workspace/project-one/.codex/sessions/selected.jsonl",
        projectName: "Project One",
        projectPath: "/workspace/project-one",
        cwd: "/workspace/project-one",
        statusKind: "running_tool",
        statusText: "Running command",
        detailText: "bun run test",
        sourcePrecision: "passive",
        lastActivityAt: "2026-03-24T12:00:20.000Z",
        bestEffort: false,
      },
    ] satisfies WatchLiveStatusResponse["sessions"];

    expect(
      createLiveUiTracePayload({
        sessions,
        selectionMode: "session",
        selectedProject,
        selectedSession,
      }),
    ).toMatchObject({
      selectionMode: "session",
      selectedProjectId: "project_1",
      selectedSessionId: "session_1",
      selectedSessionIdentity: "selected",
      displayedMatchType: "session",
      displayedRankingReason: "running_tool priority",
      renderedSummary: "Live · Codex · Running command · bun run test",
      displayedSession: {
        sessionIdentity: "selected",
        statusKind: "running_tool",
      },
      candidateSessions: [
        {
          sessionIdentity: "selected",
          statusText: "Running command",
        },
      ],
    });
  });

  it("matches Windows project and file paths case-insensitively", () => {
    const selectedProject = {
      id: "project_windows",
      provider: "codex",
      name: "Repo",
      path: "C:\\Repo",
      providerProjectKey: null,
      repositoryUrl: null,
      resolutionState: null,
      resolutionSource: null,
      sessionCount: 1,
      messageCount: 1,
      bookmarkCount: 0,
      lastActivity: "2026-03-24T12:00:00.000Z",
    } satisfies ProjectSummary;
    const selectedSession = {
      id: "session_windows",
      projectId: "project_windows",
      provider: "codex",
      filePath: "c:/repo/.codex/sessions/session-1.jsonl",
      title: "Selected session",
      modelNames: "gpt-5",
      startedAt: null,
      endedAt: null,
      durationMs: null,
      gitBranch: null,
      cwd: "c:/repo",
      sessionIdentity: "session-windows",
      providerSessionId: "session-windows",
      sessionKind: null,
      canonicalProjectPath: null,
      repositoryUrl: null,
      gitCommitHash: null,
      lineageParentId: null,
      providerClient: null,
      providerSource: null,
      providerClientVersion: null,
      resolutionSource: null,
      worktreeLabel: null,
      worktreeSource: null,
      messageCount: 1,
      bookmarkCount: 0,
      tokenInputTotal: 0,
      tokenOutputTotal: 0,
    } satisfies SessionSummary;
    const sessions = [
      {
        provider: "codex",
        sessionIdentity: "session-windows",
        sourceSessionId: "session-windows",
        filePath: "C:\\REPO\\.codex\\sessions\\SESSION-1.JSONL",
        projectName: "Repo",
        projectPath: "C:\\REPO",
        cwd: "C:\\REPO",
        statusKind: "working",
        statusText: "Responding",
        detailText: "windows path",
        sourcePrecision: "passive",
        lastActivityAt: "2026-03-24T12:00:20.000Z",
        bestEffort: false,
      },
    ] satisfies WatchLiveStatusResponse["sessions"];

    expect(
      selectRelevantLiveSession({
        sessions,
        selectionMode: "session",
        selectedProject,
        selectedSession,
      }),
    ).toMatchObject({
      sessionIdentity: "session-windows",
      sourceSessionId: "session-windows",
    });
  });
});
