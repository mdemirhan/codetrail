import { type MessageCategory, PROVIDER_VALUES, type Provider } from "../contracts/canonical";
import {
  makeEmptyCategoryCounts,
  normalizeMessageCategories,
  normalizeMessageCategory,
} from "../contracts/categories";
import type { SqliteDatabase } from "../db/bootstrap";
import {
  type SearchMode,
  type SearchQueryPlan,
  buildSearchQueryPlan,
  buildWildcardFilterPatterns,
} from "./queryPlan";

export type SearchMessagesInput = {
  query: string;
  searchMode?: SearchMode;
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
  projectId: string;
  provider: Provider;
  category: MessageCategory;
  createdAt: string;
  snippet: string;
  projectName: string;
  projectPath: string;
};

export type SearchMessagesOutput = {
  query: string;
  queryError: string | null;
  highlightPatterns: string[];
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

// Search is implemented directly on the FTS table, then enriched with session/project metadata so
// the renderer can navigate back to the exact message hit without extra round-trips.
export function searchMessages(
  db: SqliteDatabase,
  input: SearchMessagesInput,
): SearchMessagesOutput {
  const query = input.query.trim();
  const categoryCounts = makeEmptyCategoryCounts();
  if (!query) {
    return {
      query: input.query,
      queryError: null,
      highlightPatterns: [],
      totalCount: 0,
      results: [],
      categoryCounts,
    };
  }

  const queryPlan = buildSearchQueryPlan(query, input.searchMode ?? "simple");
  if (queryPlan.error) {
    return {
      query: input.query,
      queryError: queryPlan.error,
      highlightPatterns: [],
      totalCount: 0,
      results: [],
      categoryCounts,
    };
  }
  if (!queryPlan.hasTerms) {
    return {
      query: input.query,
      queryError: null,
      highlightPatterns: [],
      totalCount: 0,
      results: [],
      categoryCounts,
    };
  }

  const queryFilter = buildQueryFilter(queryPlan);
  const filters = buildFilters(input, true);
  const whereClause = sqlWhereClause([...queryFilter.conditions, ...filters.conditions]);
  const whereParams = [...queryFilter.params, ...filters.params];

  const countRow = db
    .prepare(
      `SELECT COUNT(*) as cnt
       ${SEARCH_FROM_SQL}
       ${whereClause}`,
    )
    .get(...whereParams) as { cnt: number } | undefined;
  const totalCount = Number(countRow?.cnt ?? 0);

  const facetFilters = buildFilters(input, false);
  // Facets intentionally ignore the category filter so the UI can show "what else is available"
  // for the current text/project/provider query.
  const facetWhereClause = sqlWhereClause([...queryFilter.conditions, ...facetFilters.conditions]);
  const facetWhereParams = [...queryFilter.params, ...facetFilters.params];
  const facetRows = db
    .prepare(
      `SELECT m.category as category, COUNT(*) as cnt
       ${SEARCH_FROM_SQL}
       ${facetWhereClause}
       GROUP BY m.category`,
    )
    .all(...facetWhereParams) as Array<{ category: string; cnt: number }>;

  for (const row of facetRows) {
    const category = normalizeMessageCategory(row.category);
    categoryCounts[category] += Number(row.cnt ?? 0);
  }

  const limit = Math.max(1, input.limit ?? 50);
  const offset = Math.max(0, input.offset ?? 0);
  // snippet() operates on the indexed FTS columns, so the snippet stays aligned with the exact hit
  // terms instead of reimplementing highlight logic in application code.
  const snippetSelect = "snippet(message_fts, 4, '<mark>', '</mark>', '...', 64) as snippet";
  const orderBy = "ORDER BY bm25(message_fts), m.created_at DESC, m.id DESC";
  const resultRows = db
    .prepare(
      `SELECT
         m.id as message_id,
         m.source_id as message_source_id,
         m.session_id as session_id,
         s.project_id as project_id,
         s.provider as provider,
         m.category as category,
         m.created_at as created_at,
         ${snippetSelect},
         p.name as project_name,
         p.path as project_path
       ${SEARCH_FROM_SQL}
       ${whereClause}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...whereParams, limit, offset) as Array<{
    message_id: string;
    message_source_id: string;
    session_id: string;
    project_id: string;
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
    projectId: row.project_id,
    provider: normalizeProvider(row.provider),
    category: normalizeMessageCategory(row.category),
    createdAt: row.created_at,
    snippet: row.snippet ?? "",
    projectName: row.project_name ?? "",
    projectPath: row.project_path ?? "",
  }));

  return {
    query: input.query,
    queryError: null,
    highlightPatterns: queryPlan.highlightPatterns,
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

  if (includeCategories && input.categories !== undefined) {
    appendInFilter(conditions, params, "m.category", normalizeMessageCategories(input.categories));
  }

  const projectIds = input.projectIds?.filter((value) => value.length > 0);
  if (projectIds !== undefined && projectIds.length > 0) {
    // projectIds supports batched search across a preselected subset, while projectId is the
    // simpler single-project path used by most callers.
    appendInFilter(conditions, params, "s.project_id", projectIds);
  } else if (input.projectIds !== undefined) {
    conditions.push("1 = 0");
  } else if (input.projectId && input.projectId.length > 0) {
    conditions.push("s.project_id = ?");
    params.push(input.projectId);
  }

  if (input.providers !== undefined) {
    appendInFilter(conditions, params, "s.provider", normalizeProviders(input.providers));
  }

  const projectPatterns = buildWildcardFilterPatterns(input.projectQuery ?? "");
  for (const pattern of projectPatterns) {
    conditions.push("LOWER(p.name) LIKE ? ESCAPE '\\'");
    params.push(pattern);
  }

  return { conditions, params };
}

function normalizeProviders(values: string[]): Provider[] {
  const selected = new Set<Provider>();
  for (const value of values) {
    if (PROVIDER_VALUES.includes(value as Provider)) {
      selected.add(value as Provider);
    }
  }

  return [...selected];
}

function normalizeProvider(value: string): Provider {
  if (PROVIDER_VALUES.includes(value as Provider)) {
    return value as Provider;
  }
  return "claude";
}

function appendInFilter<T extends string | number>(
  conditions: string[],
  params: Array<string | number>,
  column: string,
  values: readonly T[],
): void {
  if (values.length === 0) {
    conditions.push("1 = 0");
    return;
  }

  conditions.push(`${column} IN (${values.map(() => "?").join(",")})`);
  params.push(...values);
}

function sqlWhereClause(conditions: string[]): string {
  if (conditions.length === 0) {
    return "";
  }

  return `WHERE ${conditions.join(" AND ")}`;
}

function buildQueryFilter(plan: SearchQueryPlan): { conditions: string[]; params: string[] } {
  if (!plan.ftsQuery) {
    // Keep the SQL shape valid even for degenerate plans so callers do not need a special case.
    return {
      conditions: ["1 = 0"],
      params: [],
    };
  }

  return {
    conditions: ["message_fts MATCH ?"],
    params: [plan.ftsQuery],
  };
}
