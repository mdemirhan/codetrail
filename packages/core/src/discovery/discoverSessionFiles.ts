import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

import { asRecord, readString } from "../parsing/helpers";

import type { DiscoveredSessionFile, DiscoveryConfig, GeminiProjectResolution } from "./types";

type DiscoveryDirent = {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
};

type DiscoveryStat = {
  size: number;
  mtimeMs: number;
  isDirectory: () => boolean;
};

export type DiscoveryFileSystem = {
  closeSync: (fd: number) => void;
  existsSync: (path: string) => boolean;
  lstatSync: (path: string) => DiscoveryStat;
  openSync: (path: string, flags: "r") => number;
  readFileSync: (path: string, encoding: "utf8") => string;
  readSync: (
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ) => number;
  readdirSync: (path: string, options: { withFileTypes: true }) => DiscoveryDirent[];
  statSync: (path: string) => DiscoveryStat;
};

export type DiscoveryDependencies = {
  fs?: DiscoveryFileSystem;
};

type ResolvedDiscoveryDependencies = {
  fs: DiscoveryFileSystem;
};

const NODE_DISCOVERY_FILE_SYSTEM: DiscoveryFileSystem = {
  closeSync: (fd) => closeSync(fd),
  existsSync: (path) => existsSync(path),
  lstatSync: (path) => lstatSync(path),
  openSync: (path, flags) => openSync(path, flags),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  readSync: (fd, buffer, offset, length, position) =>
    readSync(fd, buffer, offset, length, position),
  readdirSync,
  statSync: (path) => statSync(path),
};

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  claudeRoot: join(homedir(), ".claude", "projects"),
  codexRoot: join(homedir(), ".codex", "sessions"),
  geminiRoot: join(homedir(), ".gemini", "tmp"),
  geminiHistoryRoot: join(homedir(), ".gemini", "history"),
  geminiProjectsPath: join(homedir(), ".gemini", "projects.json"),
  cursorRoot: join(homedir(), ".cursor", "projects"),
  includeClaudeSubagents: false,
};

// Discovery stays deliberately tolerant: missing roots, unreadable files, and provider-specific
// oddities should reduce coverage, not abort a full indexing run.
export function discoverSessionFiles(
  config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG,
  dependencies: DiscoveryDependencies = {},
): DiscoveredSessionFile[] {
  const resolvedDependencies = resolveDiscoveryDependencies(dependencies);
  const geminiResolution = buildGeminiProjectResolution(config, resolvedDependencies);

  return [
    ...discoverClaudeFiles(config, resolvedDependencies),
    ...discoverCodexFiles(config, resolvedDependencies),
    ...discoverGeminiFiles(config, geminiResolution, resolvedDependencies),
    ...discoverCursorFiles(config, resolvedDependencies),
  ].sort((left, right) => {
    const byMtime = right.fileMtimeMs - left.fileMtimeMs;
    if (byMtime !== 0) {
      return byMtime;
    }

    return left.filePath.localeCompare(right.filePath);
  });
}

