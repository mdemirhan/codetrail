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
          searchProviders: null,
          searchCategories: null,
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
});
