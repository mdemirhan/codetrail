// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DashboardStatsResponse } from "../app/types";
import { renderWithPaneFocus } from "../test/renderWithPaneFocus";
import { DashboardView } from "./DashboardView";

const statsFixture: DashboardStatsResponse = {
  summary: {
    projectCount: 3,
    sessionCount: 6,
    messageCount: 128,
    bookmarkCount: 9,
    toolCallCount: 14,
    indexedFileCount: 7,
    indexedBytesTotal: 65_536,
    tokenInputTotal: 2_048,
    tokenOutputTotal: 1_536,
    totalDurationMs: 420_000,
    averageMessagesPerSession: 21.3,
    averageSessionDurationMs: 70_000,
    activeProviderCount: 3,
  },
  categoryCounts: {
    user: 20,
    assistant: 54,
    tool_use: 18,
    tool_edit: 17,
    tool_result: 11,
    thinking: 5,
    system: 3,
  },
  providerCounts: {
    claude: 44,
    codex: 62,
    gemini: 22,
    cursor: 0,
    copilot: 0,
  },
  providerStats: [
    {
      provider: "codex",
      projectCount: 1,
      sessionCount: 3,
      messageCount: 62,
      toolCallCount: 7,
      tokenInputTotal: 1_024,
      tokenOutputTotal: 780,
      lastActivity: "2026-03-16T10:05:03.000Z",
    },
    {
      provider: "claude",
      projectCount: 1,
      sessionCount: 2,
      messageCount: 44,
      toolCallCount: 5,
      tokenInputTotal: 800,
      tokenOutputTotal: 620,
      lastActivity: "2026-03-15T10:05:03.000Z",
    },
    {
      provider: "gemini",
      projectCount: 1,
      sessionCount: 1,
      messageCount: 22,
      toolCallCount: 2,
      tokenInputTotal: 224,
      tokenOutputTotal: 136,
      lastActivity: "2026-03-14T10:05:03.000Z",
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
    { date: "2026-03-04", sessionCount: 1, messageCount: 6 },
    { date: "2026-03-05", sessionCount: 0, messageCount: 0 },
    { date: "2026-03-06", sessionCount: 1, messageCount: 8 },
    { date: "2026-03-07", sessionCount: 0, messageCount: 0 },
    { date: "2026-03-08", sessionCount: 1, messageCount: 12 },
    { date: "2026-03-09", sessionCount: 0, messageCount: 0 },
    { date: "2026-03-10", sessionCount: 0, messageCount: 0 },
    { date: "2026-03-11", sessionCount: 1, messageCount: 18 },
    { date: "2026-03-12", sessionCount: 0, messageCount: 0 },
    { date: "2026-03-13", sessionCount: 1, messageCount: 24 },
    { date: "2026-03-14", sessionCount: 0, messageCount: 0 },
    { date: "2026-03-15", sessionCount: 1, messageCount: 28 },
    { date: "2026-03-16", sessionCount: 2, messageCount: 32 },
  ],
  topProjects: [
    {
      projectId: "project_1",
      provider: "codex",
      name: "Code Trail",
      path: "/workspace/codetrail",
      sessionCount: 3,
      messageCount: 62,
      bookmarkCount: 6,
      lastActivity: "2026-03-16T10:05:03.000Z",
    },
    {
      projectId: "project_2",
      provider: "claude",
      name: "Parser Workbench",
      path: "/workspace/parser-workbench",
      sessionCount: 2,
      messageCount: 44,
      bookmarkCount: 2,
      lastActivity: "2026-03-15T10:05:03.000Z",
    },
  ],
  topModels: [
    {
      modelName: "codex-gpt-5",
      sessionCount: 3,
      messageCount: 62,
    },
    {
      modelName: "claude-opus-4-1",
      sessionCount: 2,
      messageCount: 44,
    },
  ],
  activityWindowDays: 14,
};

describe("DashboardView", () => {
  it("renders the main dashboard sections and aggregated values", () => {
    renderWithPaneFocus(
      <DashboardView stats={statsFixture} loading={false} error={null} onRefresh={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "Activity Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Workspace telemetry")).toBeInTheDocument();
    expect(screen.getByText("Category Composition")).toBeInTheDocument();
    expect(screen.getByText("Provider Throughput")).toBeInTheDocument();
    expect(screen.getByText("Message Skyline")).toBeInTheDocument();
    expect(screen.getByText("Where the action is")).toBeInTheDocument();
    expect(screen.getByText("Most-used model signatures")).toBeInTheDocument();
    expect(screen.getByText("Code Trail")).toBeInTheDocument();
    expect(screen.getAllByText("codex-gpt-5")).toHaveLength(2);
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("Tool Result")).toBeInTheDocument();
  });

  it("forwards refresh clicks and shows dashboard errors", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    renderWithPaneFocus(
      <DashboardView
        stats={statsFixture}
        loading={false}
        error="Dashboard failed to load"
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText("Dashboard failed to load")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh dashboard" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
