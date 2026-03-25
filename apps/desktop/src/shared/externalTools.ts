import { KNOWN_EXTERNAL_APP_VALUES, type KnownExternalAppId } from "@codetrail/core/browser";

import { type DesktopPlatform, isMacPlatform, isWindowsPlatform } from "./desktopPlatform";

export { KNOWN_EXTERNAL_APP_VALUES };
export type { KnownExternalAppId };
export type ExternalToolId = string;
export type ExternalEditorId = ExternalToolId;
export type ExternalToolRole = "editor" | "diff";

export type ExternalToolConfig = {
  id: ExternalToolId;
  kind: "known" | "custom";
  label: string;
  appId: KnownExternalAppId | null;
  command: string;
  editorArgs: string[];
  diffArgs: string[];
  enabledForEditor: boolean;
  enabledForDiff: boolean;
};

export type CustomExternalToolConfig = {
  id: string;
  label: string;
  command: string;
  editorArgs: string[];
  diffArgs: string[];
  enabledForEditor: boolean;
  enabledForDiff: boolean;
};

export type ExternalRoleToolConfig = {
  id: ExternalToolId;
  kind: "known" | "custom";
  label: string;
  appId: KnownExternalAppId | null;
  command: string;
  args: string[];
};

export const EXTERNAL_APP_OPTIONS = [
  { value: "text_edit", label: "Text Edit" },
  { value: "sublime_text", label: "Sublime Text" },
  { value: "vscode", label: "VS Code" },
  { value: "zed", label: "Zed" },
  { value: "neovim", label: "Neovim" },
  { value: "cursor", label: "Cursor" },
] as const satisfies ReadonlyArray<{
  value: KnownExternalAppId;
  label: string;
}>;

const KNOWN_TOOL_PREFIX = "tool:";
const CUSTOM_TOOL_PREFIX = "custom:";

export function isKnownExternalAppSupported(
  platform: DesktopPlatform,
  appId: KnownExternalAppId,
): boolean {
  if (isMacPlatform(platform)) {
    return true;
  }
  if (isWindowsPlatform(platform)) {
    return appId !== "text_edit" && appId !== "neovim";
  }
  return appId !== "text_edit";
}

export function getExternalAppOptions(platform: DesktopPlatform) {
  return EXTERNAL_APP_OPTIONS.filter((option) =>
    isKnownExternalAppSupported(platform, option.value),
  );
}

export function getExternalAppLabel(appId: KnownExternalAppId): string {
  return EXTERNAL_APP_OPTIONS.find((option) => option.value === appId)?.label ?? appId;
}

export function supportsKnownToolRole(appId: KnownExternalAppId, role: ExternalToolRole): boolean {
  return role === "editor" || (appId !== "sublime_text" && appId !== "text_edit");
}

export function isExternalToolEnabled(tool: ExternalToolConfig, role: ExternalToolRole): boolean {
  return role === "editor" ? tool.enabledForEditor : tool.enabledForDiff;
}

export function createKnownToolId(appId: KnownExternalAppId): ExternalToolId {
  return `${KNOWN_TOOL_PREFIX}${appId}`;
}

