export const SEARCH_TOKEN_MAX_LENGTH = 64;
export type SearchMode = "simple" | "advanced";
const HIGHLIGHT_PATTERN_TOKEN = /[\p{L}\p{N}*]+/gu;
const HIGHLIGHT_TOKEN_SEPARATOR_REGEX = String.raw`[^\p{L}\p{N}]+`;

type FtsToken = {
  value: string;
  isPrefix: boolean;
};

type AdvancedLeaf = {
  type: "leaf";
  value: string;
  isPrefix: boolean;
  isPhrase: boolean;
};

type AdvancedBinaryNode = {
  type: "and" | "or";
  left: AdvancedNode;
  right: AdvancedNode;
};

type AdvancedExcludeNode = {
  type: "not";
  left: AdvancedNode;
  right: AdvancedNode;
};

type AdvancedNode = AdvancedLeaf | AdvancedBinaryNode | AdvancedExcludeNode;

type AdvancedToken =
  | { type: "term"; value: string }
  | { type: "phrase"; value: string }
  | { type: "and" | "or" | "not" | "lparen" | "rparen" };

export type SearchQueryPlan = {
  normalizedQuery: string;
  mode: SearchMode;
  ftsTokens: FtsToken[];
  ftsQuery: string | null;
  highlightPatterns: string[];
  hasTerms: boolean;
  error: string | null;
};

// Search is compiled once up front into both an FTS query and a highlight plan so the rest of the
// stack can treat simple and advanced modes uniformly.
export function buildSearchQueryPlan(query: string, mode: SearchMode = "simple"): SearchQueryPlan {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    return buildEmptyPlan(normalizedQuery, mode);
  }

  return mode === "advanced"
    ? buildAdvancedSearchQueryPlan(normalizedQuery)
    : buildSimpleSearchQueryPlan(normalizedQuery);
}

export function buildWildcardFilterPatterns(query: string): string[] {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    return [];
  }

  const patterns: string[] = [];
  for (const rawToken of tokenizeSimpleQuery(normalizedQuery)) {
    const token = normalizeToken(rawToken);
    if (token.length === 0) {
      continue;
    }

    const withoutWildcards = token.replaceAll("*", "").trim();
    if (withoutWildcards.length === 0) {
      continue;
    }

    if (supportsFtsPrefix(token)) {
      const value = token.slice(0, -1).trim().toLowerCase();
      if (value.length > 0) {
        patterns.push(`${escapeLikeToken(value)}%`);
      }
      continue;
    }

    if (token.includes("*")) {
      patterns.push(`%${escapeLikeToken(withoutWildcards.toLowerCase())}%`);
      continue;
    }

    patterns.push(`%${escapeLikeToken(token.toLowerCase())}%`);
  }

  return patterns;
}

export function buildSearchHighlightRegex(input: string | SearchQueryPlan): RegExp | null {
  const plan = typeof input === "string" ? buildSearchQueryPlan(input) : input;
  if (!plan.hasTerms) {
    return null;
  }

  const patterns = Array.from(
    new Set(
      plan.highlightPatterns
        .map((pattern) => highlightPatternToRegexFragment(pattern))
        .filter((pattern) => pattern.length > 0),
    ),
  ).sort((left, right) => right.length - left.length);

  if (patterns.length === 0) {
    return null;
  }

  return new RegExp(patterns.join("|"), "giu");
}

function buildSimpleSearchQueryPlan(normalizedQuery: string): SearchQueryPlan {
  const ftsTokens: FtsToken[] = [];
  const highlightPatterns: string[] = [];

  for (const rawToken of tokenizeSimpleQuery(normalizedQuery)) {
    const token = normalizeToken(rawToken);
    if (token.length === 0) {
      continue;
    }

    const wildcardCount = countChar(token, "*");
    if (wildcardCount === 0) {
      ftsTokens.push({ value: token, isPrefix: false });
      highlightPatterns.push(token);
      continue;
    }

    if (supportsFtsPrefix(token)) {
      const value = token.slice(0, -1).trim();
      if (value.length > 0) {
        ftsTokens.push({ value, isPrefix: true });
        highlightPatterns.push(`${value}*`);
      }
      continue;
    }

    // SQLite FTS only supports postfix prefix matching. Other wildcard placement is preserved for
    // UI affordances but compiled as a literal term for the FTS query itself.
    // Only postfix wildcard is supported. Leading/infix wildcards are treated literally.
    const withoutWildcards = token.replaceAll("*", "").trim();
    if (withoutWildcards.length === 0) {
      continue;
    }

    ftsTokens.push({ value: withoutWildcards, isPrefix: false });
    highlightPatterns.push(withoutWildcards);
  }

  return {
    normalizedQuery,
    mode: "simple",
    ftsTokens,
    ftsQuery: ftsTokens.length > 0 ? buildFtsQuery(ftsTokens) : null,
    highlightPatterns,
    hasTerms: ftsTokens.length > 0,
    error: null,
  };
}

