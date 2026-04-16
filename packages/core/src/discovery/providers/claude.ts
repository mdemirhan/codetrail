import { basename, join } from "node:path";

import { compactMetadata } from "../../metadata";
import { hasFileExtension, stripFileExtension } from "../../pathMatching";
import {
  type ResolvedDiscoveryDependencies,
  getDiscoveryPath,
  projectNameFromPath,
  relativeSegments,
  safeIsDirectory,
  safeReadDir,
  safeStat,
} from "../shared";
import type { DiscoveredSessionFile, ResolvedDiscoveryConfig } from "../types";
import {
  decodeClaudeProjectId,
  readClaudeJsonlMeta,
  readClaudeSessionsIndex,
} from "./claudeHelpers";
import { matchClaudeManagedWorktree } from "./worktreeHelpers";

function resolveClaudeProjectInfo(args: {
  sessionIndexProjectPath: string | undefined;
  fallbackProjectId: string;
  fileMeta: ReturnType<typeof readClaudeJsonlMeta>;
}): {
  projectPath: string;
  worktreeLabel: string | null;
  worktreeSource: "claude_cwd" | "claude_env_text" | null;
  resolutionSource: string;
} {
  if (args.sessionIndexProjectPath) {
    return {
      projectPath: args.sessionIndexProjectPath,
      worktreeLabel: null,
      worktreeSource: null,
      resolutionSource: "sessions_index",
    };
  }

  if (args.fileMeta.canonicalProjectPath) {
    const claudeManagedWorktree = matchClaudeManagedWorktree(args.fileMeta.cwd);
    return {
      projectPath: args.fileMeta.canonicalProjectPath,
      worktreeLabel: args.fileMeta.worktreeLabel,
      worktreeSource: claudeManagedWorktree ? "claude_cwd" : "claude_env_text",
      resolutionSource: claudeManagedWorktree ? "claude_cwd" : "claude_env_text",
    };
  }

  if (args.fileMeta.cwd) {
    return {
      projectPath: args.fileMeta.cwd,
      worktreeLabel: null,
      worktreeSource: null,
      resolutionSource: "cwd",
    };
  }

  return {
    projectPath: decodeClaudeProjectId(args.fallbackProjectId),
    worktreeLabel: null,
    worktreeSource: null,
    resolutionSource: "project_id",
  };
}

