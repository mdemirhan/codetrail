import { basename, dirname, join } from "node:path";

import { asArray, asRecord, readString } from "../../parsing/helpers";
import type { ResolvedDiscoveryDependencies } from "../shared";
import { readLeadingNonEmptyLines } from "../shared";
import { inferGitCanonicalProjectPath, matchCodexManagedWorktree } from "./worktreeHelpers";

const MAX_CODEX_SESSION_INDEX_BYTES = 16 * 1024 * 1024;

type CodexThreadNameIndexCacheEntry = {
  size: number;
  mtimeMs: number;
  namesBySessionId: Map<string, string>;
};

const codexThreadNameIndexCache = new WeakMap<
  ResolvedDiscoveryDependencies["fs"],
  Map<string, CodexThreadNameIndexCacheEntry | null>
>();

export function readCodexJsonlMeta(
  filePath: string,
  dependencies: ResolvedDiscoveryDependencies,
): {
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
  gitCommitHash: string | null;
  repositoryUrl: string | null;
  forkedFromSessionId: string | null;
  parentSessionCwd: string | null;
  canonicalProjectPath: string | null;
  worktreeLabel: string | null;
  worktreeSource: "codex_fork" | "git_live" | null;
  originator: string | null;
  source: string | null;
  cliVersion: string | null;
  modelProvider: string | null;
  dynamicToolsCount: number;
  threadName: string | null;
  resolutionSource: string;
} {
  const lines = readLeadingNonEmptyLines(filePath, 160, 512 * 1024, dependencies);

  let sessionId: string | null = null;
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let gitCommitHash: string | null = null;
  let repositoryUrl: string | null = null;
  let forkedFromSessionId: string | null = null;
  let parentSessionCwd: string | null = null;
  let originator: string | null = null;
  let source: string | null = null;
  let cliVersion: string | null = null;
  let modelProvider: string | null = null;
  let dynamicToolsCount = 0;

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

    const recordType = readString(record.type);
    const payload = asRecord(record.payload);
    const git = asRecord(payload?.git);

    if (recordType === "session_meta") {
      sessionId = readString(payload?.id) ?? sessionId;
      cwd = readString(payload?.cwd) ?? cwd;
      forkedFromSessionId = readString(payload?.forked_from_id) ?? forkedFromSessionId;
      repositoryUrl = readString(git?.repository_url) ?? repositoryUrl;
      gitBranch = readString(git?.branch) ?? gitBranch;
      gitCommitHash = readString(git?.commit_hash) ?? gitCommitHash;
      originator = readString(payload?.originator) ?? originator;
      source = readString(payload?.source) ?? source;
      cliVersion = readString(payload?.cli_version) ?? cliVersion;
      modelProvider = readString(payload?.model_provider) ?? modelProvider;
      if (Array.isArray(payload?.dynamic_tools)) {
        dynamicToolsCount = Math.max(dynamicToolsCount, payload.dynamic_tools.length);
      }
    }

    if (recordType === "turn_context") {
      const turnContextCwd = readString(payload?.cwd);
      if (isCandidateParentCwd(turnContextCwd, cwd)) {
        parentSessionCwd ??= turnContextCwd;
      }
      cwd ??= turnContextCwd;
      repositoryUrl = readString(git?.repository_url) ?? repositoryUrl;
      gitBranch = readString(git?.branch) ?? gitBranch;
      gitCommitHash = readString(git?.commit_hash) ?? gitCommitHash;
    }

    if (recordType === "response_item") {
      const responsePayload = asRecord(record.payload);
      if (readString(responsePayload?.type) === "function_call") {
        const argumentsText = readString(responsePayload?.arguments);
        const functionArguments = parseFunctionCallArguments(argumentsText);
        const workdir = readString(functionArguments?.workdir);
        if (isCandidateParentCwd(workdir, cwd)) {
          parentSessionCwd ??= workdir;
        }
      }
    }

    const items = asArray(payload?.items);
    for (const item of items) {
      const itemRecord = asRecord(item);
      const text = readString(itemRecord?.text);
      if (!text) {
        continue;
      }
      const embeddedCwd = extractEmbeddedCwd(text);
      if (isCandidateParentCwd(embeddedCwd, cwd)) {
        parentSessionCwd ??= embeddedCwd;
      }
    }

    if (sessionId && cwd && parentSessionCwd && repositoryUrl && gitBranch) {
      break;
    }
  }

  const liveGit = inferGitCanonicalProjectPath(cwd, dependencies);
  const codexManagedWorktree = matchCodexManagedWorktree(cwd);
  const worktreeLabel = codexManagedWorktree?.slot ?? null;
  const threadName = readCodexThreadName(filePath, sessionId, dependencies);
  if (parentSessionCwd) {
    return {
      sessionId,
      cwd,
      gitBranch,
      gitCommitHash,
      repositoryUrl,
      forkedFromSessionId,
      parentSessionCwd,
      canonicalProjectPath: parentSessionCwd,
      worktreeLabel,
      worktreeSource: worktreeLabel ? "codex_fork" : null,
      originator,
      source,
      cliVersion,
      modelProvider,
      dynamicToolsCount,
      threadName,
      resolutionSource: worktreeLabel ? "codex_fork" : "cwd",
    };
  }

  return {
    sessionId,
    cwd,
    gitBranch,
    gitCommitHash,
    repositoryUrl,
    forkedFromSessionId,
    parentSessionCwd,
    canonicalProjectPath: liveGit?.canonicalProjectPath ?? null,
    worktreeLabel,
    worktreeSource: worktreeLabel && liveGit ? "git_live" : null,
    originator,
    source,
    cliVersion,
    modelProvider,
    dynamicToolsCount,
    threadName,
    resolutionSource: worktreeLabel && liveGit ? "git_live" : "cwd",
  };
}

