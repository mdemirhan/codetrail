import {
  createProviderRecord,
  indexerConfigBaseSchema,
  paneStateBaseSchema,
} from "@codetrail/core/browser";
import {
  createClaudeHookStateFixture,
  createLiveStatusFixture,
  createSettingsInfoFixture,
} from "@codetrail/core/testing";

import { createMockCodetrailClient } from "./mockCodetrailClient";

type Request = Record<string, unknown>;
type ChannelHandler = (request: Request) => Promise<unknown> | unknown;

const EMPTY_UI_STATE = Object.fromEntries(
  Object.keys(paneStateBaseSchema.shape).map((k) => [k, null]),
);
const EMPTY_INDEXER_CONFIG = Object.fromEntries(
  Object.keys(indexerConfigBaseSchema.shape).map((k) => [k, null]),
);

const SETTINGS_INFO = createSettingsInfoFixture();
const EMPTY_PROVIDER_COUNTS = createProviderRecord(() => 0);

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getFocusedHistoryMessageId(container: HTMLElement): string | null {
  return container.querySelector<HTMLElement>(".message.focused")?.dataset.historyMessageId ?? null;
}

export function installScrollIntoViewMock(): void {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: () => undefined,
    configurable: true,
  });
}

function createRendererClient(handlers: Record<string, ChannelHandler>) {
  const client = createMockCodetrailClient();
  const invoke = client.invoke as unknown as {
    mockImplementation: (
      implementation: (channel: string, payload: Request) => Promise<unknown>,
    ) => void;
  };

  invoke.mockImplementation(async (channel, payload) => {
    const request = payload as Request;
    const handler = handlers[channel];
    if (handler) {
      return await handler(request);
    }

    if (channel === "ui:getPaneState") {
      return cloneValue(EMPTY_UI_STATE);
    }
    if (channel === "ui:setPaneState") {
      return { ok: true };
    }
    if (channel === "indexer:getConfig") {
      return cloneValue(EMPTY_INDEXER_CONFIG);
    }
    if (channel === "indexer:setConfig") {
      return { ok: true };
    }
    if (channel === "ui:getZoom") {
      return { percent: 100 };
    }
    if (channel === "ui:setZoom") {
      if (typeof request.percent === "number") {
        return { percent: request.percent };
      }
      const action = String(request.action ?? "");
      return { percent: action === "in" ? 110 : action === "out" ? 90 : 100 };
    }
    if (channel === "indexer:refresh") {
      return { jobId: "refresh-1" };
    }
    if (channel === "indexer:getStatus") {
      return { running: false, queuedJobs: 0, activeJobId: null, completedJobs: 0 };
    }
    if (channel === "bookmarks:toggle") {
      return { bookmarked: true };
    }
    if (channel === "app:flushState") {
      return { ok: true };
    }
    if (channel === "app:setCommandState") {
      return { ok: true };
    }
    if (channel === "app:getSettingsInfo") {
      return cloneValue(SETTINGS_INFO);
    }
    if (channel === "dashboard:getStats") {
      return {
        summary: {
          projectCount: 2,
          sessionCount: 3,
          messageCount: 42,
          bookmarkCount: 4,
          toolCallCount: 7,
          indexedFileCount: 3,
          indexedBytesTotal: 32_768,
          tokenInputTotal: 1_200,
          tokenOutputTotal: 900,
          totalDurationMs: 240_000,
          averageMessagesPerSession: 14,
          averageSessionDurationMs: 80_000,
          activeProviderCount: 2,
        },
        categoryCounts: {
          user: 10,
          assistant: 12,
          tool_use: 5,
          tool_edit: 7,
          tool_result: 4,
          thinking: 2,
          system: 2,
        },
        providerCounts: {
          ...EMPTY_PROVIDER_COUNTS,
          claude: 20,
          codex: 22,
        },
        providerStats: [
          {
            provider: "codex",
            projectCount: 1,
            sessionCount: 2,
            messageCount: 22,
            toolCallCount: 4,
            tokenInputTotal: 700,
            tokenOutputTotal: 500,
            lastActivity: "2026-03-16T10:05:03.000Z",
          },
          {
            provider: "claude",
            projectCount: 1,
            sessionCount: 1,
            messageCount: 20,
            toolCallCount: 3,
            tokenInputTotal: 500,
            tokenOutputTotal: 400,
            lastActivity: "2026-03-15T09:12:00.000Z",
          },
          {
            provider: "gemini",
            projectCount: 0,
            sessionCount: 0,
            messageCount: 0,
            toolCallCount: 0,
            tokenInputTotal: 0,
            tokenOutputTotal: 0,
            lastActivity: null,
          },
          {
            provider: "cursor",
            projectCount: 0,
            sessionCount: 0,
            messageCount: 0,
            toolCallCount: 0,
            tokenInputTotal: 0,
            tokenOutputTotal: 0,
            lastActivity: null,
          },
          {
            provider: "copilot",
            projectCount: 0,
            sessionCount: 0,
            messageCount: 0,
            toolCallCount: 0,
            tokenInputTotal: 0,
            tokenOutputTotal: 0,
            lastActivity: null,
          },
        ],
        recentActivity: [
          { date: "2026-03-03", sessionCount: 0, messageCount: 0 },
          { date: "2026-03-04", sessionCount: 0, messageCount: 0 },
          { date: "2026-03-05", sessionCount: 1, messageCount: 3 },
          { date: "2026-03-06", sessionCount: 0, messageCount: 0 },
          { date: "2026-03-07", sessionCount: 0, messageCount: 0 },
          { date: "2026-03-08", sessionCount: 0, messageCount: 0 },
          { date: "2026-03-09", sessionCount: 0, messageCount: 0 },
          { date: "2026-03-10", sessionCount: 0, messageCount: 0 },
          { date: "2026-03-11", sessionCount: 1, messageCount: 6 },
          { date: "2026-03-12", sessionCount: 0, messageCount: 0 },
          { date: "2026-03-13", sessionCount: 1, messageCount: 12 },
          { date: "2026-03-14", sessionCount: 0, messageCount: 0 },
          { date: "2026-03-15", sessionCount: 1, messageCount: 9 },
          { date: "2026-03-16", sessionCount: 2, messageCount: 12 },
        ],
        topProjects: [
          {
            projectId: "project_1",
            provider: "codex",
            name: "Project One",
            path: "/workspace/project-one",
            sessionCount: 2,
            messageCount: 22,
            bookmarkCount: 3,
            lastActivity: "2026-03-16T10:05:03.000Z",
          },
          {
            projectId: "project_2",
            provider: "claude",
            name: "Project Two",
            path: "/workspace/project-two",
            sessionCount: 1,
            messageCount: 20,
            bookmarkCount: 1,
            lastActivity: "2026-03-15T09:12:00.000Z",
          },
        ],
        topModels: [
          {
            modelName: "codex-gpt-5",
            sessionCount: 2,
            messageCount: 22,
          },
          {
            modelName: "claude-opus-4-1",
            sessionCount: 1,
            messageCount: 20,
          },
        ],
        aiCodeStats: {
          summary: {
            writeEventCount: 4,
            measurableWriteEventCount: 3,
            writeSessionCount: 2,
            fileChangeCount: 5,
            distinctFilesTouchedCount: 4,
            linesAdded: 41,
            linesDeleted: 13,
            netLines: 28,
            multiFileWriteCount: 1,
            averageFilesPerWrite: 1.67,
          },
          changeTypeCounts: {
            add: 2,
            update: 2,
            delete: 1,
            move: 0,
          },
          providerStats: [
            {
              provider: "codex",
              writeEventCount: 3,
              fileChangeCount: 4,
              linesAdded: 30,
              linesDeleted: 9,
              writeSessionCount: 2,
            },
            {
              provider: "claude",
              writeEventCount: 1,
              fileChangeCount: 1,
              linesAdded: 11,
              linesDeleted: 4,
              writeSessionCount: 1,
            },
            {
              provider: "gemini",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
              writeSessionCount: 0,
            },
            {
              provider: "cursor",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
              writeSessionCount: 0,
            },
            {
              provider: "copilot",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
              writeSessionCount: 0,
            },
          ],
          recentActivity: [
            {
              date: "2026-03-03",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
            },
            {
              date: "2026-03-04",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
            },
            {
              date: "2026-03-05",
              writeEventCount: 1,
              fileChangeCount: 1,
              linesAdded: 4,
              linesDeleted: 0,
            },
            {
              date: "2026-03-06",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
            },
            {
              date: "2026-03-07",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
            },
            {
              date: "2026-03-08",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
            },
            {
              date: "2026-03-09",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
            },
            {
              date: "2026-03-10",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
            },
            {
              date: "2026-03-11",
              writeEventCount: 1,
              fileChangeCount: 2,
              linesAdded: 12,
              linesDeleted: 3,
            },
            {
              date: "2026-03-12",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
            },
            {
              date: "2026-03-13",
              writeEventCount: 1,
              fileChangeCount: 1,
              linesAdded: 9,
              linesDeleted: 2,
            },
            {
              date: "2026-03-14",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
            },
            {
              date: "2026-03-15",
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
            },
            {
              date: "2026-03-16",
              writeEventCount: 1,
              fileChangeCount: 1,
              linesAdded: 16,
              linesDeleted: 8,
            },
          ],
          topFiles: [
            {
              filePath: "src/dashboard.tsx",
              writeEventCount: 2,
              linesAdded: 18,
              linesDeleted: 7,
              lastTouchedAt: "2026-03-16T10:05:03.000Z",
            },
            {
              filePath: "src/queryService.ts",
              writeEventCount: 1,
              linesAdded: 12,
              linesDeleted: 3,
              lastTouchedAt: "2026-03-11T09:22:00.000Z",
            },
          ],
          topFileTypes: [
            {
              label: ".ts",
              fileChangeCount: 3,
              linesAdded: 17,
              linesDeleted: 5,
            },
            {
              label: ".tsx",
              fileChangeCount: 2,
              linesAdded: 24,
              linesDeleted: 8,
            },
          ],
        },
        activityWindowDays: 14,
      };
    }
    if (channel === "watcher:start") {
      return { ok: true, watchedRoots: [], backend: "default" };
    }
    if (channel === "watcher:getStatus") {
      return { running: false, processing: false, pendingPathCount: 0 };
    }
    if (channel === "watcher:getLiveStatus") {
      return createLiveStatusFixture({
        updatedAt: "2026-03-16T10:05:03.000Z",
        claudeHookState: createClaudeHookStateFixture(),
      });
    }
    if (channel === "claudeHooks:install" || channel === "claudeHooks:remove") {
      return {
        ok: true,
        state: createClaudeHookStateFixture({ installed: channel === "claudeHooks:install" }),
      };
    }
    if (channel === "editor:listAvailable") {
      return {
        editors: [
          {
            id: "vscode",
            label: "VS Code",
            detected: true,
            command: "/usr/bin/code",
            capabilities: {
              openFile: true,
              openAtLineColumn: true,
              openContent: true,
              openDiff: true,
            },
          },
        ],
      };
    }
    if (channel === "editor:open") {
      return { ok: true, error: null };
    }
    if (channel === "watcher:getStats") {
      return {
        startedAt: "2026-03-16T10:00:00.000Z",
        watcher: {
          backend: "default",
          watchedRootCount: 5,
          watchBasedTriggers: 2,
          fallbackToIncrementalScans: 1,
          lastTriggerAt: "2026-03-16T10:05:00.000Z",
          lastTriggerPathCount: 3,
          structuralInvalidationObservedAt: null,
          forcedRestartCount: 0,
          lastForcedRestartAt: null,
          lastPostRestartTrackedCatchupCount: null,
          lastStaleCandidateCountAfterRepair: null,
        },
        jobs: {
          startupIncremental: makeDiagnosticsBucket(),
          manualIncremental: makeDiagnosticsBucket({
            runs: 1,
            averageDurationMs: 140,
            maxDurationMs: 140,
          }),
          manualForceReindex: makeDiagnosticsBucket(),
          manualProjectForceReindex: makeDiagnosticsBucket(),
          watchTriggered: makeDiagnosticsBucket({
            runs: 2,
            averageDurationMs: 90,
            maxDurationMs: 120,
          }),
          watchTargeted: makeDiagnosticsBucket({
            runs: 1,
            averageDurationMs: 60,
            maxDurationMs: 60,
          }),
          watchFallbackIncremental: makeDiagnosticsBucket({
            runs: 1,
            averageDurationMs: 120,
            maxDurationMs: 120,
          }),
          watchInitialScan: makeDiagnosticsBucket(),
          totals: {
            completedRuns: 3,
            failedRuns: 0,
          },
        },
        lastRun: {
          source: "watch_fallback_incremental",
          completedAt: "2026-03-16T10:05:03.000Z",
          durationMs: 320,
          success: true,
        },
      };
    }
    if (channel === "watcher:stop") {
      return { ok: true };
    }

    throw new Error(`Unhandled IPC call: ${channel}`);
  });

  return client;
}

