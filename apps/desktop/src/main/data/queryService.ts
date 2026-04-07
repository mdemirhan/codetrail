import {
  type IpcRequest,
  type IpcRequestInput,
  type IpcResponse,
  type MessageCategory,
  PROVIDER_METADATA,
  type Provider,
  type SearchMode,
  type SearchQueryPlan,
  buildSearchQueryPlan,
  buildWildcardFilterPatterns,
  createProviderRecord,
  makeEmptyCategoryCounts,
  normalizeMessageCategories,
  normalizeMessageCategory,
  openDatabase,
  searchMessages,
} from "@codetrail/core";

import {
  type BookmarkStore,
  type StoredBookmark,
  createBookmarkStore,
  resolveBookmarksDbPath,
} from "./bookmarkStore";
import { summarizeStoredToolEditActivity } from "../../shared/aiCodeActivity";

type DatabaseHandle = ReturnType<typeof openDatabase>;
type OpenDatabase = typeof openDatabase;

type CreateBookmarkStore = (bookmarksDbPath: string) => BookmarkStore;
const EMPTY_SEARCH_QUERY_PLAN = buildSearchQueryPlan("", "simple");
const TOOL_EDIT_FILE_LOAD_BATCH_SIZE = 500;

export type QueryServiceDependencies = {
  openDatabase?: OpenDatabase;
  bookmarksDbPath?: string;
  createBookmarkStore?: CreateBookmarkStore;
  bookmarkStore?: BookmarkStore;
};

type SessionSummaryRow = {
  id: string;
  project_id: string;
  provider: Provider;
  file_path: string;
  title: string;
  model_names: string;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  git_branch: string | null;
  cwd: string | null;
  session_identity: string | null;
  provider_session_id: string | null;
  session_kind: string | null;
  canonical_project_path: string | null;
  repository_url: string | null;
  git_commit_hash: string | null;
  lineage_parent_id: string | null;
  provider_client: string | null;
  provider_source: string | null;
  provider_client_version: string | null;
  resolution_source: string | null;
  worktree_label: string | null;
  worktree_source: string | null;
  metadata_json: string | null;
  activity_at: string | null;
  message_count: number;
  token_input_total: number;
  token_output_total: number;
};

type ProjectSummaryRow = {
  id: string;
  provider: Provider;
  name: string;
  path: string;
  provider_project_key: string | null;
  repository_url: string | null;
  resolution_state: string | null;
  resolution_source: string | null;
  metadata_json: string | null;
  session_count: number;
  message_count: number;
  last_activity: string | null;
};

type IndexCheckpointDeleteRow = {
  file_path: string;
  provider: Provider;
  session_id: string;
  session_identity: string;
  file_size: number;
  file_mtime_ms: number;
  last_offset_bytes: number;
  last_line_number: number;
  last_event_index: number;
  next_message_sequence: number;
  processing_state_json: string;
  source_metadata_json: string;
  head_hash: string;
  tail_hash: string;
};

type MessageRow = {
  id: string;
  source_id: string;
  session_id: string;
  provider: Provider;
  category: string;
  content: string;
  created_at: string;
  created_at_ms: number;
  token_input: number | null;
  token_output: number | null;
  operation_duration_ms: number | null;
  operation_duration_source: "native" | "derived" | null;
  operation_duration_confidence: "high" | "low" | null;
};

type ToolEditFileRow = {
  message_id: string;
  file_ordinal: number;
  file_path: string;
  previous_file_path: string | null;
  change_type: "add" | "update" | "delete" | "move";
  unified_diff: string | null;
  added_line_count: number;
  removed_line_count: number;
  exactness: "exact" | "best_effort";
  before_hash: string | null;
  after_hash: string | null;
};

type ProjectCombinedMessageRow = MessageRow & {
  session_title: string;
  session_started_at: string | null;
  session_ended_at: string | null;
  session_git_branch: string | null;
  session_cwd: string | null;
};

type BookmarkMessageLookupRow = MessageRow & {
  project_id: string;
  session_title: string;
};

type MessageSortDirection = "asc" | "desc";
type FocusTargetRow = {
  id: string;
  created_at: string;
  created_at_ms: number;
};
type DashboardSummaryRow = {
  project_count: number;
  session_count: number;
  message_count: number;
  tool_call_count: number;
  indexed_file_count: number;
  indexed_bytes_total: number;
  token_input_total: number;
  token_output_total: number;
  total_duration_ms: number;
  average_session_duration_ms: number;
};
type DashboardCategoryRow = {
  category: string;
  count: number;
};
type DashboardProviderRow = {
  provider: Provider;
  project_count: number;
  session_count: number;
  message_count: number;
  token_input_total: number;
  token_output_total: number;
  last_activity: string | null;
};
type DashboardToolCallProviderRow = {
  provider: Provider;
  tool_call_count: number;
};
type DashboardActivityRow = {
  date: string;
  session_count: number;
  message_count: number;
};
type DashboardProjectRow = {
  project_id: string;
  provider: Provider;
  name: string;
  path: string;
  session_count: number;
  message_count: number;
  last_activity: string | null;
};
type DashboardModelRow = {
  model_name: string;
  session_count: number;
  message_count: number;
};
type DashboardAiWriteRow = {
  message_id: string;
  session_id: string;
  provider: Provider;
  created_at: string;
  tool_name: string | null;
  args_json: string | null;
};

type DashboardAiCodeStats = IpcResponse<"dashboard:getStats">["aiCodeStats"];

type TurnAnchorRow = {
  id: string;
  session_id: string;
  created_at: string;
  created_at_ms: number;
};

type TurnAnchorScopeSql = {
  fromSql: string;
  whereClause: string;
  params: Array<string | number>;
};

type TurnNavigationMetadata = {
  turnNumber: number;
  totalTurns: number;
  previousTurnAnchorMessageId: string | null;
  nextTurnAnchorMessageId: string | null;
  firstTurnAnchorMessageId: string | null;
  latestTurnAnchorMessageId: string | null;
};

export type QueryService = {
  getDashboardStats: () => IpcResponse<"dashboard:getStats">;
  listProjects: (request: IpcRequest<"projects:list">) => IpcResponse<"projects:list">;
  getProjectById: (projectId: string) => IpcResponse<"projects:list">["projects"][number] | null;
  getProjectCombinedDetail: (
    request: IpcRequest<"projects:getCombinedDetail">,
  ) => IpcResponse<"projects:getCombinedDetail">;
  deleteProject: (request: IpcRequest<"projects:delete">) => IpcResponse<"projects:delete">;
  listSessions: (request: IpcRequest<"sessions:list">) => IpcResponse<"sessions:list">;
  listSessionsMany: (request: IpcRequest<"sessions:listMany">) => IpcResponse<"sessions:listMany">;
  getSessionDetail: (
    request: IpcRequest<"sessions:getDetail">,
  ) => IpcResponse<"sessions:getDetail">;
  getSessionTurn: (request: IpcRequest<"sessions:getTurn">) => IpcResponse<"sessions:getTurn">;
  deleteSession: (request: IpcRequest<"sessions:delete">) => IpcResponse<"sessions:delete">;
  listProjectBookmarks: (
    request: IpcRequestInput<"bookmarks:listProject">,
  ) => IpcResponse<"bookmarks:listProject">;
  getBookmarkStates: (
    request: IpcRequest<"bookmarks:getStates">,
  ) => IpcResponse<"bookmarks:getStates">;
  toggleBookmark: (request: IpcRequest<"bookmarks:toggle">) => IpcResponse<"bookmarks:toggle">;
  runSearchQuery: (request: IpcRequest<"search:query">) => IpcResponse<"search:query">;
  listRecentLiveSessionFiles: (input: {
    providers: Provider[];
    minFileMtimeMs: number;
    limit: number;
  }) => Array<{
    filePath: string;
    provider: Provider;
    fileMtimeMs: number;
  }>;
  close: () => void;
};

// QueryService keeps SQL and bookmark resolution in one place so IPC handlers stay thin and the
// renderer only deals with typed responses.
export function createQueryService(
  dbPath: string,
  dependencies: QueryServiceDependencies = {},
): QueryService {
  const openDatabaseFn = dependencies.openDatabase ?? openDatabase;
  const db = openDatabaseFn(dbPath);
  const bookmarkStore =
    dependencies.bookmarkStore ??
    (dependencies.createBookmarkStore ?? createBookmarkStore)(
      dependencies.bookmarksDbPath ?? resolveBookmarksDbPath(dbPath),
    );

  return createQueryServiceFromDb(db, {
    bookmarkStore,
    ownsBookmarkStore: dependencies.bookmarkStore === undefined,
  });
}

export function createQueryServiceFromDb(
  db: DatabaseHandle,
  dependencies: {
    bookmarkStore?: BookmarkStore;
    createBookmarkStore?: CreateBookmarkStore;
    ownsBookmarkStore?: boolean;
  } = {},
): QueryService {
  const bookmarkStore =
    dependencies.bookmarkStore ??
    (dependencies.createBookmarkStore ?? createBookmarkStore)(":memory:");
  const ownsBookmarkStore =
    dependencies.ownsBookmarkStore ?? dependencies.bookmarkStore === undefined;

  let closed = false;
  return {
    getDashboardStats: () => getDashboardStatsWithDatabase(db, bookmarkStore),
    listProjects: (request) => listProjectsWithDatabase(db, bookmarkStore, request),
    getProjectById: (projectId) => getProjectByIdWithDatabase(db, bookmarkStore, projectId),
    getProjectCombinedDetail: (request) => getProjectCombinedDetailWithDatabase(db, request),
    deleteProject: (request) => deleteProjectWithStore(db, bookmarkStore, request),
    listSessions: (request) => listSessionsWithDatabase(db, bookmarkStore, request),
    listSessionsMany: (request) => listSessionsManyWithDatabase(db, bookmarkStore, request),
    getSessionDetail: (request) => getSessionDetailWithDatabase(db, request),
    getSessionTurn: (request) => getSessionTurnWithDatabase(db, bookmarkStore, request),
    deleteSession: (request) => deleteSessionWithStore(db, bookmarkStore, request),
    listProjectBookmarks: (request) => listProjectBookmarksWithStore(db, bookmarkStore, request),
    getBookmarkStates: (request) => getBookmarkStatesWithStore(bookmarkStore, request),
    toggleBookmark: (request) => toggleBookmarkWithStore(db, bookmarkStore, request),
    runSearchQuery: (request) => runSearchQueryWithDatabase(db, request),
    listRecentLiveSessionFiles: (input) => listRecentLiveSessionFilesWithDatabase(db, input),
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      db.close();
      if (ownsBookmarkStore) {
        bookmarkStore.close();
      }
    },
  };
}

