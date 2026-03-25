# Scenario: History Pane Interactions

**Test file:** `e2e/tests/history-pane-interactions.test.ts`

## Preconditions

- On a fresh instance, the session pane may start **collapsed** (`sessions-collapsed`).

---

## 1 — Collapse / expand project pane

1. Use the Projects collapse control; workspace gets `projects-collapsed`; pane has `collapsed`.
2. Expand restores the pane.

---

## 2 — Session pane: default collapsed, expand, collapse again

1. Assert workspace and session pane start collapsed.
2. **Expand Sessions pane** expands the pane.
3. **Collapse Sessions pane** collapses it again.

---

## 3 — Project sort: field and direction

1. Open the sort-field menu and choose **Name**; `aria-label` updates.
2. Toggle sort direction; `aria-label` changes.
3. Choose **Last Active** from the menu to restore.

---

## 4 — List / tree view

1. Use the view toggle to switch list ↔ tree (`.project-list` / `.project-list-tree`).
2. Toggle back to the previous mode.

---

## 5 — Project text filter

1. Type a non-matching string in the project search; `.project-item` count is 0.
2. Clear the field.

---

## 6 — Session pane sort direction

1. If present, click the session sort button; `title` changes.

**Expected:** Workspace classes and panes stay in the expected state.
