import { dirname, join } from "node:path";

import {
  type MessageCategory,
  type OperationDurationConfidence,
  type OperationDurationSource,
  type Provider,
  type SearchMode,
  buildSearchQueryPlan,
  makeEmptyCategoryCounts,
  normalizeMessageCategories,
  normalizeMessageCategory,
  openDatabase,
} from "@codetrail/core";

type DatabaseHandle = ReturnType<typeof openDatabase>;

const BOOKMARKS_DB_SCHEMA_VERSION = 2;
const SNAPSHOT_VERSION = 1;
const BOOKMARKS_DB_FILE_NAME = "codetrail.bookmarks.sqlite";

export type BookmarkSnapshot = {
  projectId: string;
  sessionId: string;
  messageId: string;
  messageSourceId: string;
  provider: Provider;
  sessionTitle: string;
  messageCategory: MessageCategory;
  messageContent: string;
  messageCreatedAt: string;
  bookmarkedAt: string;
  snapshotVersion: number;
  snapshotJson: string;
};

export type StoredBookmark = {
  project_id: string;
  session_id: string;
  message_id: string;
  message_source_id: string;
  provider: Provider;
  session_title: string;
  message_category: MessageCategory;
  message_content: string;
  message_created_at: string;
  bookmarked_at: string;
  is_orphaned: number;
  orphaned_at: string | null;
  snapshot_version: number;
  snapshot_json: string;
};

export type BookmarkReconciliationResult = {
  deletedMissingProjects: number;
  markedOrphaned: number;
  restored: number;
};

