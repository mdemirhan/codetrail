// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
    copilot_cli: 0,
    opencode: 0,
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
  aiCodeStats: {
    summary: {
      writeEventCount: 5,
      measurableWriteEventCount: 4,
      writeSessionCount: 3,
      fileChangeCount: 6,
      distinctFilesTouchedCount: 5,
      linesAdded: 32,
      linesDeleted: 11,
      netLines: 21,
      multiFileWriteCount: 1,
      averageFilesPerWrite: 1.5,
    },
    changeTypeCounts: {
      add: 2,
      update: 3,
      delete: 1,
      move: 0,
    },
    providerStats: [
      {
        provider: "codex",
        writeEventCount: 3,
        fileChangeCount: 4,
        linesAdded: 20,
        linesDeleted: 8,
        writeSessionCount: 2,
      },
      {
        provider: "claude",
        writeEventCount: 2,
        fileChangeCount: 2,
        linesAdded: 12,
        linesDeleted: 3,
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
        writeEventCount: 1,
        fileChangeCount: 1,
        linesAdded: 4,
        linesDeleted: 0,
      },
      {
        date: "2026-03-05",
        writeEventCount: 0,
        fileChangeCount: 0,
        linesAdded: 0,
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
        writeEventCount: 1,
        fileChangeCount: 2,
        linesAdded: 7,
        linesDeleted: 2,
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
        fileChangeCount: 1,
        linesAdded: 8,
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
        linesAdded: 5,
        linesDeleted: 1,
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
        linesAdded: 8,
        linesDeleted: 5,
      },
    ],
    topFiles: [
      {
        filePath: "src/dashboard.tsx",
        writeEventCount: 2,
        linesAdded: 16,
        linesDeleted: 6,
        lastTouchedAt: "2026-03-16T10:05:03.000Z",
      },
      {
        filePath: "src/queryService.ts",
        writeEventCount: 1,
        linesAdded: 9,
        linesDeleted: 3,
        lastTouchedAt: "2026-03-11T10:05:03.000Z",
      },
    ],
    topFileTypes: [
      {
        label: ".ts",
        fileChangeCount: 4,
        linesAdded: 18,
        linesDeleted: 6,
      },
      {
        label: ".tsx",
        fileChangeCount: 2,
        linesAdded: 14,
        linesDeleted: 5,
      },
    ],
  },
  activityWindowDays: 14,
};

describe("DashboardView", () => {
  it("renders the main dashboard sections and aggregated values", () => {
    renderWithPaneFocus(<DashboardView stats={statsFixture} error={null} />);

    expect(screen.getByRole("heading", { name: "Activity Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Workspace telemetry")).toBeInTheDocument();
    expect(screen.getByText("AI Code Activity")).toBeInTheDocument();
    expect(screen.getByText("Write Velocity")).toBeInTheDocument();
    expect(screen.getByText("Change Profile")).toBeInTheDocument();
    expect(screen.getByText("Provider Write Throughput")).toBeInTheDocument();
    expect(screen.getByText("Top Written Files")).toBeInTheDocument();
    expect(screen.getByText("Top File Types")).toBeInTheDocument();
    expect(screen.getByText("Message Composition")).toBeInTheDocument();
    expect(screen.getByText("Provider Throughput")).toBeInTheDocument();
    expect(screen.getByText("Message Skyline")).toBeInTheDocument();
    expect(screen.getByText("Top Projects")).toBeInTheDocument();
    expect(screen.getByText("Top Models")).toBeInTheDocument();
    expect(screen.getByText("Code Trail")).toBeInTheDocument();
    expect(screen.getByText("src/dashboard.tsx")).toBeInTheDocument();
    expect(screen.getByText(".ts")).toBeInTheDocument();
    expect(screen.getAllByText("codex-gpt-5")).toHaveLength(2);
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("Tool Result")).toBeInTheDocument();
  });

  it("shows dashboard errors", () => {
    renderWithPaneFocus(<DashboardView stats={statsFixture} error="Dashboard failed to load" />);

    expect(screen.getByText("Dashboard failed to load")).toBeInTheDocument();
  });

  it("shows an empty state when no ai write activity has been indexed", () => {
    renderWithPaneFocus(
      <DashboardView
        stats={{
          ...statsFixture,
          aiCodeStats: {
            ...statsFixture.aiCodeStats,
            summary: {
              ...statsFixture.aiCodeStats.summary,
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
            providerStats: statsFixture.aiCodeStats.providerStats.map((provider) => ({
              ...provider,
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
              writeSessionCount: 0,
            })),
            recentActivity: statsFixture.aiCodeStats.recentActivity.map((point) => ({
              ...point,
              writeEventCount: 0,
              fileChangeCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
            })),
            topFiles: [],
            topFileTypes: [],
            changeTypeCounts: {
              add: 0,
              update: 0,
              delete: 0,
              move: 0,
            },
          },
        }}
        error={null}
      />,
    );

    expect(screen.getByText("No AI write activity indexed yet")).toBeInTheDocument();
  });
});
