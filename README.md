# CCH TS Desktop

TypeScript desktop clone of CCH for local AI coding chat history across Claude, Codex, and Gemini.

## Scope

- Discovery from default local provider directories.
- Provider-specific parsing into one canonical message schema.
- SQLite indexing with FTS search and incremental updates.
- Desktop UI for project/session browsing and search-driven deep linking.

## Commands

- Install: `bun install`
- Quality gate: `bun run ci`
- Core test suite: `bun run test`
- Desktop build: `bun run desktop:build`
- Desktop run: `bun run desktop:start`
- Desktop build + run: `bun run desktop:dev`

## Discovery defaults

- Claude: `~/.claude/projects`
- Codex: `~/.codex/sessions`
- Gemini: `~/.gemini/tmp`

## Desktop notes

- `apps/desktop/src/main/main.ts` uses `CCH_RENDERER_URL` when set.
- Without `CCH_RENDERER_URL`, it loads `dist/renderer/index.html`.
- Search result clicks open session detail focused on the target message source id.

## Reference logs

- Decision log: `docs/DECISION_LOG.md`
- Architecture log: `docs/ARCHITECTURE_LOG.md`
