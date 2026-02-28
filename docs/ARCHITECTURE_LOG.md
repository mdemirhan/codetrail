# Architecture Log

## Overview

The repository is split into:

- `packages/core`: provider discovery, parser normalization, SQLite schema/indexing, and FTS search.
- `apps/desktop`: Electron main/preload/renderer runtime and UI.

## Core pipeline

1. Discover provider files from local roots.
2. Parse provider payloads into canonical messages.
3. Index messages and aggregates into SQLite.
4. Serve query/search/session detail APIs over typed IPC.

## Core modules

- Discovery: `packages/core/src/discovery`
- Parsing: `packages/core/src/parsing`
- DB schema/bootstrap: `packages/core/src/db`
- Indexer: `packages/core/src/indexing`
- Search: `packages/core/src/search`
- IPC contracts: `packages/core/src/contracts/ipc.ts`

## Desktop modules

- Main bootstrap and IPC registration: `apps/desktop/src/main/bootstrap.ts`
- Query service: `apps/desktop/src/main/data/queryService.ts`
- Index refresh runner: `apps/desktop/src/main/indexingRunner.ts`
- Preload bridge: `apps/desktop/src/preload/index.ts`
- Renderer app: `apps/desktop/src/renderer/App.tsx`

## Persistence and schema notes

- Schema versioning is tracked in `meta`.
- Version mismatch triggers full schema rebuild.
- Indexed file metadata supports incremental indexing and stale-heal reindex.

## Search and facets notes

- Search uses FTS5 virtual table (`message_fts`) joined with relational session/project data.
- Facet counts are computed using non-category-reduced filters for chip consistency.

## Build/runtime notes

- Desktop build script bundles main, preload, and renderer into `apps/desktop/dist`.
- Main process loads renderer URL from `CCH_RENDERER_URL` when provided.
- Otherwise it loads local `dist/renderer/index.html`.
