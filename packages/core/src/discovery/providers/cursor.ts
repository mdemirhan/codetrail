import { basename, join } from "node:path";

import { equalsCaseInsensitive, hasFileExtension } from "../../pathMatching";
import {
  type ResolvedDiscoveryDependencies,
  getDiscoveryPath,
  isUnderRoot,
  projectNameFromPath,
  providerSessionIdentity,
  relativeSegments,
  safeIsDirectory,
  safeReadDir,
  safeReadUtf8File,
  safeStat,
} from "../shared";
import type { DiscoveredSessionFile, ResolvedDiscoveryConfig } from "../types";

function decodeCursorProjectPath(
  projectDir: string,
  encodedName: string,
  dependencies: ResolvedDiscoveryDependencies,
): { projectPath: string; unresolvedProject: boolean; resolutionSource: string } {
  const terminalsDir = join(projectDir, "terminals");
  if (safeIsDirectory(terminalsDir, dependencies)) {
    for (const entry of safeReadDir(terminalsDir, dependencies)) {
      if (!entry.isFile()) {
        continue;
      }
      const content = safeReadUtf8File(join(terminalsDir, entry.name), dependencies);
      if (!content) {
        continue;
      }
      const cwdMatch = content.match(/^cwd:\s*(.+)$/m);
      if (cwdMatch?.[1]) {
        const cwd = normalizeCursorTerminalCwd(cwdMatch[1]);
        if (cwd && isLikelyAbsolutePath(cwd)) {
          return { projectPath: cwd, unresolvedProject: false, resolutionSource: "terminal_cwd" };
        }
      }
    }
  }

  const naive = `/${encodedName.replaceAll("-", "/")}`;
  if (safeIsDirectory(naive, dependencies)) {
    return { projectPath: naive, unresolvedProject: false, resolutionSource: "folder_decode" };
  }

  return { projectPath: "", unresolvedProject: true, resolutionSource: "unresolved" };
}

function normalizeCursorTerminalCwd(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === "string" && parsed.trim().length > 0 ? parsed.trim() : null;
    } catch {
      return trimmed.slice(1, -1).trim() || null;
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).trim() || null;
  }

  return trimmed;
}

function isLikelyAbsolutePath(pathValue: string): boolean {
  if (pathValue.startsWith("/")) {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(pathValue);
}

function toDiscoveredCursorFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  const cursorRoot = getDiscoveryPath(config, "cursor", "cursorRoot");
  if (!cursorRoot || !hasFileExtension(filePath, ".jsonl") || !isUnderRoot(filePath, cursorRoot)) {
    return null;
  }

  const segments = relativeSegments(filePath, cursorRoot);
  if (segments.length < 4 || !equalsCaseInsensitive(segments[1] ?? "", "agent-transcripts")) {
    return null;
  }

  const encodedName = segments[0];
  const uuid = segments[2];
  if (!encodedName || !uuid || !equalsCaseInsensitive(basename(filePath), `${uuid}.jsonl`)) {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat) {
    return null;
  }

  const projectDir = join(cursorRoot, encodedName);
  const cursorProject = decodeCursorProjectPath(projectDir, encodedName, dependencies);
  const projectPath = cursorProject.projectPath;
  const unresolvedProject = cursorProject.unresolvedProject;
  const projectName = unresolvedProject ? encodedName : projectNameFromPath(projectPath);
  const sessionIdentity = providerSessionIdentity("cursor", uuid, filePath);

  return {
    provider: "cursor",
    projectPath,
    canonicalProjectPath: projectPath,
    projectName,
    sessionIdentity,
    sourceSessionId: uuid,
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
      providerProjectKey: encodedName,
      providerSessionId: uuid,
      sessionKind: "regular",
      gitCommitHash: null,
      providerClient: "Cursor",
      providerSource: null,
      providerClientVersion: null,
      lineageParentId: null,
      resolutionSource: cursorProject.resolutionSource,
      projectMetadata: null,
      sessionMetadata: null,
    },
  };
}

export function discoverCursorFiles(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const cursorRoot = getDiscoveryPath(config, "cursor", "cursorRoot");
  if (!cursorRoot || !dependencies.fs.existsSync(cursorRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];
  for (const projectEntry of safeReadDir(cursorRoot, dependencies)) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectDir = join(cursorRoot, projectEntry.name);
    const transcriptsDir = join(projectDir, "agent-transcripts");
    if (!safeIsDirectory(transcriptsDir, dependencies)) {
      continue;
    }

    for (const sessionDir of safeReadDir(transcriptsDir, dependencies)) {
      if (!sessionDir.isDirectory()) {
        continue;
      }
      const jsonlPath = join(transcriptsDir, sessionDir.name, `${sessionDir.name}.jsonl`);
      const discoveredFile = toDiscoveredCursorFile(jsonlPath, config, dependencies);
      if (discoveredFile) {
        discovered.push(discoveredFile);
      }
    }
  }

  return discovered;
}

export function discoverSingleCursorFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  return toDiscoveredCursorFile(filePath, config, dependencies);
}
