import {
  type IpcRequest,
  type IpcResponse,
  type MessageCategory,
  PROVIDER_METADATA,
  type Provider,
  type SearchQueryPlan,
  buildSearchQueryPlan,
  buildWildcardFilterPatterns,
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

type DatabaseHandle = ReturnType<typeof openDatabase>;
type OpenDatabase = typeof openDatabase;

type CreateBookmarkStore = (bookmarksDbPath: string) => BookmarkStore;

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
  message_count: number;
  token_input_total: number;
  token_output_total: number;
};

type ProjectSummaryRow = {
  id: string;
  provider: Provider;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
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
  token_input: number | null;
  token_output: number | null;
  operation_duration_ms: number | null;
  operation_duration_source: "native" | "derived" | null;
  operation_duration_confidence: "high" | "low" | null;
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
};

const MESSAGE_CREATED_AT_ORDER_EXPR = "COALESCE(unixepoch(m.created_at), -9223372036854775808)";

export type QueryService = {
  listProjects: (request: IpcRequest<"projects:list">) => IpcResponse<"projects:list">;
  getProjectCombinedDetail: (
    request: IpcRequest<"projects:getCombinedDetail">,
  ) => IpcResponse<"projects:getCombinedDetail">;
  deleteProject: (request: IpcRequest<"projects:delete">) => IpcResponse<"projects:delete">;
  listSessions: (request: IpcRequest<"sessions:list">) => IpcResponse<"sessions:list">;
  getSessionDetail: (
    request: IpcRequest<"sessions:getDetail">,
  ) => IpcResponse<"sessions:getDetail">;
  deleteSession: (request: IpcRequest<"sessions:delete">) => IpcResponse<"sessions:delete">;
  listProjectBookmarks: (
    request: IpcRequest<"bookmarks:listProject">,
  ) => IpcResponse<"bookmarks:listProject">;
  toggleBookmark: (request: IpcRequest<"bookmarks:toggle">) => IpcResponse<"bookmarks:toggle">;
  runSearchQuery: (request: IpcRequest<"search:query">) => IpcResponse<"search:query">;
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
    listProjects: (request) => listProjectsWithDatabase(db, bookmarkStore, request),
    getProjectCombinedDetail: (request) => getProjectCombinedDetailWithDatabase(db, request),
    deleteProject: (request) => deleteProjectWithStore(db, bookmarkStore, request),
    listSessions: (request) => listSessionsWithDatabase(db, bookmarkStore, request),
    getSessionDetail: (request) => getSessionDetailWithDatabase(db, request),
    deleteSession: (request) => deleteSessionWithStore(db, bookmarkStore, request),
    listProjectBookmarks: (request) => listProjectBookmarksWithStore(db, bookmarkStore, request),
    toggleBookmark: (request) => toggleBookmarkWithStore(db, bookmarkStore, request),
    runSearchQuery: (request) => runSearchQueryWithDatabase(db, request),
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
  request: IpcRequest<"bookmarks:listProject">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"bookmarks:listProject"> {
  return withDatabaseAndBookmarkStore(
    dbPath,
    (db, bookmarkStore) => listProjectBookmarksWithStore(db, bookmarkStore, request),
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
    conditions.push("(LOWER(p.name) LIKE ? ESCAPE '\\' OR LOWER(p.path) LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }

  const rows = db
    .prepare(
      `SELECT
         p.id,
         p.provider,
         p.name,
         p.path,
         COUNT(s.id) as session_count,
         COALESCE(SUM(s.message_count), 0) as message_count,
         MAX(COALESCE(s.ended_at, s.started_at)) as last_activity
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id
       ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
       GROUP BY p.id
       ORDER BY p.provider, LOWER(p.name), p.id`,
    )
    .all(...params) as Array<{
    id: string;
    provider: Provider;
    name: string;
    path: string;
    session_count: number;
    message_count: number;
    last_activity: string | null;
  }>;

  return {
    projects: rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      name: row.name,
      path: row.path,
      sessionCount: row.session_count,
      messageCount: row.message_count,
      bookmarkCount: bookmarkStore.countProjectBookmarks(row.id),
      lastActivity: row.last_activity,
    })),
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
         s.duration_ms,
         s.git_branch,
         s.cwd,
         s.message_count,
         s.token_input_total,
         s.token_output_total
       FROM sessions s
       ${whereClause}
       ORDER BY COALESCE(s.ended_at, s.started_at) DESC, s.id DESC`,
    )
    .all(...params) as SessionSummaryRow[];

  return {
    sessions: rows.map((row) =>
      mapSessionSummaryRow(
        row,
        request.projectId ? bookmarkStore.countSessionBookmarks(request.projectId, row.id) : 0,
      ),
    ),
  };
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

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE ${whereClause}`,
    )
    .get(...params) as { cnt: number } | undefined;
  const totalCount = Number(totalRow?.cnt ?? 0);
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
  const focusTarget = resolveFocusTarget(db, {
    focusMessageId: request.focusMessageId,
    focusSourceId: request.focusSourceId,
    byMessageIdSql:
      "SELECT m.id, m.created_at FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.project_id = ? AND m.id = ?",
    byMessageIdParams: request.focusMessageId ? [request.projectId, request.focusMessageId] : [],
    bySourceIdSql:
      "SELECT m.id, m.created_at FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.project_id = ? AND m.source_id = ? ORDER BY m.created_at ASC, m.id ASC LIMIT 1",
    bySourceIdParams: request.focusSourceId ? [request.projectId, request.focusSourceId] : [],
  });
  const resolvedFocus = resolveFocusIndexAndPage({
    db,
    fromSql: `FROM messages m
              JOIN sessions s ON s.id = m.session_id`,
    whereClause,
    params,
    focusComparison,
    focusTarget,
    page,
    pageSize,
  });
  page = resolvedFocus.page;
  const focusIndex = resolvedFocus.focusIndex;

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
    messages: rows.map(mapProjectCombinedMessageRow),
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
         s.duration_ms,
         s.git_branch,
         s.cwd,
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

  const totalRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM messages m WHERE ${whereClause}`)
    .get(...params) as { cnt: number } | undefined;
  const totalCount = Number(totalRow?.cnt ?? 0);
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
  const focusTarget = resolveFocusTarget(db, {
    focusMessageId: request.focusMessageId,
    focusSourceId: request.focusSourceId,
    byMessageIdSql: "SELECT id, created_at FROM messages WHERE session_id = ? AND id = ?",
    byMessageIdParams: request.focusMessageId ? [request.sessionId, request.focusMessageId] : [],
    bySourceIdSql:
      "SELECT id, created_at FROM messages WHERE session_id = ? AND source_id = ? ORDER BY created_at ASC, id ASC LIMIT 1",
    bySourceIdParams: request.focusSourceId ? [request.sessionId, request.focusSourceId] : [],
  });
  const resolvedFocus = resolveFocusIndexAndPage({
    db,
    fromSql: "FROM messages m",
    whereClause,
    params,
    focusComparison,
    focusTarget,
    page,
    pageSize,
  });
  page = resolvedFocus.page;
  const focusIndex = resolvedFocus.focusIndex;

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
    messages: rows.map(mapSessionMessageRow),
  };
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
         p.created_at,
         p.updated_at,
         COUNT(DISTINCT s.id) as session_count,
         COALESCE(SUM(s.message_count), 0) as message_count,
         MAX(COALESCE(s.ended_at, s.started_at)) as last_activity
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id
       WHERE p.id = ?
       GROUP BY p.id, p.provider, p.name, p.path, p.created_at, p.updated_at`,
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
      upsertDeletedSessionTombstone(db, row.id);
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
  request: IpcRequest<"bookmarks:listProject">,
): IpcResponse<"bookmarks:listProject"> {
  const hasQuery = (request.query?.trim().length ?? 0) > 0;
  const queryPlan = hasQuery
    ? buildSearchQueryPlan(request.query ?? "", request.searchMode ?? "simple")
    : buildSearchQueryPlan("", request.searchMode ?? "simple");
  const storedRows = bookmarkStore.listProjectBookmarks(
    request.projectId,
    hasQuery ? request.query : undefined,
    request.searchMode ?? "simple",
  );
  const totalCount = hasQuery
    ? bookmarkStore.countProjectBookmarks(request.projectId)
    : storedRows.length;
  if (queryPlan.error) {
    return {
      projectId: request.projectId,
      totalCount,
      filteredCount: 0,
      categoryCounts: makeEmptyCategoryCounts(),
      queryError: queryPlan.error,
      highlightPatterns: [],
      results: [],
    };
  }
  const liveRowsByMessageId = listLiveBookmarkMessagesById(
    db,
    request.projectId,
    storedRows.map((row) => row.message_id),
  );

  const categoryCounts = makeEmptyCategoryCounts();
  const normalizedRequestedCategories =
    request.categories === undefined ? null : normalizeMessageCategories(request.categories);

  const includeCategory = (
    category: IpcResponse<"sessions:getDetail">["messages"][number]["category"],
  ) => {
    if (normalizedRequestedCategories === null) {
      return true;
    }
    if (normalizedRequestedCategories.length === 0) {
      return false;
    }
    return normalizedRequestedCategories.includes(category);
  };

  const results: IpcResponse<"bookmarks:listProject">["results"] = [];

  for (const row of storedRows) {
    const live = liveRowsByMessageId.get(row.message_id);
    const isLiveMatch = live !== undefined && live.session_id === row.session_id;
    const message = isLiveMatch ? mapSessionMessageRow(live) : mapStoredBookmarkMessageRow(row);

    categoryCounts[message.category] += 1;
    if (!includeCategory(message.category)) {
      continue;
    }

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
    filteredCount: results.length,
    categoryCounts,
    queryError: null,
    highlightPatterns: queryPlan.highlightPatterns,
    results,
  };
}