function buildAdvancedSearchQueryPlan(normalizedQuery: string): SearchQueryPlan {
  const tokenized = tokenizeAdvancedQuery(normalizedQuery);
  if (tokenized.error) {
    return buildErrorPlan(normalizedQuery, "advanced", tokenized.error);
  }

  const parsed = parseAdvancedQuery(tokenized.tokens);
  if (parsed.error) {
    return buildErrorPlan(normalizedQuery, "advanced", parsed.error);
  }

  if (!parsed.root || !hasPositiveLeaf(parsed.root, false)) {
    return buildErrorPlan(
      normalizedQuery,
      "advanced",
      "Advanced query must include at least one non-negated term.",
    );
  }

  const ftsQuery = compileAdvancedAst(parsed.root, 0);
  const highlightPatterns = dedupeStrings(collectPositiveHighlightPatterns(parsed.root, false, []));

  return {
    normalizedQuery,
    mode: "advanced",
    ftsTokens: [],
    ftsQuery,
    highlightPatterns,
    hasTerms: ftsQuery.length > 0,
    error: null,
  };
}

function buildEmptyPlan(normalizedQuery: string, mode: SearchMode): SearchQueryPlan {
  return {
    normalizedQuery,
    mode,
    ftsTokens: [],
    ftsQuery: null,
    highlightPatterns: [],
    hasTerms: false,
    error: null,
  };
}

function buildErrorPlan(normalizedQuery: string, mode: SearchMode, error: string): SearchQueryPlan {
  return {
    normalizedQuery,
    mode,
    ftsTokens: [],
    ftsQuery: null,
    highlightPatterns: [],
    hasTerms: false,
    error,
  };
}

function tokenizeSimpleQuery(query: string): string[] {
  return query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function normalizeToken(token: string): string {
  const collapsed = token.replace(/\*+/g, "*");
  return collapsed.length > SEARCH_TOKEN_MAX_LENGTH
    ? collapsed.slice(0, SEARCH_TOKEN_MAX_LENGTH)
    : collapsed;
}

function supportsFtsPrefix(token: string): boolean {
  return token.length > 1 && token.endsWith("*") && token.indexOf("*") === token.length - 1;
}

function buildFtsQuery(tokens: FtsToken[]): string {
  return tokens
    .map((token) => {
      const escaped = token.value.replaceAll('"', '""');
      return `"${escaped}"${token.isPrefix ? "*" : ""}`;
    })
    .join(" ");
}

function escapeLikeToken(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function highlightPatternToRegexFragment(pattern: string): string {
  const tokens = Array.from(pattern.matchAll(HIGHLIGHT_PATTERN_TOKEN), (match) => match[0] ?? "");
  if (tokens.length === 0) {
    return "";
  }

  if (tokens.length === 1 && tokens[0] === pattern) {
    const escaped = escapeRegExp(pattern);
    if (!pattern.includes("*")) {
      return escaped;
    }
    return escaped.replaceAll("\\*", "\\S*");
  }

  const fragments = tokens
    .map((token) => tokenToHighlightRegexFragment(token))
    .filter((fragment) => fragment.length > 0);
  if (fragments.length === 0) {
    return "";
  }
  return fragments.join(HIGHLIGHT_TOKEN_SEPARATOR_REGEX);
}

function tokenToHighlightRegexFragment(token: string): string {
  if (!token.includes("*")) {
    return escapeRegExp(token);
  }

  if (supportsFtsPrefix(token)) {
    const value = token.slice(0, -1);
    return `${escapeRegExp(value)}[\\p{L}\\p{N}]*`;
  }

  return escapeRegExp(token.replaceAll("*", ""));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countChar(value: string, char: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === char) {
      count += 1;
    }
  }
  return count;
}

function tokenizeAdvancedQuery(query: string): { tokens: AdvancedToken[]; error: string | null } {
  const tokens: AdvancedToken[] = [];
  let index = 0;
  while (index < query.length) {
    const char = query[index] ?? "";
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "lparen" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen" });
      index += 1;
      continue;
    }
    if (char === '"') {
      const parsedPhrase = parseQuotedPhrase(query, index);
      if (parsedPhrase.error) {
        return { tokens: [], error: parsedPhrase.error };
      }
      tokens.push({ type: "phrase", value: parsedPhrase.value });
      index = parsedPhrase.nextIndex;
      continue;
    }

    let end = index;
    while (end < query.length) {
      const next = query[end] ?? "";
      if (/\s/.test(next) || next === "(" || next === ")") {
        break;
      }
      end += 1;
    }

    const raw = query.slice(index, end).trim();
    if (raw.length === 0) {
      index = end;
      continue;
    }
    const keyword = classifyOperator(raw);
    if (keyword) {
      tokens.push({ type: keyword });
    } else {
      tokens.push({ type: "term", value: raw });
    }
    index = end;
  }

  return { tokens, error: null };
}