export type BookmarkListOptions = {
  sessionId?: string;
  query?: string;
  searchMode?: SearchMode;
  categories?: MessageCategory[];
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

type BookmarkListOptionsInput = BookmarkListOptions | string | undefined;

export type BookmarkStore = {
  listProjectBookmarks: (projectId: string, options?: BookmarkListOptionsInput) => StoredBookmark[];
  getProjectBookmarkFocusIndex: (
    projectId: string,
    target: { messageId?: string; messageSourceId?: string },
    options?: BookmarkListOptionsInput,
  ) => number | null;
  countProjectBookmarks: (projectId: string, options?: BookmarkListOptionsInput) => number;
  listProjectBookmarkMessageIds: (projectId: string, messageIds: string[]) => string[];
  countProjectBookmarkCategories: (
    projectId: string,
    query?: string,
    sessionId?: string,
    searchMode?: SearchMode,
  ) => Record<MessageCategory, number>;
  countProjectBookmarksByProjectIds?: (projectIds: string[]) => Record<string, number>;
  countAllBookmarks?: () => number;
  countSessionBookmarks: (projectId: string, sessionId: string) => number;
  countSessionBookmarksBySessionIds?: (
    projectId: string,
    sessionIds: string[],
  ) => Record<string, number>;
  getBookmark: (projectId: string, messageId: string) => StoredBookmark | null;
  upsertBookmark: (snapshot: Omit<BookmarkSnapshot, "snapshotVersion" | "snapshotJson">) => void;
  removeBookmark: (projectId: string, messageId: string) => boolean;
  removeProjectBookmarks: (projectId: string) => number;
  removeSessionBookmarks: (projectId: string, sessionId: string) => number;
  reconcileWithIndexedData: (indexedDbPath: string) => BookmarkReconciliationResult;
  close: () => void;
};

export function resolveBookmarksDbPath(indexedDbPath: string): string {
  return join(dirname(indexedDbPath), BOOKMARKS_DB_FILE_NAME);
}

export function initializeBookmarkStore(bookmarksDbPath: string): void {
  const store = createBookmarkStore(bookmarksDbPath);
  store.close();
}

export function createBookmarkStore(bookmarksDbPath: string): BookmarkStore {
  const db = openDatabase(bookmarksDbPath);
  ensureBookmarkSchema(db);

  const getStmt = db.prepare(
    `SELECT
       project_id,
       session_id,
       message_id,
       message_source_id,
       provider,
       session_title,
       message_category,
       message_content,
       message_created_at,
       bookmarked_at,
       is_orphaned,
       orphaned_at,
       snapshot_version,
       snapshot_json
     FROM bookmarks
     WHERE project_id = ? AND message_id = ?`,
  );
  const countStmt = db.prepare("SELECT COUNT(*) as cnt FROM bookmarks WHERE project_id = ?");
  const countAllStmt = db.prepare("SELECT COUNT(*) as cnt FROM bookmarks");
  const countSessionStmt = db.prepare(
    "SELECT COUNT(*) as cnt FROM bookmarks WHERE project_id = ? AND session_id = ?",
  );

  const upsertStmt = db.prepare(
    `INSERT INTO bookmarks (
       project_id,
       session_id,
       message_id,
       message_source_id,
       provider,
       session_title,
       message_category,
       message_content,
       message_created_at,
       bookmarked_at,
       is_orphaned,
       orphaned_at,
       snapshot_version,
       snapshot_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT(project_id, message_id) DO UPDATE SET
       session_id = excluded.session_id,
       message_source_id = excluded.message_source_id,
       provider = excluded.provider,
       session_title = excluded.session_title,
       message_category = excluded.message_category,
       message_content = excluded.message_content,
       message_created_at = excluded.message_created_at,
       bookmarked_at = excluded.bookmarked_at,
       is_orphaned = 0,
       orphaned_at = NULL,
       snapshot_version = excluded.snapshot_version,
       snapshot_json = excluded.snapshot_json`,
  );

  const removeStmt = db.prepare("DELETE FROM bookmarks WHERE project_id = ? AND message_id = ?");
  const removeProjectStmt = db.prepare("DELETE FROM bookmarks WHERE project_id = ?");
  const removeSessionStmt = db.prepare(
    "DELETE FROM bookmarks WHERE project_id = ? AND session_id = ?",
  );
  const deleteFtsRowStmt = db.prepare(
    "DELETE FROM bookmarks_fts WHERE project_id = ? AND message_id = ?",
  );
  const deleteProjectFtsRowsStmt = db.prepare("DELETE FROM bookmarks_fts WHERE project_id = ?");
  const deleteSessionFtsRowsStmt = db.prepare(
    `DELETE FROM bookmarks_fts
     WHERE project_id = ?
       AND message_id IN (
         SELECT message_id FROM bookmarks WHERE project_id = ? AND session_id = ?
       )`,
  );
  const insertFtsRowStmt = db.prepare(
    "INSERT INTO bookmarks_fts (project_id, message_id, message_content) VALUES (?, ?, ?)",
  );

  return {
    listProjectBookmarks: (projectId, optionsInput = {}) => {
      const options = normalizeBookmarkListOptions(optionsInput);
      const built = buildProjectBookmarkQuery(projectId, options);
      if (built.impossible) {
        return [];
      }
      const orderDirection = options.sortDirection === "asc" ? "ASC" : "DESC";
      const limitOffsetSql =
        options.limit !== undefined
          ? " LIMIT ? OFFSET ?"
          : options.offset !== undefined
            ? " LIMIT -1 OFFSET ?"
            : "";
      const params: Array<string | number> = [...built.params];
      if (options.limit !== undefined) {
        params.push(Math.max(0, options.limit), Math.max(0, options.offset ?? 0));
      } else if (options.offset !== undefined) {
        params.push(Math.max(0, options.offset));
      }

      return db
        .prepare(
          `SELECT
             b.project_id,
             b.session_id,
             b.message_id,
             b.message_source_id,
             b.provider,
             b.session_title,
             b.message_category,
             b.message_content,
             b.message_created_at,
             b.bookmarked_at,
             b.is_orphaned,
             b.orphaned_at,
             b.snapshot_version,
             b.snapshot_json
           ${built.fromSql}
           WHERE ${built.whereClause}
           ORDER BY b.message_created_at ${orderDirection}, b.message_id ${orderDirection}${limitOffsetSql}`,
        )
        .all(...params) as StoredBookmark[];
    },
    getProjectBookmarkFocusIndex: (projectId, target, optionsInput = {}) => {
      if (!target.messageId && !target.messageSourceId) {
        return null;
      }
      const options = normalizeBookmarkListOptions(optionsInput);
      const built = buildProjectBookmarkQuery(projectId, options);
      if (built.impossible) {
        return null;
      }

      const orderDirection = options.sortDirection === "desc" ? "DESC" : "ASC";
      const targetClause = target.messageId ? "b.message_id = ?" : "b.message_source_id = ?";
      const targetValue = target.messageId ?? target.messageSourceId;
      const targetRow = db
        .prepare(
          `SELECT b.message_created_at, b.message_id
           ${built.fromSql}
           WHERE ${built.whereClause}
             AND ${targetClause}
           ORDER BY b.message_created_at ${orderDirection}, b.message_id ${orderDirection}
           LIMIT 1`,
        )
        .get(...built.params, targetValue) as
        | { message_created_at: string; message_id: string }
        | undefined;
      if (!targetRow) {
        return null;
      }

      const sortComparison =
        orderDirection === "ASC"
          ? `(
               b.message_created_at < ?
               OR (b.message_created_at = ? AND b.message_id < ?)
             )`
          : `(
               b.message_created_at > ?
               OR (b.message_created_at = ? AND b.message_id > ?)
             )`;
      const indexRow = db
        .prepare(
          `SELECT COUNT(*) as cnt
           ${built.fromSql}
           WHERE ${built.whereClause}
             AND ${sortComparison}`,
        )
        .get(
          ...built.params,
          targetRow.message_created_at,
          targetRow.message_created_at,
          targetRow.message_id,
        ) as { cnt: number } | undefined;

      return Number(indexRow?.cnt ?? 0);
    },
    countProjectBookmarks: (projectId, optionsInput = {}) => {
      const options = normalizeBookmarkListOptions(optionsInput);
      if (
        options.query === undefined &&
        options.searchMode === undefined &&
        options.categories === undefined
      ) {
        const row = countStmt.get(projectId) as { cnt: number } | undefined;
        return Number(row?.cnt ?? 0);
      }
      const built = buildProjectBookmarkQuery(projectId, options);
      if (built.impossible) {
        return 0;
      }
      const row = db
        .prepare(
          `SELECT COUNT(*) as cnt
           ${built.fromSql}
           WHERE ${built.whereClause}`,
        )
        .get(...built.params) as { cnt: number } | undefined;
      return Number(row?.cnt ?? 0);
    },
    listProjectBookmarkMessageIds: (projectId, messageIds) => {
      if (messageIds.length === 0) {
        return [];
      }
      const placeholders = messageIds.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT message_id
           FROM bookmarks
           WHERE project_id = ?
             AND message_id IN (${placeholders})`,
        )
        .all(projectId, ...messageIds) as Array<{ message_id: string }>;
      return rows.map((row) => row.message_id);
    },
    countProjectBookmarkCategories: (projectId, query, sessionId, searchMode = "simple") => {
      const built = buildProjectBookmarkQuery(projectId, {
        ...(sessionId ? { sessionId } : {}),
        ...(query !== undefined ? { query } : {}),
        searchMode,
      });
      const counts = makeEmptyCategoryCounts();
      if (built.impossible) {
        return counts;
      }
      const rows = db
        .prepare(
          `SELECT b.message_category as category, COUNT(*) as cnt
           ${built.fromSql}
           WHERE ${built.whereClause}
           GROUP BY b.message_category`,
        )
        .all(...built.params) as Array<{ category: string; cnt: number }>;
      for (const row of rows) {
        counts[normalizeMessageCategory(row.category)] += Number(row.cnt ?? 0);
      }
      return counts;
    },
    countProjectBookmarksByProjectIds: (projectIds) => {
      return countBookmarksByProjectIds(db, projectIds);
    },
    countAllBookmarks: () => {
      const row = countAllStmt.get() as { cnt: number } | undefined;
      return Number(row?.cnt ?? 0);
    },
    countSessionBookmarks: (projectId, sessionId) => {
      const row = countSessionStmt.get(projectId, sessionId) as { cnt: number } | undefined;
      return Number(row?.cnt ?? 0);
    },
    countSessionBookmarksBySessionIds: (projectId, sessionIds) => {
      return countBookmarksBySessionIds(db, projectId, sessionIds);
    },
    getBookmark: (projectId, messageId) => {
      const row = getStmt.get(projectId, messageId) as StoredBookmark | undefined;
      return row ?? null;
    },
    upsertBookmark: (snapshotInput) => {
      const snapshotJson = JSON.stringify({
        provider: snapshotInput.provider,
        sessionId: snapshotInput.sessionId,
        sessionTitle: snapshotInput.sessionTitle,
        messageId: snapshotInput.messageId,
        sourceId: snapshotInput.messageSourceId,
        category: snapshotInput.messageCategory,
        content: snapshotInput.messageContent,
        createdAt: snapshotInput.messageCreatedAt,
      });

      upsertStmt.run(
        snapshotInput.projectId,
        snapshotInput.sessionId,
        snapshotInput.messageId,
        snapshotInput.messageSourceId,
        snapshotInput.provider,
        snapshotInput.sessionTitle,
        snapshotInput.messageCategory,
        snapshotInput.messageContent,
        snapshotInput.messageCreatedAt,
        snapshotInput.bookmarkedAt,
        SNAPSHOT_VERSION,
        snapshotJson,
      );
      deleteFtsRowStmt.run(snapshotInput.projectId, snapshotInput.messageId);
      insertFtsRowStmt.run(
        snapshotInput.projectId,
        snapshotInput.messageId,
        snapshotInput.messageContent,
      );
    },
    removeBookmark: (projectId, messageId) => {
      const info = removeStmt.run(projectId, messageId);
      if (info.changes > 0) {
        deleteFtsRowStmt.run(projectId, messageId);
      }
      return info.changes > 0;
    },
    removeProjectBookmarks: (projectId) => {
      const run = db.transaction((targetProjectId: string) => {
        deleteProjectFtsRowsStmt.run(targetProjectId);
        const info = removeProjectStmt.run(targetProjectId);
        return Number(info.changes ?? 0);
      });
      return run(projectId);
    },
    removeSessionBookmarks: (projectId, sessionId) => {
      const run = db.transaction((targetProjectId: string, targetSessionId: string) => {
        // The session FTS cleanup needs the outer project id plus the same project id again for
        // the subquery that still reads live bookmark rows to resolve matching message ids.
        deleteSessionFtsRowsStmt.run(targetProjectId, targetProjectId, targetSessionId);
        const info = removeSessionStmt.run(targetProjectId, targetSessionId);
        return Number(info.changes ?? 0);
      });
      return run(projectId, sessionId);
    },
    reconcileWithIndexedData: (indexedDbPath) => reconcileBookmarks(db, indexedDbPath),
    close: () => db.close(),
  };
}

function buildProjectBookmarkQuery(
  projectId: string,
  options: BookmarkListOptions,
): {
  fromSql: string;
  whereClause: string;
  params: Array<string>;
  impossible: boolean;
} {
  const normalizedQuery = options.query?.trim() ?? "";
  const queryPlan =
    normalizedQuery.length > 0
      ? buildSearchQueryPlan(normalizedQuery, options.searchMode ?? "simple")
      : null;
  if (queryPlan?.error || (normalizedQuery.length > 0 && !queryPlan?.hasTerms)) {
    return {
      fromSql: "FROM bookmarks b",
      whereClause: "1 = 0",
      params: [],
      impossible: true,
    };
  }

  const conditions = ["b.project_id = ?"];
  const params: string[] = [projectId];
  let fromSql = "FROM bookmarks b";
  if (options.sessionId) {
    conditions.push("b.session_id = ?");
    params.push(options.sessionId);
  }
  if (queryPlan?.ftsQuery) {
    fromSql = `FROM bookmarks b
               JOIN bookmarks_fts
                 ON bookmarks_fts.project_id = b.project_id
                AND bookmarks_fts.message_id = b.message_id`;
    conditions.push("bookmarks_fts MATCH ?");
    params.push(queryPlan.ftsQuery);
  }

  if (options.categories !== undefined) {
    const categories = normalizeMessageCategories(options.categories);
    if (categories.length === 0) {
      conditions.push("1 = 0");
      return {
        fromSql,
        whereClause: conditions.join(" AND "),
        params,
        impossible: true,
      };
    }
    conditions.push(`b.message_category IN (${categories.map(() => "?").join(",")})`);
    params.push(...categories);
  }

  return {
    fromSql,
    whereClause: conditions.join(" AND "),
    params,
    impossible: false,
  };
}

function ensureBookmarkSchema(db: DatabaseHandle): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS meta (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
  );

  db.exec(
    `CREATE TABLE IF NOT EXISTS bookmarks (
       project_id TEXT NOT NULL,
       session_id TEXT NOT NULL,
       message_id TEXT NOT NULL,
       message_source_id TEXT NOT NULL,
       provider TEXT NOT NULL,
       session_title TEXT NOT NULL,
       message_category TEXT NOT NULL,
       message_content TEXT NOT NULL,
       message_created_at TEXT NOT NULL,
       bookmarked_at TEXT NOT NULL,
       is_orphaned INTEGER NOT NULL DEFAULT 0,
       orphaned_at TEXT,
       snapshot_version INTEGER NOT NULL,
       snapshot_json TEXT NOT NULL,
       PRIMARY KEY (project_id, message_id)
     )`,
  );

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_bookmarks_project_message_created ON bookmarks(project_id, message_created_at DESC, message_id)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_bookmarks_project_category ON bookmarks(project_id, message_category)",
  );
  db.exec("DROP INDEX IF EXISTS idx_bookmarks_project_message_content_lower");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bookmarks_session_id ON bookmarks(session_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bookmarks_orphaned ON bookmarks(is_orphaned)");
  ensureBookmarksFtsTable(db);

  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(BOOKMARKS_DB_SCHEMA_VERSION));
}

function normalizeBookmarkListOptions(options: BookmarkListOptionsInput): BookmarkListOptions {
  if (typeof options === "string") {
    return { query: options };
  }
  return options ?? {};
}

function ensureBookmarksFtsTable(db: DatabaseHandle): void {
  const existing = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bookmarks_fts'")
    .get() as { sql: string } | undefined;
  const hasPrefix = existing ? /\bprefix\s*=\s*['"]2 3 4['"]/i.test(existing.sql ?? "") : false;
  if (existing && hasPrefix) {
    return;
  }

  db.exec("DROP TABLE IF EXISTS bookmarks_fts");
  db.exec(
    `CREATE VIRTUAL TABLE bookmarks_fts USING fts5(
       project_id UNINDEXED,
       message_id UNINDEXED,
       message_content,
       prefix='2 3 4'
     )`,
  );
  db.exec(
    `INSERT INTO bookmarks_fts (project_id, message_id, message_content)
     SELECT project_id, message_id, message_content
     FROM bookmarks`,
  );
}

function reconcileBookmarks(
  bookmarksDb: DatabaseHandle,
  indexedDbPath: string,
): BookmarkReconciliationResult {
  const indexedDb = openDatabase(indexedDbPath);

  try {
    const listStmt = bookmarksDb.prepare(
      `SELECT project_id, session_id, message_id, is_orphaned
       FROM bookmarks`,
    );
    const deleteStmt = bookmarksDb.prepare(
      "DELETE FROM bookmarks WHERE project_id = ? AND message_id = ?",
    );
    const markOrphanStmt = bookmarksDb.prepare(
      `UPDATE bookmarks
       SET is_orphaned = 1,
           orphaned_at = COALESCE(orphaned_at, ?)
       WHERE project_id = ?
         AND message_id = ?`,
    );
    const restoreStmt = bookmarksDb.prepare(
      `UPDATE bookmarks
       SET is_orphaned = 0,
           orphaned_at = NULL
       WHERE project_id = ?
         AND message_id = ?`,
    );

    const rows = listStmt.all() as Array<{
      project_id: string;
      session_id: string;
      message_id: string;
      is_orphaned: number;
    }>;

    const nowIso = new Date().toISOString();
    const result: BookmarkReconciliationResult = {
      deletedMissingProjects: 0,
      markedOrphaned: 0,
      restored: 0,
    };
    const existingProjectIds = loadExistingIds(indexedDb, "projects", "id");
    const existingSessionIds = loadExistingSessionProjectPairs(indexedDb);
    const existingMessageIds = loadExistingMessageSessionPairs(indexedDb);

    const run = bookmarksDb.transaction(() => {
      for (const row of rows) {
        if (!existingProjectIds.has(row.project_id)) {
          const info = deleteStmt.run(row.project_id, row.message_id);
          if (info.changes > 0) {
            result.deletedMissingProjects += 1;
          }
          continue;
        }

        const sessionExists = existingSessionIds.has(`${row.project_id}\u0000${row.session_id}`);
        const messageExists = existingMessageIds.has(`${row.session_id}\u0000${row.message_id}`);
        const shouldBeOrphaned = !sessionExists || !messageExists;

        if (shouldBeOrphaned) {
          if (row.is_orphaned === 0) {
            const info = markOrphanStmt.run(nowIso, row.project_id, row.message_id);
            if (info.changes > 0) {
              result.markedOrphaned += 1;
            }
          }
          continue;
        }

        if (row.is_orphaned !== 0) {
          const info = restoreStmt.run(row.project_id, row.message_id);
          if (info.changes > 0) {
            result.restored += 1;
          }
        }
      }
    });

    run();
    return result;
  } finally {
    indexedDb.close();
  }
}

export type BookmarkMessageSnapshot = {
  provider: Provider;
  sessionId: string;
  sourceId: string;
  category: MessageCategory;
  content: string;
  createdAt: string;
  tokenInput: number | null;
  tokenOutput: number | null;
  operationDurationMs: number | null;
  operationDurationSource: OperationDurationSource | null;
  operationDurationConfidence: OperationDurationConfidence | null;
};

function countBookmarksByProjectIds(
  db: DatabaseHandle,
  projectIds: string[],
): Record<string, number> {
  if (projectIds.length === 0) {
    return {};
  }

  const placeholders = projectIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT project_id, COUNT(*) as cnt
       FROM bookmarks
       WHERE project_id IN (${placeholders})
       GROUP BY project_id`,
    )
    .all(...projectIds) as Array<{ project_id: string; cnt: number }>;

  const counts = Object.fromEntries(projectIds.map((projectId) => [projectId, 0]));
  for (const row of rows) {
    counts[row.project_id] = Number(row.cnt ?? 0);
  }
  return counts;
}

function countBookmarksBySessionIds(
  db: DatabaseHandle,
  projectId: string,
  sessionIds: string[],
): Record<string, number> {
  if (sessionIds.length === 0) {
    return {};
  }

  const placeholders = sessionIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT session_id, COUNT(*) as cnt
       FROM bookmarks
       WHERE project_id = ?
         AND session_id IN (${placeholders})
       GROUP BY session_id`,
    )
    .all(projectId, ...sessionIds) as Array<{ session_id: string; cnt: number }>;

  const counts = Object.fromEntries(sessionIds.map((sessionId) => [sessionId, 0]));
  for (const row of rows) {
    counts[row.session_id] = Number(row.cnt ?? 0);
  }
  return counts;
}

function loadExistingIds(db: DatabaseHandle, table: "projects", idColumn: "id"): Set<string> {
  const rows = db.prepare(`SELECT ${idColumn} as id FROM ${table}`).all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

function loadExistingSessionProjectPairs(db: DatabaseHandle): Set<string> {
  const rows = db.prepare("SELECT id, project_id FROM sessions").all() as Array<{
    id: string;
    project_id: string;
  }>;
  return new Set(rows.map((row) => `${row.project_id}\u0000${row.id}`));
}

function loadExistingMessageSessionPairs(db: DatabaseHandle): Set<string> {
  const rows = db.prepare("SELECT id, session_id FROM messages").all() as Array<{
    id: string;
    session_id: string;
  }>;
  return new Set(rows.map((row) => `${row.session_id}\u0000${row.id}`));
}
