import type { IpcResponse } from "@codetrail/core/browser";

import type { ExternalToolConfig } from "../../shared/uiPreferences";

import { type CodetrailClient, getCodetrailClient } from "./codetrailClient";

type ExternalAppId = IpcResponse<"editor:listAvailable">["editors"][number]["id"];
type ExternalToolRole = "editor" | "diff";

type ProjectPathLike = {
  id: string;
  path: string;
};

export async function openInFileManager(
  projects: ProjectPathLike[],
  selectedProjectId: string,
  client: CodetrailClient = getCodetrailClient(),
): Promise<{ ok: boolean; error: string | null }> {
  const selected = projects.find((project) => project.id === selectedProjectId);
  if (!selected) {
    return { ok: false, error: "No selected project." };
  }
  if (selected.path.trim().length === 0) {
    return { ok: false, error: "Selected project has no location." };
  }
  return openPath(selected.path, client);
}

export async function openPath(
  path: string,
  client: CodetrailClient = getCodetrailClient(),
): Promise<{ ok: boolean; error: string | null }> {
  if (path.trim().length === 0) {
    return { ok: false, error: "Path is empty." };
  }
  const result = await client.invoke("path:openInFileManager", { path });
  return result.ok ? result : { ok: false, error: result.error ?? `Failed to open ${path}` };
}

export async function listAvailableEditors(
  options: {
    externalTools?: ExternalToolConfig[];
  } = {},
  client: CodetrailClient = getCodetrailClient(),
): Promise<IpcResponse<"editor:listAvailable">> {
  return client.invoke("editor:listAvailable", {
    ...(options.externalTools ? { externalTools: options.externalTools } : {}),
  });
}

export async function browseExternalToolCommand(
  client: CodetrailClient = getCodetrailClient(),
): Promise<IpcResponse<"dialog:pickExternalToolCommand">> {
  return client.invoke("dialog:pickExternalToolCommand", {});
}

export async function openFileInEditor(
  path: string,
  options: {
    editorId?: ExternalAppId;
    toolRole?: ExternalToolRole;
    line?: number;
    column?: number;
  } = {},
  client: CodetrailClient = getCodetrailClient(),
): Promise<{ ok: boolean; error: string | null }> {
  if (path.trim().length === 0) {
    return { ok: false, error: "Path is empty." };
  }
  const result = await client.invoke("editor:open", {
    kind: "file",
    filePath: path,
    ...options,
  });
  return result.ok ? result : { ok: false, error: result.error ?? `Failed to open ${path}` };
}

export async function openContentInEditor(
  options: {
    editorId?: ExternalAppId;
    toolRole?: ExternalToolRole;
    title?: string;
    filePath?: string;
    language?: string;
    line?: number;
    column?: number;
    content: string;
  },
  client: CodetrailClient = getCodetrailClient(),
): Promise<{ ok: boolean; error: string | null }> {
  const result = await client.invoke("editor:open", {
    kind: "content",
    title: options.title ?? "Untitled",
    content: options.content,
    ...(options.filePath ? { filePath: options.filePath } : {}),
    ...(options.language ? { language: options.language } : {}),
    ...(options.line ? { line: options.line } : {}),
    ...(options.column ? { column: options.column } : {}),
    ...(options.editorId ? { editorId: options.editorId } : {}),
    ...(options.toolRole ? { toolRole: options.toolRole } : {}),
  });
  return result.ok ? result : { ok: false, error: result.error ?? "Failed to open content" };
}

export async function openDiffInEditor(
  options: {
    editorId?: ExternalAppId;
    title?: string;
    filePath?: string;
    line?: number;
    column?: number;
    leftContent: string;
    rightContent: string;
  },
  client: CodetrailClient = getCodetrailClient(),
): Promise<{ ok: boolean; error: string | null }> {
  const result = await client.invoke("editor:open", {
    kind: "diff",
    toolRole: "diff",
    title: options.title ?? "Diff",
    filePath: options.filePath,
    line: options.line,
    column: options.column,
    leftContent: options.leftContent,
    rightContent: options.rightContent,
    ...(options.editorId ? { editorId: options.editorId } : {}),
  });
  return result.ok ? result : { ok: false, error: result.error ?? "Failed to open diff" };
}
