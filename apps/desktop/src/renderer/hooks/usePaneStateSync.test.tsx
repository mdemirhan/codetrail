// @vitest-environment jsdom

import { useCallback, useRef, useState } from "react";

import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { IpcResponse, MessageCategory, Provider } from "@codetrail/core/browser";

import type {
  ExternalEditorId,
  ExternalToolConfig,
  MessagePageSize,
  MonoFontFamily,
  MonoFontSize,
  RegularFontFamily,
  RegularFontSize,
  ShikiThemeId,
  ThemeMode,
} from "../../shared/uiPreferences";
import {
  createCustomExternalTool,
  createDefaultExternalTools,
  createKnownExternalTool,
  createKnownToolId,
} from "../../shared/uiPreferences";
import type { NonOffRefreshStrategy } from "../app/autoRefresh";
import { createMockCodetrailClient } from "../test/mockCodetrailClient";
import { renderWithClient } from "../test/renderWithClient";
import { usePaneStateSync } from "./usePaneStateSync";

// Hydration settles across two async phases in this hook: the pane/indexer config requests
// schedule a requestAnimationFrame flip to "hydrated", and the hydrated effects then schedule the
// debounced `ui:setPaneState` / `indexer:setConfig` persistence timers. Flush both phases before
// asserting persisted state.
async function flushPaneStateTimers(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
}

function installAnimationFrameTimerMocks() {
  vi.useFakeTimers();
  const requestAnimationFrameSpy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
  const cancelAnimationFrameSpy = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((handle: number) => {
      window.clearTimeout(handle);
    });

  return {
    restore() {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
      vi.useRealTimers();
    },
  };
}

