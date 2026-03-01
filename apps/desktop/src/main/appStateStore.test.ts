import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AppStateStore } from "./appStateStore";

describe("AppStateStore", () => {
  it("persists and restores pane/window state", () => {
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
      sessionPage: 3,
      sessionScrollTop: 672,
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
      sessionPage: 3,
      sessionScrollTop: 672,
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

  it("ignores invalid persisted payloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-app-state-invalid-"));
    const filePath = join(dir, "ui-state.json");
    const store = new AppStateStore(filePath);
    store.setPaneState({ projectPaneWidth: 300, sessionPaneWidth: 350 });
    store.flush();

    const malformed = new AppStateStore(filePath);
    malformed.setPaneState({ projectPaneWidth: Number.NaN, sessionPaneWidth: 420 } as never);
    malformed.setWindowState({
      width: 1200,
      height: 900,
      x: Number.POSITIVE_INFINITY,
      y: 50,
      isMaximized: true,
    } as never);
    malformed.flush();

    const restored = new AppStateStore(filePath);
    expect(restored.getPaneState()).toEqual({ projectPaneWidth: 300, sessionPaneWidth: 350 });
    expect(restored.getWindowState()).toEqual({
      width: 1200,
      height: 900,
      y: 50,
      isMaximized: true,
    });

    rmSync(dir, { recursive: true, force: true });
  });
});
