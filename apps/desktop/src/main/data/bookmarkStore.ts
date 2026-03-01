import { dirname, join } from "node:path";

import {
  type MessageCategory,
  type OperationDurationConfidence,
  type OperationDurationSource,
  type Provider,
  openDatabase,
} from "@codetrail/core";

type DatabaseHandle = ReturnType<typeof openDatabase>;

const BOOKMARKS_DB_SCHEMA_VERSION = 1;
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

export type BookmarkStore = {
  listProjectBookmarks: (projectId: string) => StoredBookmark[];
  getBookmark: (projectId: string, messageId: string) => StoredBookmark | null;
  upsertBookmark: (snapshot: Omit<BookmarkSnapshot, "snapshotVersion" | "snapshotJson">) => void;
  removeBookmark: (projectId: string, messageId: string) => boolean;
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

  const listStmt = db.prepare(
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
     WHERE project_id = ?
     ORDER BY message_created_at DESC, message_id DESC`,
  );

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

  return {
    listProjectBookmarks: (projectId) => listStmt.all(projectId) as StoredBookmark[],
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
    },
    removeBookmark: (projectId, messageId) => {
      const info = removeStmt.run(projectId, messageId);
      return info.changes > 0;
    },
    reconcileWithIndexedData: (indexedDbPath) => reconcileBookmarks(db, indexedDbPath),
    close: () => db.close(),
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
  db.exec("CREATE INDEX IF NOT EXISTS idx_bookmarks_session_id ON bookmarks(session_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bookmarks_orphaned ON bookmarks(is_orphaned)");

  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(BOOKMARKS_DB_SCHEMA_VERSION));
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

    const projectExistsStmt = indexedDb.prepare("SELECT 1 as present FROM projects WHERE id = ?");
    const sessionExistsStmt = indexedDb.prepare(
      "SELECT 1 as present FROM sessions WHERE id = ? AND project_id = ?",
    );
    const messageExistsStmt = indexedDb.prepare(
      "SELECT 1 as present FROM messages WHERE id = ? AND session_id = ?",
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

    const run = bookmarksDb.transaction(() => {
      for (const row of rows) {
        const projectExists = !!projectExistsStmt.get(row.project_id);
        if (!projectExists) {
          const info = deleteStmt.run(row.project_id, row.message_id);
          if (info.changes > 0) {
            result.deletedMissingProjects += 1;
          }
          continue;
        }

        const sessionExists = !!sessionExistsStmt.get(row.session_id, row.project_id);
        const messageExists = !!messageExistsStmt.get(row.message_id, row.session_id);
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
