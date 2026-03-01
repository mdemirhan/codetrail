import { describe, expect, it } from "vitest";

import { registerIpcHandlers } from "./ipc";

describe("registerIpcHandlers", () => {
  it("validates request payloads before invoking handlers", async () => {
    const registry = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();

    registerIpcHandlers(
      {
        handle: (channel, handler) => {
          registry.set(channel, handler as (event: unknown, payload: unknown) => Promise<unknown>);
        },
      },
      {
        "app:getHealth": () => ({ status: "ok", version: "0.1.0" }),
        "app:getSettingsInfo": () => ({
          storage: {
            settingsFile: "/tmp/codetrail/ui-state.json",
            cacheDir: "/tmp/codetrail/cache",
            databaseFile: "/tmp/codetrail/codetrail.sqlite",
            bookmarksDatabaseFile: "/tmp/codetrail/codetrail.bookmarks.sqlite",
            userDataDir: "/tmp/codetrail",
          },
          discovery: {
            claudeRoot: "/Users/test/.claude/projects",
            codexRoot: "/Users/test/.codex/sessions",
            geminiRoot: "/Users/test/.gemini/tmp",
            geminiHistoryRoot: "/Users/test/.gemini/history",
            geminiProjectsPath: "/Users/test/.gemini/projects.json",
          },
        }),
        "db:getSchemaVersion": () => ({ schemaVersion: 1 }),
        "indexer:refresh": (payload) => ({ jobId: payload.force ? "force-1" : "normal-1" }),
        "projects:list": () => ({ projects: [] }),
        "sessions:list": () => ({ sessions: [] }),
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
        "bookmarks:listProject": () => ({
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
        }),
        "bookmarks:toggle": () => ({
          bookmarked: true,
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
          results: [],
        }),
        "path:openInFileManager": () => ({
          ok: true,
          error: null,
        }),
        "ui:getState": () => ({
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
        }),
        "ui:setState": () => ({
          ok: true,
        }),
        "ui:getZoom": () => ({
          percent: 100,
        }),
        "ui:setZoom": () => ({
          percent: 100,
        }),
      },
    );

    const invalidCall = registry.get("indexer:refresh");
    await expect(invalidCall?.({}, { force: "wrong" })).rejects.toThrowError("Invalid payload");

    const validCall = registry.get("app:getHealth");
    await expect(validCall?.({}, {})).resolves.toEqual({ status: "ok", version: "0.1.0" });
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
        "app:getSettingsInfo": () => ({
          storage: {
            settingsFile: "/tmp/codetrail/ui-state.json",
            cacheDir: "/tmp/codetrail/cache",
            databaseFile: "/tmp/codetrail/codetrail.sqlite",
            bookmarksDatabaseFile: "/tmp/codetrail/codetrail.bookmarks.sqlite",
            userDataDir: "/tmp/codetrail",
          },
          discovery: {
            claudeRoot: "/Users/test/.claude/projects",
            codexRoot: "/Users/test/.codex/sessions",
            geminiRoot: "/Users/test/.gemini/tmp",
            geminiHistoryRoot: "/Users/test/.gemini/history",
            geminiProjectsPath: "/Users/test/.gemini/projects.json",
          },
        }),
        "db:getSchemaVersion": () => ({ schemaVersion: 1 }),
        "indexer:refresh": () => ({ jobId: "refresh-1" }),
        "projects:list": () => ({ projects: [] }),
        "sessions:list": () => ({ sessions: [] }),
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
        "bookmarks:listProject": () => ({
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
        }),
        "bookmarks:toggle": () => ({ bookmarked: true }),
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
          results: [],
        }),
        "path:openInFileManager": () => ({ ok: true, error: null }),
        "ui:getState": () => ({
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
        }),
        "ui:setState": () => ({ ok: true }),
        "ui:getZoom": () => ({ percent: 100 }),
        "ui:setZoom": () => ({ percent: 0 }) as never,
      },
    );

    const call = registry.get("ui:setZoom");
    await expect(
      call?.({ sender: { getZoomFactor: () => 1, getZoomLevel: () => 0 } }, { action: "in" }),
    ).rejects.toThrowError("Invalid response");
  });
});
