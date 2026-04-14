import { PROVIDER_VALUES, type Provider } from "./canonical";

export type ProviderSourceFormat = "jsonl_stream" | "materialized_json";

export type ProviderDiscoveryPathKey =
  | "claudeRoot"
  | "codexRoot"
  | "geminiRoot"
  | "geminiHistoryRoot"
  | "geminiProjectsPath"
  | "cursorRoot"
  | "copilotRoot"
  | "copilotCliRoot";

export type ProviderDiscoveryPathDefinition = {
  key: ProviderDiscoveryPathKey;
  label: string;
  watch: boolean;
};

export type ProviderMetadata = {
  id: Provider;
  label: string;
  sourceFormat: ProviderSourceFormat;
  discoveryPaths: readonly ProviderDiscoveryPathDefinition[];
  defaultSystemMessageRegexRules: readonly string[];
};

export const PROVIDER_METADATA: Record<Provider, ProviderMetadata> = {
  claude: {
    id: "claude",
    label: "Claude",
    sourceFormat: "jsonl_stream",
    discoveryPaths: [{ key: "claudeRoot", label: "Claude root", watch: true }],
    defaultSystemMessageRegexRules: [
      "^<command-name>",
      "^<local-command-stdout>",
      "^<local-command-caveat>",
    ],
  },
  codex: {
    id: "codex",
    label: "Codex",
    sourceFormat: "jsonl_stream",
    discoveryPaths: [{ key: "codexRoot", label: "Codex root", watch: true }],
    defaultSystemMessageRegexRules: [
      "^#?\\s*AGENTS\\.md instructions for [^\\r\\n]+\\r?\\n(?:\\r?\\n)?<INSTRUCTIONS>",
      "^\\s*<environment_context>",
    ],
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    sourceFormat: "materialized_json",
    discoveryPaths: [
      { key: "geminiRoot", label: "Gemini tmp root", watch: true },
      { key: "geminiHistoryRoot", label: "Gemini history root", watch: true },
      { key: "geminiProjectsPath", label: "Gemini projects path", watch: false },
    ],
    defaultSystemMessageRegexRules: [],
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    sourceFormat: "jsonl_stream",
    discoveryPaths: [{ key: "cursorRoot", label: "Cursor root", watch: true }],
    defaultSystemMessageRegexRules: [],
  },
  copilot: {
    id: "copilot",
    label: "Copilot",
    sourceFormat: "materialized_json",
    discoveryPaths: [{ key: "copilotRoot", label: "Copilot root", watch: true }],
    defaultSystemMessageRegexRules: [],
  },
  copilot_cli: {
    id: "copilot_cli",
    label: "Copilot CLI",
    sourceFormat: "jsonl_stream",
    discoveryPaths: [{ key: "copilotCliRoot", label: "Copilot CLI root", watch: true }],
    defaultSystemMessageRegexRules: [],
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
