import { describe, expect, it, vi } from "vitest";

import {
  type IpcResponse,
  createProviderRecord,
  indexerConfigBaseSchema,
  paneStateBaseSchema,
} from "@codetrail/core";
import {
  createClaudeHookStateFixture,
  createLiveStatusFixture,
  createSettingsInfoFixture,
} from "@codetrail/core/testing";

import { registerIpcHandlers } from "./ipc";

const allNullPaneState = Object.fromEntries(
  Object.keys(paneStateBaseSchema.shape).map((k) => [k, null]),
) as IpcResponse<"ui:getPaneState">;
const allNullIndexerConfig = Object.fromEntries(
  Object.keys(indexerConfigBaseSchema.shape).map((k) => [k, null]),
) as IpcResponse<"indexer:getConfig">;
const settingsInfo = createSettingsInfoFixture({
  storage: {
    settingsFile: "/tmp/codetrail/ui-state.json",
    cacheDir: "/tmp/codetrail/cache",
    databaseFile: "/tmp/codetrail/codetrail.sqlite",
    bookmarksDatabaseFile: "/tmp/codetrail/codetrail.bookmarks.sqlite",
    userDataDir: "/tmp/codetrail",
  },
  pathValues: {
    copilotRoot: "/Users/test/.copilot/projects",
  },
});

function createClaudeHookState(input: { installed: boolean }) {
  return createClaudeHookStateFixture({
    logPath: "/tmp/codetrail/live-status/claude-hooks.jsonl",
    installed: input.installed,
  });
}

const emptyAiCodeStats = {
  summary: {
    writeEventCount: 0,
    measurableWriteEventCount: 0,
    writeSessionCount: 0,
    fileChangeCount: 0,
    distinctFilesTouchedCount: 0,
    linesAdded: 0,
    linesDeleted: 0,
    netLines: 0,
    multiFileWriteCount: 0,
    averageFilesPerWrite: 0,
  },
  changeTypeCounts: {
    add: 0,
    update: 0,
    delete: 0,
    move: 0,
  },
  providerStats: [],
  recentActivity: [],
  topFiles: [],
  topFileTypes: [],
} satisfies IpcResponse<"dashboard:getStats">["aiCodeStats"];

