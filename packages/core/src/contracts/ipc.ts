import { z } from "zod";

import {
  CLAUDE_HOOK_EVENT_NAME_VALUES,
  LIVE_SESSION_STATUS_KIND_VALUES,
  LIVE_SOURCE_PRECISION_VALUES,
} from "../live/types";
import {
  type Provider,
  messageCategorySchema,
  operationDurationConfidenceSchema,
  operationDurationSourceSchema,
  providerSchema,
  turnAnchorKindSchema,
  turnGroupingModeSchema,
} from "./canonical";
import { KNOWN_EXTERNAL_APP_VALUES } from "./externalApps";
import { PROVIDER_LIST, createProviderRecord } from "./providerMetadata";

const projectSummarySchema = z.object({
  id: z.string().min(1),
  provider: providerSchema,
  name: z.string().min(1),
  path: z.string(),
  providerProjectKey: z.string().nullable(),
  repositoryUrl: z.string().nullable(),
  resolutionState: z.string().nullable(),
  resolutionSource: z.string().nullable(),
  metadataJson: z.string().nullable().optional(),
  sessionCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  bookmarkCount: z.number().int().nonnegative().default(0),
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
  sessionIdentity: z.string().nullable(),
  providerSessionId: z.string().nullable(),
  sessionKind: z.string().nullable(),
  canonicalProjectPath: z.string().nullable(),
  repositoryUrl: z.string().nullable(),
  gitCommitHash: z.string().nullable(),
  lineageParentId: z.string().nullable(),
  providerClient: z.string().nullable(),
  providerSource: z.string().nullable(),
  providerClientVersion: z.string().nullable(),
  resolutionSource: z.string().nullable(),
  worktreeLabel: z.string().nullable(),
  worktreeSource: z.string().nullable(),
  metadataJson: z.string().nullable().optional(),
  messageCount: z.number().int().nonnegative(),
  bookmarkCount: z.number().int().nonnegative().default(0),
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
  turnGroupId: z.string().min(1).nullable(),
  turnGroupingMode: turnGroupingModeSchema,
  turnAnchorKind: turnAnchorKindSchema.nullable(),
  nativeTurnId: z.string().min(1).nullable(),
  toolEditFiles: z
    .array(
      z.object({
        filePath: z.string().min(1),
        previousFilePath: z.string().min(1).nullable(),
        changeType: z.enum(["add", "update", "delete", "move"]),
        unifiedDiff: z.string().nullable(),
        addedLineCount: z.number().int().nonnegative(),
        removedLineCount: z.number().int().nonnegative(),
        exactness: z.enum(["exact", "best_effort"]),
        beforeHash: z.string().nullable(),
        afterHash: z.string().nullable(),
      }),
    )
    .optional(),
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
const providerCountsSchema = z.object(createProviderRecord(() => z.number().int().nonnegative()));
const dashboardSummarySchema = z.object({
  projectCount: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  bookmarkCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  indexedFileCount: z.number().int().nonnegative(),
  indexedBytesTotal: z.number().int().nonnegative(),
  tokenInputTotal: z.number().int().nonnegative(),
  tokenOutputTotal: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  averageMessagesPerSession: z.number().nonnegative(),
  averageSessionDurationMs: z.number().nonnegative(),
  activeProviderCount: z.number().int().nonnegative(),
});
const dashboardProviderStatSchema = z.object({
  provider: providerSchema,
  projectCount: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  tokenInputTotal: z.number().int().nonnegative(),
  tokenOutputTotal: z.number().int().nonnegative(),
  lastActivity: z.string().nullable(),
});
const dashboardActivityPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
});
const dashboardProjectStatSchema = z.object({
  projectId: z.string().min(1),
  provider: providerSchema,
  name: z.string(),
  path: z.string(),
  sessionCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  bookmarkCount: z.number().int().nonnegative(),
  lastActivity: z.string().nullable(),
});
const dashboardModelStatSchema = z.object({
  modelName: z.string().min(1),
  sessionCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
});
const dashboardAiCodeSummarySchema = z.object({
  writeEventCount: z.number().int().nonnegative(),
  measurableWriteEventCount: z.number().int().nonnegative(),
  writeSessionCount: z.number().int().nonnegative(),
  fileChangeCount: z.number().int().nonnegative(),
  distinctFilesTouchedCount: z.number().int().nonnegative(),
  linesAdded: z.number().int().nonnegative(),
  linesDeleted: z.number().int().nonnegative(),
  netLines: z.number().int(),
  multiFileWriteCount: z.number().int().nonnegative(),
  averageFilesPerWrite: z.number().nonnegative(),
});
const dashboardAiCodeChangeTypeCountsSchema = z.object({
  add: z.number().int().nonnegative(),
  update: z.number().int().nonnegative(),
  delete: z.number().int().nonnegative(),
  move: z.number().int().nonnegative(),
});
const dashboardAiCodeProviderStatSchema = z.object({
  provider: providerSchema,
  writeEventCount: z.number().int().nonnegative(),
  fileChangeCount: z.number().int().nonnegative(),
  linesAdded: z.number().int().nonnegative(),
  linesDeleted: z.number().int().nonnegative(),
  writeSessionCount: z.number().int().nonnegative(),
});
const dashboardAiCodeActivityPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  writeEventCount: z.number().int().nonnegative(),
  fileChangeCount: z.number().int().nonnegative(),
  linesAdded: z.number().int().nonnegative(),
  linesDeleted: z.number().int().nonnegative(),
});
const dashboardAiCodeTopFileSchema = z.object({
  filePath: z.string().min(1),
  writeEventCount: z.number().int().nonnegative(),
  linesAdded: z.number().int().nonnegative(),
  linesDeleted: z.number().int().nonnegative(),
  lastTouchedAt: z.string().nullable(),
});
const dashboardAiCodeTopFileTypeSchema = z.object({
  label: z.string().min(1),
  fileChangeCount: z.number().int().nonnegative(),
  linesAdded: z.number().int().nonnegative(),
  linesDeleted: z.number().int().nonnegative(),
});
const dashboardAiCodeStatsSchema = z.object({
  summary: dashboardAiCodeSummarySchema,
  changeTypeCounts: dashboardAiCodeChangeTypeCountsSchema,
  providerStats: z.array(dashboardAiCodeProviderStatSchema),
  recentActivity: z.array(dashboardAiCodeActivityPointSchema),
  topFiles: z.array(dashboardAiCodeTopFileSchema),
  topFileTypes: z.array(dashboardAiCodeTopFileTypeSchema),
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
const messagePageSizeSchema = z.union([
  z.literal(10),
  z.literal(25),
  z.literal(50),
  z.literal(100),
  z.literal(250),
]);
const viewerWrapModeSchema = z.enum(["nowrap", "wrap"]);
const diffViewModeSchema = z.enum(["unified", "split"]);
const knownExternalAppSchema = z.enum(KNOWN_EXTERNAL_APP_VALUES);
const externalToolIdSchema = z.string().min(1).max(160);
const externalToolConfigSchema = z.object({
  id: externalToolIdSchema,
  kind: z.enum(["known", "custom"]),
  label: z.string().min(1).max(120),
  appId: knownExternalAppSchema.nullable(),
  command: z.string(),
  editorArgs: z.array(z.string()),
  diffArgs: z.array(z.string()),
  enabledForEditor: z.boolean(),
  enabledForDiff: z.boolean(),
});
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
const shikiThemeSchema = z.string().min(1).max(80);
const sortDirectionSchema = z.enum(["asc", "desc"]);
const projectViewModeSchema = z.enum(["list", "tree"]);
const projectSortFieldSchema = z.enum(["last_active", "name"]);
const searchModeSchema = z.enum(["simple", "advanced"]);
const providerSourceFormatSchema = z.enum(["jsonl_stream", "materialized_json"]);
const historyExportModeSchema = z.enum(["session", "project_all", "bookmarks"]);
const historyExportScopeSchema = z.enum(["current_page", "all_pages"]);
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
const currentAutoRefreshStrategySchema = z.union([
  z.literal("off"),
  preferredAutoRefreshStrategySchema,
]);
const liveSessionStatusKindSchema = z.enum(LIVE_SESSION_STATUS_KIND_VALUES);
const liveSourcePrecisionSchema = z.enum(LIVE_SOURCE_PRECISION_VALUES);
const claudeHookEventNameSchema = z.enum(CLAUDE_HOOK_EVENT_NAME_VALUES);
function buildSystemMessageRegexRulesSchema() {
  return z.object(createProviderZodShape(() => z.array(z.string())));
}

function createProviderZodShape<T extends z.ZodTypeAny>(
  factory: (provider: Provider) => T,
): { [K in Provider]: T } {
  return createProviderRecord(factory);
}

const systemMessageRegexRulesSchema = buildSystemMessageRegexRulesSchema();
const liveProviderCountsSchema = providerCountsSchema;
const claudeHookStateSchema = z.object({
  settingsPath: z.string(),
  logPath: z.string(),
  installed: z.boolean(),
  managed: z.boolean(),
  managedEventNames: z.array(claudeHookEventNameSchema),
  missingEventNames: z.array(claudeHookEventNameSchema),
  lastError: z.string().nullable(),
});
const liveSessionEntrySchema = z.object({
  provider: providerSchema,
  sessionIdentity: z.string().min(1),
  sourceSessionId: z.string().min(1),
  filePath: z.string().min(1),
  projectName: z.string().nullable(),
  projectPath: z.string().nullable(),
  cwd: z.string().nullable(),
  statusKind: liveSessionStatusKindSchema,
  statusText: z.string().min(1),
  detailText: z.string().nullable(),
  sourcePrecision: liveSourcePrecisionSchema,
  lastActivityAt: z.string(),
  bestEffort: z.boolean(),
});
const liveUiTraceMatchTypeSchema = z.enum(["session", "project", "none"]);
const liveUiTracePayloadSchema = z.object({
  selectionMode: z.enum(["session", "bookmarks", "project_all"]),
  selectedProjectId: z.string().nullable(),
  selectedProjectPath: z.string().nullable(),
  selectedSessionId: z.string().nullable(),
  selectedSessionIdentity: z.string().nullable(),
  displayedMatchType: liveUiTraceMatchTypeSchema,
  displayedSession: liveSessionEntrySchema.nullable(),
  displayedRankingReason: z.string().nullable(),
  candidateSessions: z.array(liveSessionEntrySchema).max(20),
  renderedSummary: z.string().nullable(),
});

// Single source of truth for pane state fields. The non-nullable base schema is used
// directly as the ui:setPaneState request. The nullable variant (for ui:getPaneState responses
// where persisted values may be absent) is derived automatically.
export const paneStateBaseSchema = z.object({
  projectPaneWidth: z.number().int().positive(),
  sessionPaneWidth: z.number().int().positive(),
  projectPaneCollapsed: z.boolean(),
  sessionPaneCollapsed: z.boolean(),
  singleClickFoldersExpand: z.boolean(),
  singleClickProjectsExpand: z.boolean(),
  hideSessionsPaneInTreeView: z.boolean(),
  projectProviders: z.array(providerSchema),
  historyCategories: z.array(messageCategorySchema),
  expandedByDefaultCategories: z.array(messageCategorySchema),
  turnViewCategories: z.array(messageCategorySchema),
  turnViewExpandedByDefaultCategories: z.array(messageCategorySchema),
  turnViewCombinedChangesExpanded: z.boolean(),
  searchProviders: z.array(providerSchema),
  liveWatchEnabled: z.boolean(),
  liveWatchRowHasBackground: z.boolean(),
  claudeHooksPrompted: z.boolean(),
  theme: themeModeSchema,
  darkShikiTheme: shikiThemeSchema,
  lightShikiTheme: shikiThemeSchema,
  monoFontFamily: z.enum(["current", "droid_sans_mono"]),
  regularFontFamily: z.enum(["current", "inter"]),
  monoFontSize: monoFontSizeSchema,
  regularFontSize: regularFontSizeSchema,
  messagePageSize: messagePageSizeSchema,
  useMonospaceForAllMessages: z.boolean(),
  autoHideMessageActions: z.boolean(),
  expandPreviewOnHiddenActions: z.boolean(),
  autoHideViewerHeaderActions: z.boolean(),
  defaultViewerWrapMode: viewerWrapModeSchema,
  defaultDiffViewMode: diffViewModeSchema,
  collapseMultiFileToolDiffs: z.boolean(),
  preferredExternalEditor: externalToolIdSchema,
  preferredExternalDiffTool: externalToolIdSchema,
  terminalAppCommand: z.string(),
  externalTools: z.array(externalToolConfigSchema),
  selectedProjectId: z.string(),
  selectedSessionId: z.string(),
  historyMode: z.enum(["session", "bookmarks", "project_all"]),
  historyVisualization: z.enum(["messages", "turns", "bookmarks"]),
  historyDetailMode: z.enum(["flat", "turn"]),
  projectViewMode: projectViewModeSchema,
  projectSortField: projectSortFieldSchema,
  projectSortDirection: sortDirectionSchema,
  sessionSortDirection: sortDirectionSchema,
  messageSortDirection: sortDirectionSchema,
  bookmarkSortDirection: sortDirectionSchema,
  projectAllSortDirection: sortDirectionSchema,
  turnViewSortDirection: sortDirectionSchema,
  sessionPage: z.number().int().nonnegative(),
  sessionScrollTop: z.number().int().nonnegative(),
  currentAutoRefreshStrategy: currentAutoRefreshStrategySchema,
  preferredAutoRefreshStrategy: preferredAutoRefreshStrategySchema,
  systemMessageRegexRules: systemMessageRegexRulesSchema,
});
export const paneStatePatchSchema = paneStateBaseSchema.partial();

function makeAllNullable<T extends z.ZodRawShape>(shape: T) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, value]) => [key, (value as z.ZodTypeAny).nullable()]),
  ) as { [K in keyof T]: z.ZodNullable<T[K]> };
}

