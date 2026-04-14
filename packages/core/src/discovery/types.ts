import type { Provider } from "../contracts/canonical";
import type { ProviderDiscoveryPathKey } from "../contracts/providerMetadata";

export type WorktreeSource =
  | "claude_cwd"
  | "claude_env_text"
  | "codex_fork"
  | "git_live"
  | "repo_url_match"
  | "basename_match";

export type SessionKind = "regular" | "subagent" | "sidechain" | "imported" | "forked";

export type DiscoveredSessionFile = {
  provider: Provider;
  projectPath: string;
  canonicalProjectPath: string;
  projectName: string;
  sessionIdentity: string;
  sourceSessionId: string;
  filePath: string;
  fileSize: number;
  fileMtimeMs: number;
  metadata: {
    includeInHistory: boolean;
    isSubagent: boolean;
    unresolvedProject: boolean;
    gitBranch: string | null;
    cwd: string | null;
    worktreeLabel: string | null;
    worktreeSource: WorktreeSource | null;
    repositoryUrl: string | null;
    forkedFromSessionId: string | null;
    parentSessionCwd: string | null;
    providerProjectKey?: string | null;
    providerSessionId?: string | null;
    sessionKind?: SessionKind | null;
    gitCommitHash?: string | null;
    providerClient?: string | null;
    providerSource?: string | null;
    providerClientVersion?: string | null;
    lineageParentId?: string | null;
    resolutionSource?: string | null;
    projectMetadata?: Record<string, unknown> | null;
    sessionMetadata?: Record<string, unknown> | null;
  };
};

export type DiscoveryConfig = {
  claudeRoot: string;
  codexRoot: string;
  geminiRoot: string;
  geminiHistoryRoot?: string;
  geminiProjectsPath?: string;
  cursorRoot: string;
  copilotRoot: string;
  copilotCliRoot: string;
  includeClaudeSubagents: boolean;
  enabledProviders?: Provider[];
};

export type ResolvedDiscoveryProviderConfig = {
  paths: Partial<Record<ProviderDiscoveryPathKey, string>>;
  options: {
    includeSubagents: boolean;
  };
};

export type ResolvedDiscoveryConfig = {
  providers: Record<Provider, ResolvedDiscoveryProviderConfig>;
  enabledProviders: Provider[];
};

export type GeminiProjectResolution = {
  resolveProjectPath: (projectHash: string) => string | null;
  rememberProjectPath: (projectHash: string, projectPath: string) => void;
};
