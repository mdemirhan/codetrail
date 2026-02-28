import type { MessageCategory, Provider } from "../contracts/canonical";
import type { SqliteDatabase } from "../db/bootstrap";

const CATEGORY_KEYS = [
  "user",
  "assistant",
  "tool_use",
  "tool_result",
  "thinking",
  "system",
] as const satisfies ReadonlyArray<MessageCategory>;

const CATEGORY_ALIASES: Record<string, MessageCategory> = {
  tool_call: "tool_use",
};

export type SearchMessagesInput = {
  query: string;
  categories?: string[];
  projectId?: string;
  projectIds?: string[];
  providers?: string[];
  projectQuery?: string;
  limit?: number;
  offset?: number;
};

export type SearchMessageResult = {
  messageId: string;
  messageSourceId: string;
  sessionId: string;
  provider: Provider;
  category: MessageCategory;
  createdAt: string;
  snippet: string;
  projectName: string;
  projectPath: string;
};

export type SearchMessagesOutput = {
  query: string;
  totalCount: number;
  results: SearchMessageResult[];
  categoryCounts: Record<MessageCategory, number>;
};

const SEARCH_FROM_SQL = `
FROM message_fts
JOIN messages m ON m.id = message_fts.message_id
JOIN sessions s ON s.id = m.session_id
LEFT JOIN projects p ON p.id = s.project_id
`;

export function searchMessages(
  db: SqliteDatabase,
  input: SearchMessagesInput,
): SearchMessagesOutput {
  const query = input.query.trim();
  const categoryCounts = makeEmptyCategoryCounts();
  if (!query) {
    return {
      query: input.query,
      totalCount: 0,
      results: [],
      categoryCounts,
    };
  }

  const ftsQuery = escapeFtsQuery(query);
  const filters = buildFilters(input, true);
  const whereClause = sqlFilterClause(filters.conditions);

  const countRow = db
    .prepare(
      `SELECT COUNT(*) as cnt
       ${SEARCH_FROM_SQL}
       WHERE message_fts MATCH ?
       ${whereClause}`,
    )
    .get(ftsQuery, ...filters.params) as { cnt: number } | undefined;
  const totalCount = Number(countRow?.cnt ?? 0);

  const facetFilters = buildFilters(input, false);
  const facetRows = db
    .prepare(
      `SELECT m.category as category, COUNT(*) as cnt
       ${SEARCH_FROM_SQL}
       WHERE message_fts MATCH ?
       ${sqlFilterClause(facetFilters.conditions)}
       GROUP BY m.category`,
    )
    .all(ftsQuery, ...facetFilters.params) as Array<{ category: string; cnt: number }>;

  for (const row of facetRows) {
    const category = normalizeCategory(row.category);
    categoryCounts[category] += Number(row.cnt ?? 0);
  }

  const limit = Math.max(1, input.limit ?? 50);
  const offset = Math.max(0, input.offset ?? 0);
  const resultRows = db
    .prepare(
      `SELECT
         m.id as message_id,
         m.source_id as message_source_id,
         m.session_id as session_id,
         s.provider as provider,
         m.category as category,
         m.created_at as created_at,
         snippet(message_fts, 4, '<mark>', '</mark>', '...', 64) as snippet,
         p.name as project_name,
         p.path as project_path
       ${SEARCH_FROM_SQL}
       WHERE message_fts MATCH ?
       ${whereClause}
       ORDER BY bm25(message_fts)
       LIMIT ? OFFSET ?`,
    )
    .all(ftsQuery, ...filters.params, limit, offset) as Array<{
    message_id: string;
    message_source_id: string;
    session_id: string;
    provider: string;
    category: string;
    created_at: string;
    snippet: string;
    project_name: string | null;
    project_path: string | null;
  }>;

  const results: SearchMessageResult[] = resultRows.map((row) => ({
    messageId: row.message_id,
    messageSourceId: row.message_source_id,
    sessionId: row.session_id,
    provider: normalizeProvider(row.provider),
    category: normalizeCategory(row.category),
    createdAt: row.created_at,
    snippet: row.snippet ?? "",
    projectName: row.project_name ?? "",
    projectPath: row.project_path ?? "",
  }));

  return {
    query: input.query,
    totalCount,
    results,
    categoryCounts,
  };
}

function buildFilters(
  input: SearchMessagesInput,
  includeCategories: boolean,
): { conditions: string[]; params: Array<string | number> } {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (includeCategories && input.categories && input.categories.length > 0) {
    const categories = normalizeCategories(input.categories);
    if (categories.length > 0) {
      conditions.push(`m.category IN (${categories.map(() => "?").join(",")})`);
      params.push(...categories);
    }
  }

  const projectIds =
    input.projectIds && input.projectIds.length > 0
      ? input.projectIds.filter((value) => value.length > 0)
      : [];
  if (projectIds.length > 0) {
    conditions.push(`s.project_id IN (${projectIds.map(() => "?").join(",")})`);
    params.push(...projectIds);
  } else if (input.projectId && input.projectId.length > 0) {
    conditions.push("s.project_id = ?");
    params.push(input.projectId);
  }

  const providers = normalizeProviders(input.providers ?? []);
  if (providers.length > 0) {
    conditions.push(`s.provider IN (${providers.map(() => "?").join(",")})`);
    params.push(...providers);
  }

  const projectQuery = input.projectQuery?.trim().toLowerCase() ?? "";
  if (projectQuery.length > 0) {
    const like = `%${projectQuery}%`;
    conditions.push("(LOWER(p.name) LIKE ? OR LOWER(p.path) LIKE ?)");
    params.push(like, like);
  }

  return { conditions, params };
}

function normalizeProviders(values: string[]): Provider[] {
  const selected = new Set<Provider>();
  for (const value of values) {
    if (value === "claude" || value === "codex" || value === "gemini") {
      selected.add(value);
    }
  }

  return [...selected];
}

function normalizeProvider(value: string): Provider {
  if (value === "codex") {
    return "codex";
  }
  if (value === "gemini") {
    return "gemini";
  }
  return "claude";
}

function normalizeCategories(values: string[]): MessageCategory[] {
  const selected = new Set<MessageCategory>();
  for (const value of values) {
    const normalized = normalizeCategory(value);
    if (CATEGORY_KEYS.includes(normalized)) {
      selected.add(normalized);
    }
  }

  return CATEGORY_KEYS.filter((value) => selected.has(value));
}

function normalizeCategory(value: string): MessageCategory {
  const normalized = value.trim().toLowerCase();
  const aliased = CATEGORY_ALIASES[normalized];
  if (aliased) {
    return aliased;
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

function makeEmptyCategoryCounts(): Record<MessageCategory, number> {
  return {
    user: 0,
    assistant: 0,
    tool_use: 0,
    tool_result: 0,
    thinking: 0,
    system: 0,
  };
}

function sqlFilterClause(conditions: string[]): string {
  if (conditions.length === 0) {
    return "";
  }

  return `AND ${conditions.join(" AND ")}`;
}

function escapeFtsQuery(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return '""';
  }

  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" ");
}