const paneStateSchema = z.object(makeAllNullable(paneStateBaseSchema.shape));

export const indexerConfigBaseSchema = z.object({
  enabledProviders: z.array(providerSchema),
  removeMissingSessionsDuringIncrementalIndexing: z.boolean(),
});

const indexerConfigSchema = z.object(makeAllNullable(indexerConfigBaseSchema.shape));
const appCommandStateSchema = z.object({
  canReindexSelectedProject: z.boolean(),
});

const uiZoomResponseSchema = z.object({
  percent: z.number().int().positive(),
});

const discoveryProviderPathSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1),
  watch: z.boolean(),
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
    providers: z
      .array(
        z.object({
          provider: providerSchema,
          label: z.string().min(1),
          paths: z.array(discoveryProviderPathSchema),
        }),
      )
      .length(PROVIDER_LIST.length),
  }),
});

const indexerStatusResponseSchema = z.object({
  running: z.boolean(),
  queuedJobs: z.number().int().nonnegative(),
  activeJobId: z.string().min(1).nullable(),
  completedJobs: z.number().int().nonnegative(),
});

const diagnosticsSourceSchema = z.object({
  runs: z.number().int().nonnegative(),
  failedRuns: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  averageDurationMs: z.number().int().nonnegative(),
  maxDurationMs: z.number().int().nonnegative(),
  lastDurationMs: z.number().int().nonnegative().nullable(),
});

