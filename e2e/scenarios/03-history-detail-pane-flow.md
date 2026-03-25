# Scenario: History Detail Pane Flow

**Test file:** `e2e/tests/history-detail-pane-flow.test.ts`

## Preconditions

- In history view, the detail pane (message area) is visible.

---

## 1 — Category filters

1. Find `button.msg-filter` elements.
2. If `user-filter` exists: click → `active` toggles → click again → original state.

---

## 2 — Message sort direction

1. If `button.msg-sort-btn` exists, click twice; `aria-label` changes then restores.

---

## 3 — In-session search

1. Fill `.msg-search input.search-input` and assert value.
2. Clear the field.

---

## 4 — Advanced search (history)

1. If `advanced-search-toggle-btn-history` exists, toggle `active` on/off.

---

## 5 — Zoom (detail toolbar)

1. Zoom in → percentage increases (IPC; asserted with `toPass`).
2. Zoom out → percentage decreases.
3. **Cmd+0** (macOS) / **Ctrl+0** (Windows/Linux) resets zoom.

---

## 6 — Bulk expand scope

1. If `select[aria-label="Select expand and collapse scope"]` exists, assert an option contains “All”.