describe("registerIpcHandlers", () => {
  it("validates request payloads before invoking handlers", async () => {
    const registry = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    const onValidationError = vi.fn();

    registerIpcHandlers(
      {
        handle: (channel, handler) => {
          registry.set(channel, handler as (event: unknown, payload: unknown) => Promise<unknown>);
        },
      },
      {
        "app:getHealth": () => ({ status: "ok", version: "0.1.0" }),
        "app:flushState": () => ({ ok: true }),
        "app:setCommandState": () => ({ ok: true }),
        "app:getSettingsInfo": () => settingsInfo,
        "db:getSchemaVersion": () => ({ schemaVersion: 1 }),
        "dashboard:getStats": () => ({
          summary: {
            projectCount: 0,
            sessionCount: 0,
            messageCount: 0,
            bookmarkCount: 0,
            toolCallCount: 0,
            indexedFileCount: 0,
            indexedBytesTotal: 0,
            tokenInputTotal: 0,
            tokenOutputTotal: 0,
            totalDurationMs: 0,
            averageMessagesPerSession: 0,
            averageSessionDurationMs: 0,
            activeProviderCount: 0,
          },
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          providerCounts: createProviderRecord(() => 0),
          providerStats: [],
          recentActivity: [],
          topProjects: [],
          topModels: [],
          aiCodeStats: emptyAiCodeStats,
          activityWindowDays: 14,
        }),
        "indexer:refresh": (payload) => ({ jobId: payload.force ? "force-1" : "normal-1" }),
        "indexer:getStatus": () => ({
          running: false,
          queuedJobs: 0,
          activeJobId: null,
          completedJobs: 0,
        }),
        "projects:list": () => ({ projects: [] }),
        "projects:getCombinedDetail": (payload) => ({
          projectId: payload.projectId,
          totalCount: 0,
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          page: 0,
          pageSize: 100,
          focusIndex: null,
          messages: [],
        }),
        "sessions:list": () => ({ sessions: [] }),
        "sessions:listMany": () => ({ sessionsByProjectId: {} }),
        "sessions:getDetail": () => ({
          session: null,
          totalCount: 0,
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          page: 0,
          pageSize: 100,
          focusIndex: null,
          messages: [],
        }),
        "sessions:getTurn": () => ({
          session: null,
          anchorMessageId: "message_1",
          anchorMessage: null,
          turnNumber: 1,
          totalTurns: 1,
          previousTurnAnchorMessageId: null,
          nextTurnAnchorMessageId: null,
          firstTurnAnchorMessageId: "message_1",
          latestTurnAnchorMessageId: "message_1",
          totalCount: 0,
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          messages: [],
        }),
        "sessions:delete": (payload) => ({
          deleted: true,
          projectId: String(payload.sessionId),
          provider: "claude",
          sourceFormat: "jsonl_stream",
          removedMessageCount: 0,
          removedBookmarkCount: 0,
        }),
        "bookmarks:listProject": () => ({
          projectId: "project_1",
          totalCount: 0,
          filteredCount: 0,
          page: 0,
          pageSize: 100,
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          results: [],
        }),
        "bookmarks:getStates": () => ({
          projectId: "project_1",
          bookmarkedMessageIds: [],
        }),
        "bookmarks:toggle": () => ({
          bookmarked: true,
        }),
        "history:exportMessages": () => ({
          canceled: false,
          path: "/tmp/messages-export.md",
        }),
        "search:query": (payload) => ({
          query: payload.query,
          totalCount: 0,
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          providerCounts: createProviderRecord(() => 0),
          results: [],
        }),
        "projects:delete": (payload) => ({
          deleted: true,
          provider: "claude",
          sourceFormat: "jsonl_stream",
          removedSessionCount: Number(payload.projectId ? 1 : 0),
          removedMessageCount: 0,
          removedBookmarkCount: 0,
        }),
        "path:openInFileManager": () => ({
          ok: true,
          error: null,
        }),
        "dialog:pickExternalToolCommand": () => ({
          canceled: true,
          path: null,
          error: null,
        }),
        "editor:listAvailable": () => ({
          editors: [],
          diffTools: [],
        }),
        "editor:open": () => ({
          ok: true,
          error: null,
        }),
        "ui:getPaneState": () => allNullPaneState,
        "ui:setPaneState": () => ({
          ok: true,
        }),
        "indexer:getConfig": () => allNullIndexerConfig,
        "indexer:setConfig": () => ({
          ok: true,
        }),
        "ui:getZoom": () => ({
          percent: 100,
        }),
        "ui:setZoom": () => ({
          percent: 100,
        }),
        "watcher:start": () => ({ ok: true, watchedRoots: [], backend: "default" }),
        "watcher:getStatus": () => ({ running: false, processing: false, pendingPathCount: 0 }),
        "watcher:getStats": () => ({
          startedAt: "2026-03-16T10:00:00.000Z",
          watcher: {
            backend: "default",
            watchedRootCount: 0,
            watchBasedTriggers: 0,
            fallbackToIncrementalScans: 0,
            lastTriggerAt: null,
            lastTriggerPathCount: null,
          },
          jobs: {
            startupIncremental: makeDiagnosticsBucket(),
            manualIncremental: makeDiagnosticsBucket(),
            manualForceReindex: makeDiagnosticsBucket(),
            manualProjectForceReindex: makeDiagnosticsBucket(),
            watchTriggered: makeDiagnosticsBucket(),
            watchTargeted: makeDiagnosticsBucket(),
            watchFallbackIncremental: makeDiagnosticsBucket(),
            watchInitialScan: makeDiagnosticsBucket(),
            totals: { completedRuns: 0, failedRuns: 0 },
          },
          lastRun: null,
        }),
        "watcher:getLiveStatus": () => ({
          ...createLiveStatusFixture(),
          claudeHookState: createClaudeHookState({ installed: false }),
        }),
        "watcher:stop": () => ({ ok: true }),
        "claudeHooks:install": () => ({
          ok: true,
          state: createClaudeHookState({ installed: true }),
        }),
        "claudeHooks:remove": () => ({
          ok: true,
          state: createClaudeHookState({ installed: false }),
        }),
        "debug:recordLiveUiTrace": () => ({
          ok: true,
        }),
      },
      {
        onValidationError,
      },
    );

    const invalidCall = registry.get("indexer:refresh");
    await expect(invalidCall?.({}, { force: "wrong" })).rejects.toThrowError("Invalid payload");
    expect(onValidationError).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "indexer:refresh",
        stage: "request",
      }),
    );

    const validCall = registry.get("app:getHealth");
    await expect(validCall?.({}, {})).resolves.toEqual({ status: "ok", version: "0.1.0" });

    const paneStatePatchCall = registry.get("ui:setPaneState");
    await expect(
      paneStatePatchCall?.({}, { currentAutoRefreshStrategy: "watch-3s" }),
    ).resolves.toEqual({ ok: true });
  });

  it("validates handler responses against the contract schema", async () => {
    const registry = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();

    registerIpcHandlers(
      {
        handle: (channel, handler) => {
          registry.set(channel, handler as (event: unknown, payload: unknown) => Promise<unknown>);
        },
      },
      {
        "app:getHealth": () => ({ status: "ok", version: "0.1.0" }),
        "app:flushState": () => ({ ok: true }),
        "app:setCommandState": () => ({ ok: true }),
        "app:getSettingsInfo": () => settingsInfo,
        "db:getSchemaVersion": () => ({ schemaVersion: 1 }),
        "dashboard:getStats": () => ({
          summary: {
            projectCount: 0,
            sessionCount: 0,
            messageCount: 0,
            bookmarkCount: 0,
            toolCallCount: 0,
            indexedFileCount: 0,
            indexedBytesTotal: 0,
            tokenInputTotal: 0,
            tokenOutputTotal: 0,
            totalDurationMs: 0,
            averageMessagesPerSession: 0,
            averageSessionDurationMs: 0,
            activeProviderCount: 0,
          },
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          providerCounts: createProviderRecord(() => 0),
          providerStats: [],
          recentActivity: [],
          topProjects: [],
          topModels: [],
          aiCodeStats: emptyAiCodeStats,
          activityWindowDays: 14,
        }),
        "indexer:refresh": () => ({ jobId: "refresh-1" }),
        "indexer:getStatus": () => ({
          running: false,
          queuedJobs: 0,
          activeJobId: null,
          completedJobs: 0,
        }),
        "projects:list": () => ({ projects: [] }),
        "projects:getCombinedDetail": () => ({
          projectId: "project_1",
          totalCount: 0,
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          page: 0,
          pageSize: 100,
          focusIndex: null,
          messages: [],
        }),
        "sessions:list": () => ({ sessions: [] }),
        "sessions:listMany": () => ({ sessionsByProjectId: {} }),
        "sessions:getDetail": () => ({
          session: null,
          totalCount: 0,
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          page: 0,
          pageSize: 100,
          focusIndex: null,
          messages: [],
        }),
        "sessions:getTurn": () => ({
          session: null,
          anchorMessageId: "message_1",
          anchorMessage: null,
          turnNumber: 1,
          totalTurns: 1,
          previousTurnAnchorMessageId: null,
          nextTurnAnchorMessageId: null,
          firstTurnAnchorMessageId: "message_1",
          latestTurnAnchorMessageId: "message_1",
          totalCount: 0,
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          messages: [],
        }),
        "sessions:delete": () => ({
          deleted: true,
          projectId: "project_1",
          provider: "claude",
          sourceFormat: "jsonl_stream",
          removedMessageCount: 0,
          removedBookmarkCount: 0,
        }),
        "bookmarks:listProject": () => ({
          projectId: "project_1",
          totalCount: 0,
          filteredCount: 0,
          page: 0,
          pageSize: 100,
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          results: [],
        }),
        "bookmarks:getStates": () => ({
          projectId: "project_1",
          bookmarkedMessageIds: [],
        }),
        "bookmarks:toggle": () => ({ bookmarked: true }),
        "history:exportMessages": () => ({
          canceled: false,
          path: "/tmp/messages-export.md",
        }),
        "search:query": () => ({
          query: "",
          totalCount: 0,
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          providerCounts: createProviderRecord(() => 0),
          results: [],
        }),
        "projects:delete": () => ({
          deleted: true,
          provider: "claude",
          sourceFormat: "jsonl_stream",
          removedSessionCount: 0,
          removedMessageCount: 0,
          removedBookmarkCount: 0,
        }),
        "path:openInFileManager": () => ({ ok: true, error: null }),
        "dialog:pickExternalToolCommand": () => ({
          canceled: true,
          path: null,
          error: null,
        }),
        "editor:listAvailable": () => ({ editors: [], diffTools: [] }),
        "editor:open": () => ({ ok: true, error: null }),
        "ui:getPaneState": () => allNullPaneState,
        "ui:setPaneState": () => ({ ok: true }),
        "indexer:getConfig": () => allNullIndexerConfig,
        "indexer:setConfig": () => ({ ok: true }),
        "ui:getZoom": () => ({ percent: 100 }),
        "ui:setZoom": () => ({ percent: 0 }) as never,
        "watcher:start": () => ({ ok: true, watchedRoots: [], backend: "default" }),
        "watcher:getStatus": () => ({ running: false, processing: false, pendingPathCount: 0 }),
        "watcher:getStats": () => ({
          startedAt: "2026-03-16T10:00:00.000Z",
          watcher: {
            backend: "default",
            watchedRootCount: 0,
            watchBasedTriggers: 0,
            fallbackToIncrementalScans: 0,
            lastTriggerAt: null,
            lastTriggerPathCount: null,
          },
          jobs: {
            startupIncremental: makeDiagnosticsBucket(),
            manualIncremental: makeDiagnosticsBucket(),
            manualForceReindex: makeDiagnosticsBucket(),
            manualProjectForceReindex: makeDiagnosticsBucket(),
            watchTriggered: makeDiagnosticsBucket(),
            watchTargeted: makeDiagnosticsBucket(),
            watchFallbackIncremental: makeDiagnosticsBucket(),
            watchInitialScan: makeDiagnosticsBucket(),
            totals: { completedRuns: 0, failedRuns: 0 },
          },
          lastRun: null,
        }),
        "watcher:getLiveStatus": () => ({
          ...createLiveStatusFixture(),
          claudeHookState: createClaudeHookState({ installed: false }),
        }),
        "watcher:stop": () => ({ ok: true }),
        "claudeHooks:install": () => ({
          ok: true,
          state: createClaudeHookState({ installed: true }),
        }),
        "claudeHooks:remove": () => ({
          ok: true,
          state: createClaudeHookState({ installed: false }),
        }),
        "debug:recordLiveUiTrace": () => ({
          ok: true,
        }),
      },
    );

    const call = registry.get("ui:setZoom");
    await expect(
      call?.({ sender: { getZoomFactor: () => 1, getZoomLevel: () => 0 } }, { action: "in" }),
    ).rejects.toThrowError("Invalid response");
  });
});

function makeDiagnosticsBucket() {
  return {
    runs: 0,
    failedRuns: 0,
    totalDurationMs: 0,
    averageDurationMs: 0,
    maxDurationMs: 0,
    lastDurationMs: null,
  };
}