function discoverClaudeFiles(
  config: DiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  if (!dependencies.fs.existsSync(config.claudeRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];

  for (const projectEntry of safeReadDir(config.claudeRoot, dependencies)) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectDir = join(config.claudeRoot, projectEntry.name);
    const sessionsIndexById = readClaudeSessionsIndex(projectDir, dependencies);

    for (const entry of safeReadDir(projectDir, dependencies)) {
      if (!entry.isFile() || extname(entry.name) !== ".jsonl") {
        continue;
      }

      const filePath = join(projectDir, entry.name);
      const sessionIdentity = entry.name.slice(0, -".jsonl".length);
      const fileStat = safeStat(filePath, dependencies);
      if (!fileStat) {
        continue;
      }
      const fileMeta = readClaudeJsonlMeta(filePath, dependencies);
      const sessionIndexEntry = sessionsIndexById.get(sessionIdentity);
      const projectPath =
        sessionIndexEntry?.projectPath ?? decodeClaudeProjectId(projectEntry.name);

      discovered.push({
        provider: "claude",
        projectPath,
        projectName: projectNameFromPath(projectPath),
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
        },
      });
    }

    if (!config.includeClaudeSubagents) {
      continue;
    }

    // Claude subagents live under a parent session directory but need their own stable identity so
    // they can coexist with the main transcript in the database.
    for (const sessionDir of safeReadDir(projectDir, dependencies)) {
      if (!sessionDir.isDirectory()) {
        continue;
      }

      const subagentsDir = join(projectDir, sessionDir.name, "subagents");
      if (!safeIsDirectory(subagentsDir, dependencies)) {
        continue;
      }

      for (const fileEntry of safeReadDir(subagentsDir, dependencies)) {
        if (!fileEntry.isFile() || extname(fileEntry.name) !== ".jsonl") {
          continue;
        }

        const filePath = join(subagentsDir, fileEntry.name);
        const fileStat = safeStat(filePath, dependencies);
        if (!fileStat) {
          continue;
        }
        const fileMeta = readClaudeJsonlMeta(filePath, dependencies);
        const parentSessionId = sessionDir.name;
        const subagentName = fileEntry.name.slice(0, -".jsonl".length);
        const sessionIdentity = `${parentSessionId}:subagent:${subagentName}`;
        const sessionIndexEntry = sessionsIndexById.get(parentSessionId);
        const projectPath =
          sessionIndexEntry?.projectPath ?? decodeClaudeProjectId(projectEntry.name);

        discovered.push({
          provider: "claude",
          projectPath,
          projectName: projectNameFromPath(projectPath),
          sessionIdentity,
          sourceSessionId: parentSessionId,
          filePath,
          fileSize: fileStat.size,
          fileMtimeMs: Math.trunc(fileStat.mtimeMs),
          metadata: {
            includeInHistory: true,
            isSubagent: true,
            unresolvedProject: false,
            gitBranch: fileMeta.gitBranch,
            cwd: fileMeta.cwd,
          },
        });
      }
    }
  }

  return discovered;
}