function Harness({ logError }: { logError: (context: string, error: unknown) => void }) {
  const [projectPaneWidth, setProjectPaneWidth] = useState(280);
  const [sessionPaneWidth, setSessionPaneWidth] = useState(300);
  const [enabledProviders, setEnabledProviders] = useState<Provider[]>(["claude", "codex"]);
  const [
    removeMissingSessionsDuringIncrementalIndexing,
    setRemoveMissingSessionsDuringIncrementalIndexing,
  ] = useState(false);
  const [projectPaneCollapsed, setProjectPaneCollapsed] = useState(false);
  const [sessionPaneCollapsed, setSessionPaneCollapsed] = useState(false);
  const [singleClickFoldersExpand, setSingleClickFoldersExpand] = useState(true);
  const [singleClickProjectsExpand, setSingleClickProjectsExpand] = useState(false);
  const [hideSessionsPaneInTreeView, setHideSessionsPaneInTreeView] = useState(false);
  const [projectProviders, setProjectProviders] = useState<Provider[]>(["claude"]);
  const [historyCategories, setHistoryCategories] = useState<MessageCategory[]>(["assistant"]);
  const [expandedByDefaultCategories, setExpandedByDefaultCategories] = useState<MessageCategory[]>(
    ["assistant"],
  );
  const [turnViewCategories, setTurnViewCategories] = useState<MessageCategory[]>(["assistant"]);
  const [turnViewExpandedByDefaultCategories, setTurnViewExpandedByDefaultCategories] = useState<
    MessageCategory[]
  >(["assistant"]);
  const [turnViewCombinedChangesExpanded, setTurnViewCombinedChangesExpanded] = useState(false);
  const [searchProviders, setSearchProviders] = useState<Provider[]>(["claude"]);
  const [liveWatchEnabled, setLiveWatchEnabled] = useState(true);
  const [liveWatchRowHasBackground, setLiveWatchRowHasBackground] = useState(true);
  const [claudeHooksPrompted, setClaudeHooksPrompted] = useState(false);
  const [preferredAutoRefreshStrategy, setPreferredAutoRefreshStrategy] =
    useState<NonOffRefreshStrategy>("watch-1s");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [darkShikiTheme, setDarkShikiTheme] = useState<ShikiThemeId>("github-dark-default");
  const [lightShikiTheme, setLightShikiTheme] = useState<ShikiThemeId>("github-light-default");
  const [monoFontFamily, setMonoFontFamily] = useState<MonoFontFamily>("droid_sans_mono");
  const [regularFontFamily, setRegularFontFamily] = useState<RegularFontFamily>("current");
  const [monoFontSize, setMonoFontSize] = useState<MonoFontSize>("12px");
  const [regularFontSize, setRegularFontSize] = useState<RegularFontSize>("13.5px");
  const [messagePageSize, setMessagePageSize] = useState<MessagePageSize>(50);
  const [useMonospaceForAllMessages, setUseMonospaceForAllMessages] = useState(false);
  const [autoHideMessageActions, setAutoHideMessageActions] = useState(true);
  const [expandPreviewOnHiddenActions, setExpandPreviewOnHiddenActions] = useState(true);
  const [autoHideViewerHeaderActions, setAutoHideViewerHeaderActions] = useState(false);
  const [defaultViewerWrapMode, setDefaultViewerWrapMode] = useState<"nowrap" | "wrap">("nowrap");
  const [defaultDiffViewMode, setDefaultDiffViewMode] = useState<"unified" | "split">("unified");
  const [collapseMultiFileToolDiffs, setCollapseMultiFileToolDiffs] = useState(true);
  const [preferredExternalEditor, setPreferredExternalEditor] = useState<ExternalEditorId>(
    createKnownToolId("vscode"),
  );
  const [preferredExternalDiffTool, setPreferredExternalDiffTool] = useState<ExternalEditorId>(
    createKnownToolId("vscode"),
  );
  const [terminalAppCommand, setTerminalAppCommand] = useState("");
  const [externalTools, setExternalTools] = useState<ExternalToolConfig[]>(
    createDefaultExternalTools(),
  );
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [historyMode, setHistoryMode] = useState<"session" | "bookmarks" | "project_all">(
    "session",
  );
  const [historyDetailMode, setHistoryDetailMode] = useState<"flat" | "turn">("flat");
  const historyVisualization =
    historyDetailMode === "turn" ? "turns" : historyMode === "bookmarks" ? "bookmarks" : "messages";
  const handleSetHistoryVisualization = useCallback(
    (
      value:
        | "messages"
        | "turns"
        | "bookmarks"
        | ((current: "messages" | "turns" | "bookmarks") => "messages" | "turns" | "bookmarks"),
    ) => {
      const next = typeof value === "function" ? value(historyVisualization) : value;
      setHistoryDetailMode(next === "turns" ? "turn" : "flat");
      setHistoryMode((current) => {
        if (next === "bookmarks") {
          return "bookmarks";
        }
        return current === "bookmarks" ? "project_all" : current;
      });
    },
    [historyVisualization],
  );
  const [projectViewMode, setProjectViewMode] = useState<"list" | "tree">("list");
  const [projectSortField, setProjectSortField] = useState<"last_active" | "name">("last_active");
  const [projectSortDirection, setProjectSortDirection] = useState<"asc" | "desc">("desc");
  const [sessionSortDirection, setSessionSortDirection] = useState<"asc" | "desc">("desc");
  const [messageSortDirection, setMessageSortDirection] = useState<"asc" | "desc">("asc");
  const [bookmarkSortDirection, setBookmarkSortDirection] = useState<"asc" | "desc">("asc");
  const [projectAllSortDirection, setProjectAllSortDirection] = useState<"asc" | "desc">("desc");
  const [turnViewSortDirection, setTurnViewSortDirection] = useState<"asc" | "desc">("desc");
  const [sessionPage, setSessionPage] = useState(0);
  const [sessionScrollTop, setSessionScrollTop] = useState(0);
  const [systemMessageRegexRules, setSystemMessageRegexRules] = useState<
    Record<Provider, string[]>
  >({
    claude: [],
    codex: [],
    gemini: [],
    cursor: [],
    copilot: [],
    copilot_cli: [],
    opencode: [],
  });
  const sessionScrollTopRef = useRef(0);
  const pendingRestoredSessionScrollRef = useRef<{
    sessionId: string;
    sessionPage: number;
    scrollTop: number;
  } | null>(null);

  const { paneStateHydrated } = usePaneStateSync({
    logError,
    paneState: {
      enabledProviders,
      removeMissingSessionsDuringIncrementalIndexing,
      projectPaneWidth,
      sessionPaneWidth,
      projectPaneCollapsed,
      sessionPaneCollapsed,
      singleClickFoldersExpand,
      singleClickProjectsExpand,
      hideSessionsPaneInTreeView,
      projectProviders,
      historyCategories,
      expandedByDefaultCategories,
      turnViewCategories,
      turnViewExpandedByDefaultCategories,
      turnViewCombinedChangesExpanded,
      searchProviders,
      liveWatchEnabled,
      liveWatchRowHasBackground,
      claudeHooksPrompted,
      preferredAutoRefreshStrategy,
      theme,
      darkShikiTheme,
      lightShikiTheme,
      monoFontFamily,
      regularFontFamily,
      monoFontSize,
      regularFontSize,
      messagePageSize,
      useMonospaceForAllMessages,
      autoHideMessageActions,
      expandPreviewOnHiddenActions,
      autoHideViewerHeaderActions,
      defaultViewerWrapMode,
      defaultDiffViewMode,
      collapseMultiFileToolDiffs,
      preferredExternalEditor,
      preferredExternalDiffTool,
      terminalAppCommand,
      externalTools,
      selectedProjectId,
      selectedSessionId,
      historyMode,
      historyVisualization,
      historyDetailMode,
      projectViewMode,
      projectSortField,
      projectSortDirection,
      sessionSortDirection,
      messageSortDirection,
      bookmarkSortDirection,
      projectAllSortDirection,
      turnViewSortDirection,
      sessionPage,
      sessionScrollTop,
      systemMessageRegexRules,
    },
    setEnabledProviders,
    setRemoveMissingSessionsDuringIncrementalIndexing,
    setProjectPaneWidth,
    setSessionPaneWidth,
    setProjectPaneCollapsed,
    setSessionPaneCollapsed,
    setSingleClickFoldersExpand,
    setSingleClickProjectsExpand,
    setHideSessionsPaneInTreeView,
    setProjectProviders,
    setHistoryCategories,
    setExpandedByDefaultCategories,
    setTurnViewCategories,
    setTurnViewExpandedByDefaultCategories,
    setTurnViewCombinedChangesExpanded,
    setSearchProviders,
    setLiveWatchEnabled,
    setLiveWatchRowHasBackground,
    setClaudeHooksPrompted,
    setPreferredAutoRefreshStrategy,
    setTheme,
    setDarkShikiTheme,
    setLightShikiTheme,
    setMonoFontFamily,
    setRegularFontFamily,
    setMonoFontSize,
    setRegularFontSize,
    setMessagePageSize,
    setUseMonospaceForAllMessages,
    setAutoHideMessageActions,
    setExpandPreviewOnHiddenActions,
    setAutoHideViewerHeaderActions,
    setDefaultViewerWrapMode,
    setDefaultDiffViewMode,
    setCollapseMultiFileToolDiffs,
    setPreferredExternalEditor,
    setPreferredExternalDiffTool,
    setTerminalAppCommand,
    setExternalTools,
    setSelectedProjectId,
    setSelectedSessionId,
    setHistoryMode,
    setHistoryVisualization: handleSetHistoryVisualization,
    setProjectViewMode,
    setProjectSortField,
    setProjectSortDirection,
    setSessionSortDirection,
    setMessageSortDirection,
    setBookmarkSortDirection,
    setProjectAllSortDirection,
    setTurnViewSortDirection,
    setSessionPage,
    setSessionScrollTop,
    setSystemMessageRegexRules,
    sessionScrollTopRef,
    pendingRestoredSessionScrollRef,
  });

  return (
    <div>
      <div data-testid="hydrated">{paneStateHydrated ? "yes" : "no"}</div>
      <div data-testid="project-width">{projectPaneWidth}</div>
      <div data-testid="history-mode">{historyMode}</div>
      <div data-testid="scroll">{sessionScrollTop}</div>
    </div>
  );
}

