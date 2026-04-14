import type { IpcResponse } from "../contracts/ipc";
import { PROVIDER_LIST } from "../contracts/providerMetadata";

type SettingsInfo = IpcResponse<"app:getSettingsInfo">;
type SettingsInfoPathKey = SettingsInfo["discovery"]["providers"][number]["paths"][number]["key"];

const DEFAULT_STORAGE: SettingsInfo["storage"] = {
  settingsFile: "/tmp/ui-state.json",
  cacheDir: "/tmp/cache",
  databaseFile: "/tmp/codetrail.sqlite",
  bookmarksDatabaseFile: "/tmp/codetrail.bookmarks.sqlite",
  userDataDir: "/tmp",
};

function buildDefaultDiscoveryPaths(homeDir: string): Record<SettingsInfoPathKey, string> {
  return {
    claudeRoot: `${homeDir}/.claude/projects`,
    codexRoot: `${homeDir}/.codex/sessions`,
    geminiRoot: `${homeDir}/.gemini/tmp`,
    geminiHistoryRoot: `${homeDir}/.gemini/history`,
    geminiProjectsPath: `${homeDir}/.gemini/projects.json`,
    cursorRoot: `${homeDir}/.cursor/projects`,
    copilotRoot: `${homeDir}/Library/Application Support/Code/User/workspaceStorage`,
    copilotCliRoot: `${homeDir}/.copilot/session-state`,
  };
}

export function createSettingsInfoFixture(options?: {
  homeDir?: string;
  storage?: Partial<SettingsInfo["storage"]>;
  pathValues?: Partial<Record<SettingsInfoPathKey, string>>;
}): SettingsInfo {
  const homeDir = options?.homeDir ?? "/Users/test";
  const pathValues = {
    ...buildDefaultDiscoveryPaths(homeDir),
    ...options?.pathValues,
  };

  return {
    storage: {
      ...DEFAULT_STORAGE,
      ...options?.storage,
    },
    discovery: {
      providers: PROVIDER_LIST.map((provider) => ({
        provider: provider.id,
        label: provider.label,
        paths: provider.discoveryPaths.map((pathDef) => {
          const value = pathValues[pathDef.key];
          if (!value) {
            throw new Error(`Missing settings fixture value for ${pathDef.key}`);
          }
          return {
            key: pathDef.key,
            label: pathDef.label,
            value,
            watch: pathDef.watch,
          };
        }),
      })),
    },
  };
}
