import { z } from "zod";

import {
  messageCategorySchema,
  operationDurationConfidenceSchema,
  operationDurationSourceSchema,
  providerSchema,
} from "./canonical";

const projectSummarySchema = z.object({
  id: z.string().min(1),
  provider: providerSchema,
  name: z.string().min(1),
  path: z.string(),
  sessionCount: z.number().int().nonnegative(),
  lastActivity: z.string().nullable(),
});

const sessionSummarySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  provider: providerSchema,
  filePath: z.string().min(1),
  title: z.string(),
  modelNames: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  gitBranch: z.string().nullable(),
  cwd: z.string().nullable(),
  messageCount: z.number().int().nonnegative(),
  tokenInputTotal: z.number().int().nonnegative(),
  tokenOutputTotal: z.number().int().nonnegative(),
});

const sessionMessageSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  sessionId: z.string().min(1),
  provider: providerSchema,
  category: messageCategorySchema,
  content: z.string(),
  createdAt: z.string(),
  tokenInput: z.number().int().nonnegative().nullable(),
  tokenOutput: z.number().int().nonnegative().nullable(),
  operationDurationMs: z.number().int().nonnegative().nullable(),
  operationDurationSource: operationDurationSourceSchema.nullable(),
  operationDurationConfidence: operationDurationConfidenceSchema.nullable(),
});

const projectCombinedMessageSchema = sessionMessageSchema.extend({
  sessionTitle: z.string(),
  sessionActivity: z.string().nullable(),
  sessionStartedAt: z.string().nullable(),
  sessionEndedAt: z.string().nullable(),
  sessionGitBranch: z.string().nullable(),
  sessionCwd: z.string().nullable(),
});

const bookmarkEntrySchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  sessionTitle: z.string(),
  bookmarkedAt: z.string(),
  isOrphaned: z.boolean(),
  orphanedAt: z.string().nullable(),
  message: sessionMessageSchema,
});

const searchResultSchema = z.object({
  messageId: z.string().min(1),
  messageSourceId: z.string().min(1),
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  provider: providerSchema,
  category: messageCategorySchema,
  createdAt: z.string(),
  snippet: z.string(),
  projectName: z.string(),
  projectPath: z.string(),
});

const categoryCountsSchema = z.object({
  user: z.number().int().nonnegative(),
  assistant: z.number().int().nonnegative(),
  tool_use: z.number().int().nonnegative(),
  tool_edit: z.number().int().nonnegative(),
  tool_result: z.number().int().nonnegative(),
  thinking: z.number().int().nonnegative(),
  system: z.number().int().nonnegative(),
});

const monoFontSizeSchema = z.enum([
  "10px",
  "11px",
  "12px",
  "13px",
  "14px",
  "15px",
  "16px",
  "17px",
  "18px",
]);
const regularFontSizeSchema = z.enum([
  "11px",
  "12px",
  "13px",
  "13.5px",
  "14px",
  "15px",
  "16px",
  "17px",
  "18px",
  "20px",
]);
const themeModeSchema = z.enum([
  "light",
  "dark",
  "ft-dark",
  "tomorrow-night",
  "catppuccin-mocha",
  "obsidian",
  "graphite",
  "midnight",
  "onyx",
  "clean-white",
  "warm-paper",
  "stone",
  "sand",
]);
const sortDirectionSchema = z.enum(["asc", "desc"]);
const searchModeSchema = z.enum(["simple", "advanced"]);
const preferredAutoRefreshStrategySchema = z.enum([
  "watch-1s",
  "watch-3s",
  "watch-5s",
  "scan-5s",
  "scan-10s",
  "scan-30s",
  "scan-1min",
  "scan-5min",
]);
const systemMessageRegexRulesSchema = z.object({
  claude: z.array(z.string()),
  codex: z.array(z.string()),
  gemini: z.array(z.string()),
  cursor: z.array(z.string()),
  opencode: z.array(z.string()),
});

