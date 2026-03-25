# Scenario: Provider Toggle Flow

**Test file:** `e2e/tests/provider-toggle-flow.test.ts`  
**Shared constant:** `e2e/helpers/providers.ts` — `claude`, `codex`, `gemini`, `cursor`, `copilot`

---

## 1 — Settings: disable confirmation for each enabled provider

For each provider in order:

1. Settings is open; find `label.settings-switch-{provider}`.
2. If the checkbox is checked, click → **Disable** confirmation dialog opens.
3. **Cancel** → dialog closes; checkbox stays checked.
4. **Escape** returns to history after the loop.

> Providers that are already off are skipped.

---

## 2 — Project pane: all provider tags

1. `.project-pane button.tag` count must be 5 (same as the list above).
2. For each tag in order: click → `active` class toggles → click again → original state.

**Expected:** Every provider filter is exercised, not only the first tag.

---

## Related: Global search provider chips

The same provider list is tested in search view as `search-filter-chip-provider-*` in `04-search-flow.md`.
