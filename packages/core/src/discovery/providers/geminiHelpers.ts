import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  type ResolvedDiscoveryDependencies,
  getDiscoveryPath,
  parseJsonFile,
  safeReadDir,
  safeReadUtf8File,
} from "../shared";
import type { GeminiProjectResolution, ResolvedDiscoveryConfig } from "../types";

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

const geminiProjectResolutionCache = new WeakMap<
  ResolvedDiscoveryDependencies["fs"],
  Map<string, GeminiProjectResolution>
>();

function trimTrailingSeparators(path: string): string {
  if (/^[A-Za-z]:[\\/]?$/.test(path) || /^[\\/]+$/.test(path)) {
    return path;
  }
  return path.replace(/[\\/]+$/, "");
}

function projectHashCandidates(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) {
    return [];
  }

  const withoutTrailingSeparators = trimTrailingSeparators(trimmed);
  const slashNormalized = withoutTrailingSeparators.replace(/\\/g, "/");
  const candidates = new Set([trimmed, withoutTrailingSeparators, slashNormalized]);

  if (/^[A-Za-z]:\//.test(slashNormalized)) {
    candidates.add(`${slashNormalized[0]?.toLowerCase() ?? ""}${slashNormalized.slice(1)}`);
    candidates.add(slashNormalized.toLowerCase());
  }

  return [...candidates].filter((candidate) => candidate.length > 0);
}

function rememberProjectHashMappings(hashToPath: Map<string, string>, projectPath: string): void {
  for (const candidate of projectHashCandidates(projectPath)) {
    hashToPath.set(sha256(candidate), projectPath);
  }
}

export function buildGeminiProjectResolution(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): GeminiProjectResolution {
  const hashToPath = new Map<string, string>();

  for (const rootPath of [
    getDiscoveryPath(config, "gemini", "geminiRoot"),
    getDiscoveryPath(config, "gemini", "geminiHistoryRoot"),
  ]) {
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

      rememberProjectHashMappings(hashToPath, rootPathValue);
    }
  }

  const geminiProjectsPath = getDiscoveryPath(config, "gemini", "geminiProjectsPath");
  if (geminiProjectsPath && dependencies.fs.existsSync(geminiProjectsPath)) {
    const projects = parseJsonFile<{ projects?: Record<string, unknown> }>(
      geminiProjectsPath,
      dependencies,
    );
    for (const pathValue of Object.keys(projects?.projects ?? {})) {
      rememberProjectHashMappings(hashToPath, pathValue);
    }
  }

  return {
    resolveProjectPath: (projectHash) => hashToPath.get(projectHash) ?? null,
    rememberProjectPath: (projectHash, projectPath) => {
      if (projectHash) {
        hashToPath.set(projectHash, projectPath);
      }
    },
  };
}

export function getCachedGeminiProjectResolution(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): GeminiProjectResolution {
  return getGeminiProjectResolution(config, dependencies, false);
}

export function hasCachedGeminiProjectResolution(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): boolean {
  const byConfig = geminiProjectResolutionCache.get(dependencies.fs);
  if (!byConfig) {
    return false;
  }

  return byConfig.has(
    JSON.stringify({
      geminiRoot: getDiscoveryPath(config, "gemini", "geminiRoot") ?? "",
      geminiHistoryRoot: getDiscoveryPath(config, "gemini", "geminiHistoryRoot") ?? "",
      geminiProjectsPath: getDiscoveryPath(config, "gemini", "geminiProjectsPath") ?? "",
    }),
  );
}

export function refreshCachedGeminiProjectResolution(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): GeminiProjectResolution {
  return getGeminiProjectResolution(config, dependencies, true);
}

function getGeminiProjectResolution(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
  forceRefresh: boolean,
): GeminiProjectResolution {
  const cacheKey = JSON.stringify({
    geminiRoot: getDiscoveryPath(config, "gemini", "geminiRoot") ?? "",
    geminiHistoryRoot: getDiscoveryPath(config, "gemini", "geminiHistoryRoot") ?? "",
    geminiProjectsPath: getDiscoveryPath(config, "gemini", "geminiProjectsPath") ?? "",
  });
  let byConfig = geminiProjectResolutionCache.get(dependencies.fs);
  if (!byConfig) {
    byConfig = new Map<string, GeminiProjectResolution>();
    geminiProjectResolutionCache.set(dependencies.fs, byConfig);
  }

  const cached = byConfig.get(cacheKey);
  if (cached && !forceRefresh) {
    return cached;
  }

  const resolution = buildGeminiProjectResolution(config, dependencies);
  byConfig.set(cacheKey, resolution);
  return resolution;
}

export function geminiContainerDir(filePath: string): string {
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

  const fallbackEndExclusive =
    parts.length <= 3 ? Math.max(0, parts.length - 1) : Math.max(0, parts.length - 3);
  return joinPathSegments(parts.slice(0, fallbackEndExclusive), separator, hasLeadingSeparator);
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