// Single source of truth for pane state fields. The non-nullable base schema is used
// directly as the ui:setState request. The nullable variant (for ui:getState responses
// where persisted values may be absent) is derived automatically.
export const paneStateBaseSchema = z.object({
  projectPaneWidth: z.number().int().positive(),
  sessionPaneWidth: z.number().int().positive(),
  projectPaneCollapsed: z.boolean(),
  sessionPaneCollapsed: z.boolean(),
  projectProviders: z.array(providerSchema),
  historyCategories: z.array(messageCategorySchema),
  expandedByDefaultCategories: z.array(messageCategorySchema),
  searchProviders: z.array(providerSchema),
  theme: themeModeSchema,
  monoFontFamily: z.enum(["current", "droid_sans_mono"]),
  regularFontFamily: z.enum(["current", "inter"]),
  monoFontSize: monoFontSizeSchema,
  regularFontSize: regularFontSizeSchema,
  useMonospaceForAllMessages: z.boolean(),
  selectedProjectId: z.string(),
  selectedSessionId: z.string(),
  historyMode: z.enum(["session", "bookmarks", "project_all"]),
  projectSortDirection: sortDirectionSchema,
  sessionSortDirection: sortDirectionSchema,
  messageSortDirection: sortDirectionSchema,
  bookmarkSortDirection: sortDirectionSchema,
  projectAllSortDirection: sortDirectionSchema,
  sessionPage: z.number().int().nonnegative(),
  sessionScrollTop: z.number().int().nonnegative(),
  preferredAutoRefreshStrategy: preferredAutoRefreshStrategySchema,
  systemMessageRegexRules: systemMessageRegexRulesSchema,
});

function makeAllNullable<T extends z.ZodRawShape>(shape: T) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, value]) => [key, (value as z.ZodTypeAny).nullable()]),
  ) as { [K in keyof T]: z.ZodNullable<T[K]> };
}

const paneStateSchema = z.object(makeAllNullable(paneStateBaseSchema.shape));

const uiZoomResponseSchema = z.object({
  percent: z.number().int().positive(),
});

const settingsInfoResponseSchema = z.object({
  storage: z.object({
    settingsFile: z.string().min(1),
    cacheDir: z.string().min(1),
    databaseFile: z.string().min(1),
    bookmarksDatabaseFile: z.string().min(1),
    userDataDir: z.string().min(1),
  }),
  discovery: z.object({
    claudeRoot: z.string().min(1),
    codexRoot: z.string().min(1),
    geminiRoot: z.string().min(1),
    geminiHistoryRoot: z.string().min(1),
    geminiProjectsPath: z.string().min(1),
    cursorRoot: z.string().min(1),
    opencodeDbPath: z.string().min(1),
  }),
});

const indexerStatusResponseSchema = z.object({
  running: z.boolean(),
  queuedJobs: z.number().int().nonnegative(),
  activeJobId: z.string().min(1).nullable(),
  completedJobs: z.number().int().nonnegative(),
});