function createCustomToolId(): ExternalToolId {
  return `${CUSTOM_TOOL_PREFIX}${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
}

export function createKnownExternalTool(appId: KnownExternalAppId): ExternalToolConfig;
export function createKnownExternalTool(
  role: ExternalToolRole,
  appId: KnownExternalAppId,
): ExternalToolConfig;
export function createKnownExternalTool(
  appIdOrRole: KnownExternalAppId | ExternalToolRole,
  maybeAppId?: KnownExternalAppId,
): ExternalToolConfig {
  const appId = maybeAppId ?? (appIdOrRole as KnownExternalAppId);
  return {
    id: createKnownToolId(appId),
    kind: "known",
    label: getExternalAppLabel(appId),
    appId,
    command: "",
    editorArgs: [],
    diffArgs: [],
    enabledForEditor: true,
    enabledForDiff: supportsKnownToolRole(appId, "diff"),
  };
}

export function createCustomExternalTool(index?: number): ExternalToolConfig;
export function createCustomExternalTool(
  role: ExternalToolRole,
  index?: number,
): ExternalToolConfig;
export function createCustomExternalTool(
  roleOrIndex: ExternalToolRole | number = 1,
  maybeIndex?: number,
): ExternalToolConfig {
  const index = typeof roleOrIndex === "number" ? roleOrIndex : (maybeIndex ?? 1);
  return {
    id: createCustomToolId(),
    kind: "custom",
    label: `Custom Tool ${index}`,
    appId: null,
    command: "",
    editorArgs: ["{file}"],
    diffArgs: ["{left}", "{right}"],
    enabledForEditor: true,
    enabledForDiff: false,
  };
}

export function createCustomExternalToolCatalog(index = 1): CustomExternalToolConfig {
  return {
    id: createCustomToolId(),
    label: `Custom Tool ${index}`,
    command: "",
    editorArgs: ["{file}"],
    diffArgs: ["{left}", "{right}"],
    enabledForEditor: true,
    enabledForDiff: false,
  };
}

export function createRoleToolIdFromCustomTool(
  _role: ExternalToolRole,
  customToolId: string,
): ExternalToolId {
  return customToolId;
}

export function buildRoleToolFromCustomTool(
  _role: ExternalToolRole,
  tool: CustomExternalToolConfig,
): ExternalToolConfig {
  return {
    id: tool.id,
    kind: "custom",
    label: tool.label,
    appId: null,
    command: tool.command,
    editorArgs: tool.editorArgs,
    diffArgs: tool.diffArgs,
    enabledForEditor: tool.enabledForEditor,
    enabledForDiff: tool.enabledForDiff,
  };
}

export function createDefaultExternalTools(
  platform: DesktopPlatform = "darwin",
): ExternalToolConfig[] {
  return getExternalAppOptions(platform).map((option) => createKnownExternalTool(option.value));
}

export function normalizeExternalTools(
  tools: ExternalToolConfig[] | null | undefined,
  platform: DesktopPlatform = "darwin",
): ExternalToolConfig[] {
  const defaultKnownTools = new Map(
    createDefaultExternalTools(platform).map(
      (tool) => [tool.id, tool] satisfies [string, ExternalToolConfig],
    ),
  );
  const normalizedKnownTools = new Map(defaultKnownTools);
  const normalizedCustomTools: ExternalToolConfig[] = [];
  const orderedKnownToolIds: string[] = [];
  const seenIds = new Set<string>();

  for (const tool of tools ?? []) {
    if (tool.kind === "known" && tool.appId) {
      if (!isKnownExternalAppSupported(platform, tool.appId)) {
        continue;
      }
      const knownId = createKnownToolId(tool.appId);
      if (seenIds.has(knownId)) {
        continue;
      }
      seenIds.add(knownId);
      orderedKnownToolIds.push(knownId);
      normalizedKnownTools.set(knownId, {
        ...createKnownExternalTool(tool.appId),
        ...tool,
        id: knownId,
        kind: "known",
        label: getExternalAppLabel(tool.appId),
        appId: tool.appId,
        enabledForDiff: supportsKnownToolRole(tool.appId, "diff") && Boolean(tool.enabledForDiff),
      });
      continue;
    }
    if (tool.kind !== "custom" || seenIds.has(tool.id)) {
      continue;
    }
    seenIds.add(tool.id);
    normalizedCustomTools.push({
      ...tool,
      kind: "custom",
      appId: null,
      editorArgs: tool.editorArgs.length > 0 ? tool.editorArgs : ["{file}"],
      diffArgs: tool.diffArgs.length > 0 ? tool.diffArgs : ["{left}", "{right}"],
      enabledForEditor: Boolean(tool.enabledForEditor),
      enabledForDiff: Boolean(tool.enabledForDiff),
    });
  }

  return [
    ...orderedKnownToolIds
      .map((toolId) => normalizedKnownTools.get(toolId))
      .filter((tool): tool is ExternalToolConfig => tool !== undefined),
    ...getExternalAppOptions(platform)
      .map((option) => createKnownToolId(option.value))
      .filter((toolId) => !orderedKnownToolIds.includes(toolId))
      .map((toolId) => normalizedKnownTools.get(toolId) ?? defaultKnownTools.get(toolId))
      .filter((tool): tool is ExternalToolConfig => tool !== undefined),
    ...normalizedCustomTools,
  ];
}

export function buildRoleToolFromCatalog(
  tool: ExternalToolConfig,
  role: ExternalToolRole,
): ExternalRoleToolConfig | null {
  if (!isExternalToolEnabled(tool, role)) {
    return null;
  }
  if (tool.kind === "known" && tool.appId && !supportsKnownToolRole(tool.appId, role)) {
    return null;
  }
  return {
    id: tool.id,
    kind: tool.kind,
    label: tool.label,
    appId: tool.appId,
    command: tool.command,
    args: role === "editor" ? tool.editorArgs : tool.diffArgs,
  };
}

export function buildRoleToolsFromCatalog(
  role: ExternalToolRole,
  tools: ExternalToolConfig[] | null | undefined,
  platform: DesktopPlatform = "darwin",
): ExternalRoleToolConfig[] {
  return normalizeExternalTools(tools, platform)
    .map((tool) => buildRoleToolFromCatalog(tool, role))
    .filter((tool): tool is ExternalRoleToolConfig => tool !== null);
}

export function getEnabledExternalTools(
  role: ExternalToolRole,
  tools: ExternalToolConfig[] | null | undefined,
  platform: DesktopPlatform = "darwin",
): ExternalToolConfig[] {
  return normalizeExternalTools(tools, platform).filter((tool) =>
    role === "editor"
      ? tool.enabledForEditor
      : tool.enabledForDiff && (tool.appId === null || supportsKnownToolRole(tool.appId, role)),
  );
}

export function getExternalToolById(
  tools: ExternalToolConfig[] | null | undefined,
  id: string | null | undefined,
  platform: DesktopPlatform = "darwin",
): ExternalToolConfig | null {
  if (!id) {
    return null;
  }
  return normalizeExternalTools(tools, platform).find((tool) => tool.id === id) ?? null;
}

export function getPreferredExternalToolId(
  tools: ExternalToolConfig[] | null | undefined,
  preferredId: string | null | undefined,
  role: ExternalToolRole,
  platform: DesktopPlatform = "darwin",
): ExternalToolId {
  const enabledTools = getEnabledExternalTools(role, tools, platform);
  if (enabledTools.some((tool) => tool.id === preferredId)) {
    return preferredId ?? "";
  }
  return enabledTools[0]?.id ?? "";
}
