import {
  type IpcRequest,
  type IpcResponse,
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
  provider: "claude" | "codex" | "gemini";
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

type MessageRow = {
  id: string;
  source_id: string;
  session_id: string;
  provider: "claude" | "codex" | "gemini";
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

const SESSION_TITLE_JOIN_SQL = `
  LEFT JOIN (
    SELECT ranked.session_id, ranked.content
    FROM (
      SELECT
        m.session_id,
        m.content,
        ROW_NUMBER() OVER (
          PARTITION BY m.session_id
          ORDER BY
            CASE
              WHEN m.category = 'user' THEN 0
              WHEN m.category = 'assistant' THEN 1
              ELSE 2
            END,
            m.created_at,
            m.id
        ) AS row_num
      FROM messages m
    ) ranked
    WHERE ranked.row_num = 1
  ) first_title ON first_title.session_id = s.id
`;

export type QueryService = {
  listProjects: (request: IpcRequest<"projects:list">) => IpcResponse<"projects:list">;
  getProjectCombinedDetail: (
    request: IpcRequest<"projects:getCombinedDetail">,
  ) => IpcResponse<"projects:getCombinedDetail">;
  listSessions: (request: IpcRequest<"sessions:list">) => IpcResponse<"sessions:list">;
  getSessionDetail: (
    request: IpcRequest<"sessions:getDetail">,
  ) => IpcResponse<"sessions:getDetail">;
  listProjectBookmarks: (
    request: IpcRequest<"bookmarks:listProject">,
  ) => IpcResponse<"bookmarks:listProject">;
  toggleBookmark: (request: IpcRequest<"bookmarks:toggle">) => IpcResponse<"bookmarks:toggle">;
  runSearchQuery: (request: IpcRequest<"search:query">) => IpcResponse<"search:query">;
  close: () => void;
};

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
    listProjects: (request) => listProjectsWithDatabase(db, request),
    getProjectCombinedDetail: (request) => getProjectCombinedDetailWithDatabase(db, request),
    listSessions: (request) => listSessionsWithDatabase(db, request),
    getSessionDetail: (request) => getSessionDetailWithDatabase(db, request),
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
  return withDatabase(
    dbPath,
    (db) => listProjectsWithDatabase(db, request),
    dependencies.openDatabase,
  );
}

export function listSessions(
  dbPath: string,
  request: IpcRequest<"sessions:list">,
  dependencies: QueryServiceDependencies = {},
): IpcResponse<"sessions:list"> {
  return withDatabase(
    dbPath,
    (db) => listSessionsWithDatabase(db, request),
    dependencies.openDatabase,
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

  const query = request.query.trim().toLowerCase();
  if (query.length > 0) {
    conditions.push("(LOWER(p.name) LIKE ? OR LOWER(p.path) LIKE ?)");
    const like = `%${query}%`;
    params.push(like, like);
  }

  const rows = db
    .prepare(
      `SELECT
         p.id,
         p.provider,
         p.name,
         p.path,
         COUNT(s.id) as session_count,
         MAX(COALESCE(s.ended_at, s.started_at)) as last_activity
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id
       ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
       GROUP BY p.id
       ORDER BY p.provider, LOWER(p.name), p.id`,
    )
    .all(...params) as Array<{
    id: string;
    provider: "claude" | "codex" | "gemini";
    name: string;
    path: string;
    session_count: number;
    last_activity: string | null;
  }>;

  return {
    projects: rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      name: row.name,
      path: row.path,
      sessionCount: row.session_count,
      lastActivity: row.last_activity,
    })),
  };
}