function getDashboardStatsWithDatabase(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
): IpcResponse<"dashboard:getStats"> {
  const summaryRow = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM projects) AS project_count,
         (SELECT COUNT(*) FROM sessions) AS session_count,
         (SELECT COUNT(*) FROM messages) AS message_count,
         (SELECT COUNT(*) FROM tool_calls) AS tool_call_count,
         (SELECT COUNT(*) FROM indexed_files) AS indexed_file_count,
         (SELECT COALESCE(SUM(file_size), 0) FROM indexed_files) AS indexed_bytes_total,
         (SELECT COALESCE(SUM(token_input_total), 0) FROM sessions) AS token_input_total,
         (SELECT COALESCE(SUM(token_output_total), 0) FROM sessions) AS token_output_total,
         (SELECT COALESCE(SUM(duration_ms), 0) FROM sessions WHERE duration_ms IS NOT NULL) AS total_duration_ms,
         (SELECT COALESCE(AVG(duration_ms), 0) FROM sessions WHERE duration_ms IS NOT NULL) AS average_session_duration_ms`,
    )
    .get() as DashboardSummaryRow | undefined;

  const categoryCounts = makeEmptyCategoryCounts();
  const categoryRows = db
    .prepare("SELECT category, COUNT(*) AS count FROM messages GROUP BY category")
    .all() as DashboardCategoryRow[];
  for (const row of categoryRows) {
    categoryCounts[normalizeMessageCategory(row.category)] = Number(row.count ?? 0);
  }

  const providerCounts = createProviderRecord(() => 0);
  const providerStatsByProvider = createProviderRecord((provider) => ({
    provider,
    projectCount: 0,
    sessionCount: 0,
    messageCount: 0,
    toolCallCount: 0,
    tokenInputTotal: 0,
    tokenOutputTotal: 0,
    lastActivity: null as string | null,
  }));

  const providerRows = db
    .prepare(
      `SELECT
         provider,
         COUNT(DISTINCT project_id) AS project_count,
         COUNT(*) AS session_count,
         COALESCE(SUM(message_count), 0) AS message_count,
         COALESCE(SUM(token_input_total), 0) AS token_input_total,
         COALESCE(SUM(token_output_total), 0) AS token_output_total,
         MAX(activity_at) AS last_activity
       FROM sessions
       GROUP BY provider`,
    )
    .all() as DashboardProviderRow[];
  for (const row of providerRows) {
    providerCounts[row.provider] = Number(row.message_count ?? 0);
    providerStatsByProvider[row.provider] = {
      provider: row.provider,
      projectCount: Number(row.project_count ?? 0),
      sessionCount: Number(row.session_count ?? 0),
      messageCount: Number(row.message_count ?? 0),
      toolCallCount: 0,
      tokenInputTotal: Number(row.token_input_total ?? 0),
      tokenOutputTotal: Number(row.token_output_total ?? 0),
      lastActivity: row.last_activity ?? null,
    };
  }

  const toolCallRows = db
    .prepare(
      `SELECT m.provider AS provider, COUNT(*) AS tool_call_count
       FROM tool_calls tc
       JOIN messages m ON m.id = tc.message_id
       GROUP BY m.provider`,
    )
    .all() as DashboardToolCallProviderRow[];
  for (const row of toolCallRows) {
    providerStatsByProvider[row.provider] = {
      ...providerStatsByProvider[row.provider],
      toolCallCount: Number(row.tool_call_count ?? 0),
    };
  }

  const activityWindowDays = 14;
  const activityStart = new Date();
  activityStart.setUTCHours(0, 0, 0, 0);
  activityStart.setUTCDate(activityStart.getUTCDate() - (activityWindowDays - 1));
  const recentActivityRows = db
    .prepare(
      `SELECT
         substr(created_at, 1, 10) AS date,
         COUNT(DISTINCT session_id) AS session_count,
         COUNT(*) AS message_count
       FROM messages
       WHERE created_at >= ?
       GROUP BY substr(created_at, 1, 10)
       ORDER BY date ASC`,
    )
    .all(activityStart.toISOString()) as DashboardActivityRow[];
  const recentActivityByDate = new Map(
    recentActivityRows.map((row) => [
      row.date,
      {
        date: row.date,
        sessionCount: Number(row.session_count ?? 0),
        messageCount: Number(row.message_count ?? 0),
      },
    ]),
  );
  const recentActivity = Array.from({ length: activityWindowDays }, (_, index) => {
    const date = new Date(activityStart);
    date.setUTCDate(activityStart.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return (
      recentActivityByDate.get(key) ?? {
        date: key,
        sessionCount: 0,
        messageCount: 0,
      }
    );
  });
  const aiCodeStats = collectDashboardAiCodeStats(db, recentActivity.map((point) => point.date));

  const topProjectRows = db
    .prepare(
      `SELECT
         p.id AS project_id,
         p.provider AS provider,
         p.name AS name,
         p.path AS path,
         COALESCE(ps.session_count, 0) AS session_count,
         COALESCE(ps.message_count, 0) AS message_count,
         ps.last_activity AS last_activity
       FROM projects p
       LEFT JOIN project_stats ps ON ps.project_id = p.id
       ORDER BY COALESCE(ps.message_count, 0) DESC, COALESCE(ps.session_count, 0) DESC, p.name ASC
       LIMIT 6`,
    )
    .all() as DashboardProjectRow[];
  const topProjectBookmarkCounts = bookmarkStore.countProjectBookmarksByProjectIds?.(
    topProjectRows.map((row) => row.project_id),
  );
  const topProjects = topProjectRows.map((row) => ({
    projectId: row.project_id,
    provider: row.provider,
    name: row.name,
    path: row.path,
    sessionCount: Number(row.session_count ?? 0),
    messageCount: Number(row.message_count ?? 0),
    bookmarkCount: Number(topProjectBookmarkCounts?.[row.project_id] ?? 0),
    lastActivity: row.last_activity ?? null,
  }));

  const topModels = db
    .prepare(
      `SELECT
         model_names AS model_name,
         COUNT(*) AS session_count,
         COALESCE(SUM(message_count), 0) AS message_count
       FROM sessions
       WHERE TRIM(model_names) <> ''
       GROUP BY model_names
       ORDER BY COALESCE(SUM(message_count), 0) DESC, COUNT(*) DESC, model_names ASC
       LIMIT 6`,
    )
    .all() as DashboardModelRow[];

  const summary = {
    projectCount: Number(summaryRow?.project_count ?? 0),
    sessionCount: Number(summaryRow?.session_count ?? 0),
    messageCount: Number(summaryRow?.message_count ?? 0),
    bookmarkCount: Number(bookmarkStore.countAllBookmarks?.() ?? 0),
    toolCallCount: Number(summaryRow?.tool_call_count ?? 0),
    indexedFileCount: Number(summaryRow?.indexed_file_count ?? 0),
    indexedBytesTotal: Number(summaryRow?.indexed_bytes_total ?? 0),
    tokenInputTotal: Number(summaryRow?.token_input_total ?? 0),
    tokenOutputTotal: Number(summaryRow?.token_output_total ?? 0),
    totalDurationMs: Number(summaryRow?.total_duration_ms ?? 0),
    averageMessagesPerSession:
      Number(summaryRow?.session_count ?? 0) > 0
        ? Number(summaryRow?.message_count ?? 0) / Number(summaryRow?.session_count ?? 1)
        : 0,
    averageSessionDurationMs: Number(summaryRow?.average_session_duration_ms ?? 0),
    activeProviderCount: Object.values(providerStatsByProvider).filter(
      (stats) => stats.projectCount > 0 || stats.sessionCount > 0 || stats.messageCount > 0,
    ).length,
  };

  return {
    summary,
    categoryCounts,
    providerCounts,
    providerStats: Object.values(providerStatsByProvider),
    recentActivity,
    topProjects,
    topModels: topModels.map((row) => ({
      modelName: row.model_name,
      sessionCount: Number(row.session_count ?? 0),
      messageCount: Number(row.message_count ?? 0),
    })),
    aiCodeStats,
    activityWindowDays,
  };
}

function collectDashboardAiCodeStats(
  db: DatabaseHandle,
  recentDateKeys: string[],
): DashboardAiCodeStats {
  const providerStatsByProvider = createProviderRecord((provider) => ({
    provider,
    writeEventCount: 0,
    fileChangeCount: 0,
    linesAdded: 0,
    linesDeleted: 0,
    writeSessionCount: 0,
  }));
  const providerSessionIds = createProviderRecord(() => new Set<string>());
  const changeTypeCounts: DashboardAiCodeStats["changeTypeCounts"] = {
    add: 0,
    update: 0,
    delete: 0,
  };
  const recentActivityByDate = new Map(
    recentDateKeys.map((date) => [
      date,
      {
        date,
        writeEventCount: 0,
        fileChangeCount: 0,
        linesAdded: 0,
        linesDeleted: 0,
      },
    ]),
  );
  const fileStatsByPath = new Map<
    string,
    {
      filePath: string;
      writeEventCount: number;
      linesAdded: number;
      linesDeleted: number;
      lastTouchedAt: string | null;
    }
  >();
  const fileTypeStatsByLabel = new Map<
    string,
    {
      label: string;
      fileChangeCount: number;
      linesAdded: number;
      linesDeleted: number;
    }
  >();
  const distinctSessionIds = new Set<string>();
  const distinctFilesTouched = new Set<string>();
  const writeRows = db
    .prepare(
      `SELECT
         m.id AS message_id,
         m.session_id AS session_id,
         m.provider AS provider,
         m.created_at AS created_at,
         tc.tool_name AS tool_name,
         tc.args_json AS args_json
       FROM messages m
       LEFT JOIN tool_calls tc ON tc.message_id = m.id
       WHERE m.category = 'tool_edit'
       ORDER BY m.created_at ASC, m.id ASC`,
    )
    .all() as DashboardAiWriteRow[];

  let measurableWriteEventCount = 0;
  let fileChangeCount = 0;
  let linesAdded = 0;
  let linesDeleted = 0;
  let multiFileWriteCount = 0;

  for (const row of writeRows) {
    distinctSessionIds.add(row.session_id);
    providerStatsByProvider[row.provider] = {
      ...providerStatsByProvider[row.provider],
      writeEventCount: providerStatsByProvider[row.provider].writeEventCount + 1,
    };
    providerSessionIds[row.provider].add(row.session_id);

    const activityPoint = recentActivityByDate.get(row.created_at.slice(0, 10));
    if (activityPoint) {
      activityPoint.writeEventCount += 1;
    }

    const editSummary = summarizeStoredToolEditActivity({
      toolName: row.tool_name,
      argsJson: row.args_json,
    });
    if (!editSummary || editSummary.files.length === 0) {
      continue;
    }

    measurableWriteEventCount += 1;
    if (editSummary.files.length > 1) {
      multiFileWriteCount += 1;
    }

    const eventTouchedPaths = new Set<string>();
    for (const file of editSummary.files) {
      fileChangeCount += 1;
      linesAdded += file.linesAdded;
      linesDeleted += file.linesDeleted;
      distinctFilesTouched.add(file.filePath);
      changeTypeCounts[file.changeType] += 1;
      eventTouchedPaths.add(file.filePath);

      providerStatsByProvider[row.provider] = {
        ...providerStatsByProvider[row.provider],
        fileChangeCount: providerStatsByProvider[row.provider].fileChangeCount + 1,
        linesAdded: providerStatsByProvider[row.provider].linesAdded + file.linesAdded,
        linesDeleted: providerStatsByProvider[row.provider].linesDeleted + file.linesDeleted,
      };

      if (activityPoint) {
        activityPoint.fileChangeCount += 1;
        activityPoint.linesAdded += file.linesAdded;
        activityPoint.linesDeleted += file.linesDeleted;
      }

      const existingFileStat = fileStatsByPath.get(file.filePath);
      if (existingFileStat) {
        existingFileStat.linesAdded += file.linesAdded;
        existingFileStat.linesDeleted += file.linesDeleted;
        if (!existingFileStat.lastTouchedAt || row.created_at > existingFileStat.lastTouchedAt) {
          existingFileStat.lastTouchedAt = row.created_at;
        }
      } else {
        fileStatsByPath.set(file.filePath, {
          filePath: file.filePath,
          writeEventCount: 0,
          linesAdded: file.linesAdded,
          linesDeleted: file.linesDeleted,
          lastTouchedAt: row.created_at,
        });
      }

      const fileTypeLabel = inferDashboardFileTypeLabel(file.filePath);
      const existingFileTypeStat = fileTypeStatsByLabel.get(fileTypeLabel);
      if (existingFileTypeStat) {
        existingFileTypeStat.fileChangeCount += 1;
        existingFileTypeStat.linesAdded += file.linesAdded;
        existingFileTypeStat.linesDeleted += file.linesDeleted;
      } else {
        fileTypeStatsByLabel.set(fileTypeLabel, {
          label: fileTypeLabel,
          fileChangeCount: 1,
          linesAdded: file.linesAdded,
          linesDeleted: file.linesDeleted,
        });
      }
    }

    for (const filePath of eventTouchedPaths) {
      const fileStat = fileStatsByPath.get(filePath);
      if (fileStat) {
        fileStat.writeEventCount += 1;
      }
    }
  }

  for (const provider of Object.keys(providerStatsByProvider) as Provider[]) {
    providerStatsByProvider[provider] = {
      ...providerStatsByProvider[provider],
      writeSessionCount: providerSessionIds[provider].size,
    };
  }

  return {
    summary: {
      writeEventCount: writeRows.length,
      measurableWriteEventCount,
      writeSessionCount: distinctSessionIds.size,
      fileChangeCount,
      distinctFilesTouchedCount: distinctFilesTouched.size,
      linesAdded,
      linesDeleted,
      netLines: linesAdded - linesDeleted,
      multiFileWriteCount,
      averageFilesPerWrite:
        measurableWriteEventCount > 0 ? fileChangeCount / measurableWriteEventCount : 0,
    },
    changeTypeCounts,
    providerStats: Object.values(providerStatsByProvider),
    recentActivity: recentDateKeys.map((date) => {
      return (
        recentActivityByDate.get(date) ?? {
          date,
          writeEventCount: 0,
          fileChangeCount: 0,
          linesAdded: 0,
          linesDeleted: 0,
        }
      );
    }),
    topFiles: Array.from(fileStatsByPath.values())
      .sort((left, right) => {
        const leftTotal = left.linesAdded + left.linesDeleted;
        const rightTotal = right.linesAdded + right.linesDeleted;
        if (rightTotal !== leftTotal) {
          return rightTotal - leftTotal;
        }
        if (right.writeEventCount !== left.writeEventCount) {
          return right.writeEventCount - left.writeEventCount;
        }
        if ((right.lastTouchedAt ?? "") !== (left.lastTouchedAt ?? "")) {
          return (right.lastTouchedAt ?? "").localeCompare(left.lastTouchedAt ?? "");
        }
        return left.filePath.localeCompare(right.filePath);
      })
      .slice(0, 6),
    topFileTypes: Array.from(fileTypeStatsByLabel.values())
      .sort((left, right) => {
        if (right.fileChangeCount !== left.fileChangeCount) {
          return right.fileChangeCount - left.fileChangeCount;
        }
        const leftTotal = left.linesAdded + left.linesDeleted;
        const rightTotal = right.linesAdded + right.linesDeleted;
        if (rightTotal !== leftTotal) {
          return rightTotal - leftTotal;
        }
        return left.label.localeCompare(right.label);
      })
      .slice(0, 6),
  };
}

function inferDashboardFileTypeLabel(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const baseName = normalized.slice(normalized.lastIndexOf("/") + 1);
  const extensionIndex = baseName.lastIndexOf(".");
  if (extensionIndex <= 0 || extensionIndex === baseName.length - 1) {
    if (baseName.startsWith(".") && !baseName.slice(1).includes(".")) {
      return baseName.toLowerCase();
    }
    return "No extension";
  }
  return baseName.slice(extensionIndex).toLowerCase();
}

function listRecentLiveSessionFilesWithDatabase(
  db: DatabaseHandle,
  input: {
    providers: Provider[];
    minFileMtimeMs: number;
    limit: number;
  },
): Array<{
  filePath: string;
  provider: Provider;
  fileMtimeMs: number;
}> {
  if (input.providers.length === 0 || input.limit <= 0) {
    return [];
  }

  const placeholders = input.providers.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT file_path, provider, file_mtime_ms
       FROM indexed_files
       WHERE provider IN (${placeholders})
         AND file_mtime_ms >= ?
       ORDER BY file_mtime_ms DESC, file_path ASC
       LIMIT ?`,
    )
    .all(...input.providers, input.minFileMtimeMs, input.limit) as Array<{
    file_path: string;
    provider: Provider;
    file_mtime_ms: number;
  }>;

  return rows.map((row) => ({
    filePath: row.file_path,
    provider: row.provider,
    fileMtimeMs: row.file_mtime_ms,
  }));
}