describe("usePaneStateSync", () => {
  it("hydrates state from pane/indexer IPC and persists updates through split channels", async () => {
    const client = createMockCodetrailClient();
    const animationFrameMocks = installAnimationFrameTimerMocks();
    const hydratedTools = [
      createKnownExternalTool("zed"),
      {
        ...createCustomExternalTool("editor", 1),
        id: "custom:test",
        label: "My Tool",
        command: "my-editor",
        editorArgs: ["{file}"],
        diffArgs: ["{left}", "{right}"],
        enabledForEditor: true,
        enabledForDiff: true,
      },
    ] satisfies ExternalToolConfig[];

    try {
      client.invoke.mockImplementation(async (channel) => {
        if (channel === "ui:getPaneState") {
          return {
            projectPaneWidth: 340,
            sessionPaneWidth: 410,
            projectPaneCollapsed: true,
            sessionPaneCollapsed: false,
            singleClickFoldersExpand: false,
            singleClickProjectsExpand: true,
            hideSessionsPaneInTreeView: true,
            projectProviders: ["claude", "codex"],
            historyCategories: ["assistant", "user"],
            expandedByDefaultCategories: ["assistant"],
            turnViewCategories: ["assistant", "user"],
            turnViewExpandedByDefaultCategories: ["assistant"],
            turnViewCombinedChangesExpanded: true,
            searchProviders: ["claude"],
            liveWatchEnabled: false,
            liveWatchRowHasBackground: false,
            claudeHooksPrompted: true,
            currentAutoRefreshStrategy: null,
            preferredAutoRefreshStrategy: "scan-10s",
            theme: "dark",
            darkShikiTheme: "vesper",
            lightShikiTheme: "github-light-default",
            monoFontFamily: "droid_sans_mono",
            regularFontFamily: "inter",
            monoFontSize: "13px",
            regularFontSize: "14px",
            messagePageSize: 25,
            useMonospaceForAllMessages: true,
            autoHideMessageActions: false,
            expandPreviewOnHiddenActions: true,
            autoHideViewerHeaderActions: true,
            defaultViewerWrapMode: "wrap",
            defaultDiffViewMode: "split",
            collapseMultiFileToolDiffs: false,
            preferredExternalEditor: createKnownToolId("zed"),
            preferredExternalDiffTool: createKnownToolId("cursor"),
            terminalAppCommand: "/Applications/iTerm.app",
            externalTools: hydratedTools,
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "bookmarks",
            historyVisualization: "turns",
            historyDetailMode: "turn",
            projectViewMode: "tree",
            projectSortField: "name",
            projectSortDirection: "desc",
            sessionSortDirection: "desc",
            messageSortDirection: "asc",
            bookmarkSortDirection: "asc",
            projectAllSortDirection: "desc",
            turnViewSortDirection: "desc",
            sessionPage: 2,
            sessionScrollTop: 222,
            systemMessageRegexRules: {
              claude: ["^<command-name>"],
              codex: ["^<environment_context>"],
              gemini: [],
              cursor: [],
              copilot: [],
              copilot_cli: [],
              opencode: [],
            },
          };
        }
        if (channel === "indexer:getConfig") {
          return {
            enabledProviders: ["claude", "cursor"],
            removeMissingSessionsDuringIncrementalIndexing: true,
          };
        }
        return { ok: true };
      });

      const logError = vi.fn();
      renderWithClient(<Harness logError={logError} />, client);

      await flushPaneStateTimers();

      expect(screen.getByTestId("hydrated").textContent).toBe("yes");

      expect(screen.getByTestId("project-width").textContent).toBe("340");
      expect(screen.getByTestId("history-mode").textContent).toBe("project_all");
      expect(screen.getByTestId("scroll").textContent).toBe("222");

      const paneSaveCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "ui:setPaneState",
      );
      expect(paneSaveCalls.length).toBeGreaterThan(0);
      const lastPaneSavePayload = paneSaveCalls.at(-1)?.[1];
      expect(lastPaneSavePayload).toMatchObject({
        projectViewMode: "tree",
        projectSortField: "name",
        singleClickFoldersExpand: false,
        singleClickProjectsExpand: true,
        hideSessionsPaneInTreeView: true,
        liveWatchRowHasBackground: false,
        preferredAutoRefreshStrategy: "scan-10s",
        darkShikiTheme: "vesper",
        lightShikiTheme: "github-light-default",
        messagePageSize: 25,
        preferredExternalEditor: createKnownToolId("zed"),
        preferredExternalDiffTool: createKnownToolId("cursor"),
        autoHideMessageActions: false,
        expandPreviewOnHiddenActions: true,
        autoHideViewerHeaderActions: true,
        defaultViewerWrapMode: "wrap",
        defaultDiffViewMode: "split",
        collapseMultiFileToolDiffs: false,
        terminalAppCommand: "/Applications/iTerm.app",
        externalTools: hydratedTools,
        systemMessageRegexRules: {
          claude: ["^<command-name>"],
          codex: ["^<environment_context>"],
          gemini: [],
          cursor: [],
          copilot: [],
          copilot_cli: [],
          opencode: [],
        },
      });
      const indexerSaveCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:setConfig",
      );
      expect(indexerSaveCalls.length).toBeGreaterThan(0);
      expect(indexerSaveCalls.at(-1)?.[1]).toMatchObject({
        enabledProviders: ["claude", "cursor"],
        removeMissingSessionsDuringIncrementalIndexing: true,
      });
      expect(logError).not.toHaveBeenCalled();
    } finally {
      animationFrameMocks.restore();
    }
  });

  it("logs errors when pane/indexer hydration fails", async () => {
    const animationFrameMocks = installAnimationFrameTimerMocks();
    const client = createMockCodetrailClient();
    try {
      client.invoke.mockImplementation(async (channel) => {
        if (channel === "ui:getPaneState") {
          throw new Error("load failed");
        }
        return { ok: true };
      });

      const logError = vi.fn();
      renderWithClient(<Harness logError={logError} />, client);

      await flushPaneStateTimers();

      expect(screen.getByTestId("hydrated").textContent).toBe("yes");
      expect(logError).toHaveBeenCalledWith("Failed loading UI state", expect.any(Error));
    } finally {
      animationFrameMocks.restore();
    }
  });

  it("merges partial system message rules with empty defaults during hydration", async () => {
    const client = createMockCodetrailClient();
    const animationFrameMocks = installAnimationFrameTimerMocks();

    try {
      client.invoke.mockImplementation(async (channel) => {
        if (channel === "ui:getPaneState") {
          return {
            projectPaneWidth: null,
            sessionPaneWidth: null,
            projectPaneCollapsed: null,
            sessionPaneCollapsed: null,
            singleClickFoldersExpand: null,
            singleClickProjectsExpand: null,
            hideSessionsPaneInTreeView: null,
            projectProviders: null,
            historyCategories: null,
            expandedByDefaultCategories: null,
            turnViewCategories: null,
            turnViewExpandedByDefaultCategories: null,
            turnViewCombinedChangesExpanded: null,
            searchProviders: null,
            liveWatchEnabled: null,
            liveWatchRowHasBackground: null,
            claudeHooksPrompted: null,
            currentAutoRefreshStrategy: null,
            preferredAutoRefreshStrategy: null,
            theme: null,
            darkShikiTheme: null,
            lightShikiTheme: null,
            monoFontFamily: null,
            regularFontFamily: null,
            monoFontSize: null,
            regularFontSize: null,
            useMonospaceForAllMessages: null,
            autoHideMessageActions: null,
            expandPreviewOnHiddenActions: null,
            autoHideViewerHeaderActions: null,
            defaultViewerWrapMode: null,
            defaultDiffViewMode: null,
            collapseMultiFileToolDiffs: null,
            preferredExternalEditor: null,
            preferredExternalDiffTool: null,
            terminalAppCommand: null,
            externalTools: null,
            selectedProjectId: null,
            selectedSessionId: null,
            historyMode: null,
            historyVisualization: null,
            historyDetailMode: null,
            projectViewMode: null,
            projectSortField: null,
            projectSortDirection: null,
            sessionSortDirection: null,
            messageSortDirection: null,
            bookmarkSortDirection: null,
            projectAllSortDirection: null,
            turnViewSortDirection: null,
            sessionPage: null,
            sessionScrollTop: null,
            systemMessageRegexRules: {
              claude: ["^<command-name>"],
            },
          } as IpcResponse<"ui:getPaneState">;
        }
        if (channel === "indexer:getConfig") {
          return {
            enabledProviders: null,
            removeMissingSessionsDuringIncrementalIndexing: null,
          } as IpcResponse<"indexer:getConfig">;
        }
        return { ok: true };
      });

      renderWithClient(<Harness logError={vi.fn()} />, client);

      await flushPaneStateTimers();

      expect(screen.getByTestId("hydrated").textContent).toBe("yes");

      const saveCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "ui:setPaneState",
      );
      const lastSavePayload = saveCalls.at(-1)?.[1];
      expect(lastSavePayload).toMatchObject({
        systemMessageRegexRules: {
          claude: ["^<command-name>"],
          codex: [],
          gemini: [],
          cursor: [],
          copilot: [],
          copilot_cli: [],
          opencode: [],
        },
      });
    } finally {
      animationFrameMocks.restore();
    }
  });
});