function listSessionsWithDatabase(
  db: DatabaseHandle,
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
         COALESCE(first_title.content, '') as title,
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
       ${SESSION_TITLE_JOIN_SQL}
       ${whereClause}
       ORDER BY COALESCE(s.ended_at, s.started_at) DESC, s.id DESC`,
    )
    .all(...params) as SessionSummaryRow[];

  return { sessions: rows.map(mapSessionSummaryRow) };
}

function getProjectCombinedDetailWithDatabase(
  db: DatabaseHandle,
  request: IpcRequest<"projects:getCombinedDetail">,
): IpcResponse<"projects:getCombinedDetail"> {
  const isAscending = request.sortDirection === "asc";
  const messageOrder = isAscending
    ? "m.created_at ASC, m.id ASC"
    : "m.created_at DESC, m.id DESC";
  const focusComparison = isAscending
    ? "(m.created_at < ? OR (m.created_at = ? AND m.id <= ?))"
    : "(m.created_at > ? OR (m.created_at = ? AND m.id >= ?))";
  const pageSize = request.pageSize;
  let page = request.page;
  const messageFilters: {
    projectId: string;
    categories?: string[];
    query: string;
  } = {
    projectId: request.projectId,
    query: request.query,
  };
  if (request.categories !== undefined) {
    messageFilters.categories = request.categories;
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
  const categoryCounts = makeEmptyCategoryCounts();

  const queryOnlyFilter = buildProjectMessageFilters({
    projectId: request.projectId,
    query: request.query,
  });
  const categoryRows = db
    .prepare(
      `SELECT m.category as category, COUNT(*) as cnt
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE ${queryOnlyFilter.whereClause}
       GROUP BY m.category`,
    )
    .all(...queryOnlyFilter.params) as Array<{ category: string; cnt: number }>;

  for (const row of categoryRows) {
    categoryCounts[normalizeMessageCategory(row.category)] += Number(row.cnt ?? 0);
  }

  let focusIndex: number | null = null;
  if (request.focusMessageId || request.focusSourceId) {
    const focusTarget = request.focusMessageId
      ? ((db
          .prepare(
            "SELECT m.id, m.created_at FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.project_id = ? AND m.id = ?",
          )
          .get(request.projectId, request.focusMessageId) as
          | {
              id: string;
              created_at: string;
            }
          | undefined) ?? undefined)
      : ((db
          .prepare(
            "SELECT m.id, m.created_at FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.project_id = ? AND m.source_id = ? ORDER BY m.created_at ASC, m.id ASC LIMIT 1",
          )
          .get(request.projectId, request.focusSourceId) as
          | {
              id: string;
              created_at: string;
            }
          | undefined) ?? undefined);

    if (focusTarget) {
      const focusRow = db
        .prepare(
          `SELECT COUNT(*) as cnt
           FROM messages m
           JOIN sessions s ON s.id = m.session_id
           WHERE ${whereClause}
           AND ${focusComparison}`,
        )
        .get(...params, focusTarget.created_at, focusTarget.created_at, focusTarget.id) as
        | { cnt: number }
        | undefined;
      const countBefore = Number(focusRow?.cnt ?? 0);
      if (countBefore > 0) {
        focusIndex = countBefore - 1;
        page = Math.floor(focusIndex / pageSize);
      }
    }
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
         m.token_input,
         m.token_output,
         m.operation_duration_ms,
         m.operation_duration_source,
         m.operation_duration_confidence,
         COALESCE(first_title.content, '') as session_title,
         s.started_at as session_started_at,
         s.ended_at as session_ended_at,
         s.git_branch as session_git_branch,
         s.cwd as session_cwd
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       ${SESSION_TITLE_JOIN_SQL}
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
    messages: rows.map(mapProjectCombinedMessageRow),
  };
}

function getSessionDetailWithDatabase(
  db: DatabaseHandle,
  request: IpcRequest<"sessions:getDetail">,
): IpcResponse<"sessions:getDetail"> {
  const isAscending = request.sortDirection === "asc";
  const messageOrder = isAscending
    ? "m.created_at ASC, m.id ASC"
    : "m.created_at DESC, m.id DESC";
  const focusComparison = isAscending
    ? "(m.created_at < ? OR (m.created_at = ? AND m.id <= ?))"
    : "(m.created_at > ? OR (m.created_at = ? AND m.id >= ?))";
  const sessionRow = db
    .prepare(
      `SELECT
         s.id,
         s.project_id,
         s.provider,
         s.file_path,
         COALESCE(first_title.content, '') as title,
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
       ${SESSION_TITLE_JOIN_SQL}
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
      messages: [],
    };
  }

  const pageSize = request.pageSize;
  let page = request.page;
  const messageFilters: {
    sessionId: string;
    categories?: string[];
    query: string;
  } = {
    sessionId: request.sessionId,
    query: request.query,
  };
  if (request.categories !== undefined) {
    messageFilters.categories = request.categories;
  }

  const { whereClause, params } = buildMessageFilters(messageFilters);

  const totalRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM messages m WHERE ${whereClause}`)
    .get(...params) as { cnt: number } | undefined;
  const totalCount = Number(totalRow?.cnt ?? 0);
  const categoryCounts = makeEmptyCategoryCounts();

  const queryOnlyFilter = buildMessageFilters({
    sessionId: request.sessionId,
    query: request.query,
  });
  const categoryRows = db
    .prepare(
      `SELECT m.category as category, COUNT(*) as cnt
       FROM messages m
       WHERE ${queryOnlyFilter.whereClause}
       GROUP BY m.category`,
    )
    .all(...queryOnlyFilter.params) as Array<{ category: string; cnt: number }>;

  for (const row of categoryRows) {
    categoryCounts[normalizeMessageCategory(row.category)] += Number(row.cnt ?? 0);
  }

  let focusIndex: number | null = null;
  if (request.focusMessageId || request.focusSourceId) {
    const focusTarget = request.focusMessageId
      ? ((db
          .prepare("SELECT id, created_at FROM messages WHERE session_id = ? AND id = ?")
          .get(request.sessionId, request.focusMessageId) as
          | {
              id: string;
              created_at: string;
            }
          | undefined) ?? undefined)
      : ((db
          .prepare("SELECT id, created_at FROM messages WHERE session_id = ? AND source_id = ?")
          .get(request.sessionId, request.focusSourceId) as
          | {
              id: string;
              created_at: string;
            }
          | undefined) ?? undefined);

    if (focusTarget) {
      const focusRow = db
        .prepare(
          `SELECT COUNT(*) as cnt
           FROM messages m
           WHERE ${whereClause}
           AND ${focusComparison}`,
        )
        .get(...params, focusTarget.created_at, focusTarget.created_at, focusTarget.id) as
        | { cnt: number }
        | undefined;
      const countBefore = Number(focusRow?.cnt ?? 0);
      if (countBefore > 0) {
        focusIndex = countBefore - 1;
        page = Math.floor(focusIndex / pageSize);
      }
    }
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
    messages: rows.map(mapSessionMessageRow),
  };
}

function listProjectBookmarksWithStore(
  db: DatabaseHandle,
  bookmarkStore: BookmarkStore,
  request: IpcRequest<"bookmarks:listProject">,
): IpcResponse<"bookmarks:listProject"> {
  const allStoredRows = bookmarkStore.listProjectBookmarks(request.projectId);
  const hasQuery = (request.query?.trim().length ?? 0) > 0;
  const storedRows = hasQuery
    ? bookmarkStore.listProjectBookmarks(request.projectId, request.query)
    : allStoredRows;
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
    totalCount: allStoredRows.length,
    filteredCount: results.length,
    categoryCounts,
    results,
  };
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
         COALESCE(first_title.content, '') as session_title,
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
       ${SESSION_TITLE_JOIN_SQL}
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
         COALESCE(first_title.content, '') as session_title
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       ${SESSION_TITLE_JOIN_SQL}
       WHERE m.id = ?`,
    )
    .get(request.messageId) as
    | {
        id: string;
        source_id: string;
        session_id: string;
        provider: "claude" | "codex" | "gemini";
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
  const searchInput: {
    query: string;
    categories?: string[];
    providers?: string[];
    projectIds?: string[];
    projectQuery: string;
    limit: number;
    offset: number;
  } = {
    query: request.query,
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
  query: string;
}): { whereClause: string; params: string[] } {
  const conditions = ["m.session_id = ?"];
  const params = [args.sessionId];

  if (args.categories !== undefined) {
    const categories = normalizeMessageCategories(args.categories);
    if (categories.length > 0) {
      conditions.push(`m.category IN (${categories.map(() => "?").join(",")})`);
      params.push(...categories);
    } else {
      conditions.push("1 = 0");
    }
  }

  const query = args.query.trim().toLowerCase();
  if (query.length > 0) {
    conditions.push("LOWER(m.content) LIKE ?");
    params.push(`%${query}%`);
  }

  return { whereClause: conditions.join(" AND "), params };
}

function buildProjectMessageFilters(args: {
  projectId: string;
  categories?: string[];
  query: string;
}): { whereClause: string; params: string[] } {
  const conditions = ["s.project_id = ?"];
  const params = [args.projectId];

  if (args.categories !== undefined) {
    const categories = normalizeMessageCategories(args.categories);
    if (categories.length > 0) {
      conditions.push(`m.category IN (${categories.map(() => "?").join(",")})`);
      params.push(...categories);
    } else {
      conditions.push("1 = 0");
    }
  }

  const query = args.query.trim().toLowerCase();
  if (query.length > 0) {
    conditions.push("LOWER(m.content) LIKE ?");
    params.push(`%${query}%`);
  }

  return { whereClause: conditions.join(" AND "), params };
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
    tokenInputTotal: row.token_input_total,
    tokenOutputTotal: row.token_output_total,
  };
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
