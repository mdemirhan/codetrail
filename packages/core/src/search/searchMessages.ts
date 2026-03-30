import { type MessageCategory, PROVIDER_VALUES, type Provider } from "../contracts/canonical";
import {
  makeEmptyCategoryCounts,
  normalizeMessageCategories,
  normalizeMessageCategory,
} from "../contracts/categories";
import { createProviderRecord } from "../contracts/providerMetadata";
import { MESSAGE_FTS_CONTENT_COLUMN_INDEX, type SqliteDatabase } from "../db/bootstrap";
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
  providerCounts: Record<Provider, number>;
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
  const providerCounts = createProviderRecord(() => 0);
  if (!query) {
    return {
      query: input.query,
      queryError: null,
      highlightPatterns: [],
      totalCount: 0,
      results: [],
      categoryCounts,
      providerCounts,
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
      providerCounts,
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
      providerCounts,
    };
  }

  const queryFilter = buildQueryFilter(queryPlan);
  const filters = buildFilters(input, true);
  const whereClause = sqlWhereClause([...queryFilter.conditions, ...filters.conditions]);
  const whereParams = [...queryFilter.params, ...filters.params];

  const facetFilters = buildFilters(input, false);
  // Facets intentionally ignore the category filter so the UI can show "what else is available"
  // for the current text/project/provider query.
  const facetWhereClause = sqlWhereClause([...queryFilter.conditions, ...facetFilters.conditions]);
  const facetWhereParams = [...queryFilter.params, ...facetFilters.params];
  const categoryFilter = buildCategoryFilter("category", input.categories);
  const resultMatchWhereClause = sqlWhereClause(categoryFilter.conditions);
  const summaryRow = db
    .prepare(
      `WITH facet_matches AS (
         SELECT m.category as category, s.provider as provider
         ${SEARCH_FROM_SQL}
         ${facetWhereClause}
       ),
       result_matches AS (
         SELECT category, provider
         FROM facet_matches
         ${resultMatchWhereClause}
       )
       SELECT
         (SELECT COUNT(*) FROM result_matches) as total_count,
         COALESCE(SUM(CASE WHEN category = 'user' THEN 1 ELSE 0 END), 0) as user_count,
         COALESCE(SUM(CASE WHEN category = 'assistant' THEN 1 ELSE 0 END), 0) as assistant_count,
         COALESCE(SUM(CASE WHEN category = 'tool_use' THEN 1 ELSE 0 END), 0) as tool_use_count,
         COALESCE(SUM(CASE WHEN category = 'tool_edit' THEN 1 ELSE 0 END), 0) as tool_edit_count,
         COALESCE(SUM(CASE WHEN category = 'tool_result' THEN 1 ELSE 0 END), 0) as tool_result_count,
         COALESCE(SUM(CASE WHEN category = 'thinking' THEN 1 ELSE 0 END), 0) as thinking_count,
         COALESCE(SUM(CASE WHEN category = 'system' THEN 1 ELSE 0 END), 0) as system_count,
         COALESCE(SUM(CASE WHEN provider = 'claude' THEN 1 ELSE 0 END), 0) as claude_count,
         COALESCE(SUM(CASE WHEN provider = 'codex' THEN 1 ELSE 0 END), 0) as codex_count,
         COALESCE(SUM(CASE WHEN provider = 'gemini' THEN 1 ELSE 0 END), 0) as gemini_count,
         COALESCE(SUM(CASE WHEN provider = 'cursor' THEN 1 ELSE 0 END), 0) as cursor_count,
         COALESCE(SUM(CASE WHEN provider = 'copilot' THEN 1 ELSE 0 END), 0) as copilot_count
       FROM facet_matches`,
    )
    .get(...facetWhereParams, ...categoryFilter.params) as
    | {
        total_count: number;
        user_count: number;
        assistant_count: number;
        tool_use_count: number;
        tool_edit_count: number;
        tool_result_count: number;
        thinking_count: number;
        system_count: number;
        claude_count: number;
        codex_count: number;
        gemini_count: number;
        cursor_count: number;
        copilot_count: number;
      }
    | undefined;
  const totalCount = Number(summaryRow?.total_count ?? 0);
  categoryCounts.user = Number(summaryRow?.user_count ?? 0);
  categoryCounts.assistant = Number(summaryRow?.assistant_count ?? 0);
  categoryCounts.tool_use = Number(summaryRow?.tool_use_count ?? 0);
  categoryCounts.tool_edit = Number(summaryRow?.tool_edit_count ?? 0);
  categoryCounts.tool_result = Number(summaryRow?.tool_result_count ?? 0);
  categoryCounts.thinking = Number(summaryRow?.thinking_count ?? 0);
  categoryCounts.system = Number(summaryRow?.system_count ?? 0);
  providerCounts.claude = Number(summaryRow?.claude_count ?? 0);
  providerCounts.codex = Number(summaryRow?.codex_count ?? 0);
  providerCounts.gemini = Number(summaryRow?.gemini_count ?? 0);
  providerCounts.cursor = Number(summaryRow?.cursor_count ?? 0);
  providerCounts.copilot = Number(summaryRow?.copilot_count ?? 0);

  const limit = Math.max(1, input.limit ?? 50);
  const offset = Math.max(0, input.offset ?? 0);
  // snippet() operates on the indexed FTS columns, so the snippet stays aligned with the exact hit
  // terms instead of reimplementing highlight logic in application code.
  const snippetSelect = `snippet(message_fts, ${String(MESSAGE_FTS_CONTENT_COLUMN_INDEX)}, '<mark>', '</mark>', '...', 64) as snippet`;
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
    providerCounts,
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

function buildCategoryFilter(
  column: string,
  categories: string[] | undefined,
): { conditions: string[]; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];
  if (categories === undefined) {
    return { conditions, params };
  }
  const normalized = normalizeMessageCategories(categories);
  if (normalized.length === 0) {
    conditions.push("1 = 0");
    return { conditions, params };
  }
  conditions.push(`${column} IN (${normalized.map(() => "?").join(",")})`);
  params.push(...normalized);
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
  throw new Error(`Unexpected provider value in search row: ${value}`);
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
