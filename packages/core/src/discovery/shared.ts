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
import { basename, join } from "node:path";

import type { Provider } from "../contracts/canonical";
import type { PROVIDER_METADATA, ProviderDiscoveryPathKey } from "../contracts/providerMetadata";
import { asRecord } from "../parsing/helpers";

import { isPathWithinRoot, relativePathSegments } from "../pathMatching";
import type { DiscoveryConfig, ResolvedDiscoveryConfig } from "./types";

export type DiscoveryDirent = {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
};

export type DiscoveryStat = {
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
  onDiscoveryIssue?: (issue: DiscoveryIssue) => void;
};

export type ResolvedDiscoveryDependencies = {
  fs: DiscoveryFileSystem;
  onDiscoveryIssue: (issue: DiscoveryIssue) => void;
};

export type DiscoveryIssue = {
  operation: "readdir" | "readFile" | "stat" | "lstat";
  path: string;
  error: unknown;
};

export const NODE_DISCOVERY_FILE_SYSTEM: DiscoveryFileSystem = {
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

export function resolveDiscoveryDependencies(
  dependencies: DiscoveryDependencies = {},
): ResolvedDiscoveryDependencies {
  return {
    fs: dependencies.fs ?? NODE_DISCOVERY_FILE_SYSTEM,
    onDiscoveryIssue: dependencies.onDiscoveryIssue ?? (() => {}),
  };
}

function reportDiscoveryIssue(
  dependencies: ResolvedDiscoveryDependencies,
  issue: DiscoveryIssue,
): void {
  dependencies.onDiscoveryIssue(issue);
}

export function safeReadDir(
  path: string,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveryDirent[] {
  try {
    return dependencies.fs.readdirSync(path, { withFileTypes: true });
  } catch (error) {
    reportDiscoveryIssue(dependencies, { operation: "readdir", path, error });
    return [];
  }
}

export function safeReadUtf8File(
  path: string,
  dependencies: ResolvedDiscoveryDependencies,
): string | null {
  try {
    return dependencies.fs.readFileSync(path, "utf8");
  } catch (error) {
    reportDiscoveryIssue(dependencies, { operation: "readFile", path, error });
    return null;
  }
}

export function safeStat(
  path: string,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveryStat | null {
  try {
    return dependencies.fs.statSync(path);
  } catch (error) {
    reportDiscoveryIssue(dependencies, { operation: "stat", path, error });
    return null;
  }
}

export function safeIsDirectory(
  path: string,
  dependencies: ResolvedDiscoveryDependencies,
): boolean {
  try {
    return dependencies.fs.existsSync(path) && dependencies.fs.lstatSync(path).isDirectory();
  } catch (error) {
    reportDiscoveryIssue(dependencies, { operation: "lstat", path, error });
    return false;
  }
}

export function parseJsonFile<T>(
  filePath: string,
  dependencies: ResolvedDiscoveryDependencies,
): T | null {
  if (!dependencies.fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(dependencies.fs.readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    reportDiscoveryIssue(dependencies, { operation: "readFile", path: filePath, error });
    return null;
  }
}

export function walkFiles(root: string, dependencies: ResolvedDiscoveryDependencies): string[] {
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

export function readFirstJsonlObject(
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

export function readLeadingNonEmptyLines(
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
    const buffer = Buffer.allocUnsafe(chunkSize);

    while (lines.length < maxLines && bytesReadTotal < maxBytes) {
      const bytesToRead = Math.min(chunkSize, maxBytes - bytesReadTotal);
      if (bytesToRead <= 0) {
        break;
      }
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
  } catch (error) {
    reportDiscoveryIssue(dependencies, { operation: "readFile", path: filePath, error });
    return [];
  } finally {
    if (fd !== null) {
      dependencies.fs.closeSync(fd);
    }
  }
}

export function projectNameFromPath(projectPath: string): string {
  if (!projectPath) {
    return "Unknown";
  }

  const name = basename(projectPath);
  return name.length > 0 ? name : "Unknown";
}

export function providerSessionIdentity(
  provider: Exclude<Provider, "claude">,
  sourceSessionId: string,
  filePath: string,
): string {
  const suffix = createHash("sha1").update(filePath, "utf8").digest("hex").slice(0, 8);
  return `${provider}:${sourceSessionId}:${suffix}`;
}

export function isUnderRoot(filePath: string, root: string): boolean {
  return root.length > 0 && isPathWithinRoot(filePath, root);
}

export function relativeSegments(filePath: string, root: string): string[] {
  return relativePathSegments(filePath, root);
}

export function decodeFileUrlPath(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") {
      return value;
    }

    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }
    if (url.host) {
      return `//${url.host}${pathname}`;
    }
    return pathname;
  } catch {
    return value;
  }
}

export function getDiscoveryPath(
  config: ResolvedDiscoveryConfig,
  provider: Provider,
  key: ProviderDiscoveryPathKey,
): string | null;
export function getDiscoveryPath<P extends Provider>(
  config: ResolvedDiscoveryConfig,
  provider: P,
  key: (typeof PROVIDER_METADATA)[P]["discoveryPaths"][number]["key"],
): string | null {
  return config.providers[provider].paths[key] ?? null;
}

export function getConfigDiscoveryPath(
  config: Pick<DiscoveryConfig, "providerPaths"> &
    Partial<Record<ProviderDiscoveryPathKey, string>>,
  key: ProviderDiscoveryPathKey,
): string | null {
  const nested = config.providerPaths?.[key];
  if (typeof nested === "string" && nested.length > 0) {
    return nested;
  }
  const legacy = config[key];
  return typeof legacy === "string" && legacy.length > 0 ? legacy : null;
}
