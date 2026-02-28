import { type IpcRequest, type IpcResponse, openDatabase, searchMessages } from "@cch/core";

type SessionSummaryRow = {
  id: string;
  project_id: string;
  provider: "claude" | "codex" | "gemini";
  file_path: string;
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

const CATEGORY_ALIASES: Record<string, string> = {
  tool_call: "tool_use",
};

export function listProjects(
  dbPath: string,
  request: IpcRequest<"projects:list">,
): IpcResponse<"projects:list"> {
  return withDatabase(dbPath, (db) => {
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
  });
}

export function listSessions(
  dbPath: string,
  request: IpcRequest<"sessions:list">,
): IpcResponse<"sessions:list"> {
  return withDatabase(dbPath, (db) => {
    const rows = request.projectId
      ? (db
          .prepare(
            `SELECT id, project_id, provider, file_path, model_names, started_at, ended_at, duration_ms, git_branch, cwd, message_count, token_input_total, token_output_total
             FROM sessions
             WHERE project_id = ?
             ORDER BY COALESCE(ended_at, started_at) DESC, id DESC`,
          )
          .all(request.projectId) as SessionSummaryRow[])
      : (db
          .prepare(
            `SELECT id, project_id, provider, file_path, model_names, started_at, ended_at, duration_ms, git_branch, cwd, message_count, token_input_total, token_output_total
             FROM sessions
             ORDER BY COALESCE(ended_at, started_at) DESC, id DESC`,
          )
          .all() as SessionSummaryRow[]);

    return { sessions: rows.map(mapSessionSummaryRow) };
  });
}

export function getSessionDetail(
  dbPath: string,
  request: IpcRequest<"sessions:getDetail">,
): IpcResponse<"sessions:getDetail"> {
  return withDatabase(dbPath, (db) => {
    const sessionRow = db
      .prepare(
        `SELECT id, project_id, provider, file_path, model_names, started_at, ended_at, duration_ms, git_branch, cwd, message_count, token_input_total, token_output_total
         FROM sessions
         WHERE id = ?`,
      )
      .get(request.sessionId) as SessionSummaryRow | undefined;

    if (!sessionRow) {
      return {
        session: null,
        totalCount: 0,
        categoryCounts: emptyCategoryCounts(),
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
    if (request.categories && request.categories.length > 0) {
      messageFilters.categories = request.categories;
    }

    const { whereClause, params } = buildMessageFilters(messageFilters);

    const totalRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM messages m WHERE ${whereClause}`)
      .get(...params) as { cnt: number } | undefined;
    const totalCount = Number(totalRow?.cnt ?? 0);
    const categoryCounts = emptyCategoryCounts();

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
      categoryCounts[normalizeCategory(row.category)] += Number(row.cnt ?? 0);
    }

    let focusIndex: number | null = null;
    if (request.focusSourceId) {
      const focusTarget = db
        .prepare("SELECT id, created_at FROM messages WHERE session_id = ? AND source_id = ?")
        .get(request.sessionId, request.focusSourceId) as
        | {
            id: string;
            created_at: string;
          }
        | undefined;

      if (focusTarget) {
        const focusRow = db
          .prepare(
            `SELECT COUNT(*) as cnt
             FROM messages m
             WHERE ${whereClause}
             AND (m.created_at < ? OR (m.created_at = ? AND m.id <= ?))`,
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
           m.token_output
         FROM messages m
         WHERE ${whereClause}
         ORDER BY m.created_at, m.id
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, page * pageSize) as Array<{
      id: string;
      source_id: string;
      session_id: string;
      provider: "claude" | "codex" | "gemini";
      category: string;
      content: string;
      created_at: string;
      token_input: number | null;
      token_output: number | null;
    }>;

    return {
      session: mapSessionSummaryRow(sessionRow),
      totalCount,
      categoryCounts,
      page,
      pageSize,
      focusIndex,
      messages: rows.map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        sessionId: row.session_id,
        provider: row.provider,
        category: normalizeCategory(row.category),
        content: row.content,
        createdAt: row.created_at,
        tokenInput: row.token_input,
        tokenOutput: row.token_output,
      })),
    };
  });
}

export function runSearchQuery(
  dbPath: string,
  request: IpcRequest<"search:query">,
): IpcResponse<"search:query"> {
  return withDatabase(dbPath, (db) => {
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
  });
}

function buildMessageFilters(args: {
  sessionId: string;
  categories?: string[];
  query: string;
}): { whereClause: string; params: string[] } {
  const conditions = ["m.session_id = ?"];
  const params = [args.sessionId];

  const categories = normalizeCategories(args.categories ?? []);
  if (categories.length > 0) {
    conditions.push(`m.category IN (${categories.map(() => "?").join(",")})`);
    params.push(...categories);
  }

  const query = args.query.trim().toLowerCase();
  if (query.length > 0) {
    conditions.push("LOWER(m.content) LIKE ?");
    params.push(`%${query}%`);
  }

  return { whereClause: conditions.join(" AND "), params };
}

function normalizeCategories(values: string[]): string[] {
  const selected = new Set<string>();
  for (const value of values) {
    const normalized = normalizeCategory(value);
    selected.add(normalized);
  }

  return [...selected];
}

function normalizeCategory(
  value: string,
): "user" | "assistant" | "tool_use" | "tool_result" | "thinking" | "system" {
  const normalized = value.trim().toLowerCase();
  const alias = CATEGORY_ALIASES[normalized];
  if (alias) {
    return normalizeCategory(alias);
  }

  if (normalized === "user") {
    return "user";
  }
  if (normalized === "assistant") {
    return "assistant";
  }
  if (normalized === "tool_use") {
    return "tool_use";
  }
  if (normalized === "tool_result") {
    return "tool_result";
  }
  if (normalized === "thinking") {
    return "thinking";
  }
  return "system";
}

function emptyCategoryCounts(): IpcResponse<"search:query">["categoryCounts"] {
  return {
    user: 0,
    assistant: 0,
    tool_use: 0,
    tool_result: 0,
    thinking: 0,
    system: 0,
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

function withDatabase<T>(dbPath: string, callback: (db: ReturnType<typeof openDatabase>) => T): T {
  const db = openDatabase(dbPath);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}
