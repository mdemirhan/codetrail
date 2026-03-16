// @vitest-environment jsdom

import type { MessageCategory } from "@codetrail/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { copyTextToClipboard, openPath } = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(async () => true),
  openPath: vi.fn(async () => ({ ok: true, error: null })),
}));

vi.mock("../lib/clipboard", () => ({
  copyTextToClipboard,
}));

vi.mock("../lib/pathActions", () => ({
  openPath,
}));

import { SettingsView } from "./SettingsView";

const info = {
  storage: {
    settingsFile: "/tmp/ui-state.json",
    cacheDir: "/tmp/cache",
    databaseFile: "/tmp/codetrail.sqlite",
    bookmarksDatabaseFile: "/tmp/codetrail.bookmarks.sqlite",
    userDataDir: "/tmp",
  },
  discovery: {
    claudeRoot: "/Users/test/.claude/projects",
    codexRoot: "/Users/test/.codex/sessions",
    geminiRoot: "/Users/test/.gemini/tmp",
    geminiHistoryRoot: "/Users/test/.gemini/history",
    geminiProjectsPath: "/Users/test/.gemini/projects.json",
    cursorRoot: "/Users/test/.cursor/projects",
    opencodeDbPath: "/mock/.local/share/opencode/opencode.db",
  },
};

const diagnostics = {
  startedAt: "2026-03-16T10:00:00.000Z",
  watcher: {
    backend: "kqueue" as const,
    watchedRootCount: 5,
    watchBasedTriggers: 4,
    fallbackToIncrementalScans: 1,
    lastTriggerAt: "2026-03-16T10:05:00.000Z",
    lastTriggerPathCount: 2,
  },
  jobs: {
    startupIncremental: makeDiagnosticsBucket(),
    manualIncremental: makeDiagnosticsBucket({
      runs: 2,
      averageDurationMs: 150,
      maxDurationMs: 220,
    }),
    manualForceReindex: makeDiagnosticsBucket(),
    watchTriggered: makeDiagnosticsBucket({
      runs: 3,
      averageDurationMs: 80,
      maxDurationMs: 120,
    }),
    watchTargeted: makeDiagnosticsBucket({
      runs: 2,
      averageDurationMs: 50,
      maxDurationMs: 65,
    }),
    watchFallbackIncremental: makeDiagnosticsBucket({
      runs: 1,
      averageDurationMs: 120,
      maxDurationMs: 120,
    }),
    watchInitialScan: makeDiagnosticsBucket(),
    totals: {
      completedRuns: 5,
      failedRuns: 0,
    },
  },
  lastRun: {
    source: "watch_fallback_incremental" as const,
    completedAt: "2026-03-16T10:05:03.000Z",
    durationMs: 320,
    success: true,
  },
};

function createBaseProps() {
  return {
    diagnostics,
    diagnosticsLoading: false,
    diagnosticsError: null,
    theme: "dark" as const,
    zoomPercent: 100,
    monoFontFamily: "droid_sans_mono" as const,
    regularFontFamily: "current" as const,
    monoFontSize: "12px" as const,
    regularFontSize: "13.5px" as const,
    useMonospaceForAllMessages: false,
    onThemeChange: vi.fn(),
    onZoomPercentChange: vi.fn(),
    onMonoFontFamilyChange: vi.fn(),
    onRegularFontFamilyChange: vi.fn(),
    onMonoFontSizeChange: vi.fn(),
    onRegularFontSizeChange: vi.fn(),
    onUseMonospaceForAllMessagesChange: vi.fn(),
    expandedByDefaultCategories: ["assistant"] as MessageCategory[],
    onToggleExpandedByDefault: vi.fn(),
    systemMessageRegexRules: {
      claude: ["^<command-name>"],
      codex: ["^<environment_context>"],
      gemini: [],
      cursor: [],
      opencode: [],
    },
    onAddSystemMessageRegexRule: vi.fn(),
    onUpdateSystemMessageRegexRule: vi.fn(),
    onRemoveSystemMessageRegexRule: vi.fn(),
  };
}