export function listProjects(
  dbPath: string,
  request: IpcRequest<"projects:list">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"projects:list"> {
  return withDatabaseAndBookmarkStore(
    dbPath,
    (db, bookmarkStore) => listProjectsWithDatabase(db, bookmarkStore, request),
    dependencies,
  );
}

export function listSessions(
  dbPath: string,
  request: IpcRequest<"sessions:list">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"sessions:list"> {
  return withDatabaseAndBookmarkStore(
    dbPath,
    (db, bookmarkStore) => listSessionsWithDatabase(db, bookmarkStore, request),
    dependencies,
  );
}

export function listSessionsMany(
  dbPath: string,
  request: IpcRequest<"sessions:listMany">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"sessions:listMany"> {
  return withDatabaseAndBookmarkStore(
    dbPath,
    (db, bookmarkStore) => listSessionsManyWithDatabase(db, bookmarkStore, request),
    dependencies,
  );
}

export function deleteProject(
  dbPath: string,
  request: IpcRequest<"projects:delete">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"projects:delete"> {
  return withDatabaseAndBookmarkStore(
    dbPath,
    (db, bookmarkStore) => deleteProjectWithStore(db, bookmarkStore, request),
    dependencies,
  );
}

export function getProjectCombinedDetail(
  dbPath: string,
  request: IpcRequest<"projects:getCombinedDetail">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"projects:getCombinedDetail"> {
  return withDatabase(
    dbPath,
    (db) => getProjectCombinedDetailWithDatabase(db, request),
    dependencies.openDatabase,
  );
}

export function getSessionDetail(
  dbPath: string,
  request: IpcRequest<"sessions:getDetail">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"sessions:getDetail"> {
  return withDatabase(
    dbPath,
    (db) => getSessionDetailWithDatabase(db, request),
    dependencies.openDatabase,
  );
}

export function getSessionTurn(
  dbPath: string,
  request: IpcRequest<"sessions:getTurn">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"sessions:getTurn"> {
  return withDatabaseAndBookmarkStore(
    dbPath,
    (db, bookmarkStore) => getSessionTurnWithDatabase(db, bookmarkStore, request),
    dependencies,
  );
}

export function deleteSession(
  dbPath: string,
  request: IpcRequest<"sessions:delete">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"sessions:delete"> {
  return withDatabaseAndBookmarkStore(
    dbPath,
    (db, bookmarkStore) => deleteSessionWithStore(db, bookmarkStore, request),
    dependencies,
  );
}

export function listProjectBookmarks(
  dbPath: string,
  request: IpcRequestInput<"bookmarks:listProject">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"bookmarks:listProject"> {
  return withDatabaseAndBookmarkStore(
    dbPath,
    (db, bookmarkStore) => listProjectBookmarksWithStore(db, bookmarkStore, request),
    dependencies,
  );
}

export function getBookmarkStates(
  dbPath: string,
  request: IpcRequest<"bookmarks:getStates">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"bookmarks:getStates"> {
  return withDatabaseAndBookmarkStore(
    dbPath,
    (_db, bookmarkStore) => getBookmarkStatesWithStore(bookmarkStore, request),
    dependencies,
  );
}

export function toggleBookmark(
  dbPath: string,
  request: IpcRequest<"bookmarks:toggle">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"bookmarks:toggle"> {
  return withDatabaseAndBookmarkStore(
    dbPath,
    (db, bookmarkStore) => toggleBookmarkWithStore(db, bookmarkStore, request),
    dependencies,
  );
}

export function runSearchQuery(
  dbPath: string,
  request: IpcRequest<"search:query">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"search:query"> {
  return withDatabase(
    dbPath,
    (db) => runSearchQueryWithDatabase(db, request),
    dependencies.openDatabase,
  );
}

function listProjectsWithDatabase(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
  request: IpcRequest<"projects:list">,
): IpcResponse<"projects:list"> {
  if (request.providers && request.providers.length === 0) {
    return { projects: [] };
  }

  const conditions: string[] = [];
  const params: Array<string> = [];

  if (request.providers && request.providers.length > 0) {
    conditions.push(`p.provider IN (${request.providers.map(() => "?").join(",")})`);
    params.push(...request.providers);
  }

  const projectPatterns = buildWildcardFilterPatterns(request.query);
  for (const pattern of projectPatterns) {
    conditions.push("(p.name_folded LIKE ? ESCAPE '\\' OR p.path_folded LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }

  const rows = db
    .prepare(
      `SELECT
         p.id,
         p.provider,
         p.name,
         p.path,
         p.provider_project_key,
         p.repository_url,
         p.resolution_state,
         p.resolution_source,
         p.metadata_json,
         COALESCE(ps.session_count, 0) as session_count,
         COALESCE(ps.message_count, 0) as message_count,
         ps.last_activity as last_activity
       FROM projects p
       LEFT JOIN project_stats ps ON ps.project_id = p.id
       ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY p.provider, p.name_folded, p.id`,
    )
    .all(...params) as ProjectSummaryRow[];
  const bookmarkCounts =
    bookmarkStore.countProjectBookmarksByProjectIds?.(rows.map((row) => row.id)) ?? {};

  return {
    projects: rows.map((row) =>
      mapProjectSummaryRow(
        row,
        bookmarkCounts[row.id] ?? bookmarkStore.countProjectBookmarks(row.id),
      ),
    ),
  };
}

function getProjectByIdWithDatabase(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
  projectId: string,
): IpcResponse<"projects:list">["projects"][number] | null {
  const row = db
    .prepare(
      `SELECT
         p.id,
         p.provider,
         p.name,
         p.path,
         p.provider_project_key,
         p.repository_url,
         p.resolution_state,
         p.resolution_source,
         p.metadata_json,
         COALESCE(ps.session_count, 0) as session_count,
         COALESCE(ps.message_count, 0) as message_count,
         ps.last_activity as last_activity
       FROM projects p
       LEFT JOIN project_stats ps ON ps.project_id = p.id
       WHERE p.id = ?`,
    )
    .get(projectId) as ProjectSummaryRow | undefined;

  if (!row) {
    return null;
  }

  return mapProjectSummaryRow(row, bookmarkStore.countProjectBookmarks(row.id));
}

function mapProjectSummaryRow(
  row: ProjectSummaryRow,
  bookmarkCount: number,
): IpcResponse<"projects:list">["projects"][number] {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    path: row.path,
    providerProjectKey: row.provider_project_key,
    repositoryUrl: row.repository_url,
    resolutionState: row.resolution_state,
    resolutionSource: row.resolution_source,
    metadataJson: row.metadata_json,
    sessionCount: row.session_count,
    messageCount: row.message_count,
    bookmarkCount,
    lastActivity: row.last_activity,
  };
}

function listSessionsWithDatabase(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
  request: IpcRequest<"sessions:list">,
): IpcResponse<"sessions:list"> {
  const params: string[] = [];
  const whereClause = request.projectId ? "WHERE s.project_id = ?" : "";
  if (request.projectId) {
    params.push(request.projectId);
  }

  const rows = db
    .prepare(
      `SELECT
         s.id,
         s.project_id,
         s.provider,
         s.file_path,
         s.title,
         s.model_names,
         s.started_at,
         s.ended_at,
         s.activity_at,
         s.duration_ms,
         s.git_branch,
         s.cwd,
         s.session_identity,
         s.provider_session_id,
         s.session_kind,
         s.canonical_project_path,
         s.repository_url,
         s.git_commit_hash,
         s.lineage_parent_id,
         s.provider_client,
         s.provider_source,
         s.provider_client_version,
         s.resolution_source,
         s.worktree_label,
         s.worktree_source,
         s.metadata_json,
         s.message_count,
         s.token_input_total,
         s.token_output_total
       FROM sessions s
       ${whereClause}
       ORDER BY s.activity_at_ms DESC, s.activity_at DESC, s.id DESC`,
    )
    .all(...params) as SessionSummaryRow[];
  const sessionBookmarkCounts =
    request.projectId && bookmarkStore.countSessionBookmarksBySessionIds
      ? bookmarkStore.countSessionBookmarksBySessionIds(
          request.projectId,
          rows.map((row) => row.id),
        )
      : {};

  return {
    sessions: rows.map((row) =>
      mapSessionSummaryRow(
        row,
        request.projectId
          ? (sessionBookmarkCounts[row.id] ??
              bookmarkStore.countSessionBookmarks(request.projectId, row.id))
          : 0,
      ),
    ),
  };
}

function listSessionsManyWithDatabase(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
  request: IpcRequest<"sessions:listMany">,
): IpcResponse<"sessions:listMany"> {
  const projectIds = [...new Set(request.projectIds.filter((projectId) => projectId.length > 0))];
  if (projectIds.length === 0) {
    return { sessionsByProjectId: {} };
  }

  const placeholders = projectIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT
         s.id,
         s.project_id,
         s.provider,
         s.file_path,
         s.title,
         s.model_names,
         s.started_at,
         s.ended_at,
         s.activity_at,
         s.duration_ms,
         s.git_branch,
         s.cwd,
         s.session_identity,
         s.provider_session_id,
         s.session_kind,
         s.canonical_project_path,
         s.repository_url,
         s.git_commit_hash,
         s.lineage_parent_id,
         s.provider_client,
         s.provider_source,
         s.provider_client_version,
         s.resolution_source,
         s.worktree_label,
         s.worktree_source,
         s.message_count,
         s.token_input_total,
         s.token_output_total
       FROM sessions s
       WHERE s.project_id IN (${placeholders})
       ORDER BY s.project_id ASC, s.activity_at_ms DESC, s.activity_at DESC, s.id DESC`,
    )
    .all(...projectIds) as SessionSummaryRow[];

  const rowsByProjectId = new Map<string, SessionSummaryRow[]>();
  for (const row of rows) {
    const bucket = rowsByProjectId.get(row.project_id);
    if (bucket) {
      bucket.push(row);
    } else {
      rowsByProjectId.set(row.project_id, [row]);
    }
  }

  const sessionsByProjectId = Object.fromEntries(
    projectIds.map((projectId) => {
      const sessionRows = rowsByProjectId.get(projectId) ?? [];
      const sessionBookmarkCounts = bookmarkStore.countSessionBookmarksBySessionIds
        ? bookmarkStore.countSessionBookmarksBySessionIds(
            projectId,
            sessionRows.map((row) => row.id),
          )
        : {};
      return [
        projectId,
        sessionRows.map((row) =>
          mapSessionSummaryRow(
            row,
            sessionBookmarkCounts[row.id] ?? bookmarkStore.countSessionBookmarks(projectId, row.id),
          ),
        ),
      ];
    }),
  ) as IpcResponse<"sessions:listMany">["sessionsByProjectId"];

  return { sessionsByProjectId };
}

function getProjectCombinedDetailWithDatabase(
  db: DatabaseHandle,
  request: IpcRequest<"projects:getCombinedDetail">,
): IpcResponse<"projects:getCombinedDetail"> {
  const { messageOrder, focusComparison } = buildMessageSortSql(request.sortDirection);
  const pageSize = request.pageSize;
  let page = request.page;
  const normalizedQuery = request.query.trim();
  const queryPlan = buildSearchQueryPlan(request.query, request.searchMode ?? "simple");
  const messageFilters: {
    projectId: string;
    categories?: string[];
    queryPlan: SearchQueryPlan;
  } = {
    projectId: request.projectId,
    queryPlan,
  };
  if (request.categories !== undefined) {
    messageFilters.categories = request.categories;
  }

  if (queryPlan.error) {
    return {
      projectId: request.projectId,
      totalCount: 0,
      categoryCounts: makeEmptyCategoryCounts(),
      page: 0,
      pageSize,
      focusIndex: null,
      queryError: queryPlan.error,
      highlightPatterns: [],
      messages: [],
    };
  }
  if (normalizedQuery.length > 0 && !queryPlan.hasTerms) {
    return {
      projectId: request.projectId,
      totalCount: 0,
      categoryCounts: makeEmptyCategoryCounts(),
      page: 0,
      pageSize,
      focusIndex: null,
      queryError: null,
      highlightPatterns: [],
      messages: [],
    };
  }

  const { whereClause, params } = buildProjectMessageFilters(messageFilters);

  const focusTarget = resolveFocusTarget(db, {
    focusMessageId: request.focusMessageId,
    focusSourceId: request.focusSourceId,
    byMessageIdSql:
      "SELECT m.id, m.created_at, m.created_at_ms FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.project_id = ? AND m.id = ?",
    byMessageIdParams: request.focusMessageId ? [request.projectId, request.focusMessageId] : [],
    bySourceIdSql:
      "SELECT m.id, m.created_at, m.created_at_ms FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.project_id = ? AND m.source_id = ? ORDER BY m.created_at_ms ASC, m.created_at ASC, m.id ASC LIMIT 1",
    bySourceIdParams: request.focusSourceId ? [request.projectId, request.focusSourceId] : [],
  });
  const overview = loadMessageDetailOverview({
    db,
    fromSql: `FROM messages m
              JOIN sessions s ON s.id = m.session_id`,
    whereClause,
    params,
    focusComparison,
    ...(focusTarget ? { focusTarget } : {}),
  });
  const totalCount = overview.totalCount;
  const queryOnlyFilter = buildProjectMessageFilters({
    projectId: request.projectId,
    queryPlan,
  });
  const categoryCounts = loadCategoryCounts(
    db,
    `FROM messages m
              JOIN sessions s ON s.id = m.session_id`,
    queryOnlyFilter.whereClause,
    queryOnlyFilter.params,
  );
  const focusIndex = overview.focusIndex;
  if (focusIndex !== null) {
    page = Math.floor(focusIndex / pageSize);
  }

  if (totalCount > 0 && page * pageSize >= totalCount) {
    page = Math.floor((totalCount - 1) / pageSize);
  }

  const rows = db
    .prepare(
      `SELECT
         m.id,
         m.source_id,
         m.session_id,
         m.provider,
         m.category,
         m.content,
         m.created_at,
         m.created_at_ms,
         m.token_input,
         m.token_output,
         m.operation_duration_ms,
         m.operation_duration_source,
         m.operation_duration_confidence,
         s.title as session_title,
         s.started_at as session_started_at,
         s.ended_at as session_ended_at,
         s.git_branch as session_git_branch,
         s.cwd as session_cwd
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE ${whereClause}
       ORDER BY ${messageOrder}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, page * pageSize) as ProjectCombinedMessageRow[];

  return {
    projectId: request.projectId,
    totalCount,
    categoryCounts,
    page,
    pageSize,
    focusIndex,
    queryError: null,
    highlightPatterns: queryPlan.highlightPatterns,
    messages: mapProjectCombinedMessageRows(db, rows),
  };
}

function getSessionDetailWithDatabase(
  db: DatabaseHandle,
  request: IpcRequest<"sessions:getDetail">,
): IpcResponse<"sessions:getDetail"> {
  const { messageOrder, focusComparison } = buildMessageSortSql(request.sortDirection);
  const sessionRow = db
    .prepare(
      `SELECT
         s.id,
         s.project_id,
         s.provider,
         s.file_path,
         s.title,
         s.model_names,
         s.started_at,
         s.ended_at,
         s.activity_at,
         s.duration_ms,
         s.git_branch,
         s.cwd,
         s.session_identity,
         s.provider_session_id,
         s.session_kind,
         s.canonical_project_path,
         s.repository_url,
         s.git_commit_hash,
         s.lineage_parent_id,
         s.provider_client,
         s.provider_source,
         s.provider_client_version,
         s.resolution_source,
         s.worktree_label,
         s.worktree_source,
         s.message_count,
         s.token_input_total,
         s.token_output_total
       FROM sessions s
       WHERE s.id = ?`,
    )
    .get(request.sessionId) as SessionSummaryRow | undefined;

  if (!sessionRow) {
    return {
      session: null,
      totalCount: 0,
      categoryCounts: makeEmptyCategoryCounts(),
      page: 0,
      pageSize: request.pageSize,
      focusIndex: null,
      queryError: null,
      highlightPatterns: [],
      messages: [],
    };
  }

  const pageSize = request.pageSize;
  let page = request.page;
  const normalizedQuery = request.query.trim();
  const queryPlan = buildSearchQueryPlan(request.query, request.searchMode ?? "simple");
  const messageFilters: {
    sessionId: string;
    categories?: string[];
    queryPlan: SearchQueryPlan;
  } = {
    sessionId: request.sessionId,
    queryPlan,
  };
  if (request.categories !== undefined) {
    messageFilters.categories = request.categories;
  }

  if (queryPlan.error) {
    return {
      session: mapSessionSummaryRow(sessionRow),
      totalCount: 0,
      categoryCounts: makeEmptyCategoryCounts(),
      page: 0,
      pageSize,
      focusIndex: null,
      queryError: queryPlan.error,
      highlightPatterns: [],
      messages: [],
    };
  }
  if (normalizedQuery.length > 0 && !queryPlan.hasTerms) {
    return {
      session: mapSessionSummaryRow(sessionRow),
      totalCount: 0,
      categoryCounts: makeEmptyCategoryCounts(),
      page: 0,
      pageSize,
      focusIndex: null,
      queryError: null,
      highlightPatterns: [],
      messages: [],
    };
  }

  const { whereClause, params } = buildMessageFilters(messageFilters);

  const focusTarget = resolveFocusTarget(db, {
    focusMessageId: request.focusMessageId,
    focusSourceId: request.focusSourceId,
    byMessageIdSql:
      "SELECT id, created_at, created_at_ms FROM messages WHERE session_id = ? AND id = ?",
    byMessageIdParams: request.focusMessageId ? [request.sessionId, request.focusMessageId] : [],
    bySourceIdSql:
      "SELECT id, created_at, created_at_ms FROM messages WHERE session_id = ? AND source_id = ? ORDER BY created_at_ms ASC, created_at ASC, id ASC LIMIT 1",
    bySourceIdParams: request.focusSourceId ? [request.sessionId, request.focusSourceId] : [],
  });
  const overview = loadMessageDetailOverview({
    db,
    fromSql: "FROM messages m",
    whereClause,
    params,
    focusComparison,
    ...(focusTarget ? { focusTarget } : {}),
  });
  const totalCount = overview.totalCount;
  const queryOnlyFilter = buildMessageFilters({
    sessionId: request.sessionId,
    queryPlan,
  });
  const categoryCounts = loadCategoryCounts(
    db,
    "FROM messages m",
    queryOnlyFilter.whereClause,
    queryOnlyFilter.params,
  );
  const focusIndex = overview.focusIndex;
  if (focusIndex !== null) {
    page = Math.floor(focusIndex / pageSize);
  }

  if (totalCount > 0 && page * pageSize >= totalCount) {
    page = Math.floor((totalCount - 1) / pageSize);
  }

  const rows = db
    .prepare(
      `SELECT
         m.id,
         m.source_id,
         m.session_id,
         m.provider,
         m.category,
         m.content,
         m.created_at,
         m.created_at_ms,
         m.token_input,
         m.token_output,
         m.operation_duration_ms,
         m.operation_duration_source,
         m.operation_duration_confidence
       FROM messages m
       WHERE ${whereClause}
       ORDER BY ${messageOrder}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, page * pageSize) as MessageRow[];

  return {
    session: mapSessionSummaryRow(sessionRow),
    totalCount,
    categoryCounts,
    page,
    pageSize,
    focusIndex,
    queryError: null,
    highlightPatterns: queryPlan.highlightPatterns,
    messages: mapSessionMessageRows(db, rows),
  };
}

function getSessionTurnWithDatabase(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
  request: IpcRequest<"sessions:getTurn">,
): IpcResponse<"sessions:getTurn"> {
  const queryPlan = buildSearchQueryPlan(request.query, request.searchMode ?? "simple");
  const normalizedQuery = request.query.trim();
  const { anchor, navigation } = queryPlan.error
    ? {
        anchor: undefined,
        navigation: makeEmptyTurnNavigationMetadata(),
      }
    : resolveScopedTurnNavigation(db, bookmarkStore, request);

  if (!anchor) {
    return {
      session: null,
      anchorMessageId: request.anchorMessageId ?? null,
      anchorMessage: null,
      ...navigation,
      totalCount: 0,
      categoryCounts: makeEmptyCategoryCounts(),
      queryError: queryPlan.error ?? null,
      highlightPatterns: queryPlan.error ? [] : queryPlan.highlightPatterns,
      matchedMessageIds: queryPlan.error
        ? []
        : normalizedQuery.length > 0 && !queryPlan.hasTerms
          ? []
          : undefined,
      messages: [],
    };
  }

  const sessionRow = db
    .prepare(
      `SELECT
         s.id,
         s.project_id,
         s.provider,
         s.file_path,
         s.title,
         s.model_names,
         s.started_at,
         s.ended_at,
         s.activity_at,
         s.duration_ms,
         s.git_branch,
         s.cwd,
         s.session_identity,
         s.provider_session_id,
         s.session_kind,
         s.canonical_project_path,
         s.repository_url,
         s.git_commit_hash,
         s.lineage_parent_id,
         s.provider_client,
         s.provider_source,
         s.provider_client_version,
         s.resolution_source,
         s.worktree_label,
         s.worktree_source,
         s.message_count,
         s.token_input_total,
         s.token_output_total
       FROM sessions s
       WHERE s.id = ?`,
    )
    .get(anchor.session_id) as SessionSummaryRow | undefined;

  const nextUser = db
    .prepare(
      `SELECT id, created_at, created_at_ms
       FROM messages
       WHERE session_id = ?
         AND category = 'user'
         AND (
           created_at_ms > ?
           OR (
             created_at_ms = ?
             AND (
               created_at > ?
               OR (created_at = ? AND id > ?)
             )
           )
         )
       ORDER BY created_at_ms ASC, created_at ASC, id ASC
       LIMIT 1`,
    )
    .get(
      anchor.session_id,
      anchor.created_at_ms,
      anchor.created_at_ms,
      anchor.created_at,
      anchor.created_at,
      anchor.id,
    ) as FocusTargetRow | undefined;

  const rows = loadTurnMessages(db, anchor.session_id, anchor, nextUser, request.sortDirection);
  const messages = mapSessionMessageRows(db, rows);
  const anchorMessage = messages.find((message) => message.id === anchor.id) ?? null;
  const totalCount = rows.length;
  const unfilteredCategoryCounts = countMessageCategories(rows);

  if (queryPlan.error) {
    return {
      session: sessionRow ? mapSessionSummaryRow(sessionRow) : null,
      anchorMessageId: anchor.id,
      anchorMessage,
      ...navigation,
      totalCount,
      categoryCounts: unfilteredCategoryCounts,
      queryError: queryPlan.error,
      highlightPatterns: [],
      matchedMessageIds: [],
      messages,
    };
  }
  if (normalizedQuery.length > 0 && !queryPlan.hasTerms) {
    return {
      session: sessionRow ? mapSessionSummaryRow(sessionRow) : null,
      anchorMessageId: anchor.id,
      anchorMessage,
      ...navigation,
      totalCount,
      categoryCounts: unfilteredCategoryCounts,
      queryError: null,
      highlightPatterns: [],
      matchedMessageIds: [],
      messages,
    };
  }

  const { categoryCounts, matchedMessageIds } = queryPlan.hasTerms
    ? loadTurnMatchedMessageMetadata(db, {
        sessionId: anchor.session_id,
        anchor,
        ...(nextUser ? { nextUser } : {}),
        queryPlan,
      })
    : {
        categoryCounts: unfilteredCategoryCounts,
        matchedMessageIds: undefined,
      };

  return {
    session: sessionRow ? mapSessionSummaryRow(sessionRow) : null,
    anchorMessageId: anchor.id,
    anchorMessage,
    ...navigation,
    totalCount,
    categoryCounts,
    queryError: null,
    highlightPatterns: queryPlan.highlightPatterns,
    matchedMessageIds,
    messages,
  };
}

function makeEmptyTurnNavigationMetadata(): TurnNavigationMetadata {
  return {
    turnNumber: 0,
    totalTurns: 0,
    previousTurnAnchorMessageId: null,
    nextTurnAnchorMessageId: null,
    firstTurnAnchorMessageId: null,
    latestTurnAnchorMessageId: null,
  };
}

function resolveScopedTurnNavigation(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
  request: IpcRequest<"sessions:getTurn">,
): {
  anchor: TurnAnchorRow | undefined;
  navigation: TurnNavigationMetadata;
} {
  if (request.scopeMode === "bookmarks") {
    const anchors = loadBookmarkTurnAnchors(bookmarkStore, {
      ...(request.projectId ? { projectId: request.projectId } : {}),
    });
    const anchor = resolveScopedTurnAnchorFromList(anchors, request);
    return {
      anchor,
      navigation: buildTurnNavigationMetadataFromAnchors(anchors, anchor?.id ?? null),
    };
  }

  const scope = buildTurnAnchorScopeSql({
    ...(request.scopeMode ? { scopeMode: request.scopeMode } : {}),
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
  });
  if (!scope) {
    return {
      anchor: undefined,
      navigation: makeEmptyTurnNavigationMetadata(),
    };
  }

  const totalTurns = countTurnAnchors(db, scope);
  const first = loadBoundaryTurnAnchor(db, scope, "asc");
  const latest = loadBoundaryTurnAnchor(db, scope, "desc");
  const anchor = resolveScopedTurnAnchorFromDatabase(db, scope, request, latest);

  if (!anchor) {
    return {
      anchor: undefined,
      navigation: {
        turnNumber: 0,
        totalTurns,
        previousTurnAnchorMessageId: null,
        nextTurnAnchorMessageId: null,
        firstTurnAnchorMessageId: first?.id ?? null,
        latestTurnAnchorMessageId: latest?.id ?? null,
      },
    };
  }

  return {
    anchor,
    navigation: {
      turnNumber: countTurnAnchorsBeforeOrAt(db, scope, anchor),
      totalTurns,
      previousTurnAnchorMessageId:
        loadAdjacentTurnAnchor(db, scope, anchor, "previous")?.id ?? null,
      nextTurnAnchorMessageId: loadAdjacentTurnAnchor(db, scope, anchor, "next")?.id ?? null,
      firstTurnAnchorMessageId: first?.id ?? null,
      latestTurnAnchorMessageId: latest?.id ?? null,
    },
  };
}

function buildTurnAnchorScopeSql(args: {
  scopeMode?: "session" | "project_all" | "bookmarks";
  projectId?: string;
  sessionId?: string;
}): TurnAnchorScopeSql | null {
  const scopeMode = args.scopeMode ?? "session";
  if (scopeMode === "bookmarks") {
    return null;
  }
  const conditions = ["m.category = 'user'"];
  const params: Array<string | number> = [];
  if (scopeMode === "project_all") {
    if (!args.projectId) {
      return null;
    }
    conditions.unshift("s.project_id = ?");
    params.push(args.projectId);
    return {
      fromSql: "FROM messages m JOIN sessions s ON s.id = m.session_id",
      whereClause: conditions.join(" AND "),
      params,
    };
  }
  if (!args.sessionId) {
    return null;
  }
  conditions.unshift("m.session_id = ?");
  params.push(args.sessionId);
  return {
    fromSql: "FROM messages m",
    whereClause: conditions.join(" AND "),
    params,
  };
}

function countTurnAnchors(db: DatabaseHandle, scope: TurnAnchorScopeSql): number {
  const row = db
    .prepare(`SELECT COUNT(*) as count ${scope.fromSql} WHERE ${scope.whereClause}`)
    .get(...scope.params) as { count: number };
  return row.count;
}

function loadBoundaryTurnAnchor(
  db: DatabaseHandle,
  scope: TurnAnchorScopeSql,
  sortDirection: "asc" | "desc",
): TurnAnchorRow | undefined {
  return db
    .prepare(
      `SELECT
         m.id,
         m.session_id,
         m.created_at,
         m.created_at_ms
       ${scope.fromSql}
       WHERE ${scope.whereClause}
       ORDER BY ${
         sortDirection === "desc"
           ? "m.created_at_ms DESC, m.created_at DESC, m.id DESC"
           : "m.created_at_ms ASC, m.created_at ASC, m.id ASC"
       }
       LIMIT 1`,
    )
    .get(...scope.params) as TurnAnchorRow | undefined;
}

function loadTurnAnchorByNumber(
  db: DatabaseHandle,
  scope: TurnAnchorScopeSql,
  turnNumber: number,
): TurnAnchorRow | undefined {
  return db
    .prepare(
      `SELECT
         m.id,
         m.session_id,
         m.created_at,
         m.created_at_ms
       ${scope.fromSql}
       WHERE ${scope.whereClause}
       ORDER BY m.created_at_ms ASC, m.created_at ASC, m.id ASC
       LIMIT 1 OFFSET ?`,
    )
    .get(...scope.params, turnNumber - 1) as TurnAnchorRow | undefined;
}

function loadTurnAnchorByMessageId(
  db: DatabaseHandle,
  scope: TurnAnchorScopeSql,
  anchorMessageId: string,
): TurnAnchorRow | undefined {
  return db
    .prepare(
      `SELECT
         m.id,
         m.session_id,
         m.created_at,
         m.created_at_ms
       ${scope.fromSql}
       WHERE ${scope.whereClause} AND m.id = ?`,
    )
    .get(...scope.params, anchorMessageId) as TurnAnchorRow | undefined;
}

function loadScopedTurnTargetMessage(
  db: DatabaseHandle,
  args: {
    scopeMode?: "session" | "project_all" | "bookmarks";
    projectId?: string;
    sessionId?: string;
    messageId: string;
  },
): TurnAnchorRow | undefined {
  if (args.scopeMode === "bookmarks") {
    return undefined;
  }
  if (args.scopeMode === "project_all") {
    if (!args.projectId) {
      return undefined;
    }
    return db
      .prepare(
        `SELECT
           m.id,
           m.session_id,
           m.created_at,
           m.created_at_ms
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE s.project_id = ?
           AND m.id = ?`,
      )
      .get(args.projectId, args.messageId) as TurnAnchorRow | undefined;
  }
  if (!args.sessionId) {
    return undefined;
  }
  return db
    .prepare(
      `SELECT
         m.id,
         m.session_id,
         m.created_at,
         m.created_at_ms
       FROM messages m
       WHERE m.session_id = ?
         AND m.id = ?`,
    )
    .get(args.sessionId, args.messageId) as TurnAnchorRow | undefined;
}

function loadContainingTurnAnchorByTargetMessage(
  db: DatabaseHandle,
  scope: TurnAnchorScopeSql,
  targetMessage: TurnAnchorRow,
): TurnAnchorRow | undefined {
  return db
    .prepare(
      `SELECT
         m.id,
         m.session_id,
         m.created_at,
         m.created_at_ms
       ${scope.fromSql}
       WHERE ${scope.whereClause}
         AND m.session_id = ?
         AND (
           m.created_at_ms < ?
           OR (
             m.created_at_ms = ?
             AND (
               m.created_at < ?
               OR (m.created_at = ? AND m.id <= ?)
             )
           )
         )
       ORDER BY m.created_at_ms DESC, m.created_at DESC, m.id DESC
       LIMIT 1`,
    )
    .get(
      ...scope.params,
      targetMessage.session_id,
      targetMessage.created_at_ms,
      targetMessage.created_at_ms,
      targetMessage.created_at,
      targetMessage.created_at,
      targetMessage.id,
    ) as TurnAnchorRow | undefined;
}

function resolveScopedTurnAnchorFromDatabase(
  db: DatabaseHandle,
  scope: TurnAnchorScopeSql,
  request: IpcRequest<"sessions:getTurn">,
  latestAnchor: TurnAnchorRow | undefined,
): TurnAnchorRow | undefined {
  if (request.latest) {
    return latestAnchor;
  }
  if (request.turnNumber !== undefined) {
    return loadTurnAnchorByNumber(db, scope, request.turnNumber);
  }
  if (!request.anchorMessageId) {
    return undefined;
  }
  const exactAnchor = loadTurnAnchorByMessageId(db, scope, request.anchorMessageId);
  if (exactAnchor) {
    return exactAnchor;
  }
  const targetMessage = loadScopedTurnTargetMessage(db, {
    ...(request.scopeMode ? { scopeMode: request.scopeMode } : {}),
    ...(request.projectId ? { projectId: request.projectId } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    messageId: request.anchorMessageId,
  });
  if (!targetMessage) {
    return undefined;
  }
  return loadContainingTurnAnchorByTargetMessage(db, scope, targetMessage);
}

function countTurnAnchorsBeforeOrAt(
  db: DatabaseHandle,
  scope: TurnAnchorScopeSql,
  anchor: TurnAnchorRow,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count
       ${scope.fromSql}
       WHERE ${scope.whereClause}
         AND (
           m.created_at_ms < ?
           OR (
             m.created_at_ms = ?
             AND (
               m.created_at < ?
               OR (m.created_at = ? AND m.id <= ?)
             )
           )
         )`,
    )
    .get(
      ...scope.params,
      anchor.created_at_ms,
      anchor.created_at_ms,
      anchor.created_at,
      anchor.created_at,
      anchor.id,
    ) as { count: number };
  return row.count;
}

function loadAdjacentTurnAnchor(
  db: DatabaseHandle,
  scope: TurnAnchorScopeSql,
  anchor: TurnAnchorRow,
  direction: "previous" | "next",
): TurnAnchorRow | undefined {
  const isNext = direction === "next";
  return db
    .prepare(
      `SELECT
         m.id,
         m.session_id,
         m.created_at,
         m.created_at_ms
       ${scope.fromSql}
       WHERE ${scope.whereClause}
         AND (
           m.created_at_ms ${isNext ? ">" : "<"} ?
           OR (
             m.created_at_ms = ?
             AND (
               m.created_at ${isNext ? ">" : "<"} ?
               OR (m.created_at = ? AND m.id ${isNext ? ">" : "<"} ?)
             )
           )
         )
       ORDER BY ${
         isNext
           ? "m.created_at_ms ASC, m.created_at ASC, m.id ASC"
           : "m.created_at_ms DESC, m.created_at DESC, m.id DESC"
       }
       LIMIT 1`,
    )
    .get(
      ...scope.params,
      anchor.created_at_ms,
      anchor.created_at_ms,
      anchor.created_at,
      anchor.created_at,
      anchor.id,
    ) as TurnAnchorRow | undefined;
}

function loadBookmarkTurnAnchors(
  bookmarkStore: BookmarkStore,
  args: {
    projectId?: string;
  },
): TurnAnchorRow[] {
  if (!args.projectId) {
    return [];
  }
  return bookmarkStore
    .listProjectBookmarks(args.projectId, {
      categories: ["user"],
      sortDirection: "asc",
    })
    .map((row) => ({
      id: row.message_id,
      session_id: row.session_id,
      created_at: row.message_created_at,
      created_at_ms: Date.parse(row.message_created_at) || 0,
    }));
}

function resolveScopedTurnAnchorFromList(
  anchors: readonly TurnAnchorRow[],
  request: IpcRequest<"sessions:getTurn">,
): TurnAnchorRow | undefined {
  if (request.latest) {
    return anchors.at(-1);
  }
  if (request.turnNumber !== undefined) {
    return anchors[request.turnNumber - 1];
  }
  return anchors.find((anchor) => anchor.id === request.anchorMessageId);
}

function buildTurnNavigationMetadataFromAnchors(
  anchors: readonly TurnAnchorRow[],
  anchorMessageId: string | null,
): TurnNavigationMetadata {
  const totalTurns = anchors.length;
  const index = anchorMessageId ? anchors.findIndex((anchor) => anchor.id === anchorMessageId) : -1;
  return {
    turnNumber: index >= 0 ? index + 1 : 0,
    totalTurns,
    previousTurnAnchorMessageId: index > 0 ? (anchors[index - 1]?.id ?? null) : null,
    nextTurnAnchorMessageId:
      index >= 0 && index + 1 < anchors.length ? (anchors[index + 1]?.id ?? null) : null,
    firstTurnAnchorMessageId: anchors[0]?.id ?? null,
    latestTurnAnchorMessageId: anchors.at(-1)?.id ?? null,
  };
}

function loadTurnMessages(
  db: DatabaseHandle,
  sessionId: string,
  anchor: FocusTargetRow,
  nextUser: FocusTargetRow | undefined,
  sortDirection: "asc" | "desc",
): MessageRow[] {
  const turnScope = buildTurnMessageFilters({
    sessionId,
    anchor,
    ...(nextUser ? { nextUser } : {}),
    queryPlan: EMPTY_SEARCH_QUERY_PLAN,
  });
  return db
    .prepare(
      `SELECT
         m.id,
         m.source_id,
         m.session_id,
         m.provider,
         m.category,
         m.content,
         m.created_at,
         m.created_at_ms,
         m.token_input,
         m.token_output,
         m.operation_duration_ms,
         m.operation_duration_source,
         m.operation_duration_confidence
       FROM messages m
       WHERE ${turnScope.whereClause}
       ORDER BY ${
         sortDirection === "desc"
           ? "m.created_at_ms DESC, m.created_at DESC, m.id DESC"
           : "m.created_at_ms ASC, m.created_at ASC, m.id ASC"
       }`,
    )
    .all(...turnScope.params) as MessageRow[];
}

function deleteSessionWithStore(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
  request: IpcRequest<"sessions:delete">,
): IpcResponse<"sessions:delete"> {
  const sessionRow = db
    .prepare(
      `SELECT
         s.id,
         s.project_id,
         s.provider,
         s.file_path,
         s.message_count
       FROM sessions s
       WHERE s.id = ?`,
    )
    .get(request.sessionId) as
    | {
        id: string;
        project_id: string;
        provider: Provider;
        file_path: string;
        message_count: number;
      }
    | undefined;

  if (!sessionRow) {
    return {
      deleted: false,
      projectId: null,
      provider: null,
      sourceFormat: null,
      removedMessageCount: 0,
      removedBookmarkCount: 0,
    };
  }

  let removedBookmarkCount = 0;

  const run = db.transaction(() => {
    upsertDeletedSessionTombstone(db, sessionRow.id);
    deleteSessionCascade(db, sessionRow.id, sessionRow.file_path);
    db.exec("DELETE FROM projects WHERE id NOT IN (SELECT DISTINCT project_id FROM sessions)");
  });
  run();
  removedBookmarkCount = bookmarkStore.removeSessionBookmarks(sessionRow.project_id, sessionRow.id);

  return {
    deleted: true,
    projectId: sessionRow.project_id,
    provider: sessionRow.provider,
    sourceFormat: PROVIDER_METADATA[sessionRow.provider].sourceFormat,
    removedMessageCount: sessionRow.message_count,
    removedBookmarkCount,
  };
}

function deleteProjectWithStore(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
  request: IpcRequest<"projects:delete">,
): IpcResponse<"projects:delete"> {
  const projectRow = db
    .prepare(
      `SELECT
         p.id,
         p.provider,
         p.name,
         p.path,
         p.provider_project_key,
         p.repository_url,
         p.resolution_state,
         p.resolution_source,
         COALESCE(ps.session_count, 0) as session_count,
         COALESCE(ps.message_count, 0) as message_count,
         ps.last_activity as last_activity
       FROM projects p
       LEFT JOIN project_stats ps ON ps.project_id = p.id
       WHERE p.id = ?`,
    )
    .get(request.projectId) as ProjectSummaryRow | undefined;

  if (!projectRow) {
    return {
      deleted: false,
      provider: null,
      sourceFormat: null,
      removedSessionCount: 0,
      removedMessageCount: 0,
      removedBookmarkCount: 0,
    };
  }

  let removedBookmarkCount = 0;

  const run = db.transaction(() => {
    upsertDeletedProjectTombstone(db, projectRow.provider, projectRow.path);
    const sessionIds = db
      .prepare("SELECT id, file_path FROM sessions WHERE project_id = ?")
      .all(projectRow.id) as Array<{ id: string; file_path: string }>;
    for (const row of sessionIds) {
      tryUpsertDeletedSessionTombstone(db, row.id, {
        allowIncompleteResumeMetadata: true,
      });
    }
    for (const row of sessionIds) {
      deleteSessionCascade(db, row.id, row.file_path);
    }
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectRow.id);
  });
  run();
  removedBookmarkCount = bookmarkStore.removeProjectBookmarks(projectRow.id);

  return {
    deleted: true,
    provider: projectRow.provider,
    sourceFormat: PROVIDER_METADATA[projectRow.provider].sourceFormat,
    removedSessionCount: projectRow.session_count,
    removedMessageCount: projectRow.message_count,
    removedBookmarkCount,
  };
}

function listProjectBookmarksWithStore(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
  request: IpcRequestInput<"bookmarks:listProject">,
): IpcResponse<"bookmarks:listProject"> {
  const hasQuery = (request.query?.trim().length ?? 0) > 0;
  const countOnly = request.countOnly === true;
  const pageSize = request.pageSize ?? 100;
  let page = request.page ?? 0;
  const bookmarkScopeSessionId = request.sessionId;
  const queryPlan = hasQuery
    ? buildSearchQueryPlan(request.query ?? "", request.searchMode ?? "simple")
    : buildSearchQueryPlan("", request.searchMode ?? "simple");
  const totalCount = bookmarkStore.countProjectBookmarks(request.projectId, {
    ...(bookmarkScopeSessionId ? { sessionId: bookmarkScopeSessionId } : {}),
  });
  if (queryPlan.error) {
    return {
      projectId: request.projectId,
      totalCount,
      filteredCount: 0,
      page: 0,
      pageSize,
      categoryCounts: makeEmptyCategoryCounts(),
      queryError: queryPlan.error,
      highlightPatterns: [],
      results: [],
    };
  }
  const categoryCounts = bookmarkStore.countProjectBookmarkCategories(
    request.projectId,
    hasQuery ? request.query : undefined,
    bookmarkScopeSessionId,
    request.searchMode ?? "simple",
  );
  const bookmarkQuery = hasQuery ? (request.query ?? "") : null;
  const filteredCount = bookmarkStore.countProjectBookmarks(request.projectId, {
    ...(bookmarkScopeSessionId ? { sessionId: bookmarkScopeSessionId } : {}),
    ...(bookmarkQuery !== null ? { query: bookmarkQuery } : {}),
    searchMode: request.searchMode ?? "simple",
    ...(request.categories ? { categories: request.categories } : {}),
  });
  const bookmarkListOptions = {
    ...(bookmarkScopeSessionId ? { sessionId: bookmarkScopeSessionId } : {}),
    ...(bookmarkQuery !== null ? { query: bookmarkQuery } : {}),
    searchMode: request.searchMode ?? "simple",
    ...(request.categories ? { categories: request.categories } : {}),
    sortDirection: request.sortDirection ?? "asc",
  } as const;
  if (filteredCount === 0) {
    page = 0;
  } else if (page * pageSize >= filteredCount) {
    page = Math.floor((filteredCount - 1) / pageSize);
  }
  const focusIndex = bookmarkStore.getProjectBookmarkFocusIndex(
    request.projectId,
    {
      ...(request.focusMessageId ? { messageId: request.focusMessageId } : {}),
      ...(request.focusSourceId ? { messageSourceId: request.focusSourceId } : {}),
    },
    bookmarkListOptions,
  );
  if (focusIndex !== null) {
    page = Math.floor(focusIndex / pageSize);
  }
  if (countOnly) {
    return {
      projectId: request.projectId,
      totalCount,
      filteredCount,
      page,
      pageSize,
      categoryCounts,
      queryError: null,
      highlightPatterns: queryPlan.highlightPatterns,
      results: [],
    };
  }
  const storedRows = bookmarkStore.listProjectBookmarks(request.projectId, {
    ...bookmarkListOptions,
    limit: pageSize,
    offset: page * pageSize,
  });
  const liveRowsByMessageId = listLiveBookmarkMessagesById(
    db,
    request.projectId,
    storedRows.map((row) => row.message_id),
  );

  const results: IpcResponse<"bookmarks:listProject">["results"] = [];

  for (const row of storedRows) {
    const live = liveRowsByMessageId.get(row.message_id);
    const isLiveMatch = live !== undefined && live.session_id === row.session_id;
    const message = isLiveMatch ? mapSessionMessageRow(live) : mapStoredBookmarkMessageRow(row);
    results.push({
      projectId: row.project_id,
      sessionId: row.session_id,
      sessionTitle: isLiveMatch ? live.session_title : row.session_title,
      bookmarkedAt: row.bookmarked_at,
      isOrphaned: !isLiveMatch,
      orphanedAt: isLiveMatch ? null : row.orphaned_at,
      message,
    });
  }

  return {
    projectId: request.projectId,
    totalCount,
    filteredCount,
    page,
    pageSize,
    categoryCounts,
    queryError: null,
    highlightPatterns: queryPlan.highlightPatterns,
    results,
  };
}

function getBookmarkStatesWithStore(
  bookmarkStore: BookmarkStore,
  request: IpcRequest<"bookmarks:getStates">,
): IpcResponse<"bookmarks:getStates"> {
  return {
    projectId: request.projectId,
    bookmarkedMessageIds: bookmarkStore.listProjectBookmarkMessageIds(
      request.projectId,
      request.messageIds,
    ),
  };
}

function buildMessageSortSql(sortDirection: MessageSortDirection): {
  messageOrder: string;
  focusComparison: string;
} {
  const isAscending = sortDirection === "asc";
  return {
    messageOrder: isAscending
      ? "m.created_at_ms ASC, m.created_at ASC, m.id ASC"
      : "m.created_at_ms DESC, m.created_at DESC, m.id DESC",
    focusComparison: isAscending
      ? `(
           m.created_at_ms < ?
           OR (
             m.created_at_ms = ?
             AND (m.created_at < ? OR (m.created_at = ? AND m.id <= ?))
           )
         )`
      : `(
           m.created_at_ms > ?
           OR (
             m.created_at_ms = ?
             AND (m.created_at > ? OR (m.created_at = ? AND m.id >= ?))
           )
         )`,
  };
}

function loadMessageDetailOverview(args: {
  db: DatabaseHandle;
  fromSql: string;
  whereClause: string;
  params: readonly unknown[];
  focusComparison: string;
  focusTarget?: FocusTargetRow;
}): { totalCount: number; focusIndex: number | null } {
  const focusParams = args.focusTarget
    ? [
        args.focusTarget.created_at_ms,
        args.focusTarget.created_at_ms,
        args.focusTarget.created_at,
        args.focusTarget.created_at,
        args.focusTarget.id,
      ]
    : [0, 0, "", "", ""];
  const overviewRow = args.db
    .prepare(
      `SELECT
        COUNT(*) as total_count,
        CASE
          WHEN ? = 0 THEN NULL
          ELSE NULLIF(COALESCE(SUM(CASE WHEN ${args.focusComparison} THEN 1 ELSE 0 END), 0), 0) - 1
        END as focus_index
      ${args.fromSql}
      WHERE ${args.whereClause}`,
    )
    .get(args.focusTarget ? 1 : 0, ...focusParams, ...args.params) as
    | {
        total_count: number;
        focus_index: number | null;
      }
    | undefined;

  return {
    totalCount: Number(overviewRow?.total_count ?? 0),
    focusIndex:
      overviewRow?.focus_index === null || overviewRow?.focus_index === undefined
        ? null
        : Number(overviewRow.focus_index),
  };
}

function loadCategoryCounts(
  db: DatabaseHandle,
  fromSql: string,
  whereClause: string,
  params: readonly unknown[],
): Record<MessageCategory, number> {
  const categoryCounts = makeEmptyCategoryCounts();
  const categoryRows = db
    .prepare(
      `SELECT m.category as category, COUNT(*) as cnt
       ${fromSql}
       WHERE ${whereClause}
       GROUP BY m.category`,
    )
    .all(...params) as Array<{ category: string; cnt: number }>;

  for (const row of categoryRows) {
    categoryCounts[normalizeMessageCategory(row.category)] += Number(row.cnt ?? 0);
  }

  return categoryCounts;
}

function countMessageCategories(
  rows: ReadonlyArray<{
    category: string;
  }>,
): Record<MessageCategory, number> {
  const categoryCounts = makeEmptyCategoryCounts();
  for (const row of rows) {
    categoryCounts[normalizeMessageCategory(row.category)] += 1;
  }
  return categoryCounts;
}

function loadTurnMatchedMessageMetadata(
  db: DatabaseHandle,
  args: {
    sessionId: string;
    anchor: FocusTargetRow;
    nextUser?: FocusTargetRow;
    queryPlan: SearchQueryPlan;
  },
): {
  categoryCounts: Record<MessageCategory, number>;
  matchedMessageIds: string[];
} {
  const turnScope = buildTurnMessageFilters(args);
  const rows = db
    .prepare(
      `SELECT m.id, m.category
       FROM messages m
       WHERE ${turnScope.whereClause}
       ORDER BY m.created_at_ms ASC, m.created_at ASC, m.id ASC`,
    )
    .all(...turnScope.params) as Array<{ id: string; category: string }>;

  return {
    categoryCounts: countMessageCategories(rows),
    matchedMessageIds: rows.map((row) => row.id),
  };
}

function resolveFocusTarget(
  db: DatabaseHandle,
  args: {
    focusMessageId: string | undefined;
    focusSourceId: string | undefined;
    byMessageIdSql: string;
    byMessageIdParams: readonly unknown[];
    bySourceIdSql: string;
    bySourceIdParams: readonly unknown[];
  },
): FocusTargetRow | undefined {
  // Search results prefer the concrete indexed message id, but source ids let us reveal a message
  // even when the exact split segment changed during reindexing.
  if (args.focusMessageId) {
    return db.prepare(args.byMessageIdSql).get(...args.byMessageIdParams) as
      | FocusTargetRow
      | undefined;
  }
  if (args.focusSourceId) {
    return db.prepare(args.bySourceIdSql).get(...args.bySourceIdParams) as
      | FocusTargetRow
      | undefined;
  }
  return undefined;
}

function listLiveBookmarkMessagesById(
  db: DatabaseHandle,
  projectId: string,
  messageIds: string[],
): Map<string, BookmarkMessageLookupRow> {
  if (messageIds.length === 0) {
    return new Map();
  }

  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT
         s.project_id,
         s.title as session_title,
         m.id,
         m.source_id,
         m.session_id,
         m.provider,
         m.category,
         m.content,
         m.created_at,
         m.created_at_ms,
         m.token_input,
         m.token_output,
         m.operation_duration_ms,
         m.operation_duration_source,
         m.operation_duration_confidence
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE s.project_id = ?
         AND m.id IN (${placeholders})`,
    )
    .all(projectId, ...messageIds) as BookmarkMessageLookupRow[];

  return new Map(rows.map((row) => [row.id, row]));
}

function toggleBookmarkWithStore(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
  request: IpcRequest<"bookmarks:toggle">,
): IpcResponse<"bookmarks:toggle"> {
  const existing = bookmarkStore.getBookmark(request.projectId, request.messageId);
  if (existing) {
    bookmarkStore.removeBookmark(request.projectId, request.messageId);
    return { bookmarked: false };
  }

  const messageRow = db
    .prepare(
      `SELECT
         m.id,
         m.source_id,
         m.session_id,
         m.provider,
         m.category,
         m.content,
         m.created_at,
         s.project_id,
         s.title as session_title
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE m.id = ?`,
    )
    .get(request.messageId) as
    | {
        id: string;
        source_id: string;
        session_id: string;
        provider: Provider;
        category: string;
        content: string;
        created_at: string;
        project_id: string;
        session_title: string;
      }
    | undefined;

  if (
    !messageRow ||
    messageRow.project_id !== request.projectId ||
    messageRow.session_id !== request.sessionId ||
    messageRow.source_id !== request.messageSourceId
  ) {
    return { bookmarked: false };
  }

  bookmarkStore.upsertBookmark({
    projectId: request.projectId,
    sessionId: request.sessionId,
    messageId: request.messageId,
    messageSourceId: request.messageSourceId,
    provider: messageRow.provider,
    sessionTitle: messageRow.session_title,
    messageCategory: normalizeMessageCategory(messageRow.category),
    messageContent: messageRow.content,
    messageCreatedAt: messageRow.created_at,
    bookmarkedAt: new Date().toISOString(),
  });

  return { bookmarked: true };
}

function runSearchQueryWithDatabase(
  db: DatabaseHandle,
  request: IpcRequest<"search:query">,
): IpcResponse<"search:query"> {
  if (request.providers && request.providers.length === 0) {
    return {
      query: request.query,
      queryError: null,
      highlightPatterns: [],
      totalCount: 0,
      categoryCounts: makeEmptyCategoryCounts(),
      providerCounts: createProviderRecord(() => 0),
      results: [],
    };
  }

  const searchInput: {
    query: string;
    searchMode: "simple" | "advanced";
    categories?: string[];
    providers?: string[];
    projectIds?: string[];
    projectQuery: string;
    limit: number;
    offset: number;
  } = {
    query: request.query,
    searchMode: request.searchMode ?? "simple",
    projectQuery: request.projectQuery,
    limit: request.limit,
    offset: request.offset,
  };

  if (request.categories && request.categories.length > 0) {
    searchInput.categories = request.categories;
  }
  if (request.providers && request.providers.length > 0) {
    searchInput.providers = request.providers;
  }
  if (request.projectIds && request.projectIds.length > 0) {
    searchInput.projectIds = request.projectIds;
  }

  return searchMessages(db, searchInput);
}

function buildMessageFilters(args: {
  sessionId: string;
  categories?: string[];
  queryPlan: SearchQueryPlan;
}): { whereClause: string; params: Array<string | number> } {
  return buildScopedMessageFilters({
    scopeClause: "m.session_id = ?",
    scopeValue: args.sessionId,
    categories: args.categories,
    queryPlan: args.queryPlan,
  });
}

function buildProjectMessageFilters(args: {
  projectId: string;
  categories?: string[];
  queryPlan: SearchQueryPlan;
}): { whereClause: string; params: Array<string | number> } {
  return buildScopedMessageFilters({
    scopeClause: "s.project_id = ?",
    scopeValue: args.projectId,
    categories: args.categories,
    queryPlan: args.queryPlan,
  });
}

function buildTurnMessageFilters(args: {
  sessionId: string;
  anchor: FocusTargetRow;
  nextUser?: FocusTargetRow;
  categories?: string[];
  queryPlan: SearchQueryPlan;
}): { whereClause: string; params: Array<string | number> } {
  const conditions = [
    "m.session_id = ?",
    `(
      m.created_at_ms > ?
      OR (m.created_at_ms = ? AND (m.created_at > ? OR (m.created_at = ? AND m.id >= ?)))
    )`,
  ];
  const params = [
    args.sessionId,
    args.anchor.created_at_ms,
    args.anchor.created_at_ms,
    args.anchor.created_at,
    args.anchor.created_at,
    args.anchor.id,
  ];

  if (args.nextUser) {
    conditions.push(
      `(
        m.created_at_ms < ?
        OR (m.created_at_ms = ? AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?)))
      )`,
    );
    params.push(
      args.nextUser.created_at_ms,
      args.nextUser.created_at_ms,
      args.nextUser.created_at,
      args.nextUser.created_at,
      args.nextUser.id,
    );
  }

  appendNormalizedCategoryFilter(conditions, params, args.categories);
  appendMessageQueryConditions(conditions, params, args.queryPlan, "m");
  return { whereClause: conditions.join(" AND "), params };
}

function buildScopedMessageFilters(args: {
  scopeClause: string;
  scopeValue: string;
  categories: string[] | undefined;
  queryPlan: SearchQueryPlan;
}): { whereClause: string; params: Array<string | number> } {
  const conditions = [args.scopeClause];
  const params = [args.scopeValue];

  appendNormalizedCategoryFilter(conditions, params, args.categories);
  appendMessageQueryConditions(conditions, params, args.queryPlan, "m");

  return { whereClause: conditions.join(" AND "), params };
}

function appendNormalizedCategoryFilter(
  conditions: string[],
  params: Array<string | number>,
  categoriesInput: string[] | undefined,
): void {
  if (categoriesInput === undefined) {
    return;
  }

  const categories = normalizeMessageCategories(categoriesInput);
  if (categories.length === 0) {
    conditions.push("1 = 0");
    return;
  }

  conditions.push(`m.category IN (${categories.map(() => "?").join(",")})`);
  params.push(...categories);
}

function appendMessageQueryConditions(
  conditions: string[],
  params: Array<string | number>,
  queryPlan: SearchQueryPlan,
  messageAlias: string,
): void {
  if (!queryPlan.hasTerms) {
    return;
  }

  const textConditions: string[] = [];
  if (queryPlan.ftsQuery) {
    textConditions.push(
      `${messageAlias}.id IN (SELECT message_id FROM message_fts WHERE message_fts MATCH ?)`,
    );
    params.push(queryPlan.ftsQuery);
  }

  if (textConditions.length > 0) {
    conditions.push(`(${textConditions.join(" AND ")})`);
  }
}

function loadToolEditFilesByMessageId(
  db: DatabaseHandle,
  messageIds: readonly string[],
): Map<
  string,
  NonNullable<IpcResponse<"sessions:getDetail">["messages"][number]["toolEditFiles"]>
> {
  const output = new Map<
    string,
    NonNullable<IpcResponse<"sessions:getDetail">["messages"][number]["toolEditFiles"]>
  >();
  if (messageIds.length === 0) {
    return output;
  }
  for (let index = 0; index < messageIds.length; index += TOOL_EDIT_FILE_LOAD_BATCH_SIZE) {
    const batch = messageIds.slice(index, index + TOOL_EDIT_FILE_LOAD_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT
           message_id,
           file_ordinal,
           file_path,
           previous_file_path,
           change_type,
           unified_diff,
           added_line_count,
           removed_line_count,
           exactness,
           before_hash,
           after_hash
         FROM message_tool_edit_files
         WHERE message_id IN (${placeholders})
         ORDER BY message_id ASC, file_ordinal ASC`,
      )
      .all(...batch) as ToolEditFileRow[];
    for (const row of rows) {
      const current = output.get(row.message_id) ?? [];
      current.push({
        filePath: row.file_path,
        previousFilePath: row.previous_file_path,
        changeType: row.change_type,
        unifiedDiff: row.unified_diff,
        addedLineCount: row.added_line_count,
        removedLineCount: row.removed_line_count,
        exactness: row.exactness,
        beforeHash: row.before_hash,
        afterHash: row.after_hash,
      });
      output.set(row.message_id, current);
    }
  }
  return output;
}

function mapSessionMessageRow(
  row: MessageRow,
  toolEditFiles?: NonNullable<
    IpcResponse<"sessions:getDetail">["messages"][number]["toolEditFiles"]
  >,
): IpcResponse<"sessions:getDetail">["messages"][number] {
  return {
    id: row.id,
    sourceId: row.source_id,
    sessionId: row.session_id,
    provider: row.provider,
    category: normalizeMessageCategory(row.category),
    content: row.content,
    createdAt: row.created_at,
    tokenInput: row.token_input,
    tokenOutput: row.token_output,
    operationDurationMs: row.operation_duration_ms,
    operationDurationSource: row.operation_duration_source,
    operationDurationConfidence: row.operation_duration_confidence,
    ...(toolEditFiles && toolEditFiles.length > 0 ? { toolEditFiles } : {}),
  };
}

function mapSessionMessageRows(
  db: DatabaseHandle,
  rows: MessageRow[],
): IpcResponse<"sessions:getDetail">["messages"] {
  const toolEditFilesByMessageId = loadToolEditFilesByMessageId(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => mapSessionMessageRow(row, toolEditFilesByMessageId.get(row.id)));
}

function mapProjectCombinedMessageRow(
  row: ProjectCombinedMessageRow,
  toolEditFiles?: NonNullable<
    IpcResponse<"sessions:getDetail">["messages"][number]["toolEditFiles"]
  >,
): IpcResponse<"projects:getCombinedDetail">["messages"][number] {
  return {
    ...mapSessionMessageRow(row, toolEditFiles),
    sessionTitle: row.session_title,
    sessionActivity: row.session_ended_at ?? row.session_started_at,
    sessionStartedAt: row.session_started_at,
    sessionEndedAt: row.session_ended_at,
    sessionGitBranch: row.session_git_branch,
    sessionCwd: row.session_cwd,
  };
}

function mapProjectCombinedMessageRows(
  db: DatabaseHandle,
  rows: ProjectCombinedMessageRow[],
): IpcResponse<"projects:getCombinedDetail">["messages"] {
  const toolEditFilesByMessageId = loadToolEditFilesByMessageId(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => mapProjectCombinedMessageRow(row, toolEditFilesByMessageId.get(row.id)));
}

function mapStoredBookmarkMessageRow(
  row: StoredBookmark,
): IpcResponse<"sessions:getDetail">["messages"][number] {
  return {
    id: row.message_id,
    sourceId: row.message_source_id,
    sessionId: row.session_id,
    provider: row.provider,
    category: normalizeMessageCategory(row.message_category),
    content: row.message_content,
    createdAt: row.message_created_at,
    tokenInput: null,
    tokenOutput: null,
    operationDurationMs: null,
    operationDurationSource: null,
    operationDurationConfidence: null,
  };
}

function mapSessionSummaryRow(
  row: SessionSummaryRow,
  bookmarkCount = 0,
): IpcResponse<"sessions:list">["sessions"][number] {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: row.provider,
    filePath: row.file_path,
    title: row.title,
    modelNames: row.model_names,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    gitBranch: row.git_branch,
    cwd: row.cwd,
    sessionIdentity: row.session_identity,
    providerSessionId: row.provider_session_id,
    sessionKind: row.session_kind,
    canonicalProjectPath: row.canonical_project_path,
    repositoryUrl: row.repository_url,
    gitCommitHash: row.git_commit_hash,
    lineageParentId: row.lineage_parent_id,
    providerClient: row.provider_client,
    providerSource: row.provider_source,
    providerClientVersion: row.provider_client_version,
    resolutionSource: row.resolution_source,
    worktreeLabel: row.worktree_label,
    worktreeSource: row.worktree_source,
    metadataJson: row.metadata_json,
    messageCount: row.message_count,
    bookmarkCount,
    tokenInputTotal: row.token_input_total,
    tokenOutputTotal: row.token_output_total,
  };
}

function assertDeletedSessionResumeMetadata(
  sessionRow:
    | {
        id: string;
        provider: Provider;
        file_path: string;
        project_path: string;
        session_identity: string | null;
        file_size: number | null;
        file_mtime_ms: number | null;
      }
    | undefined,
): asserts sessionRow is {
  id: string;
  provider: Provider;
  file_path: string;
  project_path: string;
  session_identity: string;
  file_size: number;
  file_mtime_ms: number;
} {
  if (!sessionRow) {
    throw new Error("Cannot delete indexed history because the session no longer exists.");
  }
  if (
    !sessionRow.session_identity ||
    sessionRow.file_size === null ||
    sessionRow.file_mtime_ms === null
  ) {
    throw new Error(
      `Cannot delete indexed history for session "${sessionRow.id}" because its incremental resume metadata is incomplete.`,
    );
  }
}

function deleteSessionCascade(db: DatabaseHandle, sessionId: string, filePath: string): void {
  db.prepare(
    "DELETE FROM tool_calls WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)",
  ).run(sessionId);
  db.prepare(
    "DELETE FROM message_tool_edit_files WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)",
  ).run(sessionId);
  db.prepare("DELETE FROM message_fts WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  db.prepare("DELETE FROM indexed_files WHERE file_path = ?").run(filePath);
  db.prepare("DELETE FROM index_checkpoints WHERE file_path = ?").run(filePath);
}

function upsertDeletedProjectTombstone(
  db: DatabaseHandle,
  provider: Provider,
  projectPath: string,
): void {
  db.prepare(
    `INSERT INTO deleted_projects (provider, project_path, deleted_at_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(provider, project_path) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms`,
  ).run(provider, projectPath, Date.now());
}

function upsertDeletedSessionTombstone(db: DatabaseHandle, sessionId: string): void {
  const sessionRow = db
    .prepare(
      `SELECT
         s.id,
         s.provider,
         s.file_path,
         p.path as project_path,
         f.session_identity,
         f.file_size,
         f.file_mtime_ms
       FROM sessions s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN indexed_files f ON f.file_path = s.file_path
       WHERE s.id = ?`,
    )
    .get(sessionId) as
    | {
        id: string;
        provider: Provider;
        file_path: string;
        project_path: string;
        session_identity: string | null;
        file_size: number | null;
        file_mtime_ms: number | null;
      }
    | undefined;
  if (!sessionRow) {
    throw new Error("Cannot delete indexed history because the session no longer exists.");
  }
  if (!sessionRow.file_path || !sessionRow.project_path) {
    console.warn(
      `[codetrail] Skipping deleted-session tombstone for "${sessionRow.id}" because required file metadata is missing.`,
    );
    return;
  }
  assertDeletedSessionResumeMetadata(sessionRow);

  const checkpointRow = db
    .prepare(
      `SELECT
         file_path,
         provider,
         session_id,
         session_identity,
         file_size,
         file_mtime_ms,
         last_offset_bytes,
         last_line_number,
         last_event_index,
         next_message_sequence,
         processing_state_json,
         source_metadata_json,
         head_hash,
         tail_hash
       FROM index_checkpoints
       WHERE file_path = ?`,
    )
    .get(sessionRow.file_path) as IndexCheckpointDeleteRow | undefined;

  db.prepare(
    `INSERT INTO deleted_sessions (
       file_path,
       provider,
       project_path,
       session_identity,
       session_id,
       deleted_at_ms,
       file_size,
       file_mtime_ms,
       last_offset_bytes,
       last_line_number,
       last_event_index,
       next_message_sequence,
       processing_state_json,
       source_metadata_json,
       head_hash,
       tail_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       provider = excluded.provider,
       project_path = excluded.project_path,
       session_identity = excluded.session_identity,
       session_id = excluded.session_id,
       deleted_at_ms = excluded.deleted_at_ms,
       file_size = excluded.file_size,
       file_mtime_ms = excluded.file_mtime_ms,
       last_offset_bytes = excluded.last_offset_bytes,
       last_line_number = excluded.last_line_number,
       last_event_index = excluded.last_event_index,
       next_message_sequence = excluded.next_message_sequence,
       processing_state_json = excluded.processing_state_json,
       source_metadata_json = excluded.source_metadata_json,
       head_hash = excluded.head_hash,
       tail_hash = excluded.tail_hash`,
  ).run(
    sessionRow.file_path,
    sessionRow.provider,
    sessionRow.project_path,
    sessionRow.session_identity,
    sessionRow.id,
    Date.now(),
    checkpointRow?.file_size ?? sessionRow.file_size ?? 0,
    checkpointRow?.file_mtime_ms ?? sessionRow.file_mtime_ms ?? 0,
    checkpointRow?.last_offset_bytes ?? null,
    checkpointRow?.last_line_number ?? null,
    checkpointRow?.last_event_index ?? null,
    checkpointRow?.next_message_sequence ?? null,
    checkpointRow?.processing_state_json ?? null,
    checkpointRow?.source_metadata_json ?? null,
    checkpointRow?.head_hash ?? null,
    checkpointRow?.tail_hash ?? null,
  );
}

function tryUpsertDeletedSessionTombstone(
  db: DatabaseHandle,
  sessionId: string,
  options: { allowIncompleteResumeMetadata: boolean },
): void {
  if (!options.allowIncompleteResumeMetadata) {
    upsertDeletedSessionTombstone(db, sessionId);
    return;
  }

  try {
    upsertDeletedSessionTombstone(db, sessionId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("incremental resume metadata is incomplete")
    ) {
      console.warn(
        `[codetrail] Skipping deleted-session tombstone for "${sessionId}" because incremental resume metadata is incomplete.`,
      );
      return;
    }
    throw error;
  }
}

function withDatabase<T>(
  dbPath: string,
  callback: (db: DatabaseHandle) => T,
  openDatabaseFn: OpenDatabase = openDatabase,
): T {
  const db = openDatabaseFn(dbPath);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function withDatabaseAndBookmarkStore<T>(
  dbPath: string,
  callback: (db: DatabaseHandle, bookmarkStore: BookmarkStore) => T,
  dependencies: QueryServiceDependencies,
): T {
  const createStore = dependencies.createBookmarkStore ?? createBookmarkStore;
  const bookmarkStore =
    dependencies.bookmarkStore ??
    createStore(dependencies.bookmarksDbPath ?? resolveBookmarksDbPath(dbPath));

  try {
    return withDatabase(dbPath, (db) => callback(db, bookmarkStore), dependencies.openDatabase);
  } finally {
    if (!dependencies.bookmarkStore) {
      bookmarkStore.close();
    }
  }
}
