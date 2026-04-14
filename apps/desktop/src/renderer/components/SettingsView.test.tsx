// @vitest-environment jsdom

import { type ComponentProps, useState } from "react";

import type { IpcResponse, Provider } from "@codetrail/core/browser";
import {
  createClaudeHookStateFixture,
  createLiveStatusFixture,
  createSettingsInfoFixture,
} from "@codetrail/core/testing";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  type DiffViewMode,
  type ExternalEditorId,
  type ExternalToolConfig,
  type MessagePageSize,
  type ShikiThemeId,
  type ViewerWrapMode,
  createDefaultExternalTools,
  createKnownToolId,
  getShikiThemeGroupForUiTheme,
} from "../../shared/uiPreferences";

const { browseExternalToolCommand, copyTextToClipboard, openPath } = vi.hoisted(() => ({
  browseExternalToolCommand: vi.fn(async () => ({
    canceled: false,
    path: "/System/Applications/TextEdit.app",
    error: null,
  })),
  copyTextToClipboard: vi.fn(async () => true),
  openPath: vi.fn(async () => ({ ok: true, error: null })),
}));

vi.mock("../lib/clipboard", () => ({
  copyTextToClipboard,
}));

vi.mock("../lib/pathActions", () => ({
  browseExternalToolCommand,
  openPath,
}));

import { SettingsView } from "./SettingsView";

const info = createSettingsInfoFixture() satisfies IpcResponse<"app:getSettingsInfo">;

