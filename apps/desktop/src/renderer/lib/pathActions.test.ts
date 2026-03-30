import { describe, expect, it } from "vitest";

import { createMockCodetrailClient } from "../test/mockCodetrailClient";
import {
  browseExternalToolCommand,
  openContentInEditor,
  openDiffInEditor,
  openFileInEditor,
  openInFileManager,
  openPath,
} from "./pathActions";

describe("pathActions", () => {
  it("returns a clear error when no selected project exists", async () => {
    const client = createMockCodetrailClient();

    const result = await openInFileManager([{ id: "p1", path: "/workspace/p1" }], "p2", client);

    expect(result).toEqual({ ok: false, error: "No selected project." });
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("opens selected project path through the codetrail client", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockResolvedValue({ ok: true, error: null });

    const result = await openInFileManager([{ id: "p1", path: "/workspace/p1" }], "p1", client);

    expect(result).toEqual({ ok: true, error: null });
    expect(client.invoke).toHaveBeenCalledWith("path:openInFileManager", { path: "/workspace/p1" });
  });

  it("returns a clear error when selected project has no location", async () => {
    const client = createMockCodetrailClient();

    const result = await openInFileManager([{ id: "p1", path: "   " }], "p1", client);

    expect(result).toEqual({ ok: false, error: "Selected project has no location." });
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("normalizes failed open responses with fallback text", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockResolvedValue({ ok: false, error: null });

    const result = await openPath("/workspace/missing", client);

    expect(result).toEqual({ ok: false, error: "Failed to open /workspace/missing" });
  });

  it("returns a clear error when openPath receives an empty path", async () => {
    const client = createMockCodetrailClient();

    const result = await openPath("   ", client);

    expect(result).toEqual({ ok: false, error: "Path is empty." });
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("opens files in the configured external editor", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockResolvedValue({ ok: true, error: null });

    const result = await openFileInEditor("/workspace/file.ts", { line: 9, column: 2 }, client);

    expect(result).toEqual({ ok: true, error: null });
    expect(client.invoke).toHaveBeenCalledWith("editor:open", {
      kind: "file",
      filePath: "/workspace/file.ts",
      line: 9,
      column: 2,
    });
  });

  it("opens materialized content in the configured external editor", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockResolvedValue({ ok: true, error: null });

    const result = await openContentInEditor(
      {
        title: "Command",
        language: "shell",
        content: "bun run typecheck",
        toolRole: "editor",
      },
      client,
    );

    expect(result).toEqual({ ok: true, error: null });
    expect(client.invoke).toHaveBeenCalledWith("editor:open", {
      kind: "content",
      title: "Command",
      content: "bun run typecheck",
      language: "shell",
      toolRole: "editor",
    });
  });

  it("opens diffs in the configured external editor", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockResolvedValue({ ok: true, error: null });

    const result = await openDiffInEditor(
      {
        filePath: "/workspace/file.ts",
        leftContent: "old",
        rightContent: "new",
      },
      client,
    );

    expect(result).toEqual({ ok: true, error: null });
    expect(client.invoke).toHaveBeenCalledWith("editor:open", {
      kind: "diff",
      toolRole: "diff",
      title: "Diff",
      filePath: "/workspace/file.ts",
      line: undefined,
      column: undefined,
      leftContent: "old",
      rightContent: "new",
    });
  });

  it("does not pass renderer-side launch configuration overrides when opening content", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockResolvedValue({ ok: true, error: null });

    await openContentInEditor(
      {
        title: "Command",
        language: "shell",
        content: "bun run typecheck",
        editorId: "custom:textedit",
      },
      client,
    );

    expect(client.invoke).toHaveBeenCalledWith("editor:open", {
      kind: "content",
      title: "Command",
      content: "bun run typecheck",
      language: "shell",
      editorId: "custom:textedit",
    });
  });

  it("opens the external tool command picker through the codetrail client", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockResolvedValue({
      canceled: false,
      path: "/System/Applications/TextEdit.app",
      error: null,
    });

    const result = await browseExternalToolCommand(client);

    expect(result).toEqual({
      canceled: false,
      path: "/System/Applications/TextEdit.app",
      error: null,
    });
    expect(client.invoke).toHaveBeenCalledWith("dialog:pickExternalToolCommand", {});
  });
});