const diagnosticsSourceTypeSchema = z.enum([
  "startup_incremental",
  "manual_incremental",
  "manual_force_reindex",
  "manual_project_force_reindex",
  "watch_targeted",
  "watch_fallback_incremental",
  "watch_initial_scan",
]);

const watcherStatsResponseSchema = z.object({
  startedAt: z.string().min(1),
  watcher: z.object({
    backend: z.enum(["default", "kqueue"]).nullable(),
    watchedRootCount: z.number().int().nonnegative(),
    watchBasedTriggers: z.number().int().nonnegative(),
    fallbackToIncrementalScans: z.number().int().nonnegative(),
    lastTriggerAt: z.string().nullable(),
    lastTriggerPathCount: z.number().int().nonnegative().nullable(),
  }),
  jobs: z.object({
    startupIncremental: diagnosticsSourceSchema,
    manualIncremental: diagnosticsSourceSchema,
    manualForceReindex: diagnosticsSourceSchema,
    manualProjectForceReindex: diagnosticsSourceSchema,
    watchTriggered: diagnosticsSourceSchema,
    watchTargeted: diagnosticsSourceSchema,
    watchFallbackIncremental: diagnosticsSourceSchema,
    watchInitialScan: diagnosticsSourceSchema,
    totals: z.object({
      completedRuns: z.number().int().nonnegative(),
      failedRuns: z.number().int().nonnegative(),
    }),
  }),
  lastRun: z
    .object({
      source: diagnosticsSourceTypeSchema,
      completedAt: z.string().min(1),
      durationMs: z.number().int().nonnegative(),
      success: z.boolean(),
    })
    .nullable(),
});

