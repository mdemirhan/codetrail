import { z } from "zod";

import { messageCategorySchema, providerSchema } from "./canonical";

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
});

const searchResultSchema = z.object({
  messageId: z.string().min(1),
  messageSourceId: z.string().min(1),
  sessionId: z.string().min(1),
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
  tool_result: z.number().int().nonnegative(),
  thinking: z.number().int().nonnegative(),
  system: z.number().int().nonnegative(),
});

export const ipcContractSchemas = {
  "app:getHealth": {
    request: z.object({}),
    response: z.object({
      status: z.literal("ok"),
      version: z.string().min(1),
    }),
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