function makeDiagnosticsBucket(
  overrides: Partial<{
    runs: number;
    failedRuns: number;
    totalDurationMs: number;
    averageDurationMs: number;
    maxDurationMs: number;
    lastDurationMs: number | null;
  }> = {},
) {
  return {
    runs: 0,
    failedRuns: 0,
    totalDurationMs: 0,
    averageDurationMs: 0,
    maxDurationMs: 0,
    lastDurationMs: null,
    ...overrides,
  };
}

export function createAppClient(overrides: Record<string, ChannelHandler> = {}) {
  return createRendererClient({
    "projects:list": () => ({
      projects: [
        {
          id: "project_1",
          provider: "claude",
          name: "Project One",
          path: "/workspace/project-one",
          sessionCount: 1,
          messageCount: 1,
          bookmarkCount: 0,
          lastActivity: "2026-03-01T10:00:05.000Z",
        },
      ],
    }),
    "sessions:list": () => ({
      sessions: [
        {
          id: "session_1",
          projectId: "project_1",
          provider: "claude",
          filePath: "/workspace/project-one/session-1.jsonl",
          title: "Investigate markdown rendering",
          modelNames: "claude-opus-4-1",
          startedAt: "2026-03-01T10:00:00.000Z",
          endedAt: "2026-03-01T10:00:05.000Z",
          durationMs: 5000,
          gitBranch: "main",
          cwd: "/workspace/project-one",
          messageCount: 2,
          bookmarkCount: 0,
          tokenInputTotal: 14,
          tokenOutputTotal: 8,
        },
      ],
    }),
    "projects:getCombinedDetail": (request) => {
      const requestedPage = Number(request.page ?? 0);
      const page = Number.isFinite(requestedPage) && requestedPage >= 0 ? requestedPage : 0;
      return {
        projectId: "project_1",
        totalCount: 250,
        categoryCounts: {
          user: 125,
          assistant: 125,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        page,
        pageSize: 100,
        focusIndex: null,
        messages: [
          {
            id: "m1",
            sourceId: "src1",
            sessionId: "session_1",
            provider: "claude",
            category: "user",
            content: "Please review markdown table rendering",
            createdAt: "2026-03-01T10:00:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
            sessionTitle: "Investigate markdown rendering",
            sessionActivity: "2026-03-01T10:00:05.000Z",
            sessionStartedAt: "2026-03-01T10:00:00.000Z",
            sessionEndedAt: "2026-03-01T10:00:05.000Z",
            sessionGitBranch: "main",
            sessionCwd: "/workspace/project-one",
          },
          {
            id: "m2",
            sourceId: "src2",
            sessionId: "session_1",
            provider: "claude",
            category: "assistant",
            content: "Everything checks out.\n\n| A | B |\n|---|---|\n| 1 | 2 |",
            createdAt: "2026-03-01T10:00:05.000Z",
            tokenInput: 14,
            tokenOutput: 8,
            operationDurationMs: 5000,
            operationDurationSource: "native",
            operationDurationConfidence: "high",
            sessionTitle: "Investigate markdown rendering",
            sessionActivity: "2026-03-01T10:00:05.000Z",
            sessionStartedAt: "2026-03-01T10:00:00.000Z",
            sessionEndedAt: "2026-03-01T10:00:05.000Z",
            sessionGitBranch: "main",
            sessionCwd: "/workspace/project-one",
          },
        ],
      };
    },
    "sessions:getDetail": () => ({
      session: {
        id: "session_1",
        projectId: "project_1",
        provider: "claude",
        filePath: "/workspace/project-one/session-1.jsonl",
        title: "Investigate markdown rendering",
        modelNames: "claude-opus-4-1",
        startedAt: "2026-03-01T10:00:00.000Z",
        endedAt: "2026-03-01T10:00:05.000Z",
        durationMs: 5000,
        gitBranch: "main",
        cwd: "/workspace/project-one",
        messageCount: 2,
        tokenInputTotal: 14,
        tokenOutputTotal: 8,
      },
      totalCount: 2,
      categoryCounts: {
        user: 1,
        assistant: 1,
        tool_use: 0,
        tool_edit: 0,
        tool_result: 0,
        thinking: 0,
        system: 0,
      },
      page: 0,
      pageSize: 100,
      focusIndex: null,
      messages: [
        {
          id: "m1",
          sourceId: "src1",
          sessionId: "session_1",
          provider: "claude",
          category: "user",
          content: "Please review markdown table rendering",
          createdAt: "2026-03-01T10:00:00.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        },
        {
          id: "m2",
          sourceId: "src2",
          sessionId: "session_1",
          provider: "claude",
          category: "assistant",
          content: "Everything checks out.\n\n| A | B |\n|---|---|\n| 1 | 2 |",
          createdAt: "2026-03-01T10:00:05.000Z",
          tokenInput: 14,
          tokenOutput: 8,
          operationDurationMs: 5000,
          operationDurationSource: "native",
          operationDurationConfidence: "high",
        },
      ],
    }),
    "sessions:getTurn": (request) => {
      const latest = request.latest === true;
      const turnNumber = typeof request.turnNumber === "number" ? request.turnNumber : null;
      const requestedAnchorMessageId =
        typeof request.anchorMessageId === "string" && request.anchorMessageId.length > 0
          ? request.anchorMessageId
          : null;
      const anchorMessageId =
        requestedAnchorMessageId === "m1" || requestedAnchorMessageId === "m2"
          ? "m1"
          : requestedAnchorMessageId === "m3" || requestedAnchorMessageId === "m4"
            ? "m3"
            : latest || turnNumber === 2
              ? "m3"
              : "m1";
      const messages =
        anchorMessageId === "m3"
          ? [
              {
                id: "m3",
                sourceId: "src3",
                sessionId: "session_1",
                provider: "claude",
                category: "user",
                content: "Review the latest turn",
                createdAt: "2026-03-01T10:00:06.000Z",
                tokenInput: null,
                tokenOutput: null,
                operationDurationMs: null,
                operationDurationSource: null,
                operationDurationConfidence: null,
              },
              {
                id: "m4",
                sourceId: "src4",
                sessionId: "session_1",
                provider: "claude",
                category: "assistant",
                content: "Latest turn reply",
                createdAt: "2026-03-01T10:00:07.000Z",
                tokenInput: 8,
                tokenOutput: 5,
                operationDurationMs: 1000,
                operationDurationSource: "native",
                operationDurationConfidence: "high",
              },
            ]
          : [
              {
                id: "m1",
                sourceId: "src1",
                sessionId: "session_1",
                provider: "claude",
                category: "user",
                content: "Please review markdown table rendering",
                createdAt: "2026-03-01T10:00:00.000Z",
                tokenInput: null,
                tokenOutput: null,
                operationDurationMs: null,
                operationDurationSource: null,
                operationDurationConfidence: null,
              },
              {
                id: "m2",
                sourceId: "src2",
                sessionId: "session_1",
                provider: "claude",
                category: "assistant",
                content: "Everything checks out.",
                createdAt: "2026-03-01T10:00:05.000Z",
                tokenInput: 14,
                tokenOutput: 8,
                operationDurationMs: 5000,
                operationDurationSource: "native",
                operationDurationConfidence: "high",
              },
            ];
      return {
        session: {
          id: "session_1",
          projectId: "project_1",
          provider: "claude",
          filePath: "/workspace/project-one/session-1.jsonl",
          title: "Investigate markdown rendering",
          modelNames: "claude-opus-4-1",
          startedAt: "2026-03-01T10:00:00.000Z",
          endedAt: "2026-03-01T10:00:07.000Z",
          durationMs: 7000,
          gitBranch: "main",
          cwd: "/workspace/project-one",
          messageCount: 4,
          tokenInputTotal: 22,
          tokenOutputTotal: 13,
        },
        anchorMessageId,
        anchorMessage: messages[0],
        turnNumber: anchorMessageId === "m3" ? 2 : 1,
        totalTurns: 2,
        previousTurnAnchorMessageId: anchorMessageId === "m3" ? "m1" : null,
        nextTurnAnchorMessageId: anchorMessageId === "m3" ? null : "m3",
        firstTurnAnchorMessageId: "m1",
        latestTurnAnchorMessageId: "m3",
        totalCount: messages.length,
        categoryCounts: {
          user: 1,
          assistant: 1,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        queryError: null,
        highlightPatterns: [],
        matchedMessageIds: undefined,
        messages,
      };
    },
    "sessions:delete": () => ({
      deleted: true,
      projectId: "project_1",
      provider: "claude",
      sourceFormat: "jsonl_stream",
      removedMessageCount: 2,
      removedBookmarkCount: 0,
    }),
    "bookmarks:listProject": (request) => ({
      projectId: String(request.projectId),
      totalCount: 0,
      filteredCount: 0,
      page: Number(request.page ?? 0),
      pageSize: Number(request.pageSize ?? 100),
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
    "history:exportMessages": () => ({
      canceled: false,
      path: "/tmp/messages-export.md",
    }),
    "search:query": (request) => {
      const query = String(request.query ?? "");
      if (query.trim().length === 0) {
        return {
          query,
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
          providerCounts: EMPTY_PROVIDER_COUNTS,
          results: [],
        };
      }

      const totalCount = 250;
      const requestedOffset = Number(request.offset ?? 0);
      const offset = Number.isFinite(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
      const page = Math.floor(offset / 100);
      const snippet =
        page === 0
          ? "markdown table rendering"
          : page === 1
            ? "markdown table rendering page 2"
            : "markdown table rendering page 3";

      return {
        query,
        totalCount,
        categoryCounts: {
          user: 0,
          assistant: totalCount,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        providerCounts: {
          ...EMPTY_PROVIDER_COUNTS,
          claude: totalCount,
        },
        results:
          offset >= totalCount
            ? []
            : [
                {
                  messageId: "m2",
                  messageSourceId: "src2",
                  sessionId: "session_1",
                  projectId: "project_1",
                  provider: "claude",
                  category: "assistant",
                  createdAt: "2026-03-01T10:00:05.000Z",
                  snippet,
                  projectName: "Project One",
                  projectPath: "/workspace/project-one",
                },
              ],
      };
    },
    "projects:delete": () => ({
      deleted: true,
      provider: "claude",
      sourceFormat: "jsonl_stream",
      removedSessionCount: 1,
      removedMessageCount: 2,
      removedBookmarkCount: 0,
    }),
    ...overrides,
  });
}

export function createBookmarksSearchClient() {
  return createRendererClient({
    "projects:list": () => ({
      projects: [
        {
          id: "project_1",
          provider: "claude",
          name: "Project One",
          path: "/workspace/project-one",
          sessionCount: 1,
          messageCount: 1,
          bookmarkCount: 0,
          lastActivity: "2026-03-01T10:00:05.000Z",
        },
      ],
    }),
    "sessions:list": () => ({
      sessions: [
        {
          id: "session_1",
          projectId: "project_1",
          provider: "claude",
          filePath: "/workspace/project-one/session-1.jsonl",
          title: "Investigate markdown rendering",
          modelNames: "claude-opus-4-1",
          startedAt: "2026-03-01T10:00:00.000Z",
          endedAt: "2026-03-01T10:00:05.000Z",
          durationMs: 5000,
          gitBranch: "main",
          cwd: "/workspace/project-one",
          messageCount: 2,
          bookmarkCount: 0,
          tokenInputTotal: 14,
          tokenOutputTotal: 8,
        },
      ],
    }),
    "projects:getCombinedDetail": () => ({
      projectId: "project_1",
      totalCount: 2,
      categoryCounts: {
        user: 0,
        assistant: 1,
        tool_use: 1,
        tool_edit: 0,
        tool_result: 0,
        thinking: 0,
        system: 0,
      },
      page: 0,
      pageSize: 100,
      focusIndex: null,
      messages: [
        {
          id: "m_tool",
          sourceId: "src_tool",
          sessionId: "session_1",
          provider: "claude",
          category: "tool_use",
          content: '{"name":"Read","args":{"path":"src/parser.ts"}}',
          createdAt: "2026-03-01T10:00:01.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
          sessionTitle: "Investigate markdown rendering",
          sessionActivity: "2026-03-01T10:00:05.000Z",
          sessionStartedAt: "2026-03-01T10:00:00.000Z",
          sessionEndedAt: "2026-03-01T10:00:05.000Z",
          sessionGitBranch: "main",
          sessionCwd: "/workspace/project-one",
        },
        {
          id: "m_assistant",
          sourceId: "src_assistant",
          sessionId: "session_1",
          provider: "claude",
          category: "assistant",
          content: "Parser behavior inspected and fixed.",
          createdAt: "2026-03-01T10:00:05.000Z",
          tokenInput: 10,
          tokenOutput: 8,
          operationDurationMs: 4000,
          operationDurationSource: "native",
          operationDurationConfidence: "high",
          sessionTitle: "Investigate markdown rendering",
          sessionActivity: "2026-03-01T10:00:05.000Z",
          sessionStartedAt: "2026-03-01T10:00:00.000Z",
          sessionEndedAt: "2026-03-01T10:00:05.000Z",
          sessionGitBranch: "main",
          sessionCwd: "/workspace/project-one",
        },
      ],
    }),
    "sessions:getDetail": () => ({
      session: {
        id: "session_1",
        projectId: "project_1",
        provider: "claude",
        filePath: "/workspace/project-one/session-1.jsonl",
        title: "Investigate markdown rendering",
        modelNames: "claude-opus-4-1",
        startedAt: "2026-03-01T10:00:00.000Z",
        endedAt: "2026-03-01T10:00:05.000Z",
        durationMs: 5000,
        gitBranch: "main",
        cwd: "/workspace/project-one",
        messageCount: 2,
        tokenInputTotal: 14,
        tokenOutputTotal: 8,
      },
      totalCount: 2,
      categoryCounts: {
        user: 1,
        assistant: 1,
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
      session: {
        id: "session_1",
        projectId: "project_1",
        provider: "claude",
        filePath: "/workspace/project-one/session-1.jsonl",
        title: "Investigate markdown rendering",
        modelNames: "claude-opus-4-1",
        startedAt: "2026-03-01T10:00:00.000Z",
        endedAt: "2026-03-01T10:00:05.000Z",
        durationMs: 5000,
        gitBranch: "main",
        cwd: "/workspace/project-one",
        messageCount: 2,
        tokenInputTotal: 14,
        tokenOutputTotal: 8,
      },
      anchorMessageId: "turn-user-1",
      anchorMessage: {
        id: "turn-user-1",
        sourceId: "turn-src-1",
        sessionId: "session_1",
        provider: "claude",
        category: "user",
        content: "Bookmark scope turn",
        createdAt: "2026-03-01T10:00:00.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
      turnNumber: 1,
      totalTurns: 1,
      previousTurnAnchorMessageId: null,
      nextTurnAnchorMessageId: null,
      firstTurnAnchorMessageId: "turn-user-1",
      latestTurnAnchorMessageId: "turn-user-1",
      totalCount: 2,
      categoryCounts: {
        user: 1,
        assistant: 1,
        tool_use: 0,
        tool_edit: 0,
        tool_result: 0,
        thinking: 0,
        system: 0,
      },
      queryError: null,
      highlightPatterns: [],
      messages: [
        {
          id: "turn-user-1",
          sourceId: "turn-src-1",
          sessionId: "session_1",
          provider: "claude",
          category: "user",
          content: "Bookmark scope turn",
          createdAt: "2026-03-01T10:00:00.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        },
        {
          id: "turn-assistant-1",
          sourceId: "turn-src-2",
          sessionId: "session_1",
          provider: "claude",
          category: "assistant",
          content: "Bookmark scope turn reply",
          createdAt: "2026-03-01T10:00:01.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        },
      ],
    }),
    "bookmarks:listProject": (request) => {
      const query = String(request.query ?? "").toLowerCase();
      const entry = {
        projectId: "project_1",
        sessionId: "session_1",
        sessionTitle: "Investigate markdown rendering",
        bookmarkedAt: "2026-03-01T10:10:00.000Z",
        isOrphaned: false,
        orphanedAt: null,
        message: {
          id: "bm1",
          sourceId: "bm-src-1",
          sessionId: "session_1",
          provider: "claude",
          category: "assistant",
          content: "Parser behavior inspected and fixed.",
          createdAt: "2026-03-01T10:10:00.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        },
      };
      const matches = query.length === 0 || entry.message.content.toLowerCase().includes(query);

      return {
        projectId: "project_1",
        totalCount: 1,
        filteredCount: matches ? 1 : 0,
        page: Number(request.page ?? 0),
        pageSize: Number(request.pageSize ?? 100),
        categoryCounts: {
          user: 0,
          assistant: matches ? 1 : 0,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        results: matches ? [entry] : [],
      };
    },
    "search:query": (request) => ({
      query: String(request.query ?? ""),
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
      providerCounts: EMPTY_PROVIDER_COUNTS,
      results: [],
    }),
  });
}

export function createHistoryNavigationClient() {
  return createRendererClient({
    "projects:list": () => ({
      projects: [
        {
          id: "project_1",
          provider: "claude",
          name: "Project One",
          path: "/workspace/project-one",
          sessionCount: 2,
          messageCount: 2,
          bookmarkCount: 0,
          lastActivity: "2026-03-01T10:00:00.000Z",
        },
        {
          id: "project_2",
          provider: "codex",
          name: "Project Two",
          path: "/workspace/project-two",
          sessionCount: 1,
          messageCount: 1,
          bookmarkCount: 0,
          lastActivity: "2026-03-01T09:00:00.000Z",
        },
      ],
    }),
    "sessions:list": (request) => {
      if (request.projectId === "project_2") {
        return {
          sessions: [
            {
              id: "session_3",
              projectId: "project_2",
              provider: "codex",
              filePath: "/workspace/project-two/session-3.jsonl",
              title: "Project two session",
              modelNames: "gpt-5",
              startedAt: "2026-03-01T09:00:00.000Z",
              endedAt: "2026-03-01T09:05:00.000Z",
              durationMs: 300000,
              gitBranch: "main",
              cwd: "/workspace/project-two",
              messageCount: 1,
              bookmarkCount: 0,
              tokenInputTotal: 4,
              tokenOutputTotal: 5,
            },
          ],
        };
      }

      return {
        sessions: [
          {
            id: "session_1",
            projectId: "project_1",
            provider: "claude",
            filePath: "/workspace/project-one/session-1.jsonl",
            title: "Session one",
            modelNames: "claude-opus-4-1",
            startedAt: "2026-03-01T10:00:00.000Z",
            endedAt: "2026-03-01T10:05:00.000Z",
            durationMs: 300000,
            gitBranch: "main",
            cwd: "/workspace/project-one",
            messageCount: 1,
            bookmarkCount: 0,
            tokenInputTotal: 4,
            tokenOutputTotal: 5,
          },
          {
            id: "session_2",
            projectId: "project_1",
            provider: "claude",
            filePath: "/workspace/project-one/session-2.jsonl",
            title: "Session two",
            modelNames: "claude-opus-4-1",
            startedAt: "2026-03-01T09:00:00.000Z",
            endedAt: "2026-03-01T09:05:00.000Z",
            durationMs: 300000,
            gitBranch: "main",
            cwd: "/workspace/project-one",
            messageCount: 1,
            bookmarkCount: 0,
            tokenInputTotal: 3,
            tokenOutputTotal: 4,
          },
        ],
      };
    },
    "projects:getCombinedDetail": (request) => {
      if (request.projectId === "project_2") {
        return {
          projectId: "project_2",
          totalCount: 1,
          categoryCounts: {
            user: 1,
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
          messages: [
            {
              id: "project_2_message",
              sourceId: "project_2_src",
              sessionId: "session_3",
              provider: "codex",
              category: "user",
              content: "Project two combined message",
              createdAt: "2026-03-01T09:05:00.000Z",
              tokenInput: null,
              tokenOutput: null,
              operationDurationMs: null,
              operationDurationSource: null,
              operationDurationConfidence: null,
              sessionTitle: "Project two session",
              sessionActivity: "2026-03-01T09:05:00.000Z",
              sessionStartedAt: "2026-03-01T09:00:00.000Z",
              sessionEndedAt: "2026-03-01T09:05:00.000Z",
              sessionGitBranch: "main",
              sessionCwd: "/workspace/project-two",
            },
          ],
        };
      }

      return {
        projectId: "project_1",
        totalCount: 2,
        categoryCounts: {
          user: 2,
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
        messages: [
          {
            id: "project_1_message_1",
            sourceId: "project_1_src_1",
            sessionId: "session_1",
            provider: "claude",
            category: "user",
            content: "Project one first message",
            createdAt: "2026-03-01T10:05:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
            sessionTitle: "Session one",
            sessionActivity: "2026-03-01T10:05:00.000Z",
            sessionStartedAt: "2026-03-01T10:00:00.000Z",
            sessionEndedAt: "2026-03-01T10:05:00.000Z",
            sessionGitBranch: "main",
            sessionCwd: "/workspace/project-one",
          },
          {
            id: "project_1_message_2",
            sourceId: "project_1_src_2",
            sessionId: "session_2",
            provider: "claude",
            category: "user",
            content: "Project one second message",
            createdAt: "2026-03-01T09:05:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
            sessionTitle: "Session two",
            sessionActivity: "2026-03-01T09:05:00.000Z",
            sessionStartedAt: "2026-03-01T09:00:00.000Z",
            sessionEndedAt: "2026-03-01T09:05:00.000Z",
            sessionGitBranch: "main",
            sessionCwd: "/workspace/project-one",
          },
        ],
      };
    },
    "sessions:getDetail": (request) => {
      const sessionId = String(request.sessionId);
      const sessionMessages = {
        session_1: "Session one message",
        session_2: "Session two message",
        session_3: "Project two session message",
      } as const;
      const sessionTitles = {
        session_1: "Session one",
        session_2: "Session two",
        session_3: "Project two session",
      } as const;
      const projectIds = {
        session_1: "project_1",
        session_2: "project_1",
        session_3: "project_2",
      } as const;
      const providers = {
        session_1: "claude",
        session_2: "claude",
        session_3: "codex",
      } as const;
      const filePaths = {
        session_1: "/workspace/project-one/session-1.jsonl",
        session_2: "/workspace/project-one/session-2.jsonl",
        session_3: "/workspace/project-two/session-3.jsonl",
      } as const;
      const cwd = {
        session_1: "/workspace/project-one",
        session_2: "/workspace/project-one",
        session_3: "/workspace/project-two",
      } as const;
      const tokenTotals = {
        session_1: { in: 4, out: 5 },
        session_2: { in: 3, out: 4 },
        session_3: { in: 4, out: 5 },
      } as const;

      return {
        session: {
          id: sessionId,
          projectId: projectIds[sessionId as keyof typeof projectIds],
          provider: providers[sessionId as keyof typeof providers],
          filePath: filePaths[sessionId as keyof typeof filePaths],
          title: sessionTitles[sessionId as keyof typeof sessionTitles],
          modelNames: sessionId === "session_3" ? "gpt-5" : "claude-opus-4-1",
          startedAt:
            sessionId === "session_2" ? "2026-03-01T09:00:00.000Z" : "2026-03-01T10:00:00.000Z",
          endedAt:
            sessionId === "session_2" ? "2026-03-01T09:05:00.000Z" : "2026-03-01T10:05:00.000Z",
          durationMs: 300000,
          gitBranch: "main",
          cwd: cwd[sessionId as keyof typeof cwd],
          messageCount: 1,
          tokenInputTotal: tokenTotals[sessionId as keyof typeof tokenTotals].in,
          tokenOutputTotal: tokenTotals[sessionId as keyof typeof tokenTotals].out,
        },
        totalCount: 1,
        categoryCounts: {
          user: 1,
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
        messages: [
          {
            id: `${sessionId}_message`,
            sourceId: `${sessionId}_src`,
            sessionId,
            provider: providers[sessionId as keyof typeof providers],
            category: "user",
            content: sessionMessages[sessionId as keyof typeof sessionMessages],
            createdAt:
              sessionId === "session_2" ? "2026-03-01T09:05:00.000Z" : "2026-03-01T10:05:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
        ],
      };
    },
    "bookmarks:listProject": (request) => ({
      projectId: String(request.projectId),
      totalCount: 1,
      filteredCount: 1,
      page: Number(request.page ?? 0),
      pageSize: Number(request.pageSize ?? 100),
      categoryCounts: {
        user: 1,
        assistant: 0,
        tool_use: 0,
        tool_edit: 0,
        tool_result: 0,
        thinking: 0,
        system: 0,
      },
      results: [
        {
          projectId: "project_1",
          sessionId: "session_1",
          sessionTitle: "Session one",
          bookmarkedAt: "2026-03-01T10:06:00.000Z",
          isOrphaned: false,
          orphanedAt: null,
          message: {
            id: "bookmark_session_1_message",
            sourceId: "bookmark_session_1_source",
            sessionId: "session_1",
            provider: "claude",
            category: "user",
            content: "Bookmarked session one message",
            createdAt: "2026-03-01T10:05:30.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
        },
      ],
    }),
    "sessions:getTurn": () => ({
      session: null,
      anchorMessageId: null,
      anchorMessage: null,
      turnNumber: 0,
      totalTurns: 0,
      previousTurnAnchorMessageId: null,
      nextTurnAnchorMessageId: null,
      firstTurnAnchorMessageId: null,
      latestTurnAnchorMessageId: null,
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
      queryError: null,
      highlightPatterns: [],
      messages: [],
    }),
    "search:query": (request) => ({
      query: String(request.query ?? ""),
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
      providerCounts: EMPTY_PROVIDER_COUNTS,
      results: [],
    }),
  });
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

export function createProjectSwitchBookmarksDelayClient() {
  const delayedBookmarks = createDeferred<{
    projectId: string;
    totalCount: number;
    filteredCount: number;
    page: number;
    pageSize: number;
    categoryCounts: {
      user: number;
      assistant: number;
      tool_use: number;
      tool_edit: number;
      tool_result: number;
      thinking: number;
      system: number;
    };
    results: Array<{
      projectId: string;
      sessionId: string;
      sessionTitle: string;
      bookmarkedAt: string;
      isOrphaned: boolean;
      orphanedAt: null;
      message: {
        id: string;
        sourceId: string;
        sessionId: string;
        provider: "claude";
        category: "assistant";
        content: string;
        createdAt: string;
        tokenInput: null;
        tokenOutput: null;
        operationDurationMs: null;
        operationDurationSource: null;
        operationDurationConfidence: null;
      };
    }>;
  }>();

  const client = createRendererClient({
    "projects:list": () => ({
      projects: [
        {
          id: "project_1",
          provider: "claude",
          name: "Project One",
          path: "/workspace/project-one",
          sessionCount: 1,
          messageCount: 1,
          lastActivity: "2026-03-01T12:00:05.000Z",
        },
        {
          id: "project_2",
          provider: "claude",
          name: "Project Two",
          path: "/workspace/project-two",
          sessionCount: 1,
          messageCount: 1,
          lastActivity: "2026-03-01T11:00:05.000Z",
        },
      ],
    }),
    "sessions:list": (request) => {
      if (request.projectId === "project_2") {
        return {
          sessions: [
            {
              id: "session_2",
              projectId: "project_2",
              provider: "claude",
              filePath: "/workspace/project-two/session-2.jsonl",
              title: "Project two delayed bookmarks session",
              modelNames: "claude-opus-4-1",
              startedAt: "2026-03-01T11:00:00.000Z",
              endedAt: "2026-03-01T11:00:05.000Z",
              durationMs: 5000,
              gitBranch: "main",
              cwd: "/workspace/project-two",
              messageCount: 1,
              tokenInputTotal: 4,
              tokenOutputTotal: 5,
            },
          ],
        };
      }

      return {
        sessions: [
          {
            id: "session_1",
            projectId: "project_1",
            provider: "claude",
            filePath: "/workspace/project-one/session-1.jsonl",
            title: "Project one session",
            modelNames: "claude-opus-4-1",
            startedAt: "2026-03-01T10:00:00.000Z",
            endedAt: "2026-03-01T10:00:05.000Z",
            durationMs: 5000,
            gitBranch: "main",
            cwd: "/workspace/project-one",
            messageCount: 1,
            tokenInputTotal: 4,
            tokenOutputTotal: 5,
          },
        ],
      };
    },
    "bookmarks:listProject": (request) => {
      if (request.projectId === "project_2") {
        return delayedBookmarks.promise;
      }
      return {
        projectId: String(request.projectId),
        totalCount: 0,
        filteredCount: 0,
        page: Number(request.page ?? 0),
        pageSize: Number(request.pageSize ?? 100),
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
      };
    },
    "projects:getCombinedDetail": (request) => ({
      projectId: String(request.projectId),
      totalCount: 1,
      categoryCounts: {
        user: 1,
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
      messages: [
        {
          id: request.projectId === "project_2" ? "project_2_message" : "project_1_message",
          sourceId: request.projectId === "project_2" ? "project_2_src" : "project_1_src",
          sessionId: request.projectId === "project_2" ? "session_2" : "session_1",
          provider: "claude",
          category: "user",
          content:
            request.projectId === "project_2" ? "Project two message" : "Project one message",
          createdAt: "2026-03-01T10:00:05.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
          sessionTitle:
            request.projectId === "project_2"
              ? "Project two delayed bookmarks session"
              : "Project one session",
          sessionActivity: "2026-03-01T10:00:05.000Z",
          sessionStartedAt: "2026-03-01T10:00:00.000Z",
          sessionEndedAt: "2026-03-01T10:00:05.000Z",
          sessionGitBranch: "main",
          sessionCwd:
            request.projectId === "project_2" ? "/workspace/project-two" : "/workspace/project-one",
        },
      ],
    }),
    "sessions:getDetail": (request) => ({
      session: {
        id: String(request.sessionId),
        projectId: request.sessionId === "session_2" ? "project_2" : "project_1",
        provider: "claude",
        filePath:
          request.sessionId === "session_2"
            ? "/workspace/project-two/session-2.jsonl"
            : "/workspace/project-one/session-1.jsonl",
        title:
          request.sessionId === "session_2"
            ? "Project two delayed bookmarks session"
            : "Project one session",
        modelNames: "claude-opus-4-1",
        startedAt: "2026-03-01T10:00:00.000Z",
        endedAt: "2026-03-01T10:00:05.000Z",
        durationMs: 5000,
        gitBranch: "main",
        cwd:
          request.sessionId === "session_2" ? "/workspace/project-two" : "/workspace/project-one",
        messageCount: 1,
        tokenInputTotal: 4,
        tokenOutputTotal: 5,
      },
      totalCount: 1,
      categoryCounts: {
        user: 1,
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
      messages: [
        {
          id: request.sessionId === "session_2" ? "session_2_message" : "session_1_message",
          sourceId: request.sessionId === "session_2" ? "session_2_src" : "session_1_src",
          sessionId: String(request.sessionId),
          provider: "claude",
          category: "user",
          content:
            request.sessionId === "session_2" ? "Session two message" : "Session one message",
          createdAt: "2026-03-01T10:00:05.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        },
      ],
    }),
    "search:query": (request) => ({
      query: String(request.query ?? ""),
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
      providerCounts: EMPTY_PROVIDER_COUNTS,
      results: [],
    }),
  });

  return { client, delayedBookmarks };
}

export function createBookmarkSearchDelayClient() {
  const delayedBookmarks = createDeferred<{
    projectId: string;
    totalCount: number;
    filteredCount: number;
    page: number;
    pageSize: number;
    categoryCounts: {
      user: number;
      assistant: number;
      tool_use: number;
      tool_edit: number;
      tool_result: number;
      thinking: number;
      system: number;
    };
    results: Array<{
      projectId: string;
      sessionId: string;
      sessionTitle: string;
      bookmarkedAt: string;
      isOrphaned: boolean;
      orphanedAt: null;
      message: {
        id: string;
        sourceId: string;
        sessionId: string;
        provider: "claude";
        category: "assistant";
        content: string;
        createdAt: string;
        tokenInput: null;
        tokenOutput: null;
        operationDurationMs: null;
        operationDurationSource: null;
        operationDurationConfidence: null;
      };
    }>;
  }>();

  const client = createRendererClient({
    "projects:list": () => ({
      projects: [
        {
          id: "project_1",
          provider: "claude",
          name: "Project One",
          path: "/workspace/project-one",
          sessionCount: 1,
          messageCount: 1,
          lastActivity: "2026-03-01T10:00:05.000Z",
        },
      ],
    }),
    "sessions:list": () => ({
      sessions: [
        {
          id: "session_1",
          projectId: "project_1",
          provider: "claude",
          filePath: "/workspace/project-one/session-1.jsonl",
          title: "Investigate markdown rendering",
          modelNames: "claude-opus-4-1",
          startedAt: "2026-03-01T10:00:00.000Z",
          endedAt: "2026-03-01T10:00:05.000Z",
          durationMs: 5000,
          gitBranch: "main",
          cwd: "/workspace/project-one",
          messageCount: 2,
          tokenInputTotal: 14,
          tokenOutputTotal: 8,
        },
      ],
    }),
    "projects:getCombinedDetail": () => ({
      projectId: "project_1",
      totalCount: 2,
      categoryCounts: {
        user: 0,
        assistant: 1,
        tool_use: 1,
        tool_edit: 0,
        tool_result: 0,
        thinking: 0,
        system: 0,
      },
      page: 0,
      pageSize: 100,
      focusIndex: null,
      messages: [
        {
          id: "m_tool",
          sourceId: "src_tool",
          sessionId: "session_1",
          provider: "claude",
          category: "tool_use",
          content: '{"name":"Read","args":{"path":"src/parser.ts"}}',
          createdAt: "2026-03-01T10:00:01.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
          sessionTitle: "Investigate markdown rendering",
          sessionActivity: "2026-03-01T10:00:05.000Z",
          sessionStartedAt: "2026-03-01T10:00:00.000Z",
          sessionEndedAt: "2026-03-01T10:00:05.000Z",
          sessionGitBranch: "main",
          sessionCwd: "/workspace/project-one",
        },
        {
          id: "m_assistant",
          sourceId: "src_assistant",
          sessionId: "session_1",
          provider: "claude",
          category: "assistant",
          content: "Parser behavior inspected and fixed.",
          createdAt: "2026-03-01T10:00:05.000Z",
          tokenInput: 10,
          tokenOutput: 8,
          operationDurationMs: 4000,
          operationDurationSource: "native",
          operationDurationConfidence: "high",
          sessionTitle: "Investigate markdown rendering",
          sessionActivity: "2026-03-01T10:00:05.000Z",
          sessionStartedAt: "2026-03-01T10:00:00.000Z",
          sessionEndedAt: "2026-03-01T10:00:05.000Z",
          sessionGitBranch: "main",
          sessionCwd: "/workspace/project-one",
        },
      ],
    }),
    "sessions:getDetail": () => ({
      session: {
        id: "session_1",
        projectId: "project_1",
        provider: "claude",
        filePath: "/workspace/project-one/session-1.jsonl",
        title: "Investigate markdown rendering",
        modelNames: "claude-opus-4-1",
        startedAt: "2026-03-01T10:00:00.000Z",
        endedAt: "2026-03-01T10:00:05.000Z",
        durationMs: 5000,
        gitBranch: "main",
        cwd: "/workspace/project-one",
        messageCount: 2,
        tokenInputTotal: 14,
        tokenOutputTotal: 8,
      },
      totalCount: 2,
      categoryCounts: {
        user: 1,
        assistant: 1,
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
    "bookmarks:listProject": (request) => {
      const query = String(request.query ?? "").toLowerCase();
      if (query === "delayed-search") {
        return delayedBookmarks.promise;
      }

      const entry = {
        projectId: "project_1",
        sessionId: "session_1",
        sessionTitle: "Investigate markdown rendering",
        bookmarkedAt: "2026-03-01T10:10:00.000Z",
        isOrphaned: false,
        orphanedAt: null,
        message: {
          id: "bm1",
          sourceId: "bm-src-1",
          sessionId: "session_1",
          provider: "claude" as const,
          category: "assistant" as const,
          content: "Parser behavior inspected and fixed.",
          createdAt: "2026-03-01T10:10:00.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        },
      };
      const matches = query.length === 0 || entry.message.content.toLowerCase().includes(query);

      return {
        projectId: "project_1",
        totalCount: 1,
        filteredCount: matches ? 1 : 0,
        page: Number(request.page ?? 0),
        pageSize: Number(request.pageSize ?? 100),
        categoryCounts: {
          user: 0,
          assistant: matches ? 1 : 0,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        results: matches ? [entry] : [],
      };
    },
    "search:query": (request) => ({
      query: String(request.query ?? ""),
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
      providerCounts: EMPTY_PROVIDER_COUNTS,
      results: [],
    }),
  });

  return { client, delayedBookmarks };
}