export const ipcContractSchemas = {
  "app:getHealth": {
    request: z.object({}),
    response: z.object({
      status: z.literal("ok"),
      version: z.string().min(1),
    }),
  },
  "app:flushState": {
    request: z.object({}),
    response: z.object({
      ok: z.literal(true),
    }),
  },
  "app:setCommandState": {
    request: appCommandStateSchema,
    response: z.object({
      ok: z.literal(true),
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
  "dashboard:getStats": {
    request: z.object({}),
    response: z.object({
      summary: dashboardSummarySchema,
      categoryCounts: categoryCountsSchema,
      providerCounts: providerCountsSchema,
      providerStats: z.array(dashboardProviderStatSchema),
      recentActivity: z.array(dashboardActivityPointSchema),
      topProjects: z.array(dashboardProjectStatSchema),
      topModels: z.array(dashboardModelStatSchema),
      aiCodeStats: dashboardAiCodeStatsSchema,
      activityWindowDays: z.number().int().positive(),
    }),
  },
  "indexer:refresh": {
    request: z.object({
      force: z.boolean().default(false),
      projectId: z.string().min(1).optional(),
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
  "sessions:listMany": {
    request: z.object({
      projectIds: z.array(z.string().min(1)).max(500),
    }),
    response: z.object({
      sessionsByProjectId: z.record(z.string(), z.array(sessionSummarySchema)),
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
  "sessions:getTurn": {
    request: z
      .object({
        scopeMode: z.enum(["session", "project_all", "bookmarks"]).default("session"),
        projectId: z.string().min(1).optional(),
        sessionId: z.string().min(1).optional(),
        anchorMessageId: z.string().min(1).optional(),
        turnNumber: z.number().int().positive().optional(),
        latest: z.boolean().optional(),
        query: z.string().default(""),
        searchMode: searchModeSchema.optional(),
        sortDirection: sortDirectionSchema.default("asc"),
      })
      .superRefine((value, context) => {
        const targetCount =
          (value.anchorMessageId ? 1 : 0) +
          (value.turnNumber !== undefined ? 1 : 0) +
          (value.latest ? 1 : 0);
        if (targetCount !== 1) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide exactly one of anchorMessageId, turnNumber, or latest.",
            path: ["anchorMessageId"],
          });
        }
        if (value.scopeMode !== "session" && !value.projectId) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "projectId is required for project_all and bookmarks turn scope.",
            path: ["projectId"],
          });
        }
      }),
    response: z.object({
      session: sessionSummarySchema.nullable(),
      anchorMessageId: z.string().min(1).nullable(),
      anchorMessage: sessionMessageSchema.nullable(),
      turnNumber: z.number().int().nonnegative(),
      totalTurns: z.number().int().nonnegative(),
      previousTurnAnchorMessageId: z.string().min(1).nullable(),
      nextTurnAnchorMessageId: z.string().min(1).nullable(),
      firstTurnAnchorMessageId: z.string().min(1).nullable(),
      latestTurnAnchorMessageId: z.string().min(1).nullable(),
      totalCount: z.number().int().nonnegative(),
      categoryCounts: categoryCountsSchema,
      queryError: z.string().nullable().optional(),
      highlightPatterns: z.array(z.string()).optional(),
      matchedMessageIds: z.array(z.string()).optional(),
      messages: z.array(sessionMessageSchema),
    }),
  },
  "sessions:delete": {
    request: z.object({
      sessionId: z.string().min(1),
    }),
    response: z.object({
      deleted: z.boolean(),
      projectId: z.string().min(1).nullable(),
      provider: providerSchema.nullable(),
      sourceFormat: providerSourceFormatSchema.nullable(),
      removedMessageCount: z.number().int().nonnegative(),
      removedBookmarkCount: z.number().int().nonnegative(),
    }),
  },
  "bookmarks:listProject": {
    request: z.object({
      projectId: z.string().min(1),
      sessionId: z.string().min(1).optional(),
      page: z.number().int().nonnegative().default(0),
      pageSize: z.number().int().positive().max(500).default(100),
      sortDirection: sortDirectionSchema.default("asc"),
      countOnly: z.boolean().optional(),
      query: z.string().optional(),
      searchMode: searchModeSchema.optional(),
      categories: z.array(messageCategorySchema).optional(),
      focusMessageId: z.string().min(1).optional(),
      focusSourceId: z.string().min(1).optional(),
    }),
    response: z.object({
      projectId: z.string().min(1),
      totalCount: z.number().int().nonnegative(),
      filteredCount: z.number().int().nonnegative(),
      page: z.number().int().nonnegative(),
      pageSize: z.number().int().positive(),
      categoryCounts: categoryCountsSchema,
      queryError: z.string().nullable().optional(),
      highlightPatterns: z.array(z.string()).optional(),
      results: z.array(bookmarkEntrySchema),
    }),
  },
  "bookmarks:getStates": {
    request: z.object({
      projectId: z.string().min(1),
      messageIds: z.array(z.string().min(1)).max(500),
    }),
    response: z.object({
      projectId: z.string().min(1),
      bookmarkedMessageIds: z.array(z.string().min(1)),
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
  "projects:delete": {
    request: z.object({
      projectId: z.string().min(1),
    }),
    response: z.object({
      deleted: z.boolean(),
      provider: providerSchema.nullable(),
      sourceFormat: providerSourceFormatSchema.nullable(),
      removedSessionCount: z.number().int().nonnegative(),
      removedMessageCount: z.number().int().nonnegative(),
      removedBookmarkCount: z.number().int().nonnegative(),
    }),
  },
  "history:exportMessages": {
    request: z.object({
      exportId: z.string().min(1),
      mode: historyExportModeSchema,
      projectId: z.string().min(1),
      sessionId: z.string().optional(),
      page: z.number().int().nonnegative().default(0),
      pageSize: z.number().int().positive().max(500).default(100),
      categories: z.array(messageCategorySchema).optional(),
      query: z.string().default(""),
      searchMode: searchModeSchema.optional(),
      sortDirection: sortDirectionSchema.default("asc"),
      scope: historyExportScopeSchema,
    }),
    response: z.object({
      canceled: z.boolean(),
      path: z.string().nullable(),
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
      providerCounts: providerCountsSchema,
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
  "dialog:pickExternalToolCommand": {
    request: z.object({}),
    response: z.object({
      canceled: z.boolean(),
      path: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  "editor:listAvailable": {
    request: z.object({
      externalTools: z.array(externalToolConfigSchema).optional(),
    }),
    response: z.object({
      editors: z.array(
        z.object({
          id: externalToolIdSchema,
          kind: z.enum(["known", "custom"]),
          label: z.string().min(1),
          appId: knownExternalAppSchema.nullable(),
          detected: z.boolean(),
          command: z.string().nullable(),
          args: z.array(z.string()),
          capabilities: z.object({
            openFile: z.boolean(),
            openAtLineColumn: z.boolean(),
            openContent: z.boolean(),
            openDiff: z.boolean(),
          }),
        }),
      ),
      diffTools: z.array(
        z.object({
          id: externalToolIdSchema,
          kind: z.enum(["known", "custom"]),
          label: z.string().min(1),
          appId: knownExternalAppSchema.nullable(),
          detected: z.boolean(),
          command: z.string().nullable(),
          args: z.array(z.string()),
          capabilities: z.object({
            openFile: z.boolean(),
            openAtLineColumn: z.boolean(),
            openContent: z.boolean(),
            openDiff: z.boolean(),
          }),
        }),
      ),
    }),
  },
  "editor:open": {
    request: z.union([
      z.object({
        kind: z.literal("file"),
        toolRole: z.enum(["editor", "diff"]).optional(),
        editorId: externalToolIdSchema.optional(),
        filePath: z.string().min(1),
        line: z.number().int().positive().optional(),
        column: z.number().int().positive().optional(),
      }),
      z.object({
        kind: z.literal("content"),
        toolRole: z.enum(["editor", "diff"]).optional(),
        editorId: externalToolIdSchema.optional(),
        title: z.string().default("Untitled"),
        content: z.string(),
        filePath: z.string().optional(),
        language: z.string().optional(),
        line: z.number().int().positive().optional(),
        column: z.number().int().positive().optional(),
      }),
      z.object({
        kind: z.literal("diff"),
        toolRole: z.literal("diff").optional(),
        editorId: externalToolIdSchema.optional(),
        title: z.string().default("Diff"),
        leftContent: z.string(),
        rightContent: z.string(),
        filePath: z.string().optional(),
        line: z.number().int().positive().optional(),
        column: z.number().int().positive().optional(),
      }),
    ]),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
    }),
  },
  "ui:getPaneState": {
    request: z.object({}),
    response: paneStateSchema,
  },
  "ui:setPaneState": {
    request: paneStatePatchSchema,
    response: z.object({
      ok: z.literal(true),
    }),
  },
  "indexer:getConfig": {
    request: z.object({}),
    response: indexerConfigSchema,
  },
  "indexer:setConfig": {
    request: indexerConfigBaseSchema,
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
  "watcher:getStats": {
    request: z.object({}),
    response: watcherStatsResponseSchema,
  },
  "watcher:getLiveStatus": {
    request: z.object({}),
    response: z.object({
      enabled: z.boolean(),
      revision: z.number().int().nonnegative(),
      updatedAt: z.string(),
      instrumentationEnabled: z.boolean(),
      providerCounts: liveProviderCountsSchema,
      sessions: z.array(liveSessionEntrySchema),
      claudeHookState: claudeHookStateSchema,
    }),
  },
  "watcher:stop": {
    request: z.object({}),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  "claudeHooks:install": {
    request: z.object({}),
    response: z.object({
      ok: z.literal(true),
      state: claudeHookStateSchema,
    }),
  },
  "claudeHooks:remove": {
    request: z.object({}),
    response: z.object({
      ok: z.literal(true),
      state: claudeHookStateSchema,
    }),
  },
  "debug:recordLiveUiTrace": {
    request: liveUiTracePayloadSchema,
    response: z.object({
      ok: z.literal(true),
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