function buildMessageSortSql(sortDirection: MessageSortDirection): {
  messageOrder: string;
  focusComparison: string;
} {
  const isAscending = sortDirection === "asc";
  return {
    // created_at can be null or invalid in imported data, so use the unixepoch expression as the
    // primary stable sort key and the raw string/id as deterministic tie-breakers.
    messageOrder: isAscending
      ? `${MESSAGE_CREATED_AT_ORDER_EXPR} ASC, m.created_at ASC, m.id ASC`
      : `${MESSAGE_CREATED_AT_ORDER_EXPR} DESC, m.created_at DESC, m.id DESC`,
    focusComparison: isAscending
      ? `(
           ${MESSAGE_CREATED_AT_ORDER_EXPR} < COALESCE(unixepoch(?), -9223372036854775808)
           OR (
             ${MESSAGE_CREATED_AT_ORDER_EXPR} = COALESCE(unixepoch(?), -9223372036854775808)
             AND (m.created_at < ? OR (m.created_at = ? AND m.id <= ?))
           )
         )`
      : `(
           ${MESSAGE_CREATED_AT_ORDER_EXPR} > COALESCE(unixepoch(?), -9223372036854775808)
           OR (
             ${MESSAGE_CREATED_AT_ORDER_EXPR} = COALESCE(unixepoch(?), -9223372036854775808)
             AND (m.created_at > ? OR (m.created_at = ? AND m.id >= ?))
           )
         )`,
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

function resolveFocusIndexAndPage(args: {
  db: DatabaseHandle;
  fromSql: string;
  whereClause: string;
  params: readonly unknown[];
  focusComparison: string;
  focusTarget: FocusTargetRow | undefined;
  page: number;
  pageSize: number;
}): { page: number; focusIndex: number | null } {
  let { page } = args;
  let focusIndex: number | null = null;
  if (!args.focusTarget) {
    return { page, focusIndex };
  }

  // Convert a focus target into the page that should be loaded by counting how many rows sort
  // before it under the current direction/filter set.
  const focusRow = args.db
    .prepare(
      `SELECT COUNT(*) as cnt
       ${args.fromSql}
       WHERE ${args.whereClause}
       AND ${args.focusComparison}`,
    )
    .get(
      ...args.params,
      args.focusTarget.created_at,
      args.focusTarget.created_at,
      args.focusTarget.created_at,
      args.focusTarget.created_at,
      args.focusTarget.id,
    ) as { cnt: number } | undefined;
  const countBefore = Number(focusRow?.cnt ?? 0);
  if (countBefore > 0) {
    focusIndex = countBefore - 1;
    page = Math.floor(focusIndex / args.pageSize);
  }
  return { page, focusIndex };
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
}): { whereClause: string; params: string[] } {
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
}): { whereClause: string; params: string[] } {
  return buildScopedMessageFilters({
    scopeClause: "s.project_id = ?",
    scopeValue: args.projectId,
    categories: args.categories,
    queryPlan: args.queryPlan,
  });
}

function buildScopedMessageFilters(args: {
  scopeClause: string;
  scopeValue: string;
  categories: string[] | undefined;
  queryPlan: SearchQueryPlan;
}): { whereClause: string; params: string[] } {
  const conditions = [args.scopeClause];
  const params = [args.scopeValue];

  appendNormalizedCategoryFilter(conditions, params, args.categories);
  appendMessageQueryConditions(conditions, params, args.queryPlan, "m");

  return { whereClause: conditions.join(" AND "), params };
}

function appendNormalizedCategoryFilter(
  conditions: string[],
  params: string[],
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
  params: string[],
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

function mapSessionMessageRow(
  row: MessageRow,
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
  };
}

function mapProjectCombinedMessageRow(
  row: ProjectCombinedMessageRow,
): IpcResponse<"projects:getCombinedDetail">["messages"][number] {
  return {
    ...mapSessionMessageRow(row),
    sessionTitle: row.session_title,
    sessionActivity: row.session_ended_at ?? row.session_started_at,
    sessionStartedAt: row.session_started_at,
    sessionEndedAt: row.session_ended_at,
    sessionGitBranch: row.session_git_branch,
    sessionCwd: row.session_cwd,
  };
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
