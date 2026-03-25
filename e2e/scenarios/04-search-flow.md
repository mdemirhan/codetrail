# Scenario: Search Flow

**Test file:** `e2e/tests/search-flow.test.ts`

## Preconditions

- Global search; results update after query debounce (~500 ms).

---

## Scenario A — Full search workflow

1. Open search via the Search button; `.search-query-input` is visible.
2. Type a query; match count is visible.
3. Toggle advanced search; `aria-pressed` / `active` updates.
4. If category chips exist (e.g. user), toggle `is-active`.
5. **All provider chips** (`claude`, `codex`, `gemini`, `cursor`, `copilot`): for each, double-click toggles `is-active` and restores.
6. Collapse / expand the search filter panel (`search-panel-collapse-btn`, `aria-expanded`).
7. Project scope menu: choose “All projects”, menu closes.
8. Clear query; match count is not active.
9. Type `test` and press **Enter** → results scroll region is focused.
10. **Escape** → history layout.

---

## Scenario B — Project name filter

1. Open Search.
2. Type into `input.search-filter-input`; short wait.
3. Clear the field.
4. **Escape** → history.
