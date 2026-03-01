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

const bookmarkEntrySchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  sessionTitle: z.string(),
  bookmarkedAt: z.string(),
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
const systemMessageRegexRulesSchema = z.object({
  claude: z.array(z.string()),
  codex: z.array(z.string()),
  gemini: z.array(z.string()),
});

const paneStateSchema = z.object({
  projectPaneWidth: z.number().int().positive().nullable(),
  sessionPaneWidth: z.number().int().positive().nullable(),
  projectProviders: z.array(providerSchema).nullable(),
  historyCategories: z.array(messageCategorySchema).nullable(),
  expandedByDefaultCategories: z.array(messageCategorySchema).nullable(),
  searchProviders: z.array(providerSchema).nullable(),
  theme: z.enum(["light", "dark"]).nullable(),
  monoFontFamily: z.enum(["current", "droid_sans_mono"]).nullable(),
  regularFontFamily: z.enum(["current", "inter"]).nullable(),
  monoFontSize: monoFontSizeSchema.nullable(),
  regularFontSize: regularFontSizeSchema.nullable(),
  useMonospaceForAllMessages: z.boolean().nullable(),
  selectedProjectId: z.string().nullable(),
  selectedSessionId: z.string().nullable(),
  historyMode: z.enum(["session", "bookmarks"]).nullable(),
  sessionPage: z.number().int().nonnegative().nullable(),
  sessionScrollTop: z.number().int().nonnegative().nullable(),
  systemMessageRegexRules: systemMessageRegexRulesSchema.nullable(),
});

const uiZoomResponseSchema = z.object({
  percent: z.number().int().positive(),
});

const settingsInfoResponseSchema = z.object({
  storage: z.object({
    settingsFile: z.string().min(1),
    cacheDir: z.string().min(1),
    databaseFile: z.string().min(1),
    userDataDir: z.string().min(1),
  }),
  discovery: z.object({
    claudeRoot: z.string().min(1),
    codexRoot: z.string().min(1),
    geminiRoot: z.string().min(1),
    geminiHistoryRoot: z.string().min(1),
    geminiProjectsPath: z.string().min(1),
  }),
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
  "projects:list": {
    request: z.object({
      providers: z.array(providerSchema).optional(),
      query: z.string().default(""),
    }),
    response: z.object({
      projects: z.array(projectSummarySchema),
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
      categories: z.array(z.string().min(1)).optional(),
      query: z.string().default(""),
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
      messages: z.array(sessionMessageSchema),
    }),
  },
  "bookmarks:listProject": {
    request: z.object({
      projectId: z.string().min(1),
      categories: z.array(z.string().min(1)).optional(),
    }),
    response: z.object({
      projectId: z.string().min(1),
      totalCount: z.number().int().nonnegative(),
      filteredCount: z.number().int().nonnegative(),
      categoryCounts: categoryCountsSchema,
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
      categories: z.array(z.string().min(1)).optional(),
      providers: z.array(providerSchema).optional(),
      projectIds: z.array(z.string().min(1)).optional(),
      projectQuery: z.string().default(""),
      limit: z.number().int().positive().max(500).default(50),
      offset: z.number().int().nonnegative().default(0),
    }),
    response: z.object({
      query: z.string(),
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
    request: z.object({
      projectPaneWidth: z.number().int().positive(),
      sessionPaneWidth: z.number().int().positive(),
      projectProviders: z.array(providerSchema),
      historyCategories: z.array(messageCategorySchema),
      expandedByDefaultCategories: z.array(messageCategorySchema),
      searchProviders: z.array(providerSchema),
      theme: z.enum(["light", "dark"]),
      monoFontFamily: z.enum(["current", "droid_sans_mono"]),
      regularFontFamily: z.enum(["current", "inter"]),
      monoFontSize: monoFontSizeSchema,
      regularFontSize: regularFontSizeSchema,
      useMonospaceForAllMessages: z.boolean(),
      selectedProjectId: z.string(),
      selectedSessionId: z.string(),
      historyMode: z.enum(["session", "bookmarks"]),
      sessionPage: z.number().int().nonnegative(),
      sessionScrollTop: z.number().int().nonnegative(),
      systemMessageRegexRules: systemMessageRegexRulesSchema,
    }),
    response: z.object({
      ok: z.literal(true),
    }),
  },
  "ui:getZoom": {
    request: z.object({}),
    response: uiZoomResponseSchema,
  },
  "ui:setZoom": {
    request: z.object({
      action: z.enum(["in", "out", "reset"]),
    }),
    response: uiZoomResponseSchema,
  },
} as const;

export const ipcChannels = Object.keys(ipcContractSchemas) as Array<
  keyof typeof ipcContractSchemas
>;

export type IpcChannel = keyof typeof ipcContractSchemas;
export type IpcRequest<C extends IpcChannel> = z.infer<(typeof ipcContractSchemas)[C]["request"]>;
export type IpcResponse<C extends IpcChannel> = z.infer<(typeof ipcContractSchemas)[C]["response"]>;

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpcValidationError";
  }
}
