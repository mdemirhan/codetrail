import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { DiscoveryConfig, IpcResponse } from "@codetrail/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueryService } from "./data/queryService";
import type {
  FileWatcherBatch,
  FileWatcherOptions,
  FileWatcherService,
} from "./fileWatcherService";
import { LiveSessionStore } from "./liveSessionStore";

function makeConfig(dir: string): DiscoveryConfig {
  return {
    claudeRoot: join(dir, ".claude", "projects"),
    codexRoot: join(dir, ".codex", "sessions"),
    geminiRoot: join(dir, ".gemini", "tmp"),
    geminiHistoryRoot: join(dir, ".gemini", "history"),
    geminiProjectsPath: join(dir, ".gemini", "projects.json"),
    cursorRoot: join(dir, ".cursor", "projects"),
    copilotRoot: join(dir, "copilot-workspace"),
    copilotCliRoot: join(dir, ".copilot", "session-state"),
    opencodeRoot: join(dir, ".local", "share", "opencode"),
    includeClaudeSubagents: false,
    enabledProviders: ["claude", "codex"],
  };
}

function createCodexTranscript(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify({
      type: "session_meta",
      payload: { id: "codex-session", cwd: "/workspace/codetrail" },
    })}\n`,
    "utf8",
  );
}

function createClaudeTranscript(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify({
      sessionId: "claude-session",
      cwd: "/workspace/codetrail",
      type: "user",
      message: { content: [{ type: "text", text: "Start" }] },
    })}\n`,
    "utf8",
  );
}

function writeClaudeHookSettings(settingsPath: string): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(
    settingsPath,
    JSON.stringify({
      hooks: Object.fromEntries(
        [
          "Notification",
          "SessionStart",
          "UserPromptSubmit",
          "PreToolUse",
          "PostToolUse",
          "Stop",
          "SessionEnd",
        ].map((eventName) => [
          eventName,
          [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    'CODETRAIL_CLAUDE_HOOK=1 /bin/sh -lc \'mkdir -p "$1" && cat >> "$2" && printf "\\n" >> "$2"\'',
                  async: true,
                },
              ],
            },
          ],
        ]),
      ),
    }),
    "utf8",
  );
}

function makeBatch(path: string): FileWatcherBatch {
  return {
    changedPaths: [path],
    requiresFullScan: false,
  };
}

function makeRecentLiveCandidate(
  filePath: string,
  provider: "claude" | "codex",
  fileMtimeMs: number,
  fileSize = statSync(filePath).size,
): {
  filePath: string;
  provider: "claude" | "codex";
  fileMtimeMs: number;
  fileSize: number;
} {
  return {
    filePath,
    provider,
    fileMtimeMs,
    fileSize,
  };
}

type WatcherRecord = {
  roots: string[];
  callback: (batch: FileWatcherBatch) => void | Promise<void>;
  options: FileWatcherOptions | undefined;
  watcher: Pick<FileWatcherService, "start" | "stop">;
};

function createWatcherFactory() {
  const records: WatcherRecord[] = [];
  const createFileWatcher = vi.fn(
    (
      roots: string[],
      callback: (batch: FileWatcherBatch) => void | Promise<void>,
      options?: FileWatcherOptions,
    ) => {
      const watcher = {
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      } satisfies Pick<FileWatcherService, "start" | "stop">;
      records.push({ roots, callback, options, watcher });
      return watcher as unknown as FileWatcherService;
    },
  );
  return { createFileWatcher, records };
}

function getSingleSession(
  store: LiveSessionStore,
): IpcResponse<"watcher:getLiveStatus">["sessions"][number] {
  const session = store.snapshot().sessions[0];
  if (!session) {
    throw new Error("Expected a live session");
  }
  return session;
}

async function repairRecentSessions(store: LiveSessionStore, minFileMtimeMs = 0) {
  return store.repairRecentSessionsAfterIndexing({ minFileMtimeMs });
}

