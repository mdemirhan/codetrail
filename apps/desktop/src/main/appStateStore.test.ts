import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createDefaultExternalTools, createKnownToolId } from "../shared/uiPreferences";
import { AppStateStore } from "./appStateStore";

function createMemoryFs(initialFiles: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initialFiles));

  return {
    files,
    existsSync: vi.fn((path: string) => files.has(path)),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn((path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return content;
    }),
    writeFileSync: vi.fn((path: string, content: string) => {
      files.set(path, content);
    }),
  };
}

function createFakeTimer() {
  let id = 0;
  const callbacks = new Map<number, () => void>();

  return {
    timer: {
      setTimeout: vi.fn((callback: () => void) => {
        id += 1;
        callbacks.set(id, callback);
        return id as unknown as ReturnType<typeof setTimeout>;
      }),
      clearTimeout: vi.fn((timerId: ReturnType<typeof setTimeout>) => {
        callbacks.delete(Number(timerId));
      }),
    },
    runAll: () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) {
        callback();
      }
    },
  };
}

describe("AppStateStore", () => {
  it("persists and restores pane/window state with real file storage", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-app-state-"));
    const filePath = join(dir, "ui-state.json");

    const store = new AppStateStore(filePath);
    store.setPaneState({
      projectPaneWidth: 312,
      sessionPaneWidth: 404,
      singleClickFoldersExpand: false,
      singleClickProjectsExpand: true,
      hideSessionsPaneInTreeView: true,
      liveWatchRowHasBackground: false,
      theme: "ft-dark",
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
      preferredExternalDiffTool: createKnownToolId("vscode"),
      terminalAppCommand: "/Applications/iTerm.app",
      externalTools: createDefaultExternalTools(),
      selectedProjectId: "project_alpha",
      selectedSessionId: "session_beta",
      historyMode: "bookmarks",
      projectViewMode: "tree",
      projectSortField: "name",
      currentAutoRefreshStrategy: "watch-3s",
      preferredAutoRefreshStrategy: "scan-30s",
      projectSortDirection: "desc",
      sessionSortDirection: "desc",
      messageSortDirection: "asc",
      bookmarkSortDirection: "asc",
      projectAllSortDirection: "desc",
      sessionPage: 3,
      sessionScrollTop: 672,
      systemMessageRegexRules: {
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
        cursor: [],
        copilot: [],
        copilot_cli: [],
      },
    });
    store.setIndexingState({
      enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
      removeMissingSessionsDuringIncrementalIndexing: true,
    });
    store.setWindowState({ width: 1440, height: 920, x: 48, y: 72, isMaximized: false });
    store.flush();

    const reloaded = new AppStateStore(filePath);
    expect(reloaded.getPaneState()).toEqual({
      projectPaneWidth: 312,
      sessionPaneWidth: 404,
      singleClickFoldersExpand: false,
      singleClickProjectsExpand: true,
      hideSessionsPaneInTreeView: true,
      liveWatchRowHasBackground: false,
      theme: "ft-dark",
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
      preferredExternalDiffTool: createKnownToolId("vscode"),
      terminalAppCommand: "/Applications/iTerm.app",
      externalTools: createDefaultExternalTools(),
      selectedProjectId: "project_alpha",
      selectedSessionId: "session_beta",
      historyMode: "bookmarks",
      projectViewMode: "tree",
      projectSortField: "name",
      currentAutoRefreshStrategy: "watch-3s",
      preferredAutoRefreshStrategy: "scan-30s",
      projectSortDirection: "desc",
      sessionSortDirection: "desc",
      messageSortDirection: "asc",
      bookmarkSortDirection: "asc",
      projectAllSortDirection: "desc",
      sessionPage: 3,
      sessionScrollTop: 672,
      systemMessageRegexRules: {
        claude: ["^<command-name>"],
        codex: ["^<environment_context>"],
        gemini: [],
        cursor: [],
        copilot: [],
        copilot_cli: [],
      },
    });
    expect(reloaded.getIndexingState()).toEqual({
      enabledProviders: ["claude", "codex", "gemini", "cursor", "copilot"],
      removeMissingSessionsDuringIncrementalIndexing: true,
    });
    expect(reloaded.getWindowState()).toEqual({
      width: 1440,
      height: 920,
      x: 48,
      y: 72,
      isMaximized: false,
    });

    const raw = readFileSync(filePath, "utf8");
    expect(raw).toContain('"pane"');
    expect(raw).toContain('"indexing"');
    expect(raw).toContain('"window"');

    rmSync(dir, { recursive: true, force: true });
  });

  it("debounces persistence and keeps the latest in-memory state", () => {
    const fs = createMemoryFs();
    const fakeTimer = createFakeTimer();
    const filePath = "/tmp/codetrail-ui-state.json";

    const store = new AppStateStore(filePath, {
      fs,
      timer: fakeTimer.timer,
    });

    store.setPaneState({ projectPaneWidth: 300, sessionPaneWidth: 360 });
    store.setPaneState({ projectPaneWidth: 310, sessionPaneWidth: 370 });

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fakeTimer.timer.setTimeout).toHaveBeenCalledTimes(2);

    fakeTimer.runAll();

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(fs.files.get(filePath) ?? "{}") as {
      pane?: { projectPaneWidth?: number; sessionPaneWidth?: number };
    };
    expect(persisted.pane).toEqual({
      projectPaneWidth: 310,
      sessionPaneWidth: 370,
      darkShikiTheme: "github-dark-default",
      lightShikiTheme: "github-light-default",
      messagePageSize: 50,
      defaultViewerWrapMode: "wrap",
      defaultDiffViewMode: "unified",
      collapseMultiFileToolDiffs: true,
      externalTools: createDefaultExternalTools(),
    });
  });

  it("keeps pane state in memory without writing until flush when updated runtime-only", () => {
    const fs = createMemoryFs();
    const fakeTimer = createFakeTimer();
    const filePath = "/tmp/codetrail-runtime-only-ui-state.json";

    const store = new AppStateStore(filePath, {
      fs,
      timer: fakeTimer.timer,
    });

    store.setPaneStateRuntimeOnly({ projectPaneWidth: 320, sessionPaneWidth: 390 });

    expect(store.getPaneState()).toEqual({
      projectPaneWidth: 320,
      sessionPaneWidth: 390,
      darkShikiTheme: "github-dark-default",
      lightShikiTheme: "github-light-default",
      messagePageSize: 50,
      defaultViewerWrapMode: "wrap",
      defaultDiffViewMode: "unified",
      collapseMultiFileToolDiffs: true,
      externalTools: createDefaultExternalTools(),
    });
    expect(fakeTimer.timer.setTimeout).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();

    fakeTimer.runAll();
    expect(fs.writeFileSync).not.toHaveBeenCalled();

    store.flush();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("merges runtime-only pane patches into existing pane state", () => {
    const fs = createMemoryFs();
    const filePath = "/tmp/codetrail-runtime-pane-patch.json";

    const store = new AppStateStore(filePath, { fs });
    store.setPaneState({ projectPaneWidth: 320, sessionPaneWidth: 390 });
    store.setPaneStateRuntimeOnly({ currentAutoRefreshStrategy: "watch-3s" } as never);
    store.flush();

    expect(store.getPaneState()).toEqual({
      projectPaneWidth: 320,
      sessionPaneWidth: 390,
      currentAutoRefreshStrategy: "watch-3s",
      darkShikiTheme: "github-dark-default",
      lightShikiTheme: "github-light-default",
      messagePageSize: 50,
      defaultViewerWrapMode: "wrap",
      defaultDiffViewMode: "unified",
      collapseMultiFileToolDiffs: true,
      externalTools: createDefaultExternalTools(),
    });
    expect(JSON.parse(fs.files.get(filePath) ?? "{}")).toEqual({
      pane: {
        projectPaneWidth: 320,
        sessionPaneWidth: 390,
        currentAutoRefreshStrategy: "watch-3s",
        darkShikiTheme: "github-dark-default",
        lightShikiTheme: "github-light-default",
        messagePageSize: 50,
        defaultViewerWrapMode: "wrap",
        defaultDiffViewMode: "unified",
        collapseMultiFileToolDiffs: true,
        externalTools: createDefaultExternalTools(),
      },
    });
  });

  it("falls back to empty state for malformed payloads", () => {
    const filePath = "/tmp/codetrail-malformed-ui-state.json";
    const fs = createMemoryFs({
      [filePath]: "not valid json",
    });

    const store = new AppStateStore(filePath, { fs });

    expect(store.getPaneState()).toBeNull();
    expect(store.getWindowState()).toBeNull();
  });

  it("does not infer indexing config from pane data when indexing is absent", () => {
    const filePath = "/tmp/codetrail-pane-only-state.json";
    const fs = createMemoryFs({
      [filePath]: JSON.stringify({
        pane: {
          projectPaneWidth: 300,
          sessionPaneWidth: 420,
          enabledProviders: ["claude", "codex"],
        },
      }),
    });

    const store = new AppStateStore(filePath, { fs });

    expect(store.getIndexingState()).toBeNull();
    expect(store.getPaneState()).toEqual(
      expect.objectContaining({
        projectPaneWidth: 300,
        sessionPaneWidth: 420,
      }),
    );
  });

  it("filters unknown provider and category values instead of dropping the whole array", () => {
    const filePath = "/tmp/codetrail-filter-ui-state.json";
    const fs = createMemoryFs({
      [filePath]: JSON.stringify({
        pane: {
          projectPaneWidth: 300,
          sessionPaneWidth: 360,
          projectProviders: ["claude", "future-provider", "claude", 42],
          historyCategories: ["assistant", "future-category", "assistant", null],
        },
        indexing: {
          enabledProviders: ["claude", "future-provider", "claude", 42],
        },
      }),
    });

    const store = new AppStateStore(filePath, { fs });

    expect(store.getPaneState()).toEqual({
      projectPaneWidth: 300,
      sessionPaneWidth: 360,
      darkShikiTheme: "github-dark-default",
      lightShikiTheme: "github-light-default",
      messagePageSize: 50,
      defaultViewerWrapMode: "wrap",
      defaultDiffViewMode: "unified",
      collapseMultiFileToolDiffs: true,
      projectProviders: ["claude"],
      historyCategories: ["assistant"],
      externalTools: createDefaultExternalTools(),
    });
    expect(store.getIndexingState()).toEqual({
      enabledProviders: ["claude"],
    });
  });

  it("drops disabled providers from saved project and search filters", () => {
    const filePath = "/tmp/codetrail-enabled-providers-ui-state.json";
    const fs = createMemoryFs({
      [filePath]: JSON.stringify({
        pane: {
          projectPaneWidth: 300,
          sessionPaneWidth: 360,
          projectProviders: ["claude", "codex"],
          searchProviders: ["codex", "cursor"],
        },
        indexing: {
          enabledProviders: ["claude", "cursor"],
        },
      }),
    });

    const store = new AppStateStore(filePath, { fs });

    expect(store.getPaneState()).toEqual({
      projectPaneWidth: 300,
      sessionPaneWidth: 360,
      darkShikiTheme: "github-dark-default",
      lightShikiTheme: "github-light-default",
      messagePageSize: 50,
      defaultViewerWrapMode: "wrap",
      defaultDiffViewMode: "unified",
      collapseMultiFileToolDiffs: true,
      projectProviders: ["claude", "cursor"],
      searchProviders: ["cursor", "claude"],
      externalTools: createDefaultExternalTools(),
    });
    expect(store.getIndexingState()).toEqual({
      enabledProviders: ["claude", "cursor"],
    });
  });

  it("sanitizes invalid fields and ignores invalid widths", () => {
    const filePath = "/tmp/codetrail-sanitize-ui-state.json";
    const fs = createMemoryFs();

    const store = new AppStateStore(filePath, { fs });
    store.setPaneState({ projectPaneWidth: 300, sessionPaneWidth: 350 });
    store.setPaneState({ projectPaneWidth: Number.NaN, sessionPaneWidth: 420 } as never);
    store.setWindowState({
      width: 1400,
      height: 900,
      x: Number.POSITIVE_INFINITY,
      y: 50,
      isMaximized: true,
    } as never);
    store.flush();

    const reloaded = new AppStateStore(filePath, { fs });
    expect(reloaded.getPaneState()).toEqual({
      projectPaneWidth: 300,
      sessionPaneWidth: 350,
      darkShikiTheme: "github-dark-default",
      lightShikiTheme: "github-light-default",
      messagePageSize: 50,
      defaultViewerWrapMode: "wrap",
      defaultDiffViewMode: "unified",
      collapseMultiFileToolDiffs: true,
      externalTools: createDefaultExternalTools(),
    });
    expect(reloaded.getWindowState()).toEqual({
      width: 1400,
      height: 900,
      y: 50,
      isMaximized: true,
    });
  });

  it("keeps invalid preferred external tool ids unresolved instead of silently rewriting them", () => {
    const filePath = "/tmp/codetrail-preferred-tool-ui-state.json";
    const fs = createMemoryFs({
      [filePath]: JSON.stringify({
        pane: {
          projectPaneWidth: 300,
          sessionPaneWidth: 360,
          preferredExternalEditor: "editor:missing",
          preferredExternalDiffTool: "diff:missing",
          externalTools: createDefaultExternalTools(),
        },
      }),
    });

    const store = new AppStateStore(filePath, { fs });

    expect(store.getPaneState()).toEqual({
      projectPaneWidth: 300,
      sessionPaneWidth: 360,
      darkShikiTheme: "github-dark-default",
      lightShikiTheme: "github-light-default",
      messagePageSize: 50,
      defaultViewerWrapMode: "wrap",
      defaultDiffViewMode: "unified",
      collapseMultiFileToolDiffs: true,
      externalTools: createDefaultExternalTools(),
    });
    expect(store.getPaneState()?.preferredExternalEditor ?? null).toBeNull();
    expect(store.getPaneState()?.preferredExternalDiffTool ?? null).toBeNull();
  });

  it("reports write errors through onPersistError", () => {
    const filePath = "/tmp/codetrail-write-failure.json";
    const onPersistError = vi.fn();
    const fs = {
      ...createMemoryFs(),
      writeFileSync: vi.fn(() => {
        throw new Error("disk full");
      }),
    };

    const store = new AppStateStore(filePath, {
      fs,
      onPersistError,
    });
    store.setPaneState({ projectPaneWidth: 320, sessionPaneWidth: 380 });
    store.flush();

    expect(onPersistError).toHaveBeenCalledTimes(1);
    expect(String(onPersistError.mock.calls[0]?.[0])).toContain("disk full");
  });
});