export const ipcContractSchemas = {
  "app:getHealth": {
    request: z.object({}),
    response: z.object({
      status: z.literal("ok"),
      version: z.string().min(1),
    }),
  },
  "app:getSettingsInfo": {
    request: z.object({}),
    response: settingsInfoResponseSchema,
  },
  "db:getSchemaVersion": {
    request: z.object({}),
    response: z.object({
      schemaVersion: z.number().int().positive(),
    }),
  },
  "indexer:refresh": {
    request: z.object({
      force: z.boolean().default(false),
    }),
    response: z.object({
      jobId: z.string().min(1),
    }),
  },
  "indexer:getStatus": {
    request: z.object({}),
    response: indexerStatusResponseSchema,
  },
  "projects:list": {
    request: z.object({
      providers: z.array(providerSchema).optional(),
      query: z.string().default(""),
    }),
    response: z.object({
      projects: z.array(projectSummarySchema),
    }),
  },
  "projects:getCombinedDetail": {
    request: z.object({
      projectId: z.string().min(1),
      page: z.number().int().nonnegative().default(0),
      pageSize: z.number().int().positive().max(500).default(100),
      categories: z.array(messageCategorySchema).optional(),
      query: z.string().default(""),
      searchMode: searchModeSchema.optional(),
      sortDirection: sortDirectionSchema.default("asc"),
      focusMessageId: z.string().min(1).optional(),
      focusSourceId: z.string().min(1).optional(),
    }),
    response: z.object({
      projectId: z.string().min(1),
      totalCount: z.number().int().nonnegative(),
      categoryCounts: categoryCountsSchema,
      page: z.number().int().nonnegative(),
      pageSize: z.number().int().positive(),
      focusIndex: z.number().int().nonnegative().nullable(),
      queryError: z.string().nullable().optional(),
      highlightPatterns: z.array(z.string()).optional(),
      messages: z.array(projectCombinedMessageSchema),
    }),
  },
  "sessions:list": {
    request: z.object({
      projectId: z.string().default(""),
    }),
    response: z.object({
      sessions: z.array(sessionSummarySchema),
    }),
  },
  "sessions:getDetail": {
    request: z.object({
      sessionId: z.string().min(1),
      page: z.number().int().nonnegative().default(0),
      pageSize: z.number().int().positive().max(500).default(100),
      categories: z.array(messageCategorySchema).optional(),
      query: z.string().default(""),
      searchMode: searchModeSchema.optional(),
      sortDirection: sortDirectionSchema.default("asc"),
      focusMessageId: z.string().min(1).optional(),
      focusSourceId: z.string().min(1).optional(),
    }),
    response: z.object({
      session: sessionSummarySchema.nullable(),
      totalCount: z.number().int().nonnegative(),
      categoryCounts: categoryCountsSchema,
      page: z.number().int().nonnegative(),
      pageSize: z.number().int().positive(),
      focusIndex: z.number().int().nonnegative().nullable(),
      queryError: z.string().nullable().optional(),
      highlightPatterns: z.array(z.string()).optional(),
      messages: z.array(sessionMessageSchema),
    }),
  },
  "bookmarks:listProject": {
    request: z.object({
      projectId: z.string().min(1),
      query: z.string().optional(),
      searchMode: searchModeSchema.optional(),
      categories: z.array(messageCategorySchema).optional(),
    }),
    response: z.object({
      projectId: z.string().min(1),
      totalCount: z.number().int().nonnegative(),
      filteredCount: z.number().int().nonnegative(),
      categoryCounts: categoryCountsSchema,
      queryError: z.string().nullable().optional(),
      highlightPatterns: z.array(z.string()).optional(),
      results: z.array(bookmarkEntrySchema),
    }),
  },
  "bookmarks:toggle": {
    request: z.object({
      projectId: z.string().min(1),
      sessionId: z.string().min(1),
      messageId: z.string().min(1),
      messageSourceId: z.string().min(1),
    }),
    response: z.object({
      bookmarked: z.boolean(),
    }),
  },
  "search:query": {
    request: z.object({
      query: z.string().default(""),
      searchMode: searchModeSchema.optional(),
      categories: z.array(messageCategorySchema).optional(),
      providers: z.array(providerSchema).optional(),
      projectIds: z.array(z.string().min(1)).optional(),
      projectQuery: z.string().default(""),
      limit: z.number().int().positive().max(500).default(50),
      offset: z.number().int().nonnegative().default(0),
    }),
    response: z.object({
      query: z.string(),
      queryError: z.string().nullable().optional(),
      highlightPatterns: z.array(z.string()).optional(),
      totalCount: z.number().int().nonnegative(),
      categoryCounts: categoryCountsSchema,
      results: z.array(searchResultSchema),
    }),
  },
  "path:openInFileManager": {
    request: z.object({
      path: z.string().min(1),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
    }),
  },
  "ui:getState": {
    request: z.object({}),
    response: paneStateSchema,
  },
  "ui:setState": {
    request: paneStateBaseSchema,
    response: z.object({
      ok: z.literal(true),
    }),
  },
  "ui:getZoom": {
    request: z.object({}),
    response: uiZoomResponseSchema,
  },
  "ui:setZoom": {
    request: z.union([
      z.object({
        action: z.enum(["in", "out", "reset"]),
      }),
      z.object({
        percent: z.number().int(),
      }),
    ]),
    response: uiZoomResponseSchema,
  },
  "watcher:start": {
    request: z.object({
      debounceMs: z.union([z.literal(1000), z.literal(3000), z.literal(5000)]),
    }),
    response: z.object({
      ok: z.boolean(),
      backend: z.enum(["default", "kqueue"]),
      watchedRoots: z.array(z.string()),
    }),
  },
  "watcher:getStatus": {
    request: z.object({}),
    response: z.object({
      running: z.boolean(),
      processing: z.boolean(),
      pendingPathCount: z.number().int().nonnegative(),
    }),
  },
  "watcher:stop": {
    request: z.object({}),
    response: z.object({
      ok: z.boolean(),
    }),
  },
} as const;

export const ipcChannels = Object.keys(ipcContractSchemas) as Array<
  keyof typeof ipcContractSchemas
>;

export type IpcChannel = keyof typeof ipcContractSchemas;
export type IpcRequestInput<C extends IpcChannel> = z.input<
  (typeof ipcContractSchemas)[C]["request"]
>;
export type IpcRequest<C extends IpcChannel> = z.infer<(typeof ipcContractSchemas)[C]["request"]>;
export type IpcResponse<C extends IpcChannel> = z.infer<(typeof ipcContractSchemas)[C]["response"]>;

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpcValidationError";
  }
}
