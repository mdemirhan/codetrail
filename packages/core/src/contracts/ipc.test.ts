import { describe, expect, it } from "vitest";

import {
  createClaudeHookStateFixture,
  createLiveStatusFixture,
} from "../testing/liveWatchFixtures";
import { createSettingsInfoFixture } from "../testing/settingsInfoFixture";
import {
  type IpcChannel,
  indexerConfigBaseSchema,
  ipcChannels,
  ipcContractSchemas,
  paneStateBaseSchema,
} from "./ipc";

const allNullPaneState = Object.fromEntries(
  Object.keys(paneStateBaseSchema.shape).map((k) => [k, null]),
);
const allNullIndexerConfig = Object.fromEntries(
  Object.keys(indexerConfigBaseSchema.shape).map((k) => [k, null]),
);

type ChannelExample = {
  request: unknown;
  response: unknown;
};

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
};

function createClaudeHookStateExample(input: { installed: boolean }) {
  return createClaudeHookStateFixture({
    settingsPath: "/home/user/.claude/settings.json",
    logPath: "/tmp/codetrail/live-status/claude-hooks.jsonl",
    installed: input.installed,
  });
}

const channelExamples: Record<IpcChannel, ChannelExample> = {
  "app:getHealth": {
    request: {},
    response: { status: "ok", version: "0.1.0" },
  },
  "app:flushState": {
    request: {},
    response: { ok: true },
  },
  "app:setCommandState": {
    request: { canReindexSelectedProject: false },
    response: { ok: true },
  },
  "app:getSettingsInfo": {
    request: {},
    response: createSettingsInfoFixture({
      homeDir: "/home/user",
      pathValues: {
        copilotRoot: "/home/user/.config/Code/User/workspaceStorage",
      },
    }),
  },
  "db:getSchemaVersion": {
    request: {},
    response: { schemaVersion: 1 },
  },
  "dashboard:getStats": {
    request: {},
    response: {
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
      providerCounts: {
        claude: 0,
        codex: 0,
        gemini: 0,
        cursor: 0,
        copilot: 0,
        copilot_cli: 0,
        opencode: 0,
      },
      providerStats: [],
      recentActivity: [],
      topProjects: [],
      topModels: [],
      aiCodeStats: emptyAiCodeStats,
      activityWindowDays: 14,
    },
  },
  "indexer:refresh": {
    request: { force: true, projectId: "project_1" },
    response: { jobId: "refresh-1" },
  },
  "indexer:getStatus": {
    request: {},
    response: {
      running: false,
      queuedJobs: 0,
      activeJobId: null,
      completedJobs: 0,
    },
  },
  "projects:list": {
    request: { providers: ["claude"], query: "" },
    response: { projects: [] },
  },
  "projects:getCombinedDetail": {
    request: {
      projectId: "project_1",
      page: 0,
      pageSize: 100,
      categories: ["assistant"],
      query: "",
      sortDirection: "asc",
      focusMessageId: "message_1",
    },
    response: {
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
    },
  },
  "sessions:list": {
    request: { projectId: "project_1" },
    response: { sessions: [] },
  },
  "sessions:listMany": {
    request: { projectIds: ["project_1", "project_2"] },
    response: { sessionsByProjectId: { project_1: [], project_2: [] } },
  },
  "sessions:getDetail": {
    request: {
      sessionId: "session_1",
      page: 0,
      pageSize: 100,
      categories: ["user"],
      query: "",
      sortDirection: "asc",
      focusMessageId: "message_1",
    },
    response: {
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
    },
  },
  "sessions:getTurn": {
    request: {
      scopeMode: "session",
      sessionId: "session_1",
      anchorMessageId: "message_1",
      query: "",
      sortDirection: "asc",
    },
    response: {
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
      matchedMessageIds: [],
      messages: [],
    },
  },
  "sessions:delete": {
    request: {
      sessionId: "session_1",
    },
    response: {
      deleted: true,
      projectId: "project_1",
      provider: "claude",
      sourceFormat: "jsonl_stream",
      removedMessageCount: 2,
      removedBookmarkCount: 1,
    },
  },
  "bookmarks:listProject": {
    request: {
      projectId: "project_1",
      page: 0,
      pageSize: 100,
      sortDirection: "asc",
      countOnly: true,
      query: "parser",
      categories: ["assistant"],
      focusMessageId: "message_1",
    },
    response: {
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
    },
  },
  "bookmarks:getStates": {
    request: {
      projectId: "project_1",
      messageIds: ["message_1", "message_2"],
    },
    response: {
      projectId: "project_1",
      bookmarkedMessageIds: ["message_2"],
    },
  },
  "bookmarks:toggle": {
    request: {
      projectId: "project_1",
      sessionId: "session_1",
      messageId: "message_1",
      messageSourceId: "source_1",
    },
    response: { bookmarked: true },
  },
  "history:exportMessages": {
    request: {
      exportId: "export_1",
      mode: "session",
      projectId: "project_1",
      sessionId: "session_1",
      page: 0,
      pageSize: 100,
      categories: ["assistant"],
      query: "parser",
      searchMode: "simple",
      sortDirection: "asc",
      scope: "current_page",
    },
    response: {
      canceled: false,
      path: "/tmp/messages-export.md",
    },
  },
  "search:query": {
    request: {
      query: "parser",
      categories: ["assistant"],
      providers: ["claude"],
      projectIds: ["project_1"],
      projectQuery: "",
      limit: 50,
      offset: 0,
    },
    response: {
      query: "parser",
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
      providerCounts: {
        claude: 0,
        codex: 0,
        gemini: 0,
        cursor: 0,
        copilot: 0,
        copilot_cli: 0,
        opencode: 0,
      },
      results: [],
    },
  },
  "projects:delete": {
    request: { projectId: "project_1" },
    response: {
      deleted: true,
      provider: "claude",
      sourceFormat: "jsonl_stream",
      removedSessionCount: 3,
      removedMessageCount: 20,
      removedBookmarkCount: 4,
    },
  },
  "path:openInFileManager": {
    request: { path: "/tmp/file.txt" },
    response: { ok: true, error: null },
  },
  "dialog:pickExternalToolCommand": {
    request: {},
    response: { canceled: false, path: "/System/Applications/TextEdit.app", error: null },
  },
  "editor:listAvailable": {
    request: {},
    response: {
      editors: [
        {
          id: "editor:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          detected: true,
          command: "/usr/bin/code",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
      diffTools: [
        {
          id: "diff:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          detected: true,
          command: "/usr/bin/code",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
      ],
    },
  },
  "editor:open": {
    request: {
      kind: "file",
      filePath: "/tmp/file.txt",
      line: 10,
      column: 3,
    },
    response: { ok: true, error: null },
  },
  "ui:getPaneState": {
    request: {},
    response: allNullPaneState,
  },
  "ui:setPaneState": {
    request: {
      projectPaneWidth: 300,
      sessionPaneWidth: 360,
      projectPaneCollapsed: false,
      sessionPaneCollapsed: false,
      projectProviders: ["claude", "codex", "gemini"],
      historyCategories: ["user", "assistant"],
      expandedByDefaultCategories: ["assistant"],
      turnViewCategories: ["user", "assistant"],
      turnViewExpandedByDefaultCategories: ["assistant"],
      turnViewCombinedChangesExpanded: false,
      searchProviders: ["claude"],
      theme: "dark",
      darkShikiTheme: "github-dark-default",
      lightShikiTheme: "github-light-default",
      monoFontFamily: "droid_sans_mono",
      regularFontFamily: "inter",
      monoFontSize: "13px",
      regularFontSize: "14px",
      messagePageSize: 50,
      useMonospaceForAllMessages: false,
      autoHideMessageActions: true,
      expandPreviewOnHiddenActions: true,
      autoHideViewerHeaderActions: false,
      defaultViewerWrapMode: "nowrap",
      defaultDiffViewMode: "unified",
      collapseMultiFileToolDiffs: true,
      preferredExternalEditor: "tool:vscode",
      preferredExternalDiffTool: "tool:cursor",
      terminalAppCommand: "/Applications/iTerm.app",
      externalTools: [
        {
          id: "tool:vscode",
          kind: "known",
          label: "VS Code",
          appId: "vscode",
          command: "",
          editorArgs: [],
          diffArgs: [],
          enabledForEditor: true,
          enabledForDiff: true,
        },
        {
          id: "tool:cursor",
          kind: "known",
          label: "Cursor",
          appId: "cursor",
          command: "",
          enabledForEditor: true,
          enabledForDiff: true,
          editorArgs: [],
          diffArgs: [],
        },
        {
          id: "tool:zed",
          kind: "known",
          label: "Zed",
          appId: "zed",
          command: "",
          editorArgs: [],
          diffArgs: [],
          enabledForEditor: true,
          enabledForDiff: true,
        },
        {
          id: "custom:helix",
          kind: "custom",
          label: "Helix",
          appId: null,
          command: "hx",
          editorArgs: ["{file}"],
          diffArgs: ["{left}", "{right}"],
          enabledForEditor: true,
          enabledForDiff: false,
        },
      ],
      selectedProjectId: "project_1",
      selectedSessionId: "session_1",
      historyMode: "session",
      singleClickFoldersExpand: true,
      singleClickProjectsExpand: false,
      hideSessionsPaneInTreeView: false,
      projectViewMode: "tree",
      projectSortField: "last_active",
      projectSortDirection: "desc",
      sessionSortDirection: "desc",
      messageSortDirection: "asc",
      bookmarkSortDirection: "asc",
      projectAllSortDirection: "desc",
      turnViewSortDirection: "desc",
      sessionPage: 0,
      sessionScrollTop: 0,
      liveWatchEnabled: false,
      liveWatchRowHasBackground: true,
      claudeHooksPrompted: false,
      currentAutoRefreshStrategy: "off",
      preferredAutoRefreshStrategy: "watch-5s",
      systemMessageRegexRules: {
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
        cursor: [],
        copilot: [],
        copilot_cli: [],
        opencode: [],
      },
    },
    response: { ok: true },
  },
  "indexer:getConfig": {
    request: {},
    response: allNullIndexerConfig,
  },
  "indexer:setConfig": {
    request: {
      enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
      removeMissingSessionsDuringIncrementalIndexing: false,
    },
    response: { ok: true },
  },
  "ui:getZoom": {
    request: {},
    response: { percent: 100 },
  },
  "ui:setZoom": {
    request: { action: "reset" },
    response: { percent: 100 },
  },
  "watcher:start": {
    request: { debounceMs: 3000 },
    response: { ok: true, watchedRoots: ["/home/user/.claude/projects"], backend: "default" },
  },
  "watcher:getStatus": {
    request: {},
    response: { running: true, processing: false, pendingPathCount: 3 },
  },
  "watcher:getStats": {
    request: {},
    response: {
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
        manualIncremental: makeDiagnosticsBucket(),
        manualForceReindex: makeDiagnosticsBucket(),
        manualProjectForceReindex: makeDiagnosticsBucket(),
        watchTriggered: makeDiagnosticsBucket(),
        watchTargeted: makeDiagnosticsBucket(),
        watchFallbackIncremental: makeDiagnosticsBucket(),
        watchInitialScan: makeDiagnosticsBucket(),
        totals: {
          completedRuns: 0,
          failedRuns: 0,
        },
      },
      lastRun: null,
    },
  },
  "watcher:getLiveStatus": {
    request: {},
    response: createLiveStatusFixture({
      enabled: true,
      providerCounts: {
        claude: 1,
        codex: 0,
        gemini: 0,
        cursor: 0,
        copilot: 0,
        copilot_cli: 0,
        opencode: 0,
      },
      sessions: [
        {
          provider: "claude",
          sessionIdentity: "claude:session-1",
          sourceSessionId: "session-1",
          filePath: "/home/user/.claude/projects/project-a/session-1.jsonl",
          projectName: "project-a",
          projectPath: "/workspace/project-a",
          cwd: "/workspace/project-a",
          statusKind: "running_tool",
          statusText: "Running tool",
          detailText: "Read",
          sourcePrecision: "hook",
          lastActivityAt: "2026-03-24T10:00:00.000Z",
          bestEffort: false,
        },
      ],
      claudeHookState: createClaudeHookStateExample({ installed: true }),
    }),
  },
  "watcher:stop": {
    request: {},
    response: { ok: true },
  },
  "claudeHooks:install": {
    request: {},
    response: {
      ok: true,
      state: createClaudeHookStateExample({ installed: true }),
    },
  },
  "claudeHooks:remove": {
    request: {},
    response: {
      ok: true,
      state: createClaudeHookStateExample({ installed: false }),
    },
  },
  "debug:recordLiveUiTrace": {
    request: {
      selectionMode: "session",
      selectedProjectId: "project_1",
      selectedProjectPath: "/workspace/project-one",
      selectedSessionId: "session_1",
      selectedSessionIdentity: "selected",
      displayedMatchType: "session",
      displayedRankingReason: "running_tool priority",
      displayedSession: {
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
      candidateSessions: [
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
      ],
      renderedSummary: "Live · Codex · Running command · bun run test",
    },
    response: {
      ok: true,
    },
  },
};

describe("ipc contracts", () => {
  it("accepts valid request and response payloads for every channel", () => {
    for (const channel of ipcChannels) {
      const example = channelExamples[channel];
      const requestResult = ipcContractSchemas[channel].request.safeParse(example.request);
      const responseResult = ipcContractSchemas[channel].response.safeParse(example.response);
      expect(
        requestResult.success,
        `${channel} request: ${requestResult.success ? "ok" : requestResult.error.message}`,
      ).toBe(true);
      expect(
        responseResult.success,
        `${channel} response: ${responseResult.success ? "ok" : responseResult.error.message}`,
      ).toBe(true);
    }
  });

  it("rejects invalid payload shapes", () => {
    expect(ipcContractSchemas["indexer:refresh"].request.safeParse({ force: "yes" }).success).toBe(
      false,
    );
    expect(
      ipcContractSchemas["indexer:refresh"].request.safeParse({ force: true, projectId: "" })
        .success,
    ).toBe(false);
    expect(
      ipcContractSchemas["app:setCommandState"].request.safeParse({
        canReindexSelectedProject: "yes",
      }).success,
    ).toBe(false);
    expect(ipcContractSchemas["ui:setZoom"].response.safeParse({ percent: 0 }).success).toBe(false);
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
