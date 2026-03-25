import type { DesktopPlatform } from "../shared/desktopPlatform";
import type { ExternalRoleToolConfig, KnownExternalAppId } from "../shared/uiPreferences";
import {
  EDITOR_DEFINITIONS,
  type EditorDefinition,
  type EditorInfo,
  type ResolvedEditorDependencies,
  type ToolRole,
  defaultCapabilitiesForRole,
} from "./editorDefinitions";
import { isExplicitCommandPath, isMacAppBundleCommand } from "./editorMacos";
import { createEditorPlatformConfig } from "./editorPlatform";

function expandUserPath(value: string): string {
  return value.replace(/%USERNAME%/g, process.env.USERNAME ?? "");
}

export async function findCommandOnPath(
  command: string,
  runExecFile: ResolvedEditorDependencies["execFile"],
  platform: DesktopPlatform,
): Promise<string | null> {
  try {
    const result = await runExecFile(createEditorPlatformConfig(platform).pathLocatorCommand, [
      command,
    ]);
    const firstLine = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return firstLine ?? null;
  } catch {
    return null;
  }
}

export async function resolveKnownCommandPath(
  definition: EditorDefinition,
  dependencies: ResolvedEditorDependencies,
  platform: DesktopPlatform,
): Promise<string | null> {
  for (const command of definition.commands) {
    const located = await findCommandOnPath(command, dependencies.execFile, platform);
    if (located) {
      return located;
    }
  }

  const knownPaths = definition.knownPaths[platform] ?? [];
  for (const candidate of knownPaths) {
    const expanded = expandUserPath(candidate);
    try {
      await dependencies.access(expanded);
      return expanded;
    } catch {}
  }
  return null;
}

export async function resolveCustomCommandPath(
  command: string,
  dependencies: ResolvedEditorDependencies,
  platform: DesktopPlatform,
): Promise<string | null> {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (isMacAppBundleCommand(trimmed) || isExplicitCommandPath(trimmed)) {
    try {
      await dependencies.access(trimmed);
      return trimmed;
    } catch {
      return null;
    }
  }
  return findCommandOnPath(trimmed, dependencies.execFile, platform);
}

export async function resolveConfiguredToolInfo(
  tool: ExternalRoleToolConfig,
  dependencies: ResolvedEditorDependencies,
  role: ToolRole,
  platform: DesktopPlatform,
): Promise<EditorInfo> {
  if (tool.kind === "known" && tool.appId) {
    const definition = EDITOR_DEFINITIONS.find((candidate) => candidate.id === tool.appId) ?? null;
    const command = definition
      ? await resolveKnownCommandPath(definition, dependencies, platform)
      : null;
    return {
      id: tool.id,
      kind: tool.kind,
      label: tool.label,
      appId: tool.appId,
      detected: command !== null,
      command,
      args: tool.args,
      capabilities: definition?.capabilities ?? defaultCapabilitiesForRole(role),
    };
  }

  const command = tool.command.trim();
  const resolvedCommand = await resolveCustomCommandPath(command, dependencies, platform);
  return {
    id: tool.id,
    kind: tool.kind,
    label: tool.label,
    appId: null,
    detected: resolvedCommand !== null,
    command: resolvedCommand ?? (command.length > 0 ? command : null),
    args: tool.args,
    capabilities: defaultCapabilitiesForRole(role),
  };
}

export function getEditorDefinition(appId: KnownExternalAppId): EditorDefinition | null {
  return EDITOR_DEFINITIONS.find((candidate) => candidate.id === appId) ?? null;
}
