// @vitest-environment jsdom

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App, setTestHistorySelectionDebounceOverrides } from "./App";
import { createAppClient, installScrollIntoViewMock } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

function countCalls(
  client: ReturnType<typeof createAppClient>,
  channel: string,
  predicate?: (payload: Record<string, unknown>) => boolean,
): number {
  return client.invoke.mock.calls.filter(([candidate, payload]) => {
    if (candidate !== channel) {
      return false;
    }
    if (!predicate) {
      return true;
    }
    return predicate(payload as Record<string, unknown>);
  }).length;
}

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function expectDefined<T>(value: T | null | undefined, message: string): NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
  return value as NonNullable<T>;
}

describe("App history selection debounce", () => {
  afterEach(() => {
    setTestHistorySelectionDebounceOverrides(null);
    vi.useRealTimers();
  });

  it("debounces project-to-project data loading by 100ms during keyboard navigation", async () => {
    installScrollIntoViewMock();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setTestHistorySelectionDebounceOverrides({ project: 100, session: 75 });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
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
          {
            id: "project_2",
            provider: "codex",
            name: "Project Two",
            path: "/workspace/project-two",
            sessionCount: 1,
            messageCount: 1,
            bookmarkCount: 0,
            lastActivity: "2026-03-01T09:00:05.000Z",
          },
        ],
      }),
      "sessions:list": (request) => ({
        sessions: [
          {
            id: `${String(request.projectId)}_session_1`,
            projectId: String(request.projectId),
            provider: request.projectId === "project_2" ? "codex" : "claude",
            filePath: `/workspace/${String(request.projectId)}/session-1.jsonl`,
            title: `${String(request.projectId)} session`,
            modelNames: "test-model",
            startedAt: "2026-03-01T10:00:00.000Z",
            endedAt: "2026-03-01T10:00:05.000Z",
            durationMs: 5000,
            gitBranch: "main",
            cwd: `/workspace/${String(request.projectId)}`,
            messageCount: 1,
            bookmarkCount: 0,
            tokenInputTotal: 10,
            tokenOutputTotal: 5,
          },
        ],
      }),
      "bookmarks:listProject": (request) => ({
        projectId: String(request.projectId),
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
        queryError: null,
        highlightPatterns: [],
      }),
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
            id: `${String(request.projectId)}_message_1`,
            sourceId: `${String(request.projectId)}_src_1`,
            sessionId: `${String(request.projectId)}_session_1`,
            provider: request.projectId === "project_2" ? "codex" : "claude",
            category: "user" as const,
            content:
              request.projectId === "project_2" ? "Project two message" : "Project one message",
            createdAt: "2026-03-01T10:00:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
            sessionTitle: `${String(request.projectId)} session`,
            sessionActivity: "2026-03-01T10:00:05.000Z",
            sessionStartedAt: "2026-03-01T10:00:00.000Z",
            sessionEndedAt: "2026-03-01T10:00:05.000Z",
            sessionGitBranch: "main",
            sessionCwd: `/workspace/${String(request.projectId)}`,
          },
        ],
      }),
    });

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project one message")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Switch to List" }));
    await user.click(screen.getByRole("button", { name: /project one/i }));
    client.invoke.mockClear();

    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(countCalls(client, "sessions:list")).toBe(0);
    expect(countCalls(client, "bookmarks:listProject")).toBe(0);
    expect(countCalls(client, "projects:getCombinedDetail")).toBe(0);

    await advanceTimers(99);

    expect(countCalls(client, "sessions:list")).toBe(0);
    expect(countCalls(client, "bookmarks:listProject")).toBe(0);
    expect(countCalls(client, "projects:getCombinedDetail")).toBe(0);

    fireEvent.keyUp(window, { key: "ArrowDown" });

    await advanceTimers(99);

    expect(countCalls(client, "sessions:list")).toBe(0);
    expect(countCalls(client, "bookmarks:listProject")).toBe(0);
    expect(countCalls(client, "projects:getCombinedDetail")).toBe(0);

    await advanceTimers(1);

    await waitFor(() => {
      expect(
        countCalls(client, "sessions:list", (payload) => payload.projectId === "project_2"),
      ).toBeGreaterThan(0);
      expect(
        countCalls(client, "bookmarks:listProject", (payload) => payload.projectId === "project_2"),
      ).toBeGreaterThan(0);
      expect(
        countCalls(
          client,
          "projects:getCombinedDetail",
          (payload) => payload.projectId === "project_2",
        ),
      ).toBeGreaterThan(0);
    });
  });

  it("debounces session-to-session detail loading by 75ms during keyboard navigation", async () => {
    installScrollIntoViewMock();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setTestHistorySelectionDebounceOverrides({ project: 100, session: 75 });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "sessions:list": () => ({
        sessions: [
          {
            id: "session_1",
            projectId: "project_1",
            provider: "claude",
            filePath: "/workspace/project-one/session-1.jsonl",
            title: "Session One",
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
          {
            id: "session_2",
            projectId: "project_1",
            provider: "claude",
            filePath: "/workspace/project-one/session-2.jsonl",
            title: "Session Two",
            modelNames: "claude-opus-4-1",
            startedAt: "2026-03-01T09:00:00.000Z",
            endedAt: "2026-03-01T09:00:05.000Z",
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
      "sessions:getDetail": (request) => ({
        session: {
          id: String(request.sessionId),
          projectId: "project_1",
          provider: "claude" as const,
          filePath: `/workspace/project-one/${String(request.sessionId)}.jsonl`,
          title: request.sessionId === "session_2" ? "Session Two" : "Session One",
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
            id: `${String(request.sessionId)}_message_1`,
            sourceId: `${String(request.sessionId)}_src_1`,
            sessionId: String(request.sessionId),
            provider: "claude" as const,
            category: "user" as const,
            content:
              request.sessionId === "session_2" ? "Session two detail" : "Session one detail",
            createdAt: "2026-03-01T10:00:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
          },
        ],
      }),
    });

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    const sessionOneButton = await screen.findByRole("button", { name: /Session One/i });
    await user.click(sessionOneButton);

    await waitFor(() => {
      expect(screen.getByText("Session one detail")).toBeInTheDocument();
    });

    const focusedSessionOneButton = await screen.findByRole("button", { name: /Session One/i });
    focusedSessionOneButton.focus();
    client.invoke.mockClear();

    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(countCalls(client, "sessions:getDetail")).toBe(0);

    await advanceTimers(40);

    expect(countCalls(client, "sessions:getDetail")).toBe(0);

    fireEvent.keyUp(window, { key: "ArrowDown" });

    await advanceTimers(34);

    expect(countCalls(client, "sessions:getDetail")).toBe(0);

    await advanceTimers(1);

    await waitFor(() => {
      expect(
        countCalls(client, "sessions:getDetail", (payload) => payload.sessionId === "session_2"),
      ).toBeGreaterThan(0);
    });
  });

  it("does not load an intermediate project when tree navigation ends on a folder", async () => {
    installScrollIntoViewMock();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setTestHistorySelectionDebounceOverrides({ project: 100, session: 75 });

    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          {
            id: "project_1",
            provider: "claude",
            name: "Project One",
            path: "/workspace/folder-1/project-one",
            sessionCount: 1,
            messageCount: 1,
            bookmarkCount: 0,
            lastActivity: "2026-03-01T10:00:05.000Z",
          },
          {
            id: "project_2",
            provider: "codex",
            name: "Project Two",
            path: "/workspace/folder-1/project-two",
            sessionCount: 1,
            messageCount: 1,
            bookmarkCount: 0,
            lastActivity: "2026-03-01T09:00:05.000Z",
          },
          {
            id: "project_3",
            provider: "gemini",
            name: "Project Three",
            path: "/workspace/folder-2/project-three",
            sessionCount: 1,
            messageCount: 1,
            bookmarkCount: 0,
            lastActivity: "2026-03-01T08:00:05.000Z",
          },
        ],
      }),
      "sessions:list": (request) => ({
        sessions: [
          {
            id: `${String(request.projectId)}_session_1`,
            projectId: String(request.projectId),
            provider:
              request.projectId === "project_2"
                ? "codex"
                : request.projectId === "project_3"
                  ? "gemini"
                  : "claude",
            filePath: `/workspace/${String(request.projectId)}/session-1.jsonl`,
            title: `${String(request.projectId)} session`,
            modelNames: "test-model",
            startedAt: "2026-03-01T10:00:00.000Z",
            endedAt: "2026-03-01T10:00:05.000Z",
            durationMs: 5000,
            gitBranch: "main",
            cwd: `/workspace/${String(request.projectId)}`,
            messageCount: 1,
            bookmarkCount: 0,
            tokenInputTotal: 10,
            tokenOutputTotal: 5,
          },
        ],
      }),
      "bookmarks:listProject": (request) => ({
        projectId: String(request.projectId),
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
        queryError: null,
        highlightPatterns: [],
      }),
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
            id: `${String(request.projectId)}_message_1`,
            sourceId: `${String(request.projectId)}_src_1`,
            sessionId: `${String(request.projectId)}_session_1`,
            provider:
              request.projectId === "project_2"
                ? "codex"
                : request.projectId === "project_3"
                  ? "gemini"
                  : "claude",
            category: "user" as const,
            content:
              request.projectId === "project_2"
                ? "Project two message"
                : request.projectId === "project_3"
                  ? "Project three message"
                  : "Project one message",
            createdAt: "2026-03-01T10:00:00.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
            sessionTitle: `${String(request.projectId)} session`,
            sessionActivity: "2026-03-01T10:00:05.000Z",
            sessionStartedAt: "2026-03-01T10:00:00.000Z",
            sessionEndedAt: "2026-03-01T10:00:05.000Z",
            sessionGitBranch: "main",
            sessionCwd: `/workspace/${String(request.projectId)}`,
          },
        ],
      }),
    });

    const { container } = renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project one message")).toBeInTheDocument();
    });

    const projectList = expectDefined(
      container.querySelector<HTMLDivElement>(".list-scroll.project-list"),
      "Expected project list",
    );
    await act(async () => {
      projectList.focus();
    });
    expect(document.activeElement).toBe(projectList);
    client.invoke.mockClear();

    await act(async () => {
      fireEvent.keyDown(projectList, { key: "ArrowDown" });
      fireEvent.keyUp(window, { key: "ArrowDown" });
    });
    expect(projectList.contains(document.activeElement)).toBe(true);
    expect(
      document.activeElement?.getAttribute("data-folder-id") ??
        document.activeElement?.closest("[data-folder-id]")?.getAttribute("data-folder-id"),
    ).toBe("/workspace/folder-1/project-two");

    await advanceTimers(50);

    expect(countCalls(client, "sessions:list")).toBe(0);
    expect(countCalls(client, "bookmarks:listProject")).toBe(0);
    expect(countCalls(client, "projects:getCombinedDetail")).toBe(0);

    await act(async () => {
      fireEvent.keyDown(projectList, { key: "ArrowDown" });
      fireEvent.keyUp(window, { key: "ArrowDown" });
    });
    expect(projectList.contains(document.activeElement)).toBe(true);
    expect(
      document.activeElement?.getAttribute("data-project-nav-id") ??
        document.activeElement
          ?.closest("[data-project-nav-id]")
          ?.getAttribute("data-project-nav-id"),
    ).toBe("project_2");

    await advanceTimers(50);

    expect(countCalls(client, "sessions:list")).toBe(0);
    expect(countCalls(client, "bookmarks:listProject")).toBe(0);
    expect(countCalls(client, "projects:getCombinedDetail")).toBe(0);

    await act(async () => {
      fireEvent.keyDown(projectList, { key: "ArrowDown" });
      fireEvent.keyUp(window, { key: "ArrowDown" });
    });
    expect(projectList.contains(document.activeElement)).toBe(true);
    expect(
      document.activeElement?.getAttribute("data-folder-id") ??
        document.activeElement?.closest("[data-folder-id]")?.getAttribute("data-folder-id"),
    ).toBe("/workspace/folder-2/project-three");

    await advanceTimers(99);

    expect(countCalls(client, "sessions:list")).toBe(0);
    expect(countCalls(client, "bookmarks:listProject")).toBe(0);
    expect(countCalls(client, "projects:getCombinedDetail")).toBe(0);

    await advanceTimers(1);

    expect(countCalls(client, "sessions:list")).toBe(0);
    expect(countCalls(client, "bookmarks:listProject")).toBe(0);
    expect(countCalls(client, "projects:getCombinedDetail")).toBe(0);
    expect(screen.getByText("Project one message")).toBeInTheDocument();
  });
});
