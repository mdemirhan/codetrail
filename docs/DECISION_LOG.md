# Decision Log

## Product scope and parity

- Chosen: selective strict parity for discovery, parsing, indexing, and search behavior.
- Chosen: UI and interaction layer can be modernized while preserving functionality.

## Stack decisions

- Language: strict TypeScript end-to-end.
- Desktop shell: Electron.
- UI: React 19.
- DB: SQLite via `better-sqlite3`.
- Search: SQLite FTS5.
- Validation: Zod contracts for IPC.
- Testing: Vitest integration-first coverage.
- Tooling: Bun workspaces + Biome + TypeScript.

## Data and indexing decisions

- Canonical categories: `user`, `assistant`, `tool_use`, `tool_result`, `thinking`, `system`.
- Split-message token usage attached only to first split message of a source event.
- Unknown/unsupported message types normalized to `system`.
- Incremental identity includes provider + source session id, with path suffix for Codex/Gemini duplicates.
- Indexed file metadata keyed by `file_path`.
- Sessions store `file_path` as unique, plus computed aggregate fields.

## Search behavior decisions

- FTS query uses escaped quoted terms.
- Category alias normalization includes `tool_call -> tool_use`.
- Facet counts are computed without active category-filter reduction.
- Search results return snippets with highlight tags and source message id for deep linking.

## UI interaction decisions

- Main split layout with nav, projects, sessions, and content panes.
- Focus mode hides side panes for reading.
- Session detail supports in-session debounced filtering and pagination size 100.
- Session category chips persist during session navigation in app state.
- Search result click deep-links to session detail with focus target.
- Path context actions use file manager open API.