function discoverCodexFiles(
  config: DiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  if (!dependencies.fs.existsSync(config.codexRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];
  const files = walkFiles(config.codexRoot, dependencies);

  for (const filePath of files) {
    if (extname(filePath) !== ".jsonl") {
      continue;
    }

    const fileStat = safeStat(filePath, dependencies);
    if (!fileStat) {
      continue;
    }
    const meta = readCodexJsonlMeta(filePath, dependencies);
    const sourceSessionId = meta.sessionId ?? basename(filePath, ".jsonl");
    // Codex can emit multiple physical files for the same logical session id, so the indexed
    // identity includes the file path to avoid collisions.
    const sessionIdentity = providerSessionIdentity("codex", sourceSessionId, filePath);
    const projectPath = meta.cwd ?? "";

    discovered.push({
      provider: "codex",
      projectPath,
      projectName: projectNameFromPath(projectPath),
      sessionIdentity,
      sourceSessionId,
      filePath,
      fileSize: fileStat.size,
      fileMtimeMs: Math.trunc(fileStat.mtimeMs),
      metadata: {
        includeInHistory: true,
        isSubagent: false,
        unresolvedProject: false,
        gitBranch: meta.gitBranch,
        cwd: meta.cwd,
      },
    });
  }

  return discovered;
}

function discoverGeminiFiles(
  config: DiscoveryConfig,
  resolution: GeminiProjectResolution,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  if (!dependencies.fs.existsSync(config.geminiRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];
  const files = walkFiles(config.geminiRoot, dependencies);

  for (const filePath of files) {
    if (extname(filePath) !== ".json") {
      continue;
    }

    if (!basename(filePath).startsWith("session-")) {
      continue;
    }

    const fileStat = safeStat(filePath, dependencies);
    if (!fileStat) {
      continue;
    }
    const content = parseJsonFile<Record<string, unknown>>(filePath, dependencies);
    if (!content) {
      continue;
    }

    const sourceSessionId = readString(content.sessionId) ?? basename(filePath, ".json");
    const sessionIdentity = providerSessionIdentity("gemini", sourceSessionId, filePath);
    const projectHash = readString(content.projectHash) ?? "";
    const containerDir = geminiContainerDir(filePath);
    let resolvedProjectPath = resolution.hashToPath.get(projectHash) ?? null;
    if (!resolvedProjectPath) {
      const projectRootPath = join(containerDir, ".project_root");
      if (dependencies.fs.existsSync(projectRootPath)) {
        const fallbackPath = (safeReadUtf8File(projectRootPath, dependencies) ?? "").trim();
        if (fallbackPath.length > 0) {
          resolvedProjectPath = fallbackPath;
          if (projectHash) {
            resolution.hashToPath.set(projectHash, fallbackPath);
          }
        }
      }
    }

    const projectPath = resolvedProjectPath ?? "";
    const unresolvedProject = !resolvedProjectPath;
    const fallbackProjectName = basename(containerDir);

    discovered.push({
      provider: "gemini",
      projectPath,
      projectName: unresolvedProject ? fallbackProjectName : projectNameFromPath(projectPath),
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
      },
    });
  }

  return discovered;
}

function discoverCursorFiles(
  config: DiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  if (!dependencies.fs.existsSync(config.cursorRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];

  for (const projectEntry of safeReadDir(config.cursorRoot, dependencies)) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectDir = join(config.cursorRoot, projectEntry.name);
    const transcriptsDir = join(projectDir, "agent-transcripts");
    if (!safeIsDirectory(transcriptsDir, dependencies)) {
      continue;
    }

    const cursorProject = decodeCursorProjectPath(projectDir, projectEntry.name, dependencies);
    const projectPath = cursorProject.projectPath;
    const unresolvedProject = cursorProject.unresolvedProject;
    const projectName = unresolvedProject
      ? projectEntry.name
      : projectNameFromPath(cursorProject.projectPath);

    for (const sessionDir of safeReadDir(transcriptsDir, dependencies)) {
      if (!sessionDir.isDirectory()) {
        continue;
      }

      const sessionUuid = sessionDir.name;
      const jsonlPath = join(transcriptsDir, sessionUuid, `${sessionUuid}.jsonl`);
      if (!dependencies.fs.existsSync(jsonlPath)) {
        continue;
      }

      const fileStat = safeStat(jsonlPath, dependencies);
      if (!fileStat) {
        continue;
      }

      const sessionIdentity = providerSessionIdentity("cursor", sessionUuid, jsonlPath);

      discovered.push({
        provider: "cursor",
        projectPath,
        projectName,
        sessionIdentity,
        sourceSessionId: sessionUuid,
        filePath: jsonlPath,
        fileSize: fileStat.size,
        fileMtimeMs: Math.trunc(fileStat.mtimeMs),
        metadata: {
          includeInHistory: true,
          isSubagent: false,
          unresolvedProject,
          gitBranch: null,
          cwd: projectPath || null,
        },
      });
    }
  }

  return discovered;
}

/**
 * Determines which provider a single file belongs to and constructs a {@link DiscoveredSessionFile}
 * using the same rules as the per-provider discover functions. Returns `null` if the file is
 * unrecognised, not statable, or is a subagent transcript.
 */
export function discoverSingleFile(
  filePath: string,
  config: DiscoveryConfig,
  dependencies: DiscoveryDependencies = {},
): DiscoveredSessionFile | null {
  if (filePath.includes("/subagents/")) {
    return null;
  }

  const resolved = resolveDiscoveryDependencies(dependencies);

  if (filePath.startsWith(config.claudeRoot + "/")) {
    return discoverSingleClaudeFile(filePath, config, resolved);
  }
  if (filePath.startsWith(config.codexRoot + "/")) {
    return discoverSingleCodexFile(filePath, resolved);
  }
  if (filePath.startsWith(config.geminiRoot + "/")) {
    return discoverSingleGeminiFile(filePath, config, resolved);
  }
  if (config.geminiHistoryRoot && filePath.startsWith(config.geminiHistoryRoot + "/")) {
    return discoverSingleGeminiFile(filePath, config, resolved);
  }
  if (filePath.startsWith(config.cursorRoot + "/")) {
    return discoverSingleCursorFile(filePath, config, resolved);
  }

  return null;
}

function discoverSingleClaudeFile(
  filePath: string,
  config: DiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  if (extname(filePath) !== ".jsonl") {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat) {
    return null;
  }

  // Extract projectId: first path segment after claudeRoot.
  const relative = filePath.slice(config.claudeRoot.length + 1);
  const segments = relative.split("/");
  if (segments.length < 2) {
    return null;
  }

  const projectId = segments[0]!;
  const projectDir = join(config.claudeRoot, projectId);
  const sessionIdentity = basename(filePath, ".jsonl");
  const sessionsIndexById = readClaudeSessionsIndex(projectDir, dependencies);
  const sessionIndexEntry = sessionsIndexById.get(sessionIdentity);
  const projectPath = sessionIndexEntry?.projectPath ?? decodeClaudeProjectId(projectId);
  const fileMeta = readClaudeJsonlMeta(filePath, dependencies);

  return {
    provider: "claude",
    projectPath,
    projectName: projectNameFromPath(projectPath),
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
    },
  };
}