function readCodexThreadName(
  filePath: string,
  sessionId: string | null,
  dependencies: ResolvedDiscoveryDependencies,
): string | null {
  if (!sessionId) {
    return null;
  }

  const codexHome = findCodexHomeForSessionFile(filePath);
  if (!codexHome) {
    return null;
  }

  const sessionIndexPath = join(codexHome, "session_index.jsonl");
  const index = readCodexThreadNameIndex(sessionIndexPath, dependencies);
  return index?.get(sessionId) ?? null;
}

function readCodexThreadNameIndex(
  sessionIndexPath: string,
  dependencies: ResolvedDiscoveryDependencies,
): Map<string, string> | null {
  let cacheByPath = codexThreadNameIndexCache.get(dependencies.fs);
  if (!cacheByPath) {
    cacheByPath = new Map();
    codexThreadNameIndexCache.set(dependencies.fs, cacheByPath);
  }

  let stat: { size: number; mtimeMs: number };
  try {
    stat = dependencies.fs.statSync(sessionIndexPath);
  } catch {
    cacheByPath.set(sessionIndexPath, null);
    return null;
  }
  if (stat.size > MAX_CODEX_SESSION_INDEX_BYTES) {
    cacheByPath.set(sessionIndexPath, null);
    return null;
  }

  const cached = cacheByPath.get(sessionIndexPath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.namesBySessionId;
  }

  let content: string;
  try {
    content = dependencies.fs.readFileSync(sessionIndexPath, "utf8");
  } catch {
    cacheByPath.set(sessionIndexPath, null);
    return null;
  }

  const entriesBySessionId = new Map<string, { name: string; updatedAt: string }>();
  for (const line of content.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    const sessionId = readString(record?.id);
    if (!sessionId) {
      continue;
    }
    const threadName = readString(record?.thread_name);
    if (!threadName) {
      continue;
    }
    const updatedAt = readString(record?.updated_at) ?? "";
    const existing = entriesBySessionId.get(sessionId);
    if (!existing || updatedAt >= existing.updatedAt) {
      entriesBySessionId.set(sessionId, { name: threadName, updatedAt });
    }
  }

  const namesBySessionId = new Map(
    [...entriesBySessionId.entries()].map(([id, entry]) => [id, entry.name]),
  );
  cacheByPath.set(sessionIndexPath, {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    namesBySessionId,
  });
  return namesBySessionId;
}

function findCodexHomeForSessionFile(filePath: string): string | null {
  let current = dirname(filePath);
  for (let depth = 0; depth < 8; depth += 1) {
    if (basename(current) === "sessions") {
      return dirname(current);
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

function parseFunctionCallArguments(argumentsText: string | null): Record<string, unknown> | null {
  if (!argumentsText) {
    return null;
  }
  try {
    return asRecord(JSON.parse(argumentsText));
  } catch {
    return null;
  }
}

function extractEmbeddedCwd(value: string): string | null {
  const cwdMatch = value.match(/\bcwd\b["\s:=]+([^\s"'}\],]+)/i);
  return cwdMatch?.[1] ?? null;
}

function isCandidateParentCwd(candidate: string | null, currentCwd: string | null): boolean {
  if (!candidate || candidate === currentCwd) {
    return false;
  }
  if (!candidate.startsWith("/")) {
    return false;
  }
  return matchCodexManagedWorktree(candidate) === null;
}