describe("SettingsView", () => {
  it("renders loading and error states", () => {
    const baseProps = createBaseProps();
    const { rerender } = render(
      <SettingsView info={null} loading={true} error={null} {...baseProps} />,
    );

    expect(screen.getByText("Loading settings...")).toBeInTheDocument();

    rerender(<SettingsView info={null} loading={false} error="boom" {...baseProps} />);

    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders settings details and handles control interactions", async () => {
    const user = userEvent.setup();
    const baseProps = createBaseProps();

    render(<SettingsView info={info} loading={false} error={null} {...baseProps} />);

    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("Discovery Roots")).toBeInTheDocument();
    expect(screen.getByText("System Message Rules")).toBeInTheDocument();

    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(5);
    await user.selectOptions(selects[0] as HTMLElement, "midnight");
    await user.selectOptions(selects[1] as HTMLElement, "current");
    await user.selectOptions(selects[2] as HTMLElement, "13px");
    await user.selectOptions(selects[3] as HTMLElement, "inter");
    await user.selectOptions(selects[4] as HTMLElement, "14px");
    await user.clear(screen.getByRole("textbox", { name: "Zoom" }));
    await user.type(screen.getByRole("textbox", { name: "Zoom" }), "104%");
    await user.tab();

    await user.click(
      screen.getByRole("checkbox", { name: "Use monospaced fonts for all messages" }),
    );
    await user.click(screen.getByRole("button", { name: "User" }));
    await user.click(screen.getByRole("button", { name: "Add claude regex rule" }));
    await user.type(screen.getByRole("textbox", { name: "claude regex rule 1" }), "$");
    await user.click(screen.getByRole("button", { name: "Remove claude regex rule 1" }));

    const copyButtons = screen.getAllByRole("button", { name: /Copy /i });
    const openButtons = screen.getAllByRole("button", { name: /Open /i });
    expect(copyButtons.length).toBeGreaterThan(0);
    expect(openButtons.length).toBeGreaterThan(0);
    await user.click(copyButtons[0] as HTMLElement);
    await user.click(openButtons[0] as HTMLElement);

    expect(baseProps.onThemeChange).toHaveBeenCalledWith("midnight");
    expect(baseProps.onZoomPercentChange).toHaveBeenCalledWith(104);
    expect(baseProps.onMonoFontFamilyChange).toHaveBeenCalledWith("current");
    expect(baseProps.onMonoFontSizeChange).toHaveBeenCalledWith("13px");
    expect(baseProps.onRegularFontFamilyChange).toHaveBeenCalledWith("inter");
    expect(baseProps.onRegularFontSizeChange).toHaveBeenCalledWith("14px");
    expect(baseProps.onUseMonospaceForAllMessagesChange).toHaveBeenCalledWith(true);
    expect(baseProps.onToggleExpandedByDefault).toHaveBeenCalledWith("user");
    expect(baseProps.onAddSystemMessageRegexRule).toHaveBeenCalledWith("claude");
    expect(baseProps.onUpdateSystemMessageRegexRule).toHaveBeenCalledWith(
      "claude",
      0,
      "^<command-name>$",
    );
    expect(baseProps.onRemoveSystemMessageRegexRule).toHaveBeenCalledWith("claude", 0);
    expect(copyTextToClipboard).toHaveBeenCalled();
    expect(openPath).toHaveBeenCalled();
  });

  it("shows diagnostics in a separate tab", async () => {
    const user = userEvent.setup();
    const baseProps = createBaseProps();

    render(<SettingsView info={info} loading={false} error={null} {...baseProps} />);

    await user.click(screen.getByRole("tab", { name: "Diagnostics" }));

    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Manual Incremental Scans")).toBeInTheDocument();
    expect(screen.getByText("Watch-Based Triggers")).toBeInTheDocument();
    expect(screen.getByText("Run Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Trigger type")).toBeInTheDocument();
    expect(screen.getByText("Avg duration")).toBeInTheDocument();
    expect(screen.getByText("Max duration")).toBeInTheDocument();
  });
});

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
