import { basename, join } from "node:path";

import { compactMetadata } from "../../metadata";
import { equalsCaseInsensitive, hasFileExtension, stripFileExtension } from "../../pathMatching";
import {
  type ResolvedDiscoveryDependencies,
  decodeFileUrlPath,
  getDiscoveryPath,
  isUnderRoot,
  parseJsonFile,
  projectNameFromPath,
  providerSessionIdentity,
  relativeSegments,
  safeIsDirectory,
  safeReadDir,
  safeStat,
} from "../shared";
import type { DiscoveredSessionFile, ResolvedDiscoveryConfig } from "../types";

function decodeCopilotWorkspaceProject(
  workspaceDir: string,
  dependencies: ResolvedDiscoveryDependencies,
): string | null {
  const workspaceJsonPath = join(workspaceDir, "workspace.json");
  const content = parseJsonFile<{ folder?: string }>(workspaceJsonPath, dependencies);
  if (!content?.folder) {
    return null;
  }

  return decodeFileUrlPath(content.folder);
}

function toDiscoveredCopilotFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  const copilotRoot = getDiscoveryPath(config, "copilot", "copilotRoot");
  if (!copilotRoot || !hasFileExtension(filePath, ".json") || !isUnderRoot(filePath, copilotRoot)) {
    return null;
  }

  const segments = relativeSegments(filePath, copilotRoot);
  if (segments.length < 3 || !equalsCaseInsensitive(segments[1] ?? "", "chatSessions")) {
    return null;
  }

  const workspaceId = segments[0];
  if (!workspaceId) {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat) {
    return null;
  }

  const workspaceDir = join(copilotRoot, workspaceId);
  const projectPath = decodeCopilotWorkspaceProject(workspaceDir, dependencies);
  const projectName = projectPath ? projectNameFromPath(projectPath) : workspaceId;
  const unresolvedProject = !projectPath;
  const sourceSessionId = basename(stripFileExtension(filePath, ".json"));
  const sessionIdentity = providerSessionIdentity("copilot", sourceSessionId, filePath);
  const sessionContent = parseJsonFile<{
    version?: number;
    initialLocation?: string;
    isImported?: boolean;
    sessionId?: string;
  }>(filePath, dependencies);
  const initialLocation =
    typeof sessionContent?.initialLocation === "string" ? sessionContent.initialLocation : null;
  const isImported = sessionContent?.isImported === true;

  return {
    provider: "copilot",
    projectPath: projectPath ?? "",
    canonicalProjectPath: projectPath ?? "",
    projectName,
    sessionIdentity,
    sourceSessionId,
    filePath,
    fileSize: fileStat.size,
    fileMtimeMs: Math.trunc(fileStat.mtimeMs),
    metadata: {
      includeInHistory: true,
      isSubagent: false,
      unresolvedProject,
      gitBranch: null,
      cwd: projectPath || null,
      worktreeLabel: null,
      worktreeSource: null,
      repositoryUrl: null,
      forkedFromSessionId: null,
      parentSessionCwd: null,
      providerProjectKey: workspaceId,
      providerSessionId:
        typeof sessionContent?.sessionId === "string" ? sessionContent.sessionId : sourceSessionId,
      sessionKind: isImported ? "imported" : "regular",
      gitCommitHash: null,
      providerClient: "GitHub Copilot",
      providerSource: null,
      providerClientVersion:
        typeof sessionContent?.version === "number" ? String(sessionContent.version) : null,
      lineageParentId: null,
      resolutionSource: projectPath ? "workspace_json" : "unresolved",
      projectMetadata: null,
      sessionMetadata: compactMetadata({
        initialLocation: initialLocation && initialLocation !== "panel" ? initialLocation : null,
      }),
    },
  };
}

export function discoverCopilotFiles(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const copilotRoot = getDiscoveryPath(config, "copilot", "copilotRoot");
  if (!copilotRoot || !dependencies.fs.existsSync(copilotRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];
  for (const workspaceEntry of safeReadDir(copilotRoot, dependencies)) {
    if (!workspaceEntry.isDirectory()) {
      continue;
    }

    const workspaceDir = join(copilotRoot, workspaceEntry.name);
    const chatSessionsDir = join(workspaceDir, "chatSessions");
    if (!safeIsDirectory(chatSessionsDir, dependencies)) {
      continue;
    }

    for (const sessionFile of safeReadDir(chatSessionsDir, dependencies)) {
      if (!sessionFile.isFile()) {
        continue;
      }
      const discoveredFile = toDiscoveredCopilotFile(
        join(chatSessionsDir, sessionFile.name),
        config,
        dependencies,
      );
      if (discoveredFile) {
        discovered.push(discoveredFile);
      }
    }
  }

  return discovered;
}

export function discoverSingleCopilotFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  return toDiscoveredCopilotFile(filePath, config, dependencies);
}
