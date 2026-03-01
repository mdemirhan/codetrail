import type { Provider } from "../contracts/canonical";

export type DiscoveredSessionFile = {
  provider: Provider;
  projectPath: string;
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
  };
};

export type DiscoveryConfig = {
  claudeRoot: string;
  codexRoot: string;
  geminiRoot: string;
  geminiHistoryRoot?: string;
  geminiProjectsPath?: string;
  cursorRoot: string;
  includeClaudeSubagents: boolean;
};

export type GeminiProjectResolution = {
  hashToPath: Map<string, string>;
};