function discoverSingleCodexFile(
  filePath: string,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  if (extname(filePath) !== ".jsonl") {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat) {
    return null;
  }

  const meta = readCodexJsonlMeta(filePath, dependencies);
  const sourceSessionId = meta.sessionId ?? basename(filePath, ".jsonl");
  const sessionIdentity = providerSessionIdentity("codex", sourceSessionId, filePath);
  const projectPath = meta.cwd ?? "";

  return {
    provider: "codex",
    projectPath,
    projectName: projectNameFromPath(projectPath),
    sessionIdentity,
    sourceSessionId,
    filePath,
    fileSize: fileStat.size,
    fileMtimeMs: Math.trunc(fileStat.mtimeMs),
    metadata: {
      includeInHistory: true,
      isSubagent: false,
      unresolvedProject: false,
      gitBranch: meta.gitBranch,
      cwd: meta.cwd,
    },
  };
}

function discoverSingleGeminiFile(
  filePath: string,
  config: DiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  if (extname(filePath) !== ".json") {
    return null;
  }
  if (!basename(filePath).startsWith("session-")) {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat) {
    return null;
  }

  const content = parseJsonFile<Record<string, unknown>>(filePath, dependencies);
  if (!content) {
    return null;
  }

  const sourceSessionId = readString(content.sessionId) ?? basename(filePath, ".json");
  const sessionIdentity = providerSessionIdentity("gemini", sourceSessionId, filePath);
  const projectHash = readString(content.projectHash) ?? "";
  const containerDir = geminiContainerDir(filePath);

  // Build a minimal project resolution for just this file.
  let resolvedProjectPath: string | null = null;

  // Check if we can resolve from project hash via the global resolution mechanism.
  if (projectHash) {
    const resolution = buildGeminiProjectResolution(config, dependencies);
    resolvedProjectPath = resolution.hashToPath.get(projectHash) ?? null;
  }

  // Fallback: check for .project_root in the container directory.
  if (!resolvedProjectPath) {
    const projectRootPath = join(containerDir, ".project_root");
    if (dependencies.fs.existsSync(projectRootPath)) {
      const fallbackPath = (safeReadUtf8File(projectRootPath, dependencies) ?? "").trim();
      if (fallbackPath.length > 0) {
        resolvedProjectPath = fallbackPath;
      }
    }
  }

  const projectPath = resolvedProjectPath ?? "";
  const unresolvedProject = !resolvedProjectPath;
  const fallbackProjectName = basename(containerDir);

  return {
    provider: "gemini",
    projectPath,
    projectName: unresolvedProject ? fallbackProjectName : projectNameFromPath(projectPath),
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
    },
  };
}

function discoverSingleCursorFile(
  filePath: string,
  config: DiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  if (extname(filePath) !== ".jsonl") {
    return null;
  }

  // Expected pattern: {cursorRoot}/{encodedName}/agent-transcripts/{uuid}/{uuid}.jsonl
  const relative = filePath.slice(config.cursorRoot.length + 1);
  const segments = relative.split("/");
  // segments: [encodedName, "agent-transcripts", uuid, "{uuid}.jsonl"]
  if (segments.length < 4 || segments[1] !== "agent-transcripts") {
    return null;
  }

  const encodedName = segments[0]!;
  const uuid = segments[2]!;
  const expectedFilename = `${uuid}.jsonl`;
  if (basename(filePath) !== expectedFilename) {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat) {
    return null;
  }

  const projectDir = join(config.cursorRoot, encodedName);
  const cursorProject = decodeCursorProjectPath(projectDir, encodedName, dependencies);
  const projectPath = cursorProject.projectPath;
  const unresolvedProject = cursorProject.unresolvedProject;
  const projectName = unresolvedProject ? encodedName : projectNameFromPath(projectPath);
  const sessionIdentity = providerSessionIdentity("cursor", uuid, filePath);

  return {
    provider: "cursor",
    projectPath,
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
    },
  };
}

function decodeCursorProjectPath(
  projectDir: string,
  encodedName: string,
  dependencies: ResolvedDiscoveryDependencies,
): { projectPath: string; unresolvedProject: boolean } {
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
          return { projectPath: cwd, unresolvedProject: false };
        }
      }
    }
  }

  const naive = `/${encodedName.replaceAll("-", "/")}`;
  if (safeIsDirectory(naive, dependencies)) {
    return { projectPath: naive, unresolvedProject: false };
  }

  return { projectPath: "", unresolvedProject: true };
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

