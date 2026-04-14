import { basename, dirname, join } from "node:path";

import { compactMetadata } from "../../metadata";

import { readString } from "../../parsing/helpers";
import {
  type ResolvedDiscoveryDependencies,
  getDiscoveryPath,
  isUnderRoot,
  projectNameFromPath,
  providerSessionIdentity,
  readFirstJsonlObject,
  safeReadDir,
  safeReadUtf8File,
  safeStat,
} from "../shared";
import type { DiscoveredSessionFile, ResolvedDiscoveryConfig } from "../types";

export type CopilotCliWorkspaceMeta = {
  id: string | null;
  cwd: string | null;
  repository: string | null;
  branch: string | null;
  summary: string | null;
};

export function parseWorkspaceYaml(content: string): CopilotCliWorkspaceMeta {
  const meta: CopilotCliWorkspaceMeta = {
    id: null,
    cwd: null,
    repository: null,
    branch: null,
    summary: null,
  };

  for (const line of content.split(/\r?\n/)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex < 0) {
      continue;
    }
    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();
    if (!rawValue) {
      continue;
    }
    // Strip matching surrounding quotes (YAML serializers may quote values
    // containing colons, backslashes, or other special characters).
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    if (!value) {
      continue;
    }

    switch (key) {
      case "id":
        meta.id = value;
        break;
      case "cwd":
        meta.cwd = value;
        break;
      case "repository":
        meta.repository = value;
        break;
      case "branch":
        meta.branch = value;
        break;
      case "summary":
        meta.summary = value;
        break;
    }
  }

  return meta;
}

function readCopilotCliMeta(
  sessionDir: string,
  dependencies: ResolvedDiscoveryDependencies,
): CopilotCliWorkspaceMeta {
  const yamlPath = join(sessionDir, "workspace.yaml");
  const content = safeReadUtf8File(yamlPath, dependencies);
  if (content) {
    return parseWorkspaceYaml(content);
  }

  // Fallback: parse session.start event from events.jsonl first line (reads ≤16 KB)
  const eventsPath = join(sessionDir, "events.jsonl");
  const firstObj = readFirstJsonlObject(eventsPath, dependencies);
  if (!firstObj) {
    return { id: null, cwd: null, repository: null, branch: null, summary: null };
  }

  if (firstObj.type === "session.start" && firstObj.data) {
    const data = firstObj.data as Record<string, unknown>;
    const ctx = (data.context ?? {}) as Record<string, unknown>;
    return {
      id: readString(data.sessionId),
      cwd: readString(ctx.cwd),
      repository: readString(ctx.repository),
      branch: readString(ctx.branch),
      summary: null,
    };
  }

  return { id: null, cwd: null, repository: null, branch: null, summary: null };
}

function toDiscoveredCopilotCliFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  const copilotCliRoot = getDiscoveryPath(config, "copilot_cli", "copilotCliRoot");
  if (!copilotCliRoot || !isUnderRoot(filePath, copilotCliRoot)) {
    return null;
  }

  if (basename(filePath) !== "events.jsonl") {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat || fileStat.size === 0) {
    return null;
  }

  const sessionDir = dirname(filePath);
  const dirName = basename(sessionDir);
  const meta = readCopilotCliMeta(sessionDir, dependencies);
  const sourceSessionId = meta.id ?? dirName;
  const sessionIdentity = providerSessionIdentity("copilot_cli", sourceSessionId, filePath);
  const projectPath = meta.cwd ?? "";
  const unresolvedProject = !projectPath;
  const resolutionSource = projectPath ? "cwd" : "unresolved";

  return {
    provider: "copilot_cli",
    projectPath,
    canonicalProjectPath: projectPath,
    projectName: projectNameFromPath(projectPath),
    sessionIdentity,
    sourceSessionId,
    filePath,
    fileSize: fileStat.size,
    fileMtimeMs: Math.trunc(fileStat.mtimeMs),
    metadata: {
      includeInHistory: true,
      isSubagent: false,
      unresolvedProject,
      gitBranch: meta.branch,
      cwd: meta.cwd,
      worktreeLabel: null,
      worktreeSource: null,
      repositoryUrl: null,
      forkedFromSessionId: null,
      parentSessionCwd: null,
      providerProjectKey: null,
      providerSessionId: sourceSessionId,
      sessionKind: "regular",
      gitCommitHash: null,
      providerClient: "copilot-cli",
      providerSource: null,
      providerClientVersion: null,
      lineageParentId: null,
      resolutionSource,
      projectMetadata: null,
      sessionMetadata: compactMetadata({ summary: meta.summary, repository: meta.repository }),
    },
  };
}

export function discoverCopilotCliFiles(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const copilotCliRoot = getDiscoveryPath(config, "copilot_cli", "copilotCliRoot");
  if (!copilotCliRoot || !dependencies.fs.existsSync(copilotCliRoot)) {
    return [];
  }

  const results: DiscoveredSessionFile[] = [];
  for (const entry of safeReadDir(copilotCliRoot, dependencies)) {
    if (!entry.isDirectory()) {
      continue;
    }
    const eventsPath = join(copilotCliRoot, entry.name, "events.jsonl");
    const discovered = toDiscoveredCopilotCliFile(eventsPath, config, dependencies);
    if (discovered) {
      results.push(discovered);
    }
  }

  return results;
}

export function discoverSingleCopilotCliFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  return toDiscoveredCopilotCliFile(filePath, config, dependencies);
}
