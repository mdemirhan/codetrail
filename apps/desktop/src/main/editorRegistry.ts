import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { IpcResponse } from "@codetrail/core";

import {
  buildRoleToolsFromCatalog,
  createDefaultExternalTools,
  getPreferredExternalToolId,
} from "../shared/uiPreferences";
import type { PaneState } from "./appStateStore";
import type {
  EditorDependencies,
  EditorId,
  EditorInfo,
  EditorOpenRequest,
  EditorOpenResponse,
  ResolvedEditorDependencies,
  ToolRole,
} from "./editorDefinitions";
import { resolveConfiguredToolInfo } from "./editorDetection";
import { buildLaunchCommand } from "./editorLaunch";
import { createEditorPlatformConfig } from "./editorPlatform";
import { getCurrentMainPlatformConfig } from "./platformConfig";

const execFileAsync = promisify(execFile);
const DETECTION_CACHE_TTL_MS = 30_000;
const availableEditorsCache = new Map<
  string,
  { expiresAt: number; value: Promise<IpcResponse<"editor:listAvailable">> }
>();

function resolveDependencies(dependencies: EditorDependencies = {}): ResolvedEditorDependencies {
  return {
    execFile: (dependencies.execFile as ResolvedEditorDependencies["execFile"]) ?? execFileAsync,
    access: dependencies.access ?? access,
    spawn: dependencies.spawn ?? spawn,
    mkdtemp: dependencies.mkdtemp ?? mkdtemp,
    mkdir: dependencies.mkdir ?? mkdir,
    writeFile: dependencies.writeFile ?? writeFile,
    readdir: dependencies.readdir ?? readdir,
    stat: dependencies.stat ?? stat,
    rm: dependencies.rm ?? rm,
    readFile: dependencies.readFile ?? readFile,
  };
}

export async function listAvailableEditors(
  paneState: Partial<PaneState> | null | undefined,
  dependencies: EditorDependencies = {},
): Promise<IpcResponse<"editor:listAvailable">> {
  const resolvedDependencies = resolveDependencies(dependencies);
  const cacheKey =
    Object.keys(dependencies).length === 0 ? JSON.stringify(paneState ?? null) : null;
  if (cacheKey) {
    const cached = availableEditorsCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const value = listAvailableEditorsUncached(paneState, resolvedDependencies);
    availableEditorsCache.set(cacheKey, {
      expiresAt: now + DETECTION_CACHE_TTL_MS,
      value,
    });
    return value;
  }
  return listAvailableEditorsUncached(paneState, resolvedDependencies);
}

async function listAvailableEditorsUncached(
  paneState: Partial<PaneState> | null | undefined,
  resolvedDependencies: ResolvedEditorDependencies,
): Promise<IpcResponse<"editor:listAvailable">> {
  const platform = getCurrentMainPlatformConfig().platform;
  const editorTools = getConfiguredTools("editor", paneState);
  const diffTools = getConfiguredTools("diff", paneState);
  return {
    editors: await Promise.all(
      editorTools.map((tool) =>
        resolveConfiguredToolInfo(tool, resolvedDependencies, "editor", platform),
      ),
    ),
    diffTools: await Promise.all(
      diffTools.map((tool) =>
        resolveConfiguredToolInfo(tool, resolvedDependencies, "diff", platform),
      ),
    ),
  };
}

export async function openInEditor(
  request: EditorOpenRequest,
  paneState: Partial<PaneState> | null | undefined,
  dependencies: EditorDependencies = {},
): Promise<EditorOpenResponse> {
  const resolvedDependencies = resolveDependencies(dependencies);
  const availableEditors = await listAvailableEditors(paneState, dependencies);
  const role = resolveToolRole(request);
  const availableTools = role === "diff" ? availableEditors.diffTools : availableEditors.editors;
  const selectedEditor =
    resolveSelectedEditor(availableTools, request.editorId, role, paneState) ?? null;

  if (!selectedEditor) {
    return {
      ok: false,
      error:
        role === "diff"
          ? "No supported external diff tool is available."
          : "No supported external editor is available.",
    };
  }
  if (!selectedEditor.detected) {
    return { ok: false, error: `${selectedEditor.label} is not available on this machine.` };
  }
  if (!supportsRole(selectedEditor, role)) {
    return {
      ok: false,
      error:
        role === "diff"
          ? `${selectedEditor.label} is not configured as a diff tool.`
          : `${selectedEditor.label} is not configured as an editor.`,
    };
  }

  const launch = await buildLaunchCommand(request, selectedEditor, resolvedDependencies, paneState);
  if (!launch) {
    return {
      ok: false,
      error: `Unable to build a launch command for ${selectedEditor.label}.`,
    };
  }

  try {
    const platform = getCurrentMainPlatformConfig().platform;
    const child = resolvedDependencies.spawn(launch.command, launch.args, {
      detached: true,
      stdio: "ignore",
      shell: createEditorPlatformConfig(platform).spawnWithShell,
    });
    child.unref();
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed launching external application.",
    };
  }
}

function resolveToolRole(request: EditorOpenRequest): ToolRole {
  if (request.kind === "diff") {
    return "diff";
  }
  return request.toolRole ?? "editor";
}

function getConfiguredTools(role: ToolRole, paneState: Partial<PaneState> | null | undefined) {
  const platform = getCurrentMainPlatformConfig().platform;
  return buildRoleToolsFromCatalog(
    role,
    paneState?.externalTools ?? createDefaultExternalTools(platform),
    platform,
  );
}

function getPreferredId(
  role: ToolRole,
  paneState: Partial<PaneState> | null | undefined,
): EditorId {
  const platform = getCurrentMainPlatformConfig().platform;
  return role === "diff"
    ? getPreferredExternalToolId(
        paneState?.externalTools ?? createDefaultExternalTools(platform),
        paneState?.preferredExternalDiffTool ?? null,
        "diff",
        platform,
      )
    : getPreferredExternalToolId(
        paneState?.externalTools ?? createDefaultExternalTools(platform),
        paneState?.preferredExternalEditor ?? null,
        "editor",
        platform,
      );
}

function supportsRole(editor: EditorInfo, role: ToolRole): boolean {
  return role === "diff" ? editor.capabilities.openDiff : editor.capabilities.openFile;
}

function resolveSelectedEditor(
  editors: EditorInfo[],
  explicitEditor: EditorId | undefined,
  role: ToolRole,
  paneState: Partial<PaneState> | null | undefined,
): EditorInfo | undefined {
  if (explicitEditor) {
    return editors.find((editor) => editor.id === explicitEditor);
  }

  const preferredId = getPreferredId(role, paneState);
  const preferred = editors.find(
    (editor) => editor.id === preferredId && editor.detected && supportsRole(editor, role),
  );
  if (preferred) {
    return preferred;
  }

  return editors.find((editor) => editor.detected && supportsRole(editor, role));
}

export function resetAvailableEditorsCacheForTests(): void {
  availableEditorsCache.clear();
}
