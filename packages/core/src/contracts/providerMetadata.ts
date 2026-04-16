import { PROVIDER_VALUES, type Provider } from "./canonical";

export type ProviderSourceFormat = "jsonl_stream" | "materialized_json";
export type ProviderTurnDiffStrategy =
  | "none"
  | "raw_tool_payload"
  | "raw_tool_payload_fallback"
  | "inline_reconstructed";
export type DiscoveryPlatform = "darwin" | "win32" | "linux";
export type DiscoveryPlatformEnvironment = {
  homeDir: string;
  appDataDir?: string | null;
  localAppDataDir?: string | null;
};

export type ProviderDiscoveryPathKey =
  | "claudeRoot"
  | "codexRoot"
  | "geminiRoot"
  | "geminiHistoryRoot"
  | "geminiProjectsPath"
  | "cursorRoot"
  | "copilotRoot"
  | "copilotCliRoot"
  | "opencodeRoot";

export type ProviderDiscoveryPathDefinition = {
  key: ProviderDiscoveryPathKey;
  label: string;
  watch: boolean;
  defaultPath: (platform: DiscoveryPlatform, environment: DiscoveryPlatformEnvironment) => string;
};

export type ProviderMetadata = {
  id: Provider;
  label: string;
  sourceFormat: ProviderSourceFormat;
  discoveryPaths: readonly ProviderDiscoveryPathDefinition[];
  defaultSystemMessageRegexRules: readonly string[];
  supportsTurnFamilyQuery?: boolean;
  turnDiffStrategy?: ProviderTurnDiffStrategy;
};

function joinPlatformPath(_platform: DiscoveryPlatform, ...segments: string[]): string {
  const separator = "/";
  return segments
    .filter((segment) => segment.length > 0)
    .map((segment, index) => {
      if (index === 0) {
        return segment.replace(/[\\/]+$/g, "");
      }
      return segment.replace(/^[\\/]+|[\\/]+$/g, "");
    })
    .join(separator);
}

export function getDefaultCopilotRoot(
  platform: DiscoveryPlatform,
  environment: DiscoveryPlatformEnvironment,
): string {
  const homeDir = environment.homeDir;
  if (platform === "darwin") {
    return joinPlatformPath(
      platform,
      homeDir,
      "Library",
      "Application Support",
      "Code",
      "User",
      "workspaceStorage",
    );
  }
  if (platform === "win32") {
    return joinPlatformPath(
      platform,
      environment.appDataDir ?? joinPlatformPath(platform, homeDir, "AppData", "Roaming"),
      "Code",
      "User",
      "workspaceStorage",
    );
  }
  return joinPlatformPath(platform, homeDir, ".config", "Code", "User", "workspaceStorage");
}

export const PROVIDER_METADATA: Record<Provider, ProviderMetadata> = {
  claude: {
    id: "claude",
    label: "Claude",
    sourceFormat: "jsonl_stream",
    discoveryPaths: [
      {
        key: "claudeRoot",
        label: "Claude root",
        watch: true,
        defaultPath: (platform, environment) =>
          joinPlatformPath(platform, environment.homeDir, ".claude", "projects"),
      },
    ],
    defaultSystemMessageRegexRules: [
      "^<command-name>",
      "^<local-command-stdout>",
      "^<local-command-caveat>",
    ],
    supportsTurnFamilyQuery: true,
    turnDiffStrategy: "inline_reconstructed",
  },
  codex: {
    id: "codex",
    label: "Codex",
    sourceFormat: "jsonl_stream",
    discoveryPaths: [
      {
        key: "codexRoot",
        label: "Codex root",
        watch: true,
        defaultPath: (platform, environment) =>
          joinPlatformPath(platform, environment.homeDir, ".codex", "sessions"),
      },
    ],
    defaultSystemMessageRegexRules: [
      "^#?\\s*AGENTS\\.md instructions for [^\\r\\n]+\\r?\\n(?:\\r?\\n)?<INSTRUCTIONS>",
      "^\\s*<environment_context>",
    ],
    turnDiffStrategy: "raw_tool_payload",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    sourceFormat: "materialized_json",
    discoveryPaths: [
      {
        key: "geminiRoot",
        label: "Gemini tmp root",
        watch: true,
        defaultPath: (platform, environment) =>
          joinPlatformPath(platform, environment.homeDir, ".gemini", "tmp"),
      },
      {
        key: "geminiHistoryRoot",
        label: "Gemini history root",
        watch: true,
        defaultPath: (platform, environment) =>
          joinPlatformPath(platform, environment.homeDir, ".gemini", "history"),
      },
      {
        key: "geminiProjectsPath",
        label: "Gemini projects path",
        watch: false,
        defaultPath: (platform, environment) =>
          joinPlatformPath(platform, environment.homeDir, ".gemini", "projects.json"),
      },
    ],
    defaultSystemMessageRegexRules: [],
    turnDiffStrategy: "raw_tool_payload",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    sourceFormat: "jsonl_stream",
    discoveryPaths: [
      {
        key: "cursorRoot",
        label: "Cursor root",
        watch: true,
        defaultPath: (platform, environment) =>
          joinPlatformPath(platform, environment.homeDir, ".cursor", "projects"),
      },
    ],
    defaultSystemMessageRegexRules: [],
    turnDiffStrategy: "raw_tool_payload",
  },
  copilot: {
    id: "copilot",
    label: "Copilot",
    sourceFormat: "materialized_json",
    discoveryPaths: [
      {
        key: "copilotRoot",
        label: "Copilot root",
        watch: true,
        defaultPath: (platform, environment) => getDefaultCopilotRoot(platform, environment),
      },
    ],
    defaultSystemMessageRegexRules: [],
    turnDiffStrategy: "raw_tool_payload_fallback",
  },
  copilot_cli: {
    id: "copilot_cli",
    label: "Copilot CLI",
    sourceFormat: "jsonl_stream",
    discoveryPaths: [
      {
        key: "copilotCliRoot",
        label: "Copilot CLI root",
        watch: true,
        defaultPath: (platform, environment) =>
          joinPlatformPath(platform, environment.homeDir, ".copilot", "session-state"),
      },
    ],
    defaultSystemMessageRegexRules: [],
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    sourceFormat: "materialized_json",
    discoveryPaths: [
      {
        key: "opencodeRoot",
        label: "OpenCode data root",
        watch: true,
        defaultPath: (platform, environment) =>
          platform === "win32"
            ? joinPlatformPath(
                platform,
                environment.localAppDataDir ??
                  joinPlatformPath(platform, environment.homeDir, "AppData", "Local"),
                "opencode",
              )
            : joinPlatformPath(platform, environment.homeDir, ".local", "share", "opencode"),
      },
    ],
    defaultSystemMessageRegexRules: [],
    turnDiffStrategy: "raw_tool_payload",
  },
};

export const PROVIDER_LIST: ProviderMetadata[] = PROVIDER_VALUES.map(
  (provider) => PROVIDER_METADATA[provider],
);

export function getProviderLabel(provider: Provider): string {
  return PROVIDER_METADATA[provider].label;
}

export function createProviderRecord<T>(factory: (provider: Provider) => T): Record<Provider, T> {
  return Object.fromEntries(
    PROVIDER_VALUES.map((provider) => [provider, factory(provider)]),
  ) as Record<Provider, T>;
}
