# Scenario: Refresh & Indexing Flow

**Test file:** `e2e/tests/refresh-and-indexing-flow.test.ts`

## 1 — Incremental refresh

1. Click “Incremental refresh”.
2. While indexing, the control may show “Indexing in progress” or the refresh control.
3. When finished, the refresh button is enabled and visible again (wait with timeout).

---

## 2 — Force reindex (Settings)

1. Open Settings; “Force reindex” is visible.
2. Click → confirm dialog “Force Reindex”.
3. **Cancel** → dialog closes.
4. Click again → confirm **Reindex** → dialog closes.
5. **Escape** → history.

---

## 3 — Cmd+R / Ctrl+R shortcut

1. From history, press **Cmd+R** (macOS) or **Ctrl+R** (Windows/Linux).
2. Refresh/indexing cycle runs; refresh control becomes ready again.
