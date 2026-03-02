import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

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
      theme: "dark",
      monoFontFamily: "droid_sans_mono",
      regularFontFamily: "inter",
      monoFontSize: "13px",
      regularFontSize: "14px",
      useMonospaceForAllMessages: true,
      selectedProjectId: "project_alpha",
      selectedSessionId: "session_beta",
      historyMode: "bookmarks",
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
      },
    });
    store.setWindowState({ width: 1440, height: 920, x: 48, y: 72, isMaximized: false });
    store.flush();

    const reloaded = new AppStateStore(filePath);
    expect(reloaded.getPaneState()).toEqual({
      projectPaneWidth: 312,
      sessionPaneWidth: 404,
      theme: "dark",
      monoFontFamily: "droid_sans_mono",
      regularFontFamily: "inter",
      monoFontSize: "13px",
      regularFontSize: "14px",
      useMonospaceForAllMessages: true,
      selectedProjectId: "project_alpha",
      selectedSessionId: "session_beta",
      historyMode: "bookmarks",
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
      },
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
    expect(persisted.pane).toEqual({ projectPaneWidth: 310, sessionPaneWidth: 370 });
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
    expect(reloaded.getPaneState()).toEqual({ projectPaneWidth: 300, sessionPaneWidth: 350 });
    expect(reloaded.getWindowState()).toEqual({
      width: 1400,
      height: 900,
      y: 50,
      isMaximized: true,
    });
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