function buildGeminiProjectResolution(
  config: DiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): GeminiProjectResolution {
  const hashToPath = new Map<string, string>();

  for (const rootPath of [config.geminiRoot, config.geminiHistoryRoot]) {
    if (!rootPath || !dependencies.fs.existsSync(rootPath)) {
      continue;
    }

    for (const dirEntry of safeReadDir(rootPath, dependencies)) {
      if (!dirEntry.isDirectory()) {
        continue;
      }

      const projectRootFile = join(rootPath, dirEntry.name, ".project_root");
      if (!dependencies.fs.existsSync(projectRootFile)) {
        continue;
      }

      const rootPathValue = (safeReadUtf8File(projectRootFile, dependencies) ?? "").trim();
      if (!rootPathValue) {
        continue;
      }

      hashToPath.set(sha256(rootPathValue), rootPathValue);
    }
  }

  if (config.geminiProjectsPath && dependencies.fs.existsSync(config.geminiProjectsPath)) {
    const projects = parseJsonFile<{ projects?: Record<string, string> }>(
      config.geminiProjectsPath,
      dependencies,
    );
    for (const pathValue of Object.keys(projects?.projects ?? {})) {
      hashToPath.set(sha256(pathValue), pathValue);
    }
  }

  return { hashToPath };
}

function readClaudeSessionsIndex(
  projectDir: string,
  dependencies: ResolvedDiscoveryDependencies,
): Map<string, { projectPath: string }> {
  const sessionsIndexPath = join(projectDir, "sessions-index.json");
  const parsed = parseJsonFile<{ entries?: Array<{ sessionId?: string; projectPath?: string }> }>(
    sessionsIndexPath,
    dependencies,
  );
  const byId = new Map<string, { projectPath: string }>();

  for (const entry of parsed?.entries ?? []) {
    if (!entry.sessionId || !entry.projectPath) {
      continue;
    }

    byId.set(entry.sessionId, { projectPath: entry.projectPath });
  }

  return byId;
}

function readClaudeJsonlMeta(
  filePath: string,
  dependencies: ResolvedDiscoveryDependencies,
): {
  cwd: string | null;
  gitBranch: string | null;
} {
  const firstObject = readFirstJsonlObject(filePath, dependencies);
  if (!firstObject) {
    return { cwd: null, gitBranch: null };
  }

  return {
    cwd: readString(firstObject.cwd),
    gitBranch: readString(firstObject.gitBranch),
  };
}

function readCodexJsonlMeta(
  filePath: string,
  dependencies: ResolvedDiscoveryDependencies,
): {
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
} {
  const lines = readLeadingNonEmptyLines(filePath, 120, 256 * 1024, dependencies);

  let sessionId: string | null = null;
  let cwd: string | null = null;
  let gitBranch: string | null = null;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const record = asRecord(parsed);
    if (!record) {
      continue;
    }

    if (readString(record.type) !== "session_meta") {
      continue;
    }

    const payload = asRecord(record.payload);
    const git = asRecord(payload?.git);
    sessionId = readString(payload?.id) ?? sessionId;
    cwd = readString(payload?.cwd) ?? cwd;
    gitBranch = readString(git?.branch) ?? gitBranch;

    if (sessionId && cwd) {
      break;
    }
  }

  return { sessionId, cwd, gitBranch };
}

function readFirstJsonlObject(
  filePath: string,
  dependencies: ResolvedDiscoveryDependencies,
): Record<string, unknown> | null {
  const firstLine = readLeadingNonEmptyLines(filePath, 1, 16 * 1024, dependencies)[0];
  if (!firstLine) {
    return null;
  }

  try {
    return asRecord(JSON.parse(firstLine));
  } catch {
    return null;
  }
}

