import { homedir } from "node:os";
import { join } from "node:path";

import { PROVIDER_VALUES } from "../contracts/canonical";

export type DiscoveryPlatform = "darwin" | "win32" | "linux";

export type DiscoveryPlatformEnvironment = {
  homeDir?: string;
  appDataDir?: string | null;
};

export function getCurrentDiscoveryPlatform(): DiscoveryPlatform {
  if (process.platform === "win32") {
    return "win32";
  }
  if (process.platform === "darwin") {
    return "darwin";
  }
  return "linux";
}

export function getDefaultCopilotRoot(
  platform: DiscoveryPlatform,
  environment: DiscoveryPlatformEnvironment = {},
): string {
  const homeDir = environment.homeDir ?? homedir();
  if (platform === "darwin") {
    return join(homeDir, "Library", "Application Support", "Code", "User", "workspaceStorage");
  }
  if (platform === "win32") {
    return join(
      environment.appDataDir ?? join(homeDir, "AppData", "Roaming"),
      "Code",
      "User",
      "workspaceStorage",
    );
  }
  return join(homeDir, ".config", "Code", "User", "workspaceStorage");
}

export function createDefaultDiscoveryConfig(
  platform: DiscoveryPlatform,
  environment: DiscoveryPlatformEnvironment = {},
) {
  const homeDir = environment.homeDir ?? homedir();
  return {
    claudeRoot: join(homeDir, ".claude", "projects"),
    codexRoot: join(homeDir, ".codex", "sessions"),
    geminiRoot: join(homeDir, ".gemini", "tmp"),
    geminiHistoryRoot: join(homeDir, ".gemini", "history"),
    geminiProjectsPath: join(homeDir, ".gemini", "projects.json"),
    cursorRoot: join(homeDir, ".cursor", "projects"),
    copilotRoot: getDefaultCopilotRoot(platform, environment),
    copilotCliRoot: join(homeDir, ".copilot", "session-state"),
    includeClaudeSubagents: false,
    enabledProviders: [...PROVIDER_VALUES],
  };
}