const diagnostics = {
  startedAt: "2026-03-16T10:00:00.000Z",
  watcher: {
    backend: "kqueue" as const,
    watchedRootCount: 5,
    watchBasedTriggers: 4,
    fallbackToIncrementalScans: 1,
    lastTriggerAt: "2026-03-16T10:05:00.000Z",
    lastTriggerPathCount: 2,
    structuralInvalidationObservedAt: null,
    forcedRestartCount: 0,
    lastForcedRestartAt: null,
    lastPostRestartTrackedCatchupCount: null,
    lastStaleCandidateCountAfterRepair: null,
  },
  jobs: {
    startupIncremental: makeDiagnosticsBucket(),
    manualIncremental: makeDiagnosticsBucket({
      runs: 2,
      averageDurationMs: 150,
      maxDurationMs: 220,
    }),
    manualForceReindex: makeDiagnosticsBucket(),
    manualProjectForceReindex: makeDiagnosticsBucket(),
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

function createBaseProps(): Omit<
  ComponentProps<typeof SettingsView>,
  "info" | "loading" | "error"
> {
  const externalTools: ExternalToolConfig[] = [
    ...createDefaultExternalTools().map((tool) =>
      tool.appId === "vscode"
        ? tool
        : {
            ...tool,
            enabledForEditor: false,
            enabledForDiff: false,
          },
    ),
    {
      id: "custom:1",
      kind: "custom",
      label: "Custom Tool 1",
      appId: null,
      command: "",
      editorArgs: ["{file}"],
      diffArgs: ["{left}", "{right}"],
      enabledForEditor: true,
      enabledForDiff: false,
    },
  ];

  return {
    diagnostics,
    diagnosticsLoading: false,
    diagnosticsError: null,
    liveStatus: createLiveStatusFixture({
      enabled: true,
      updatedAt: "2026-03-16T10:05:04.000Z",
      providerCounts: {
        claude: 1,
        codex: 1,
        gemini: 0,
        cursor: 0,
        copilot: 0,
        copilot_cli: 0,
        opencode: 0,
      },
      sessions: [
        {
          provider: "claude",
          sessionIdentity: "claude-session",
          sourceSessionId: "claude-session",
          filePath: "/workspace/.claude/projects/project-a/claude-session.jsonl",
          projectName: "project-a",
          projectPath: "/workspace/project-a",
          cwd: "/workspace/project-a",
          statusKind: "waiting_for_approval" as const,
          statusText: "Waiting for approval",
          detailText: "Read ~/.claude/settings.json",
          sourcePrecision: "hook" as const,
          lastActivityAt: "2026-03-16T10:05:02.000Z",
          bestEffort: false,
        },
      ],
      claudeHookState: createClaudeHookStateFixture({
        installed: true,
        managedEventNames: [
          "SessionStart",
          "UserPromptSubmit",
          "PreToolUse",
          "PostToolUse",
          "Notification",
          "Stop",
          "SessionEnd",
        ],
        missingEventNames: [],
      }),
    }),
    liveStatusError: null,
    liveWatchEnabled: true,
    liveWatchRowHasBackground: true,
    onLiveWatchEnabledChange: vi.fn(),
    onLiveWatchRowHasBackgroundChange: vi.fn(),
    claudeHookState: createClaudeHookStateFixture({
      installed: true,
      managedEventNames: [
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "Notification",
        "Stop",
        "SessionEnd",
      ],
      missingEventNames: [],
    }),
    claudeHookActionPending: null,
    onInstallClaudeHooks: vi.fn(),
    onRemoveClaudeHooks: vi.fn(),
    appearance: {
      theme: "dark" as const,
      shikiTheme: "github-dark-default" as ShikiThemeId,
      zoomPercent: 100,
      messagePageSize: 50 as MessagePageSize,
      monoFontFamily: "droid_sans_mono" as const,
      regularFontFamily: "current" as const,
      monoFontSize: "12px" as const,
      regularFontSize: "13.5px" as const,
      useMonospaceForAllMessages: false,
      autoHideMessageActions: true,
      expandPreviewOnHiddenActions: true,
      autoHideViewerHeaderActions: false,
      defaultViewerWrapMode: "nowrap" as ViewerWrapMode,
      defaultDiffViewMode: "unified" as DiffViewMode,
      collapseMultiFileToolDiffs: false,
      preferredExternalEditor: createKnownToolId("vscode") as ExternalEditorId,
      preferredExternalDiffTool: createKnownToolId("vscode") as ExternalEditorId,
      terminalAppCommand: "",
      externalTools,
      availableEditors: [
        {
          id: createKnownToolId("vscode"),
          kind: "known" as const,
          label: "VS Code",
          appId: "vscode" as const,
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
        {
          id: createKnownToolId("cursor"),
          kind: "known" as const,
          label: "Cursor",
          appId: "cursor" as const,
          detected: true,
          command: "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
          args: [],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: true,
          },
        },
        {
          id: "custom:1" as const,
          kind: "custom" as const,
          label: "Custom Editor",
          appId: null,
          detected: false,
          command: null,
          args: ["{file}"],
          capabilities: {
            openFile: true,
            openAtLineColumn: true,
            openContent: true,
            openDiff: false,
          },
        },
      ],
      availableDiffTools: [
        {
          id: createKnownToolId("vscode"),
          kind: "known" as const,
          label: "VS Code",
          appId: "vscode" as const,
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
      onThemeChange: vi.fn(),
      onShikiThemeChange: vi.fn(),
      onZoomPercentChange: vi.fn(),
      onMessagePageSizeChange: vi.fn(),
      onMonoFontFamilyChange: vi.fn(),
      onRegularFontFamilyChange: vi.fn(),
      onMonoFontSizeChange: vi.fn(),
      onRegularFontSizeChange: vi.fn(),
      onUseMonospaceForAllMessagesChange: vi.fn(),
      onAutoHideMessageActionsChange: vi.fn(),
      onExpandPreviewOnHiddenActionsChange: vi.fn(),
      onAutoHideViewerHeaderActionsChange: vi.fn(),
      onDefaultViewerWrapModeChange: vi.fn(),
      onDefaultDiffViewModeChange: vi.fn(),
      onCollapseMultiFileToolDiffsChange: vi.fn(),
      onPreferredExternalEditorChange: vi.fn(),
      onPreferredExternalDiffToolChange: vi.fn(),
      onTerminalAppCommandChange: vi.fn(),
      onExternalToolsChange: vi.fn(),
      onRescanExternalTools: vi.fn(),
    },
    indexing: {
      enabledProviders: [
        "claude",
        "codex",
        "gemini",
        "cursor",
        "copilot",
        "opencode",
      ] as Provider[],
      removeMissingSessionsDuringIncrementalIndexing: false,
      canForceReindex: true,
      onToggleProviderEnabled: vi.fn(),
      onForceReindex: vi.fn(),
      onRemoveMissingSessionsDuringIncrementalIndexingChange: vi.fn(),
    },
    messageRules: {
      systemMessageRegexRules: {
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
        cursor: [],
        copilot: [],
        copilot_cli: [],
        opencode: [],
      },
      onAddSystemMessageRegexRule: vi.fn(),
      onUpdateSystemMessageRegexRule: vi.fn(),
      onRemoveSystemMessageRegexRule: vi.fn(),
    },
    onActionError: vi.fn(),
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

    const sectionHeadings = screen
      .getAllByRole("heading", { level: 3 })
      .map((node) => node.textContent?.trim());
    expect(sectionHeadings).not.toContain("Default Expansion");
    expect(sectionHeadings.indexOf("Providers")).toBeLessThan(
      sectionHeadings.indexOf("Live Watch"),
    );
    expect(sectionHeadings.indexOf("Live Watch")).toBeLessThan(
      sectionHeadings.indexOf("External Tools"),
    );
    expect(sectionHeadings.indexOf("External Tools")).toBeLessThan(
      sectionHeadings.indexOf("Database Maintenance"),
    );
    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("Discovery Roots")).toBeInTheDocument();
    expect(screen.getByText("OpenCode data root")).toBeInTheDocument();
    expect(screen.getByText("System Message Rules")).toBeInTheDocument();

    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThanOrEqual(8);
    await user.selectOptions(screen.getByRole("combobox", { name: "Theme" }), "midnight");
    expect(screen.getByRole("option", { name: "Tokyo Night" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Light Plus" })).not.toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Text viewer theme" }),
      "tokyo-night",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Monospaced font" }), "current");
    await user.selectOptions(screen.getByRole("combobox", { name: "Monospaced size" }), "13px");
    await user.selectOptions(screen.getByRole("combobox", { name: "Regular font" }), "inter");
    await user.selectOptions(screen.getByRole("combobox", { name: "Regular size" }), "14px");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Preferred editor" }),
      "custom:1",
    );

    await user.click(
      screen.getByRole("checkbox", { name: "Use monospaced fonts for all messages" }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Default text viewer wrap" }),
      "wrap",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Default diff view" }), "split");
    await user.click(screen.getByRole("checkbox", { name: "Auto-hide message actions" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Auto-hide text viewer header actions" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Collapse multiple diffs by default in write cards and for all diffs in combined changes card",
      }),
    );

    const presetToolsList = screen.getByRole("list", { name: "Preset tools" });
    const cursorPresetRow = within(presetToolsList)
      .getByText("Cursor")
      .closest(".settings-tool-row") as HTMLElement;
    const vscodePresetRow = within(presetToolsList)
      .getByText("VS Code")
      .closest(".settings-tool-row") as HTMLElement;
    await user.click(within(cursorPresetRow).getByRole("button", { name: "Editor" }));
    await user.click(within(vscodePresetRow).getByRole("button", { name: "Diff" }));

    await user.click(screen.getByRole("button", { name: "Expand Custom Tool 1" }));
    const customRow = screen
      .getByRole("button", { name: "Collapse Custom Tool 1" })
      .closest(".settings-tool-row") as HTMLElement;
    fireEvent.change(screen.getByRole("textbox", { name: "Custom Tool 1 command" }), {
      target: { value: "my-editor" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Custom Tool 1 editor arguments" }), {
      target: { value: "{file} {line}" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Custom Tool 1 diff arguments" }), {
      target: { value: "{left} {right} {title}" },
    });
    await user.click(within(customRow).getByRole("button", { name: "Browse" }));
    await user.click(within(customRow).getByRole("button", { name: "Diff" }));
    await user.click(screen.getByRole("button", { name: "Add Custom Tool" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New custom tool name" }), {
      target: { value: "Helix" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "New custom tool command" }), {
      target: { value: "hx" },
    });
    await user.click(screen.getByRole("button", { name: "Add Tool" }));
    await user.click(screen.getByRole("button", { name: "Remove Custom Tool 1" }));
    await user.click(screen.getByRole("button", { name: "Rescan System" }));
    await user.click(screen.getByRole("checkbox", { name: "Claude" }));
    await user.click(screen.getByRole("checkbox", { name: "Enable live watch" }));
    await user.click(screen.getByRole("checkbox", { name: "Use live row background" }));
    await user.click(screen.getByRole("button", { name: "Force reindex" }));
    await user.click(
      screen.getByRole("checkbox", {
        name: "Remove indexed sessions when source files disappear during incremental refresh",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Add claude regex rule" }));
    fireEvent.change(screen.getByRole("textbox", { name: "claude regex rule 1" }), {
      target: { value: "^<command-name>$" },
    });
    await user.click(screen.getByRole("button", { name: "Remove claude regex rule 1" }));

    const copyButtons = screen.getAllByRole("button", { name: /Copy /i });
    const openButtons = screen.getAllByRole("button", { name: /Open /i });
    expect(copyButtons.length).toBeGreaterThan(0);
    expect(openButtons.length).toBeGreaterThan(0);
    await user.click(copyButtons[0] as HTMLElement);
    await user.click(openButtons[0] as HTMLElement);

    expect(baseProps.appearance.onThemeChange).toHaveBeenCalledWith("midnight");
    expect(baseProps.appearance.onShikiThemeChange).toHaveBeenCalledWith("tokyo-night");
    expect(baseProps.appearance.onMonoFontFamilyChange).toHaveBeenCalledWith("current");
    expect(baseProps.appearance.onMonoFontSizeChange).toHaveBeenCalledWith("13px");
    expect(baseProps.appearance.onRegularFontFamilyChange).toHaveBeenCalledWith("inter");
    expect(baseProps.appearance.onRegularFontSizeChange).toHaveBeenCalledWith("14px");
    expect(baseProps.appearance.onUseMonospaceForAllMessagesChange).toHaveBeenCalledWith(true);
    expect(baseProps.appearance.onDefaultViewerWrapModeChange).toHaveBeenCalledWith("wrap");
    expect(baseProps.appearance.onDefaultDiffViewModeChange).toHaveBeenCalledWith("split");
    expect(baseProps.appearance.onAutoHideMessageActionsChange).toHaveBeenCalledWith(false);
    expect(baseProps.appearance.onAutoHideViewerHeaderActionsChange).toHaveBeenCalledWith(true);
    expect(baseProps.appearance.onCollapseMultiFileToolDiffsChange).toHaveBeenCalledWith(true);
    expect(baseProps.appearance.onPreferredExternalEditorChange).toHaveBeenCalledWith("custom:1");
    expect(baseProps.appearance.onPreferredExternalDiffToolChange).toHaveBeenCalledWith("");
    const onExternalToolsChange = vi.mocked(baseProps.appearance.onExternalToolsChange);
    const externalToolCalls = onExternalToolsChange.mock.calls.map(
      ([tools]) => tools as ExternalToolConfig[],
    );
    expect(
      externalToolCalls.some((tools) =>
        tools.some(
          (tool) =>
            tool.id === createKnownToolId("cursor") &&
            tool.enabledForEditor &&
            !tool.enabledForDiff,
        ),
      ),
    ).toBe(true);
    expect(
      externalToolCalls.some((tools) =>
        tools.some((tool) => tool.id === createKnownToolId("vscode") && !tool.enabledForDiff),
      ),
    ).toBe(true);
    expect(
      externalToolCalls.some((tools) =>
        tools.some(
          (tool) => tool.id === "custom:1" && tool.command === "/System/Applications/TextEdit.app",
        ),
      ),
    ).toBe(true);
    expect(
      externalToolCalls.some((tools) =>
        tools.some(
          (tool) => tool.id === "custom:1" && tool.editorArgs.join(" ") === "{file} {line}",
        ),
      ),
    ).toBe(true);
    expect(
      externalToolCalls.some((tools) =>
        tools.some(
          (tool) => tool.id === "custom:1" && tool.diffArgs.join(" ") === "{left} {right} {title}",
        ),
      ),
    ).toBe(true);
    expect(
      externalToolCalls.some((tools) =>
        tools.some((tool) => tool.id === "custom:1" && tool.enabledForDiff),
      ),
    ).toBe(true);
    expect(
      externalToolCalls.some((tools) =>
        tools.some(
          (tool) => tool.kind === "custom" && tool.label === "Helix" && tool.command === "hx",
        ),
      ),
    ).toBe(true);
    expect(externalToolCalls.some((tools) => !tools.some((tool) => tool.id === "custom:1"))).toBe(
      true,
    );
    expect(vi.mocked(baseProps.appearance.onRescanExternalTools!)).toHaveBeenCalledTimes(1);
    expect(baseProps.indexing.onToggleProviderEnabled).toHaveBeenCalledWith("claude");
    expect(baseProps.onLiveWatchEnabledChange).toHaveBeenCalledWith(false);
    expect(baseProps.onLiveWatchRowHasBackgroundChange).toHaveBeenCalledWith(false);
    expect(baseProps.indexing.onForceReindex).toHaveBeenCalledTimes(1);
    expect(
      baseProps.indexing.onRemoveMissingSessionsDuringIncrementalIndexingChange,
    ).toHaveBeenCalledWith(true);
    expect(baseProps.messageRules.onAddSystemMessageRegexRule).toHaveBeenCalledWith("claude");
    expect(baseProps.messageRules.onUpdateSystemMessageRegexRule).toHaveBeenCalledWith(
      "claude",
      0,
      "^<command-name>$",
    );
    expect(baseProps.messageRules.onRemoveSystemMessageRegexRule).toHaveBeenCalledWith("claude", 0);
    expect(browseExternalToolCommand).toHaveBeenCalled();
    expect(copyTextToClipboard).toHaveBeenCalled();
    expect(openPath).toHaveBeenCalled();
  }, 10000);

  it("ignores invalid text viewer theme selections", () => {
    const baseProps = createBaseProps();

    render(<SettingsView info={info} loading={false} error={null} {...baseProps} />);

    const textViewerThemeSelect = screen.getByRole("combobox", { name: "Text viewer theme" });
    const validTheme = getShikiThemeGroupForUiTheme(baseProps.appearance.theme).options[0]?.value;
    expect(validTheme).toBeTruthy();

    fireEvent.change(textViewerThemeSelect, { target: { value: "__invalid_theme__" } });

    expect(baseProps.appearance.onShikiThemeChange).toHaveBeenCalledWith(
      baseProps.appearance.shikiTheme,
    );
  });

  it("keeps existing custom tools collapsed and expands newly added custom tools", async () => {
    const user = userEvent.setup();

    function Harness() {
      const initialProps = createBaseProps();
      const [appearanceState, setAppearanceState] = useState(initialProps.appearance);

      return (
        <SettingsView
          info={info}
          loading={false}
          error={null}
          diagnostics={initialProps.diagnostics}
          diagnosticsLoading={initialProps.diagnosticsLoading}
          diagnosticsError={initialProps.diagnosticsError}
          indexing={initialProps.indexing}
          messageRules={initialProps.messageRules}
          liveStatus={initialProps.liveStatus ?? null}
          liveStatusError={initialProps.liveStatusError ?? null}
          claudeHookState={initialProps.claudeHookState ?? null}
          claudeHookActionPending={initialProps.claudeHookActionPending ?? null}
          onInstallClaudeHooks={initialProps.onInstallClaudeHooks ?? (() => undefined)}
          onRemoveClaudeHooks={initialProps.onRemoveClaudeHooks ?? (() => undefined)}
          liveWatchEnabled={initialProps.liveWatchEnabled ?? false}
          liveWatchRowHasBackground={initialProps.liveWatchRowHasBackground ?? true}
          onLiveWatchEnabledChange={initialProps.onLiveWatchEnabledChange ?? (() => undefined)}
          onLiveWatchRowHasBackgroundChange={
            initialProps.onLiveWatchRowHasBackgroundChange ?? (() => undefined)
          }
          {...(initialProps.onActionError ? { onActionError: initialProps.onActionError } : {})}
          appearance={{
            ...appearanceState,
            onThemeChange: initialProps.appearance.onThemeChange,
            onShikiThemeChange: (theme) =>
              setAppearanceState((current) => ({ ...current, shikiTheme: theme })),
            onZoomPercentChange: initialProps.appearance.onZoomPercentChange,
            onMessagePageSizeChange: (pageSize) =>
              setAppearanceState((current) => ({ ...current, messagePageSize: pageSize })),
            onMonoFontFamilyChange: initialProps.appearance.onMonoFontFamilyChange,
            onRegularFontFamilyChange: initialProps.appearance.onRegularFontFamilyChange,
            onMonoFontSizeChange: initialProps.appearance.onMonoFontSizeChange,
            onRegularFontSizeChange: initialProps.appearance.onRegularFontSizeChange,
            onUseMonospaceForAllMessagesChange:
              initialProps.appearance.onUseMonospaceForAllMessagesChange,
            onAutoHideMessageActionsChange: (enabled) =>
              setAppearanceState((current) => ({ ...current, autoHideMessageActions: enabled })),
            onExpandPreviewOnHiddenActionsChange: (enabled) =>
              setAppearanceState((current) => ({
                ...current,
                expandPreviewOnHiddenActions: enabled,
              })),
            onAutoHideViewerHeaderActionsChange: (enabled) =>
              setAppearanceState((current) => ({
                ...current,
                autoHideViewerHeaderActions: enabled,
              })),
            onDefaultViewerWrapModeChange: (mode) =>
              setAppearanceState((current) => ({ ...current, defaultViewerWrapMode: mode })),
            onDefaultDiffViewModeChange: (mode) =>
              setAppearanceState((current) => ({ ...current, defaultDiffViewMode: mode })),
            onCollapseMultiFileToolDiffsChange: (enabled) =>
              setAppearanceState((current) => ({
                ...current,
                collapseMultiFileToolDiffs: enabled,
              })),
            onPreferredExternalEditorChange: (editor) =>
              setAppearanceState((current) => ({ ...current, preferredExternalEditor: editor })),
            onPreferredExternalDiffToolChange: (editor) =>
              setAppearanceState((current) => ({ ...current, preferredExternalDiffTool: editor })),
            onTerminalAppCommandChange: (value) =>
              setAppearanceState((current) => ({ ...current, terminalAppCommand: value })),
            onExternalToolsChange: (tools) =>
              setAppearanceState((current) => ({ ...current, externalTools: tools })),
            ...(initialProps.appearance.onRescanExternalTools
              ? { onRescanExternalTools: initialProps.appearance.onRescanExternalTools }
              : {}),
          }}
        />
      );
    }

    render(<Harness />);

    expect(
      screen.queryByRole("textbox", { name: "Custom Tool 1 command" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand Custom Tool 1" }));
    expect(screen.getByRole("textbox", { name: "Custom Tool 1 command" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Custom Tool" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New custom tool name" }), {
      target: { value: "Helix" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "New custom tool command" }), {
      target: { value: "hx" },
    });
    await user.click(screen.getByRole("button", { name: "Add Tool" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Collapse Helix" })).toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Helix command" })).toHaveValue("hx");

    const helixRow = screen
      .getByRole("button", { name: "Collapse Helix" })
      .closest(".settings-tool-row") as HTMLElement;
    await user.click(within(helixRow).getByRole("button", { name: "Editor" }));
    expect(helixRow.className).toContain("disabled");

    await user.click(within(helixRow).getByRole("button", { name: "Remove Helix" }));
    expect(screen.queryByText("Helix")).not.toBeInTheDocument();
  });

  it("persists external tool ordering changes", async () => {
    const user = userEvent.setup();
    const baseProps = createBaseProps();

    render(<SettingsView {...baseProps} info={info} loading={false} error={null} />);

    await user.click(screen.getByRole("button", { name: "Move Zed up" }));

    const toolCalls = vi.mocked(baseProps.appearance.onExternalToolsChange).mock.calls;
    expect(toolCalls.length).toBeGreaterThan(0);
    const reorderedTools = toolCalls.at(-1)?.[0] as ExternalToolConfig[];
    expect(reorderedTools.map((tool) => tool.id)).toEqual([
      createKnownToolId("text_edit"),
      createKnownToolId("sublime_text"),
      createKnownToolId("zed"),
      createKnownToolId("vscode"),
      createKnownToolId("neovim"),
      createKnownToolId("cursor"),
      "custom:1",
    ]);
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

  it("forwards Claude hook install and remove actions", async () => {
    const user = userEvent.setup();
    const baseProps = createBaseProps();

    render(<SettingsView info={info} loading={false} error={null} {...baseProps} />);

    expect(screen.getByText("Live Watch")).toBeInTheDocument();
    expect(screen.getByText("Claude hooks installed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Live tracking only runs while Auto-refresh is using a watch strategy. Manual and scan refresh modes do not produce live session updates.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Install / Update" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(baseProps.onInstallClaudeHooks).toHaveBeenCalledTimes(1);
    expect(baseProps.onRemoveClaudeHooks).toHaveBeenCalledTimes(1);
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