function readLeadingNonEmptyLines(
  filePath: string,
  maxLines: number,
  maxBytes: number,
  dependencies: ResolvedDiscoveryDependencies,
): string[] {
  if (maxLines <= 0 || maxBytes <= 0) {
    return [];
  }

  let fd: number | null = null;
  try {
    fd = dependencies.fs.openSync(filePath, "r");
    const lines: string[] = [];
    let bytesReadTotal = 0;
    let remainder = "";
    const chunkSize = 4096;

    while (lines.length < maxLines && bytesReadTotal < maxBytes) {
      const bytesToRead = Math.min(chunkSize, maxBytes - bytesReadTotal);
      if (bytesToRead <= 0) {
        break;
      }
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const bytesRead = dependencies.fs.readSync(fd, buffer, 0, bytesToRead, null);
      if (bytesRead <= 0) {
        break;
      }
      bytesReadTotal += bytesRead;
      remainder += buffer.toString("utf8", 0, bytesRead);

      let newlineIndex = remainder.indexOf("\n");
      while (newlineIndex >= 0 && lines.length < maxLines) {
        const line = remainder.slice(0, newlineIndex).trim();
        if (line.length > 0) {
          lines.push(line);
        }
        remainder = remainder.slice(newlineIndex + 1);
        newlineIndex = remainder.indexOf("\n");
      }
    }

    if (lines.length < maxLines) {
      const tail = remainder.trim();
      if (tail.length > 0) {
        lines.push(tail);
      }
    }

    return lines.slice(0, maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      dependencies.fs.closeSync(fd);
    }
  }
}

function parseJsonFile<T>(filePath: string, dependencies: ResolvedDiscoveryDependencies): T | null {
  if (!dependencies.fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(dependencies.fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function walkFiles(root: string, dependencies: ResolvedDiscoveryDependencies): string[] {
  const files: string[] = [];
  if (!dependencies.fs.existsSync(root)) {
    return files;
  }

  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of safeReadDir(current, dependencies)) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeReadDir(path: string, dependencies: ResolvedDiscoveryDependencies): DiscoveryDirent[] {
  try {
    return dependencies.fs.readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeReadUtf8File(
  path: string,
  dependencies: ResolvedDiscoveryDependencies,
): string | null {
  try {
    return dependencies.fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function safeStat(path: string, dependencies: ResolvedDiscoveryDependencies): DiscoveryStat | null {
  try {
    return dependencies.fs.statSync(path);
  } catch {
    return null;
  }
}

function safeIsDirectory(path: string, dependencies: ResolvedDiscoveryDependencies): boolean {
  try {
    return dependencies.fs.existsSync(path) && dependencies.fs.lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function resolveDiscoveryDependencies(
  dependencies: DiscoveryDependencies = {},
): ResolvedDiscoveryDependencies {
  return {
    fs: dependencies.fs ?? NODE_DISCOVERY_FILE_SYSTEM,
  };
}

function geminiContainerDir(filePath: string): string {
  const separator = filePath.includes("\\") ? "\\" : "/";
  const hasLeadingSeparator = filePath.startsWith("/") || filePath.startsWith("\\");
  const parts = filePath.split(/[\\/]+/).filter((part) => part.length > 0);
  const sessionsIndex = parts.lastIndexOf("sessions");
  if (sessionsIndex > 0) {
    return joinPathSegments(parts.slice(0, sessionsIndex), separator, hasLeadingSeparator);
  }

  const chatsIndex = parts.lastIndexOf("chats");
  if (chatsIndex > 0) {
    return joinPathSegments(parts.slice(0, chatsIndex), separator, hasLeadingSeparator);
  }

  return joinPathSegments(
    parts.slice(0, Math.max(0, parts.length - 3)),
    separator,
    hasLeadingSeparator,
  );
}

function joinPathSegments(
  parts: string[],
  separator: "/" | "\\",
  hasLeadingSeparator: boolean,
): string {
  if (parts.length === 0) {
    return hasLeadingSeparator ? separator : "";
  }

  const joined = parts.join(separator);
  if (hasLeadingSeparator && !joined.includes(":")) {
    return `${separator}${joined}`;
  }
  return joined;
}

function decodeClaudeProjectId(projectId: string): string {
  if (!projectId) {
    return "";
  }

  return projectId.replaceAll("-", "/");
}

function projectNameFromPath(projectPath: string): string {
  if (!projectPath) {
    return "Unknown";
  }

  const name = basename(projectPath);
  return name.length > 0 ? name : "Unknown";
}

function providerSessionIdentity(
  provider: "codex" | "gemini" | "cursor",
  sourceSessionId: string,
  filePath: string,
): string {
  const suffix = createHash("sha1").update(filePath, "utf8").digest("hex").slice(0, 8);
  return `${provider}:${sourceSessionId}:${suffix}`;
}