export function discoverClaudeFiles(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const claudeRoot = getDiscoveryPath(config, "claude", "claudeRoot");
  if (!claudeRoot || !dependencies.fs.existsSync(claudeRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];

  for (const projectEntry of safeReadDir(claudeRoot, dependencies)) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectDir = join(claudeRoot, projectEntry.name);
    const sessionsIndexById = readClaudeSessionsIndex(projectDir, dependencies);

    for (const entry of safeReadDir(projectDir, dependencies)) {
      if (!entry.isFile() || !hasFileExtension(entry.name, ".jsonl")) {
        continue;
      }

      const filePath = join(projectDir, entry.name);
      const fileStat = safeStat(filePath, dependencies);
      if (!fileStat) {
        continue;
      }
      const sessionIdentity = stripFileExtension(entry.name, ".jsonl");
      const fileMeta = readClaudeJsonlMeta(filePath, dependencies);
      const sessionIndexEntry = sessionsIndexById.get(sessionIdentity);
      const projectInfo = resolveClaudeProjectInfo({
        sessionIndexProjectPath: sessionIndexEntry?.projectPath,
        fallbackProjectId: projectEntry.name,
        fileMeta,
      });

      discovered.push({
        provider: "claude",
        projectPath: projectInfo.projectPath,
        canonicalProjectPath: projectInfo.projectPath,
        projectName: projectNameFromPath(projectInfo.projectPath),
        sessionIdentity,
        sourceSessionId: sessionIdentity,
        filePath,
        fileSize: fileStat.size,
        fileMtimeMs: Math.trunc(fileStat.mtimeMs),
        metadata: {
          includeInHistory: true,
          isSubagent: false,
          unresolvedProject: false,
          gitBranch: fileMeta.gitBranch,
          cwd: fileMeta.cwd,
          worktreeLabel: projectInfo.worktreeLabel,
          worktreeSource: projectInfo.worktreeSource,
          repositoryUrl: null,
          forkedFromSessionId: null,
          parentSessionCwd: fileMeta.mainRepositoryPath,
          providerProjectKey: projectEntry.name,
          providerSessionId: fileMeta.sessionId ?? sessionIdentity,
          sessionKind: fileMeta.isSidechain ? "sidechain" : "regular",
          gitCommitHash: null,
          providerClient: "Claude",
          providerSource: null,
          providerClientVersion: fileMeta.version,
          lineageParentId: null,
          resolutionSource: projectInfo.resolutionSource,
          projectMetadata: null,
          sessionMetadata: compactMetadata({
            userType: fileMeta.userType,
            isSidechain: fileMeta.isSidechain ? true : undefined,
          }),
        },
      });
    }

    if (!config.providers.claude.options.includeSubagents) {
      continue;
    }

    for (const sessionDir of safeReadDir(projectDir, dependencies)) {
      if (!sessionDir.isDirectory()) {
        continue;
      }

      const subagentsDir = join(projectDir, sessionDir.name, "subagents");
      if (!safeIsDirectory(subagentsDir, dependencies)) {
        continue;
      }

      for (const fileEntry of safeReadDir(subagentsDir, dependencies)) {
        if (!fileEntry.isFile() || !hasFileExtension(fileEntry.name, ".jsonl")) {
          continue;
        }

        const filePath = join(subagentsDir, fileEntry.name);
        const fileStat = safeStat(filePath, dependencies);
        if (!fileStat) {
          continue;
        }
        const fileMeta = readClaudeJsonlMeta(filePath, dependencies);
        const parentSessionId = sessionDir.name;
        const subagentName = stripFileExtension(fileEntry.name, ".jsonl");
        const sessionIdentity = `${parentSessionId}:subagent:${subagentName}`;
        const sessionIndexEntry = sessionsIndexById.get(parentSessionId);
        const projectInfo = resolveClaudeProjectInfo({
          sessionIndexProjectPath: sessionIndexEntry?.projectPath,
          fallbackProjectId: projectEntry.name,
          fileMeta,
        });

        discovered.push(
          buildClaudeSubagentDiscoveredFile({
            projectPath: projectInfo.projectPath,
            providerProjectKey: projectEntry.name,
            sessionIdentity,
            sourceSessionId: parentSessionId,
            providerSessionId: fileMeta.sessionId ?? subagentName,
            filePath,
            fileSize: fileStat.size,
            fileMtimeMs: Math.trunc(fileStat.mtimeMs),
            gitBranch: fileMeta.gitBranch,
            cwd: fileMeta.cwd,
            mainRepositoryPath: fileMeta.mainRepositoryPath,
            providerClientVersion: fileMeta.version,
            userType: fileMeta.userType,
            isSidechain: fileMeta.isSidechain,
            worktreeLabel: projectInfo.worktreeLabel,
            worktreeSource: projectInfo.worktreeSource,
            resolutionSource: projectInfo.resolutionSource,
            lineageParentId: parentSessionId,
          }),
        );
      }
    }
  }

  return discovered;
}