function parseQuotedPhrase(
  query: string,
  startIndex: number,
): { value: string; nextIndex: number; error: string | null } {
  let index = startIndex + 1;
  let value = "";
  while (index < query.length) {
    const char = query[index] ?? "";
    if (char === '"') {
      if (query[index + 1] === '"') {
        value += '"';
        index += 2;
        continue;
      }
      return { value: value.trim(), nextIndex: index + 1, error: null };
    }
    value += char;
    index += 1;
  }

  return {
    value: "",
    nextIndex: query.length,
    error: "Unclosed quote. Close the phrase with a matching double quote.",
  };
}

function classifyOperator(raw: string): "and" | "or" | "not" | null {
  if (!/^[A-Za-z]+$/.test(raw)) {
    return null;
  }

  const normalized = raw.toUpperCase();
  if (normalized === "AND") {
    return "and";
  }
  if (normalized === "OR") {
    return "or";
  }
  if (normalized === "NOT") {
    return "not";
  }
  return null;
}

function parseAdvancedQuery(tokens: AdvancedToken[]): {
  root: AdvancedNode | null;
  error: string | null;
} {
  if (tokens.length === 0) {
    return { root: null, error: null };
  }

  let cursor = 0;
  const peek = (): AdvancedToken | null => tokens[cursor] ?? null;
  const consume = (): AdvancedToken | null => {
    const next = tokens[cursor] ?? null;
    if (next) {
      cursor += 1;
    }
    return next;
  };

  const parsePrimary = (): { node: AdvancedNode | null; error: string | null } => {
    const token = peek();
    if (!token) {
      return { node: null, error: "Expected a term, phrase, or sub-expression." };
    }

    if (token.type === "lparen") {
      consume();
      const inner = parseOr();
      if (inner.error) {
        return inner;
      }
      const closing = consume();
      if (!closing || closing.type !== "rparen") {
        return { node: null, error: "Missing closing ')' in advanced query." };
      }
      return inner;
    }

    if (token.type === "term" || token.type === "phrase") {
      consume();
      return normalizeAdvancedLeaf(token);
    }

    return {
      node: null,
      error: `Unexpected token '${token.type.toUpperCase()}'. Expected a term, phrase, or '('.`,
    };
  };

  const parseAnd = (): { node: AdvancedNode | null; error: string | null } => {
    const first = parsePrimary();
    if (first.error || !first.node) {
      return first;
    }

    let left = first.node;
    while (true) {
      const next = peek();
      if (!next || next.type === "rparen" || next.type === "or") {
        break;
      }

      // Adjacent terms are treated as AND, which mirrors how most users expect whitespace search
      // to work while still allowing explicit AND/NOT control.
      let operator: "and" | "not" = "and";
      if (next.type === "and") {
        consume();
      } else if (next.type === "not") {
        operator = "not";
        consume();
      }

      const right = parsePrimary();
      if (right.error) {
        return right;
      }
      if (!right.node) {
        return {
          node: null,
          error:
            operator === "and"
              ? "AND must be followed by a term, phrase, or sub-expression."
              : "NOT must be followed by a term, phrase, or sub-expression.",
        };
      }

      left = {
        type: operator,
        left,
        right: right.node,
      };
    }

    return { node: left, error: null };
  };

  const parseOr = (): { node: AdvancedNode | null; error: string | null } => {
    const first = parseAnd();
    if (first.error || !first.node) {
      return first;
    }

    let left = first.node;
    while (true) {
      const next = peek();
      if (!next || next.type !== "or") {
        break;
      }
      consume();
      const right = parseAnd();
      if (right.error) {
        return right;
      }
      if (!right.node) {
        return { node: null, error: "OR must be followed by a term, phrase, or sub-expression." };
      }
      left = {
        type: "or",
        left,
        right: right.node,
      };
    }

    return { node: left, error: null };
  };

  const parsed = parseOr();
  if (parsed.error) {
    return { root: null, error: parsed.error };
  }
  if (cursor < tokens.length) {
    const token = tokens[cursor];
    return {
      root: null,
      error: `Unexpected token '${token?.type.toUpperCase() ?? "UNKNOWN"}'.`,
    };
  }

  return { root: parsed.node, error: null };
}

