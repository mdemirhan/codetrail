import { describe, expect, it } from "vitest";

import { type IpcChannel, ipcChannels, ipcContractSchemas } from "./ipc";

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
  "projects:list": {
    request: { providers: ["claude"], query: "" },
    response: { projects: [] },
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
    response: {
      projectPaneWidth: null,
      sessionPaneWidth: null,
      projectProviders: null,
      historyCategories: null,
      expandedByDefaultCategories: null,
      searchProviders: null,
      theme: null,
      monoFontFamily: null,
      regularFontFamily: null,
      monoFontSize: null,
      regularFontSize: null,
      useMonospaceForAllMessages: null,
      selectedProjectId: null,
      selectedSessionId: null,
      historyMode: null,
      sessionPage: null,
      sessionScrollTop: null,
      systemMessageRegexRules: null,
    },
  },
  "ui:setState": {
    request: {
      projectPaneWidth: 300,
      sessionPaneWidth: 360,
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
      sessionPage: 0,
      sessionScrollTop: 0,
      systemMessageRegexRules: {
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
      },
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
