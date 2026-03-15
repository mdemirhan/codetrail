import { describe, expect, it } from "vitest";

import { type IpcResponse, paneStateBaseSchema } from "@codetrail/core";

import { registerIpcHandlers } from "./ipc";

const allNullPaneState = Object.fromEntries(
  Object.keys(paneStateBaseSchema.shape).map((k) => [k, null]),
) as IpcResponse<"ui:getState">;

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
            cursorRoot: "/Users/test/.cursor/projects",
          },
        }),
        "db:getSchemaVersion": () => ({ schemaVersion: 1 }),
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
        "ui:getState": () => allNullPaneState,
        "ui:setState": () => ({
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
        "watcher:stop": () => ({ ok: true }),
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
            cursorRoot: "/Users/test/.cursor/projects",
          },
        }),
        "db:getSchemaVersion": () => ({ schemaVersion: 1 }),
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
        "ui:getState": () => allNullPaneState,
        "ui:setState": () => ({ ok: true }),
        "ui:getZoom": () => ({ percent: 100 }),
        "ui:setZoom": () => ({ percent: 0 }) as never,
        "watcher:start": () => ({ ok: true, watchedRoots: [], backend: "default" }),
        "watcher:getStatus": () => ({ running: false, processing: false, pendingPathCount: 0 }),
        "watcher:stop": () => ({ ok: true }),
      },
    );

    const call = registry.get("ui:setZoom");
    await expect(
      call?.({ sender: { getZoomFactor: () => 1, getZoomLevel: () => 0 } }, { action: "in" }),
    ).rejects.toThrowError("Invalid response");
  });
});