function normalizeAdvancedLeaf(token: Extract<AdvancedToken, { type: "term" | "phrase" }>): {
  node: AdvancedNode | null;
  error: string | null;
} {
  if (token.type === "phrase") {
    const phrase = token.value.trim();
    if (phrase.length === 0) {
      return { node: null, error: "Quoted phrase cannot be empty." };
    }
    return {
      node: {
        type: "leaf",
        value: phrase,
        isPrefix: false,
        isPhrase: true,
      },
      error: null,
    };
  }

  const normalized = normalizeToken(token.value);
  if (normalized.length === 0) {
    return { node: null, error: "Empty term is not allowed." };
  }

  const wildcardCount = countChar(normalized, "*");
  if (wildcardCount === 0) {
    return {
      node: {
        type: "leaf",
        value: normalized,
        isPrefix: false,
        isPhrase: false,
      },
      error: null,
    };
  }

  if (supportsFtsPrefix(normalized)) {
    const value = normalized.slice(0, -1).trim();
    if (value.length === 0) {
      return { node: null, error: "Wildcard terms must include text before '*'." };
    }
    return {
      node: {
        type: "leaf",
        value,
        isPrefix: true,
        isPhrase: false,
      },
      error: null,
    };
  }

  const withoutWildcards = normalized.replaceAll("*", "").trim();
  if (withoutWildcards.length === 0) {
    return { node: null, error: "Wildcard terms must include text." };
  }
  return {
    node: {
      type: "leaf",
      value: withoutWildcards,
      isPrefix: false,
      isPhrase: false,
    },
    error: null,
  };
}

function compileAdvancedAst(node: AdvancedNode, parentPrecedence: number): string {
  const precedence = node.type === "or" ? 1 : node.type === "and" ? 2 : node.type === "not" ? 3 : 4;

  let compiled = "";
  if (node.type === "leaf") {
    const escaped = node.value.replaceAll('"', '""');
    compiled = `"${escaped}"${node.isPrefix ? "*" : ""}`;
  } else if (node.type === "not") {
    const left = compileAdvancedAst(node.left, precedence);
    const right = compileAdvancedAst(node.right, precedence);
    compiled = `${left} NOT ${right}`;
  } else {
    const operator = node.type === "and" ? "AND" : "OR";
    const left = compileAdvancedAst(node.left, precedence);
    const right = compileAdvancedAst(node.right, precedence);
    compiled = `${left} ${operator} ${right}`;
  }

  return precedence < parentPrecedence ? `(${compiled})` : compiled;
}

function hasPositiveLeaf(node: AdvancedNode, negated: boolean): boolean {
  if (node.type === "leaf") {
    return !negated;
  }
  if (node.type === "not") {
    // "A NOT B" still needs A to anchor the FTS query. Purely negated expressions are rejected
    // because FTS cannot efficiently answer "everything except X" on their own.
    return hasPositiveLeaf(node.left, negated);
  }
  return hasPositiveLeaf(node.left, negated) || hasPositiveLeaf(node.right, negated);
}

function collectPositiveHighlightPatterns(
  node: AdvancedNode,
  negated: boolean,
  patterns: string[],
): string[] {
  if (node.type === "leaf") {
    if (!negated) {
      patterns.push(node.isPrefix ? `${node.value}*` : node.value);
    }
    return patterns;
  }
  if (node.type === "not") {
    return collectPositiveHighlightPatterns(node.left, negated, patterns);
  }
  collectPositiveHighlightPatterns(node.left, negated, patterns);
  collectPositiveHighlightPatterns(node.right, negated, patterns);
  return patterns;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