export function discoverSingleClaudeFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  if (!hasFileExtension(filePath, ".jsonl")) {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat) {
    return null;
  }

  const claudeRoot = getDiscoveryPath(config, "claude", "claudeRoot");
  if (!claudeRoot) {
    return null;
  }

  const segments = relativeSegments(filePath, claudeRoot);
  if (segments.length < 2) {
    return null;
  }

  const projectId = segments[0];
  if (!projectId) {
    return null;
  }

  const projectDir = join(claudeRoot, projectId);
  const subagentIndex = segments.findIndex((segment) => segment === "subagents");
  if (subagentIndex >= 0) {
    if (!config.providers.claude.options.includeSubagents) {
      return null;
    }
    const parentSessionId = segments[subagentIndex - 1];
    if (!parentSessionId) {
      return null;
    }
    const subagentName = stripFileExtension(basename(filePath), ".jsonl");
    const fileMeta = readClaudeJsonlMeta(filePath, dependencies);
    const sessionIdentity = `${parentSessionId}:subagent:${subagentName}`;
    const sessionsIndexById = readClaudeSessionsIndex(projectDir, dependencies);
    const sessionIndexEntry = sessionsIndexById.get(parentSessionId);
    const projectInfo = resolveClaudeProjectInfo({
      sessionIndexProjectPath: sessionIndexEntry?.projectPath,
      fallbackProjectId: projectId,
      fileMeta,
    });

    return buildClaudeSubagentDiscoveredFile({
      projectPath: projectInfo.projectPath,
      providerProjectKey: projectId,
      sessionIdentity,
      sourceSessionId: parentSessionId,
      providerSessionId: fileMeta.sessionId ?? subagentName,
      filePath,
      fileSize: fileStat.size,
      fileMtimeMs: Math.trunc(fileStat.mtimeMs),
      gitBranch: fileMeta.gitBranch,
      cwd: fileMeta.cwd,
      mainRepositoryPath: fileMeta.mainRepositoryPath,
      providerClientVersion: fileMeta.version,
      userType: fileMeta.userType,
      isSidechain: fileMeta.isSidechain,
      worktreeLabel: projectInfo.worktreeLabel,
      worktreeSource: projectInfo.worktreeSource,
      resolutionSource: projectInfo.resolutionSource,
      lineageParentId: parentSessionId,
    });
  }

  const sessionIdentity = basename(stripFileExtension(filePath, ".jsonl"));
  const sessionsIndexById = readClaudeSessionsIndex(projectDir, dependencies);
  const sessionIndexEntry = sessionsIndexById.get(sessionIdentity);
  const fileMeta = readClaudeJsonlMeta(filePath, dependencies);
  const projectInfo = resolveClaudeProjectInfo({
    sessionIndexProjectPath: sessionIndexEntry?.projectPath,
    fallbackProjectId: projectId,
    fileMeta,
  });

  return {
    provider: "claude",
    projectPath: projectInfo.projectPath,
    canonicalProjectPath: projectInfo.projectPath,
    projectName: projectNameFromPath(projectInfo.projectPath),
    sessionIdentity,
    sourceSessionId: sessionIdentity,
    filePath,
    fileSize: fileStat.size,
    fileMtimeMs: Math.trunc(fileStat.mtimeMs),
    metadata: {
      includeInHistory: true,
      isSubagent: false,
      unresolvedProject: false,
      gitBranch: fileMeta.gitBranch,
      cwd: fileMeta.cwd,
      worktreeLabel: projectInfo.worktreeLabel,
      worktreeSource: projectInfo.worktreeSource,
      repositoryUrl: null,
      forkedFromSessionId: null,
      parentSessionCwd: fileMeta.mainRepositoryPath,
      providerProjectKey: projectId,
      providerSessionId: fileMeta.sessionId ?? sessionIdentity,
      sessionKind: fileMeta.isSidechain ? "sidechain" : "regular",
      gitCommitHash: null,
      providerClient: "Claude",
      providerSource: null,
      providerClientVersion: fileMeta.version,
      lineageParentId: null,
      resolutionSource: projectInfo.resolutionSource,
      projectMetadata: null,
      sessionMetadata: compactMetadata({
        userType: fileMeta.userType,
        isSidechain: fileMeta.isSidechain ? true : undefined,
      }),
    },
  };
}

function buildClaudeSubagentDiscoveredFile(args: {
  projectPath: string;
  providerProjectKey: string;
  sessionIdentity: string;
  sourceSessionId: string;
  providerSessionId: string;
  filePath: string;
  fileSize: number;
  fileMtimeMs: number;
  gitBranch: string | null;
  cwd: string | null;
  mainRepositoryPath: string | null;
  providerClientVersion: string | null;
  userType: string | null;
  isSidechain: boolean;
  worktreeLabel: string | null;
  worktreeSource: DiscoveredSessionFile["metadata"]["worktreeSource"];
  resolutionSource: string | null;
  lineageParentId: string;
}): DiscoveredSessionFile {
  return {
    provider: "claude",
    projectPath: args.projectPath,
    canonicalProjectPath: args.projectPath,
    projectName: projectNameFromPath(args.projectPath),
    sessionIdentity: args.sessionIdentity,
    sourceSessionId: args.sourceSessionId,
    filePath: args.filePath,
    fileSize: args.fileSize,
    fileMtimeMs: args.fileMtimeMs,
    metadata: {
      includeInHistory: true,
      isSubagent: true,
      unresolvedProject: false,
      gitBranch: args.gitBranch,
      cwd: args.cwd,
      worktreeLabel: args.worktreeLabel,
      worktreeSource: args.worktreeSource,
      repositoryUrl: null,
      forkedFromSessionId: null,
      parentSessionCwd: args.mainRepositoryPath,
      providerProjectKey: args.providerProjectKey,
      providerSessionId: args.providerSessionId,
      sessionKind: "subagent",
      gitCommitHash: null,
      providerClient: "Claude",
      providerSource: null,
      providerClientVersion: args.providerClientVersion,
      lineageParentId: args.lineageParentId,
      resolutionSource: args.resolutionSource,
      projectMetadata: null,
      sessionMetadata: compactMetadata({
        userType: args.userType,
        isSidechain: args.isSidechain ? true : undefined,
      }),
    },
  };
}
