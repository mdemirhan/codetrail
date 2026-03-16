import { describe, expect, it } from "vitest";

import { type IpcChannel, ipcChannels, ipcContractSchemas, paneStateBaseSchema } from "./ipc";

const allNullPaneState = Object.fromEntries(
  Object.keys(paneStateBaseSchema.shape).map((k) => [k, null]),
);

type ChannelExample = {
  request: unknown;
  response: unknown;
};

const channelExamples: Record<IpcChannel, ChannelExample> = {
  "app:getHealth": {
    request: {},
    response: { status: "ok", version: "0.1.0" },
  },
  "app:getSettingsInfo": {
    request: {},
    response: {
      storage: {
        settingsFile: "/tmp/ui-state.json",
        cacheDir: "/tmp/cache",
        databaseFile: "/tmp/codetrail.sqlite",
        bookmarksDatabaseFile: "/tmp/codetrail.bookmarks.sqlite",
        userDataDir: "/tmp",
      },
      discovery: {
        claudeRoot: "/home/user/.claude/projects",
        codexRoot: "/home/user/.codex/sessions",
        geminiRoot: "/home/user/.gemini/tmp",
        geminiHistoryRoot: "/home/user/.gemini/history",
        geminiProjectsPath: "/home/user/.gemini/projects.json",
        cursorRoot: "/home/user/.cursor/projects",
        copilotRoot: "/home/user/.config/Code/User/workspaceStorage",
      },
    },
  },
  "db:getSchemaVersion": {
    request: {},
    response: { schemaVersion: 1 },
  },
  "indexer:refresh": {
    request: { force: false },
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
  "bookmarks:listProject": {
    request: {
      projectId: "project_1",
      query: "parser",
      categories: ["assistant"],
    },
    response: {
      projectId: "project_1",
      totalCount: 0,
      filteredCount: 0,
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
  "bookmarks:toggle": {
    request: {
      projectId: "project_1",
      sessionId: "session_1",
      messageId: "message_1",
      messageSourceId: "source_1",
    },
    response: { bookmarked: true },
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
      results: [],
    },
  },
  "path:openInFileManager": {
    request: { path: "/tmp/file.txt" },
    response: { ok: true, error: null },
  },
  "ui:getState": {
    request: {},
    response: allNullPaneState,
  },
  "ui:setState": {
    request: {
      projectPaneWidth: 300,
      sessionPaneWidth: 360,
      projectPaneCollapsed: false,
      sessionPaneCollapsed: false,
      projectProviders: ["claude", "codex", "gemini"],
      historyCategories: ["user", "assistant"],
      expandedByDefaultCategories: ["assistant"],
      searchProviders: ["claude"],
      theme: "dark",
      monoFontFamily: "droid_sans_mono",
      regularFontFamily: "inter",
      monoFontSize: "13px",
      regularFontSize: "14px",
      useMonospaceForAllMessages: false,
      selectedProjectId: "project_1",
      selectedSessionId: "session_1",
      historyMode: "session",
      projectSortDirection: "desc",
      sessionSortDirection: "desc",
      messageSortDirection: "asc",
      bookmarkSortDirection: "asc",
      projectAllSortDirection: "desc",
      sessionPage: 0,
      sessionScrollTop: 0,
      preferredAutoRefreshStrategy: "watch-5s",
      systemMessageRegexRules: {
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
        cursor: [],
        copilot: [],
      },
      autoScrollEnabled: false,
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
      },
      jobs: {
        startupIncremental: makeDiagnosticsBucket(),
        manualIncremental: makeDiagnosticsBucket(),
        manualForceReindex: makeDiagnosticsBucket(),
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
  "watcher:stop": {
    request: {},
    response: { ok: true },
  },
};

describe("ipc contracts", () => {
  it("accepts valid request and response payloads for every channel", () => {
    for (const channel of ipcChannels) {
      const example = channelExamples[channel];
      expect(ipcContractSchemas[channel].request.safeParse(example.request).success).toBe(true);
      expect(ipcContractSchemas[channel].response.safeParse(example.response).success).toBe(true);
    }
  });

  it("rejects invalid payload shapes", () => {
    expect(ipcContractSchemas["indexer:refresh"].request.safeParse({ force: "yes" }).success).toBe(
      false,
    );
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