describe("LiveSessionStore", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tails Codex files incrementally, including partial appended lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-03-24T09:00:30.000Z"),
    });

    await store.start({ discoveryConfig: config });

    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", title: "Live status" },
      })}\n`,
      "utf8",
    );
    await store.handleWatcherBatch(makeBatch(filePath));
    expect(getSingleSession(store).statusKind).toBe("working");

    appendFileSync(
      filePath,
      JSON.stringify({
        timestamp: "2026-03-24T09:00:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: { cmd: "bun run typec" },
        },
      }).slice(0, -4),
      "utf8",
    );
    await store.handleWatcherBatch(makeBatch(filePath));
    expect(getSingleSession(store).statusKind).toBe("working");

    appendFileSync(filePath, `heck" } } }\n`, "utf8");
    await store.handleWatcherBatch(makeBatch(filePath));

    const session = getSingleSession(store);
    expect(session.statusKind).toBe("running_tool");
    expect(session.detailText).toBe("bun run typecheck");
  });

  it("writes live instrumentation records for transcript lines and snapshots", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-trace-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      instrumentationEnabled: true,
    });

    await store.start({ discoveryConfig: config });

    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: { cmd: "bun run typecheck" },
        },
      })}\n`,
      "utf8",
    );

    await store.handleWatcherBatch(makeBatch(filePath));
    store.snapshot();

    const traceLogPath = join(dir, "user-data", "live-status", "live-trace.jsonl");
    const traceLines = readFileSync(traceLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(traceLines.some((line) => line.kind === "cursor_created")).toBe(true);
    expect(
      traceLines.some(
        (line) =>
          line.kind === "line_applied" &&
          line.source === "codex_transcript" &&
          (line.after as { statusKind?: string } | undefined)?.statusKind === "running_tool",
      ),
    ).toBe(true);
    expect(traceLines.some((line) => line.kind === "live_snapshot")).toBe(true);
  });

  it("does not write live instrumentation records when instrumentation is disabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-no-trace-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      instrumentationEnabled: false,
    });

    await store.start({ discoveryConfig: config });

    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: { cmd: "bun run typecheck" },
        },
      })}\n`,
      "utf8",
    );

    await store.handleWatcherBatch(makeBatch(filePath));
    store.snapshot();

    const traceLogPath = join(dir, "user-data", "live-status", "live-trace.jsonl");
    expect(() => readFileSync(traceLogPath, "utf8")).toThrowError(/ENOENT/);
    expect(store.snapshot().instrumentationEnabled).toBe(false);
  });

  it("drains prefetched indexing chunks destructively", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-prefetch-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
    });

    await store.start({ discoveryConfig: config });

    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", title: "Live status" },
      })}\n`,
      "utf8",
    );
    await store.handleWatcherBatch(makeBatch(filePath));

    const firstTake = store.takeIndexingPrefetchedJsonlChunks([filePath]);
    expect(firstTake).toHaveLength(1);
    expect(Buffer.from(firstTake[0]?.bytes ?? []).toString("utf8")).toContain('"task_started"');

    const secondTake = store.takeIndexingPrefetchedJsonlChunks([filePath]);
    expect(secondTake).toEqual([]);
  });

  it("resets on truncation and marks the session best-effort", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-truncate-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-03-24T09:00:30.000Z"),
    });

    await store.start({ discoveryConfig: config });

    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started" },
      })}\n`,
      "utf8",
    );
    await store.handleWatcherBatch(makeBatch(filePath));
    expect(getSingleSession(store).bestEffort).toBe(false);

    truncateSync(filePath, 0);
    writeFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:10.000Z",
        type: "event_msg",
        payload: { type: "task_complete" },
      })}\n`,
      "utf8",
    );
    await store.handleWatcherBatch(makeBatch(filePath));

    const session = getSingleSession(store);
    expect(session.statusKind).toBe("idle");
    expect(session.bestEffort).toBe(true);
  });

  it("seeds recent sessions from indexed files on start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-seed-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);
    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Seeded activity" },
      })}\n`,
      "utf8",
    );

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => [
          makeRecentLiveCandidate(filePath, "codex", Date.parse("2026-03-24T09:00:00.000Z")),
        ]),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-03-24T09:00:30.000Z"),
    });

    await store.start({ discoveryConfig: config });

    expect(getSingleSession(store).statusKind).toBe("working");
    expect(getSingleSession(store).detailText).toBe("Seeded activity");
  });

  it("only seeds startup transcripts for enabled providers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-provider-seed-"));
    tempDirs.push(dir);
    const config = {
      ...makeConfig(dir),
      enabledProviders: ["claude"] satisfies DiscoveryConfig["enabledProviders"],
    };
    const codexPath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    const claudePath = join(config.claudeRoot, "project-a", "claude-session.jsonl");
    createCodexTranscript(codexPath);
    createClaudeTranscript(claudePath);
    appendFileSync(
      codexPath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Codex seed" },
      })}\n`,
      "utf8",
    );
    appendFileSync(
      claudePath,
      `${JSON.stringify({
        parentUuid: "assistant-1",
        sessionId: "claude-session",
        cwd: "/workspace/codetrail",
        type: "assistant",
        message: { content: [{ type: "text", text: "Claude seed" }] },
      })}\n`,
      "utf8",
    );

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => [
          makeRecentLiveCandidate(codexPath, "codex", Date.parse("2026-03-24T09:00:00.000Z")),
          makeRecentLiveCandidate(claudePath, "claude", Date.parse("2026-03-24T09:00:00.000Z")),
        ]),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-03-24T09:00:30.000Z"),
    });

    await store.start({ discoveryConfig: config });

    expect(store.snapshot().sessions).toHaveLength(1);
    expect(getSingleSession(store).provider).toBe("claude");
    expect(getSingleSession(store).detailText).toBe("Claude seed");
  });

  it("marks startup-seeded sessions as best-effort when the initial tail window is applied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-seed-large-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);
    appendFileSync(filePath, `${"x".repeat(70_000)}\n`, "utf8");
    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Recent large tail" },
      })}\n`,
      "utf8",
    );

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => [
          makeRecentLiveCandidate(filePath, "codex", Date.parse("2026-03-24T09:00:00.000Z")),
        ]),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-03-24T09:00:30.000Z"),
    });

    await store.start({ discoveryConfig: config });

    expect(getSingleSession(store).bestEffort).toBe(true);
    expect(getSingleSession(store).detailText).toBe("Recent large tail");
  });

  it("repairs indexed-but-untracked Codex sessions after indexing completes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-backfill-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "04", "11", "codex-session.jsonl");
    createCodexTranscript(filePath);
    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:01.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Recovered after indexing" },
      })}\n`,
      "utf8",
    );

    const listRecentLiveSessionFiles = vi
      .fn()
      .mockReturnValueOnce([])
      .mockImplementation(() => [
        makeRecentLiveCandidate(filePath, "codex", Date.parse("2026-04-11T09:00:02.000Z")),
      ]);
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles,
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-04-11T09:00:00.000Z"),
    });

    await store.start({ discoveryConfig: config });
    expect(store.snapshot().sessions).toHaveLength(0);

    const result = await repairRecentSessions(store);

    expect(result).toEqual({
      ran: true,
      candidateCount: 1,
      recoveredSessionCount: 1,
      repairedTrackedSessionCount: 0,
      consumedStructuralInvalidation: false,
      staleCandidateCountAfterRepair: 0,
    });
    expect(getSingleSession(store).provider).toBe("codex");
    expect(getSingleSession(store).detailText).toBe("Recovered after indexing");
  });

  it("replays already tracked Codex sessions when the file is rewritten without growing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-repair-mtime-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "04", "11", "codex-session.jsonl");
    const initialTranscript =
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: "codex-session", cwd: "/workspace/codetrail" },
      })}\n` +
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: { cmd: "bun run lint" },
        },
      })}\n`;
    const rewrittenTranscript =
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: "codex-session", cwd: "/workspace/codetrail" },
      })}\n` +
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: { cmd: "bun run test" },
        },
      })}\n`;
    expect(Buffer.byteLength(rewrittenTranscript, "utf8")).toBe(
      Buffer.byteLength(initialTranscript, "utf8"),
    );
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, initialTranscript, "utf8");
    const initialMtimeMs = Date.parse("2026-04-11T09:00:00.000Z");
    utimesSync(filePath, initialMtimeMs / 1000, initialMtimeMs / 1000);

    const listRecentLiveSessionFiles = vi
      .fn()
      .mockReturnValueOnce([])
      .mockImplementation(() => [
        makeRecentLiveCandidate(filePath, "codex", Date.parse("2026-04-11T09:00:01.000Z")),
      ]);
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles,
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-04-11T09:00:00.000Z"),
    });

    await store.start({ discoveryConfig: config });
    await store.handleWatcherBatch(makeBatch(filePath));
    const newerMtimeMs = Date.parse("2026-04-11T09:00:01.000Z");
    writeFileSync(filePath, rewrittenTranscript, "utf8");
    utimesSync(filePath, newerMtimeMs / 1000, newerMtimeMs / 1000);

    const result = await repairRecentSessions(store);

    expect(result).toEqual({
      ran: true,
      candidateCount: 1,
      recoveredSessionCount: 0,
      repairedTrackedSessionCount: 1,
      consumedStructuralInvalidation: false,
      staleCandidateCountAfterRepair: 0,
    });
    expect(store.snapshot().sessions).toHaveLength(1);
    expect(getSingleSession(store).statusKind).toBe("running_tool");
    expect(getSingleSession(store).detailText).toBe("bun run test");
  });

  it("restores the previous cursor when replay-from-start fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-replay-error-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "04", "11", "codex-session.jsonl");
    const initialTranscript =
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: "codex-session", cwd: "/workspace/codetrail" },
      })}\n` +
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: { cmd: "bun run lint" },
        },
      })}\n`;
    const rewrittenTranscript =
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: "codex-session", cwd: "/workspace/codetrail" },
      })}\n` +
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: { cmd: "bun run test" },
        },
      })}\n`;
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, initialTranscript, "utf8");
    const initialMtimeMs = Date.parse("2026-04-11T09:00:00.000Z");
    utimesSync(filePath, initialMtimeMs / 1000, initialMtimeMs / 1000);

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-04-11T09:00:00.000Z"),
    });

    await store.start({ discoveryConfig: config });
    await store.handleWatcherBatch(makeBatch(filePath));
    writeFileSync(filePath, rewrittenTranscript, "utf8");
    const newerMtimeMs = Date.parse("2026-04-11T09:00:01.000Z");
    utimesSync(filePath, newerMtimeMs / 1000, newerMtimeMs / 1000);

    chmodSync(filePath, 0o000);
    try {
      await (
        store as unknown as {
          replayRecentSessionCandidatesFromStart: (
            candidates: Array<{
              filePath: string;
              provider: "claude" | "codex";
              fileMtimeMs: number;
              fileSize: number;
            }>,
          ) => Promise<void>;
        }
      ).replayRecentSessionCandidatesFromStart([
        makeRecentLiveCandidate(filePath, "codex", newerMtimeMs),
      ]);
    } finally {
      chmodSync(filePath, 0o644);
    }

    expect(getSingleSession(store).statusKind).toBe("running_tool");
    expect(getSingleSession(store).detailText).toBe("bun run lint");
  });

  it("repairs already tracked Codex sessions when the file size grows without a watcher batch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-repair-size-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "04", "11", "codex-session.jsonl");
    createCodexTranscript(filePath);
    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:01.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Recovered before append" },
      })}\n`,
      "utf8",
    );

    const listRecentLiveSessionFiles = vi
      .fn()
      .mockReturnValueOnce([])
      .mockImplementation(() => [
        makeRecentLiveCandidate(filePath, "codex", Date.parse("2026-04-11T09:00:02.000Z")),
      ]);
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles,
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-04-11T09:00:00.000Z"),
    });

    await store.start({ discoveryConfig: config });
    await store.handleWatcherBatch(makeBatch(filePath));

    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: { cmd: "bun run typecheck" },
        },
      })}\n`,
      "utf8",
    );

    const result = await repairRecentSessions(store);

    expect(result).toEqual({
      ran: true,
      candidateCount: 1,
      recoveredSessionCount: 0,
      repairedTrackedSessionCount: 1,
      consumedStructuralInvalidation: false,
      staleCandidateCountAfterRepair: 0,
    });
    expect(getSingleSession(store).statusKind).toBe("running_tool");
    expect(getSingleSession(store).detailText).toBe("bun run typecheck");
  });

  it("reports stale missing indexed files after repair without clearing live state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-backfill-missing-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const missingPath = join(config.codexRoot, "2026", "04", "11", "missing-session.jsonl");

    const listRecentLiveSessionFiles = vi
      .fn()
      .mockReturnValueOnce([])
      .mockImplementation(() => [
        {
          filePath: missingPath,
          provider: "codex" as const,
          fileMtimeMs: Date.parse("2026-04-11T09:00:01.000Z"),
          fileSize: 1,
        },
      ]);
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles,
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-04-11T09:00:00.000Z"),
    });

    await store.start({ discoveryConfig: config });

    const result = await repairRecentSessions(store);

    expect(result).toEqual({
      ran: true,
      candidateCount: 1,
      recoveredSessionCount: 0,
      repairedTrackedSessionCount: 0,
      consumedStructuralInvalidation: false,
      staleCandidateCountAfterRepair: 1,
    });
    expect(store.snapshot().sessions).toHaveLength(0);
  });

  it("repair preserves existing live sessions and Claude hook precision", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-backfill-preserve-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const claudePath = join(config.claudeRoot, "project-a", "claude-session.jsonl");
    const codexPath = join(config.codexRoot, "2026", "04", "11", "codex-session.jsonl");
    createClaudeTranscript(claudePath);
    createCodexTranscript(codexPath);
    appendFileSync(
      codexPath,
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:03.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Recovered Codex session" },
      })}\n`,
      "utf8",
    );
    const homeDir = join(dir, "home");
    const userDataDir = join(dir, "user-data");
    const settingsPath = join(homeDir, ".claude", "settings.json");
    writeClaudeHookSettings(settingsPath);

    const listRecentLiveSessionFiles = vi
      .fn()
      .mockReturnValueOnce([])
      .mockImplementation(() => [
        makeRecentLiveCandidate(codexPath, "codex", Date.parse("2026-04-11T09:00:03.000Z")),
      ]);
    const { createFileWatcher, records } = createWatcherFactory();
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles,
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir,
      homeDir,
      createFileWatcher,
      now: () => Date.parse("2026-04-11T09:00:00.000Z"),
    });

    await store.start({ discoveryConfig: config });
    await store.handleWatcherBatch(makeBatch(claudePath));

    const hookLogPath = join(userDataDir, "live-status", "claude-hooks.jsonl");
    mkdirSync(dirname(hookLogPath), { recursive: true });
    writeFileSync(
      hookLogPath,
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:01.000Z",
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        transcript_path: claudePath,
        message: "Approve file edit",
      })}\n`,
      "utf8",
    );
    await records[0]!.callback(makeBatch(hookLogPath));

    store.noteStructuralInvalidation(Date.parse("2026-04-11T09:00:00.000Z"));
    const result = await repairRecentSessions(store);

    const sessions = store.snapshot().sessions;
    expect(result).toEqual({
      ran: true,
      candidateCount: 1,
      recoveredSessionCount: 1,
      repairedTrackedSessionCount: 0,
      consumedStructuralInvalidation: true,
      staleCandidateCountAfterRepair: 0,
    });
    expect(records).toHaveLength(1);
    expect(sessions).toHaveLength(2);
    const claudeSession = sessions.find((session) => session.provider === "claude");
    const codexSession = sessions.find((session) => session.provider === "codex");
    expect(claudeSession?.sourcePrecision).toBe("hook");
    expect(claudeSession?.detailText).toBe("Approve file edit");
    expect(codexSession?.detailText).toBe("Recovered Codex session");
  });

  it("retains structural invalidation after a failed repair and consumes it on the next success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-backfill-retry-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "04", "11", "codex-session.jsonl");
    createCodexTranscript(filePath);
    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:02.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Recovered on retry" },
      })}\n`,
      "utf8",
    );

    const listRecentLiveSessionFiles = vi
      .fn()
      .mockReturnValueOnce([])
      .mockImplementationOnce(() => {
        throw new Error("transient db failure");
      })
      .mockImplementation(() => [
        makeRecentLiveCandidate(filePath, "codex", Date.parse("2026-04-11T09:00:02.000Z")),
      ]);
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles,
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-04-11T09:00:00.000Z"),
    });

    await store.start({ discoveryConfig: config });
    store.noteStructuralInvalidation(Date.parse("2026-04-11T09:00:00.000Z"));

    const firstAttempt = await repairRecentSessions(store);
    expect(firstAttempt).toEqual({
      ran: false,
      candidateCount: 0,
      recoveredSessionCount: 0,
      repairedTrackedSessionCount: 0,
      consumedStructuralInvalidation: false,
      staleCandidateCountAfterRepair: 0,
    });

    const secondAttempt = await repairRecentSessions(store);
    expect(secondAttempt).toEqual({
      ran: true,
      candidateCount: 1,
      recoveredSessionCount: 1,
      repairedTrackedSessionCount: 0,
      consumedStructuralInvalidation: true,
      staleCandidateCountAfterRepair: 0,
    });
    expect(getSingleSession(store).detailText).toBe("Recovered on retry");
  });

  it("keeps the first structural invalidation timestamp until repair succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-structural-ts-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-04-11T09:00:00.000Z"),
    });

    await store.start({ discoveryConfig: config });
    store.noteStructuralInvalidation(Date.parse("2026-04-11T09:00:00.000Z"));
    store.noteStructuralInvalidation(Date.parse("2026-04-11T09:05:00.000Z"));

    expect(store.hasStructuralInvalidationPending()).toBe(true);
    expect(store.getStructuralInvalidationObservedAtMs()).toBe(
      Date.parse("2026-04-11T09:00:00.000Z"),
    );
  });

  it("catches up tracked transcripts after a watcher restart gap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-repair-catchup-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "04", "11", "tracked-during-restart.jsonl");
    createCodexTranscript(filePath);
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-04-11T09:00:00.000Z"),
    });

    await store.start({ discoveryConfig: config });
    await store.handleWatcherBatch(makeBatch(filePath));
    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: { cmd: "bun run typecheck" },
        },
      })}\n`,
      "utf8",
    );

    const result = await store.catchUpTrackedTranscriptsAfterWatcherRestart({
      restartStartedAtMs: Date.parse("2026-04-11T09:00:01.000Z"),
    });

    expect(result).toEqual({ processedTrackedFileCount: 1 });
    expect(getSingleSession(store).statusKind).toBe("running_tool");
    expect(getSingleSession(store).detailText).toBe("bun run typecheck");
  });

  it("removes tracked sessions when the transcript disappears during the watcher restart gap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-repair-catchup-delete-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "04", "11", "deleted-during-restart.jsonl");
    createCodexTranscript(filePath);
    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:01.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Tracked before deletion" },
      })}\n`,
      "utf8",
    );
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-04-11T09:00:00.000Z"),
    });

    await store.start({ discoveryConfig: config });
    await store.handleWatcherBatch(makeBatch(filePath));
    rmSync(filePath, { force: true });

    const result = await store.catchUpTrackedTranscriptsAfterWatcherRestart({
      restartStartedAtMs: Date.parse("2026-04-11T09:00:02.000Z"),
    });

    expect(result).toEqual({ processedTrackedFileCount: 1 });
    expect(store.snapshot().sessions).toHaveLength(0);
  });

  it("retains live state when repair leaves stale candidates and consumes structural invalidation later", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-repair-restart-error-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const missingPath = join(config.codexRoot, "2026", "04", "11", "missing-session.jsonl");
    const trackedPath = join(config.codexRoot, "2026", "04", "11", "tracked-session.jsonl");
    const recoveredPath = join(config.codexRoot, "2026", "04", "11", "recovered-later.jsonl");
    createCodexTranscript(trackedPath);
    appendFileSync(
      trackedPath,
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:01.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Tracked before stale repair" },
      })}\n`,
      "utf8",
    );
    createCodexTranscript(recoveredPath);
    appendFileSync(
      recoveredPath,
      `${JSON.stringify({
        timestamp: "2026-04-11T09:00:02.000Z",
        type: "event_msg",
        payload: { type: "agent_message", text: "Recovered after stale repair" },
      })}\n`,
      "utf8",
    );

    let repairMode: "missing" | "recovered" = "missing";
    let callCount = 0;
    const listRecentLiveSessionFiles = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return [];
      }
      if (repairMode === "missing") {
        return [
          {
            filePath: missingPath,
            provider: "codex" as const,
            fileMtimeMs: Date.parse("2026-04-11T09:00:01.000Z"),
            fileSize: 1,
          },
        ];
      }
      return [
        makeRecentLiveCandidate(recoveredPath, "codex", Date.parse("2026-04-11T09:00:02.000Z")),
      ];
    });

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles,
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-04-11T09:00:00.000Z"),
    });

    await store.start({ discoveryConfig: config });
    await store.handleWatcherBatch(makeBatch(trackedPath));
    store.noteStructuralInvalidation(Date.parse("2026-04-11T09:00:00.000Z"));

    const firstAttempt = await repairRecentSessions(store);
    expect(firstAttempt).toEqual({
      ran: true,
      candidateCount: 1,
      recoveredSessionCount: 0,
      repairedTrackedSessionCount: 0,
      consumedStructuralInvalidation: false,
      staleCandidateCountAfterRepair: 1,
    });
    expect(getSingleSession(store).detailText).toBe("Tracked before stale repair");

    repairMode = "recovered";

    const secondAttempt = await repairRecentSessions(store);
    expect(secondAttempt).toEqual({
      ran: true,
      candidateCount: 1,
      recoveredSessionCount: 1,
      repairedTrackedSessionCount: 0,
      consumedStructuralInvalidation: true,
      staleCandidateCountAfterRepair: 0,
    });
    expect(store.snapshot().sessions).toHaveLength(2);
    expect(store.snapshot().sessions.map((session) => session.detailText)).toContain(
      "Recovered after stale repair",
    );
  });

  it("updates Claude sessions from the dedicated hook watcher", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-hooks-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const transcriptPath = join(config.claudeRoot, "project-a", "claude-session.jsonl");
    createClaudeTranscript(transcriptPath);
    const homeDir = join(dir, "home");
    const userDataDir = join(dir, "user-data");
    const settingsPath = join(homeDir, ".claude", "settings.json");
    writeClaudeHookSettings(settingsPath);

    const { createFileWatcher, records } = createWatcherFactory();
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir,
      homeDir,
      createFileWatcher,
    });

    await store.start({ discoveryConfig: config });
    expect(records).toHaveLength(1);
    await store.handleWatcherBatch(makeBatch(transcriptPath));
    expect(getSingleSession(store).provider).toBe("claude");

    const hookLogPath = join(userDataDir, "live-status", "claude-hooks.jsonl");
    mkdirSync(dirname(hookLogPath), { recursive: true });
    writeFileSync(
      hookLogPath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        transcript_path: transcriptPath,
        message: "Allow editing package.json",
      })}\n`,
      "utf8",
    );

    await records[0]!.callback(makeBatch(hookLogPath));

    const session = getSingleSession(store);
    expect(session.provider).toBe("claude");
    expect(session.statusKind).toBe("waiting_for_approval");
    expect(session.sourcePrecision).toBe("hook");
    expect(records[0]!.roots[0]).toBe(join(userDataDir, "live-status"));
  });

  it("uses file mtime fallback so stale untimestamped Claude transcripts do not appear fresh when seeded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-claude-stale-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const transcriptPath = join(config.claudeRoot, "project-a", "claude-session.jsonl");
    createClaudeTranscript(transcriptPath);
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        parentUuid: "assistant-1",
        sessionId: "claude-session",
        cwd: "/workspace/codetrail",
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Old assistant message without timestamp" }],
        },
      })}\n`,
      "utf8",
    );
    const oldActivityMs = Date.parse("2026-03-24T08:00:00.000Z");
    utimesSync(transcriptPath, oldActivityMs / 1000, oldActivityMs / 1000);
    const listRecentLiveSessionFiles = vi.fn(() => [
      makeRecentLiveCandidate(transcriptPath, "claude", oldActivityMs),
    ]);

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles,
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => Date.parse("2026-03-24T09:00:30.000Z"),
    });

    await store.start({ discoveryConfig: config });

    expect(listRecentLiveSessionFiles).toHaveBeenCalledOnce();
    expect(store.snapshot().sessions).toHaveLength(0);
  });

  it("parses concatenated Claude hook objects across partial writes without skipping events", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-hook-concat-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const transcriptPath = join(config.claudeRoot, "project-a", "claude-session.jsonl");
    createClaudeTranscript(transcriptPath);
    const homeDir = join(dir, "home");
    const userDataDir = join(dir, "user-data");
    const settingsPath = join(homeDir, ".claude", "settings.json");
    writeClaudeHookSettings(settingsPath);

    const { createFileWatcher, records } = createWatcherFactory();
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir,
      homeDir,
      createFileWatcher,
    });

    await store.start({ discoveryConfig: config });
    await store.handleWatcherBatch(makeBatch(transcriptPath));

    const hookLogPath = join(userDataDir, "live-status", "claude-hooks.jsonl");
    mkdirSync(dirname(hookLogPath), { recursive: true });
    const preToolUse = JSON.stringify({
      timestamp: "2026-03-24T09:00:00.000Z",
      hook_event_name: "PreToolUse",
      transcript_path: transcriptPath,
      tool_name: "Read",
      tool_use_id: "tool-1",
    });
    const postToolUse = JSON.stringify({
      timestamp: "2026-03-24T09:00:01.000Z",
      hook_event_name: "PostToolUse",
      transcript_path: transcriptPath,
      tool_name: "Read",
      tool_use_id: "tool-1",
      message: "Read finished",
    });

    writeFileSync(hookLogPath, preToolUse.slice(0, 40), "utf8");
    await records[0]!.callback(makeBatch(hookLogPath));
    expect(getSingleSession(store).statusKind).toBe("active_recently");

    appendFileSync(hookLogPath, `${preToolUse.slice(40)}${postToolUse}`, "utf8");
    await records[0]!.callback(makeBatch(hookLogPath));

    const session = getSingleSession(store);
    expect(session.statusKind).toBe("working");
    expect(session.statusText).toBe("Tool finished");
    expect(session.detailText).toBe("Read finished");
  });

  it("drops the first parsed hook object after truncation when the read resumes mid-object", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-hook-resync-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const transcriptPath = join(config.claudeRoot, "project-a", "claude-session.jsonl");
    createClaudeTranscript(transcriptPath);
    const homeDir = join(dir, "home");
    const userDataDir = join(dir, "user-data");
    const settingsPath = join(homeDir, ".claude", "settings.json");
    writeClaudeHookSettings(settingsPath);

    const { createFileWatcher, records } = createWatcherFactory();
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir,
      homeDir,
      createFileWatcher,
    });

    await store.start({ discoveryConfig: config });
    await store.handleWatcherBatch(makeBatch(transcriptPath));

    const hookLogPath = join(userDataDir, "live-status", "claude-hooks.jsonl");
    mkdirSync(dirname(hookLogPath), { recursive: true });
    writeFileSync(hookLogPath, `${"x".repeat(80_000)}\n`, "utf8");
    await records[0]!.callback(makeBatch(hookLogPath));

    const bogusLeadingObject = JSON.stringify({
      timestamp: "2026-03-24T09:00:05.000Z",
      hook_event_name: "Stop",
      transcript_path: transcriptPath,
      message: "Bogus stop",
    });
    const validObject = JSON.stringify({
      timestamp: "2026-03-24T09:00:04.000Z",
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      transcript_path: transcriptPath,
      message: "Allow edit",
    });
    truncateSync(hookLogPath, 0);
    writeFileSync(hookLogPath, `${"x".repeat(70_000)}${bogusLeadingObject}${validObject}`, "utf8");

    await records[0]!.callback(makeBatch(hookLogPath));

    const session = getSingleSession(store);
    expect(session.statusKind).toBe("waiting_for_approval");
    expect(session.detailText).toBe("Allow edit");
  });

  it("reuses cached snapshots until the next semantic invalidation point", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-cache-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);
    let nowMs = Date.parse("2026-03-24T09:00:00.000Z");

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => nowMs,
    });

    await store.start({ discoveryConfig: config });

    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "request_user_input", prompt: "Need confirmation" },
      })}\n`,
      "utf8",
    );
    await store.handleWatcherBatch(makeBatch(filePath));

    const firstSnapshot = store.snapshot();
    nowMs += 15_000;
    const secondSnapshot = store.snapshot();

    expect(secondSnapshot).toBe(firstSnapshot);
    expect(secondSnapshot.updatedAt).toBe(firstSnapshot.updatedAt);
  });

  it("invalidates cached snapshots when recent last-action detail expires", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-last-action-expiry-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);
    let nowMs = Date.parse("2026-03-24T09:00:00.000Z");

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => nowMs,
    });

    await store.start({ discoveryConfig: config });

    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-1",
          name: "exec_command",
          arguments: { cmd: "bun run test" },
        },
      })}\n${JSON.stringify({
        timestamp: "2026-03-24T09:00:01.000Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call-1" },
      })}\n`,
      "utf8",
    );
    await store.handleWatcherBatch(makeBatch(filePath));

    const beforeExpiry = store.snapshot();
    expect(beforeExpiry.sessions[0]?.detailText).toBe("Last command: bun run test");

    nowMs += 10_000;
    const cachedBeforeExpiry = store.snapshot();
    expect(cachedBeforeExpiry).toBe(beforeExpiry);

    nowMs += 7_000;
    const afterExpiry = store.snapshot();
    expect(afterExpiry).not.toBe(beforeExpiry);
    expect(afterExpiry.sessions[0]?.detailText).toBeNull();
  });

  it("prunes stale sessions from the backing cursor map", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-prune-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);
    let nowMs = Date.parse("2026-03-24T09:00:00.000Z");

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      now: () => nowMs,
    });

    await store.start({ discoveryConfig: config });

    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started" },
      })}\n`,
      "utf8",
    );
    await store.handleWatcherBatch(makeBatch(filePath));
    expect((store as unknown as { sessionCursors: Map<string, unknown> }).sessionCursors.size).toBe(
      1,
    );

    nowMs += 4 * 60_000;
    expect(store.snapshot().sessions).toEqual([]);
    expect((store as unknown as { sessionCursors: Map<string, unknown> }).sessionCursors.size).toBe(
      0,
    );
  });

  it("installs, repairs, and removes managed Claude hooks without touching unrelated hooks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-install-"));
    tempDirs.push(dir);
    const homeDir = join(dir, "home");
    const userDataDir = join(dir, "user-data");
    const settingsPath = join(homeDir, ".claude", "settings.json");
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "CODETRAIL_CLAUDE_HOOK=1 /bin/sh -lc 'old managed command'",
                  async: true,
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: "echo keep-me",
                  async: true,
                },
              ],
            },
          ],
        },
      }),
      "utf8",
    );

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir,
      homeDir,
    });

    const installed = await store.installClaudeHooks();
    expect(installed.installed).toBe(true);
    expect(installed.managedEventNames).toHaveLength(7);

    const installedSettings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const installedCommands = Object.values(installedSettings.hooks ?? {})
      .flat()
      .flatMap((entry) => entry.hooks ?? [])
      .map((hook) => hook.command ?? "");
    expect(installedCommands.some((command) => command.includes("exit 0"))).toBe(true);
    expect(installedCommands).toContain("echo keep-me");

    const removed = await store.removeClaudeHooks();
    expect(removed.installed).toBe(false);
    expect(removed.managed).toBe(false);

    const removedSettings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const remainingCommands = Object.values(removedSettings.hooks ?? {})
      .flat()
      .flatMap((entry) => entry.hooks ?? [])
      .map((hook) => hook.command ?? "");
    expect(remainingCommands).toEqual(["echo keep-me"]);
  });

  it("creates the hooks object on first install when Claude settings has no hooks key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-first-install-"));
    tempDirs.push(dir);
    const homeDir = join(dir, "home");
    const userDataDir = join(dir, "user-data");
    const settingsPath = join(homeDir, ".claude", "settings.json");
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }), "utf8");

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir,
      homeDir,
    });

    const installed = await store.installClaudeHooks();
    expect(installed.installed).toBe(true);

    const nextSettings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      theme?: string;
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    expect(nextSettings.theme).toBe("dark");
    expect(Object.keys(nextSettings.hooks ?? {})).toHaveLength(7);
    expect(
      Object.values(nextSettings.hooks ?? {})
        .flat()
        .flatMap((entry) => entry.hooks ?? [])
        .some((hook) => typeof hook.command === "string" && hook.command.includes("exit 0")),
    ).toBe(true);
  });

  it("fails cleanly when the existing Claude settings file is invalid JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-invalid-json-"));
    tempDirs.push(dir);
    const homeDir = join(dir, "home");
    const userDataDir = join(dir, "user-data");
    const settingsPath = join(homeDir, ".claude", "settings.json");
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, "{ invalid json", "utf8");

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir,
      homeDir,
    });

    await expect(store.installClaudeHooks()).rejects.toThrow();
  });

  it("fails cleanly when Claude settings cannot be written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-write-fail-"));
    tempDirs.push(dir);
    const homeDir = join(dir, "home");
    const userDataDir = join(dir, "user-data");
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(join(homeDir, ".claude"), "not a directory", "utf8");

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir,
      homeDir,
    });

    await expect(store.installClaudeHooks()).rejects.toThrow();
  });

  it("prepares the Claude hook log directory and rotates the previous log once on app start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-hook-log-"));
    tempDirs.push(dir);
    const homeDir = join(dir, "home");
    const userDataDir = join(dir, "user-data");
    const logPath = join(userDataDir, "live-status", "claude-hooks.jsonl");
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, '{"event":"old"}\n', "utf8");

    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir,
      homeDir,
    });

    await store.prepareClaudeHookLogForAppStart();

    expect(readFileSync(`${logPath}.1`, "utf8")).toBe('{"event":"old"}\n');
    expect(() => readFileSync(logPath, "utf8")).toThrow();

    await store.prepareClaudeHookLogForAppStart();
    expect(readFileSync(`${logPath}.1`, "utf8")).toBe('{"event":"old"}\n');
  });

  it("fires onSnapshotInvalidated when a watcher batch updates cursor state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-push-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);

    const onSnapshotInvalidated = vi.fn();
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      onSnapshotInvalidated,
    });

    await store.start({ discoveryConfig: config });
    onSnapshotInvalidated.mockClear();

    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", title: "Push test" },
      })}\n`,
      "utf8",
    );
    await store.handleWatcherBatch(makeBatch(filePath));

    expect(onSnapshotInvalidated).toHaveBeenCalled();
  });

  it("does not fire onSnapshotInvalidated after stop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-push-stop-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const filePath = join(config.codexRoot, "2026", "03", "24", "codex-session.jsonl");
    createCodexTranscript(filePath);

    const onSnapshotInvalidated = vi.fn();
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir: join(dir, "user-data"),
      homeDir: join(dir, "home"),
      onSnapshotInvalidated,
    });

    await store.start({ discoveryConfig: config });
    await store.stop();
    onSnapshotInvalidated.mockClear();

    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", title: "Push test" },
      })}\n`,
      "utf8",
    );
    await store.handleWatcherBatch(makeBatch(filePath));

    expect(onSnapshotInvalidated).not.toHaveBeenCalled();
  });

  it("fires onSnapshotInvalidated from Claude hook watcher updates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-live-store-push-hooks-"));
    tempDirs.push(dir);
    const config = makeConfig(dir);
    const transcriptPath = join(config.claudeRoot, "project-a", "claude-session.jsonl");
    createClaudeTranscript(transcriptPath);
    const homeDir = join(dir, "home");
    const userDataDir = join(dir, "user-data");
    const settingsPath = join(homeDir, ".claude", "settings.json");
    writeClaudeHookSettings(settingsPath);

    const onSnapshotInvalidated = vi.fn();
    const { createFileWatcher, records } = createWatcherFactory();
    const store = new LiveSessionStore({
      queryService: {
        listRecentLiveSessionFiles: vi.fn(() => []),
      } satisfies Pick<QueryService, "listRecentLiveSessionFiles">,
      userDataDir,
      homeDir,
      createFileWatcher,
      onSnapshotInvalidated,
    });

    await store.start({ discoveryConfig: config });
    await store.handleWatcherBatch(makeBatch(transcriptPath));
    onSnapshotInvalidated.mockClear();

    const hookLogPath = join(userDataDir, "live-status", "claude-hooks.jsonl");
    mkdirSync(dirname(hookLogPath), { recursive: true });
    writeFileSync(
      hookLogPath,
      `${JSON.stringify({
        timestamp: "2026-03-24T09:00:00.000Z",
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        transcript_path: transcriptPath,
        message: "Allow editing",
      })}\n`,
      "utf8",
    );

    await records[0]!.callback(makeBatch(hookLogPath));

    expect(onSnapshotInvalidated).toHaveBeenCalled();
  });
});
