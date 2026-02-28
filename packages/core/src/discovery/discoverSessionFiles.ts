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

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  claudeRoot: join(homedir(), ".claude", "projects"),
  codexRoot: join(homedir(), ".codex", "sessions"),
  geminiRoot: join(homedir(), ".gemini", "tmp"),
  geminiHistoryRoot: join(homedir(), ".gemini", "history"),
  geminiProjectsPath: join(homedir(), ".gemini", "projects.json"),
  includeClaudeSubagents: false,
};

export function discoverSessionFiles(
  config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG,
): DiscoveredSessionFile[] {
  const geminiResolution = buildGeminiProjectResolution(config);

  return [
    ...discoverClaudeFiles(config),
    ...discoverCodexFiles(config),
    ...discoverGeminiFiles(config, geminiResolution),
  ].sort((left, right) => {
    const byMtime = right.fileMtimeMs - left.fileMtimeMs;
    if (byMtime !== 0) {
      return byMtime;
    }

    return left.filePath.localeCompare(right.filePath);
  });
}

function discoverClaudeFiles(config: DiscoveryConfig): DiscoveredSessionFile[] {
  if (!existsSync(config.claudeRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];

  for (const projectEntry of readdirSync(config.claudeRoot, { withFileTypes: true })) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectDir = join(config.claudeRoot, projectEntry.name);
    const sessionsIndexById = readClaudeSessionsIndex(projectDir);

    for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
      if (!entry.isFile() || extname(entry.name) !== ".jsonl") {
        continue;
      }

      const filePath = join(projectDir, entry.name);
      const sessionIdentity = entry.name.slice(0, -".jsonl".length);
      const fileStat = statSync(filePath);
      const fileMeta = readClaudeJsonlMeta(filePath);
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

    for (const sessionDir of readdirSync(projectDir, { withFileTypes: true })) {
      if (!sessionDir.isDirectory()) {
        continue;
      }

      const subagentsDir = join(projectDir, sessionDir.name, "subagents");
      if (!existsSync(subagentsDir) || !lstatSync(subagentsDir).isDirectory()) {
        continue;
      }

      for (const fileEntry of readdirSync(subagentsDir, { withFileTypes: true })) {
        if (!fileEntry.isFile() || extname(fileEntry.name) !== ".jsonl") {
          continue;
        }

        const filePath = join(subagentsDir, fileEntry.name);
        const fileStat = statSync(filePath);
        const fileMeta = readClaudeJsonlMeta(filePath);
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

function discoverCodexFiles(config: DiscoveryConfig): DiscoveredSessionFile[] {
  if (!existsSync(config.codexRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];
  const files = walkFiles(config.codexRoot);

  for (const filePath of files) {
    if (extname(filePath) !== ".jsonl") {
      continue;
    }

    const fileStat = statSync(filePath);
    const meta = readCodexJsonlMeta(filePath);
    const sourceSessionId = meta.sessionId ?? basename(filePath, ".jsonl");
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
): DiscoveredSessionFile[] {
  if (!existsSync(config.geminiRoot)) {
    return [];
  }

  const discovered: DiscoveredSessionFile[] = [];
  const files = walkFiles(config.geminiRoot);

  for (const filePath of files) {
    if (extname(filePath) !== ".json") {
      continue;
    }

    if (!basename(filePath).startsWith("session-")) {
      continue;
    }

    const fileStat = statSync(filePath);
    const content = parseJsonFile<Record<string, unknown>>(filePath);
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
      if (existsSync(projectRootPath)) {
        const fallbackPath = readFileSync(projectRootPath, "utf8").trim();
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

function buildGeminiProjectResolution(config: DiscoveryConfig): GeminiProjectResolution {
  const hashToPath = new Map<string, string>();

  for (const rootPath of [config.geminiRoot, config.geminiHistoryRoot]) {
    if (!rootPath || !existsSync(rootPath)) {
      continue;
    }

    for (const dirEntry of readdirSync(rootPath, { withFileTypes: true })) {
      if (!dirEntry.isDirectory()) {
        continue;
      }

      const projectRootFile = join(rootPath, dirEntry.name, ".project_root");
      if (!existsSync(projectRootFile)) {
        continue;
      }

      const rootPathValue = readFileSync(projectRootFile, "utf8").trim();
      if (!rootPathValue) {
        continue;
      }

      hashToPath.set(sha256(rootPathValue), rootPathValue);
    }
  }

  if (config.geminiProjectsPath && existsSync(config.geminiProjectsPath)) {
    const projects = parseJsonFile<{ projects?: Record<string, string> }>(
      config.geminiProjectsPath,
    );
    for (const pathValue of Object.keys(projects?.projects ?? {})) {
      hashToPath.set(sha256(pathValue), pathValue);
    }
  }

  return { hashToPath };
}

function readClaudeSessionsIndex(projectDir: string): Map<string, { projectPath: string }> {
  const sessionsIndexPath = join(projectDir, "sessions-index.json");
  const parsed = parseJsonFile<{ entries?: Array<{ sessionId?: string; projectPath?: string }> }>(
    sessionsIndexPath,
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

function readClaudeJsonlMeta(filePath: string): {
  cwd: string | null;
  gitBranch: string | null;
} {
  const firstObject = readFirstJsonlObject(filePath);
  if (!firstObject) {
    return { cwd: null, gitBranch: null };
  }

  return {
    cwd: readString(firstObject.cwd),
    gitBranch: readString(firstObject.gitBranch),
  };
}

function readCodexJsonlMeta(filePath: string): {
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
} {
  const lines = readLeadingNonEmptyLines(filePath, 120, 256 * 1024);

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

function readFirstJsonlObject(filePath: string): Record<string, unknown> | null {
  const firstLine = readLeadingNonEmptyLines(filePath, 1, 16 * 1024)[0];
  if (!firstLine) {
    return null;
  }

  try {
    return asRecord(JSON.parse(firstLine));
  } catch {
    return null;
  }
}

function readLeadingNonEmptyLines(filePath: string, maxLines: number, maxBytes: number): string[] {
  if (maxLines <= 0 || maxBytes <= 0) {
    return [];
  }

  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
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
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, null);
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
      closeSync(fd);
    }
  }
}

function parseJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) {
    return files;
  }

  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
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

function geminiContainerDir(filePath: string): string {
  const parts = filePath.split("/");
  const sessionsIndex = parts.lastIndexOf("sessions");
  if (sessionsIndex > 0) {
    return parts.slice(0, sessionsIndex).join("/") || "/";
  }

  const chatsIndex = parts.lastIndexOf("chats");
  if (chatsIndex > 0) {
    return parts.slice(0, chatsIndex).join("/") || "/";
  }

  return dirname(dirname(dirname(filePath)));
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
  provider: "codex" | "gemini",
  sourceSessionId: string,
  filePath: string,
): string {
  const suffix = createHash("sha1").update(filePath, "utf8").digest("hex").slice(0, 8);
  return `${provider}:${sourceSessionId}:${suffix}`;
}
