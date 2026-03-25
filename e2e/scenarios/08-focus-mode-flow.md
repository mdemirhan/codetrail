# Scenario: Focus Mode Flow

**Test file:** `e2e/tests/focus-mode-flow.test.ts`

## 1 — Enter and exit focus mode

1. In history, project and session panes are visible.
2. “Enter focus mode” → `history-focus-pane`; workspace is no longer `history-layout`; side panes hidden.
3. Button label becomes “Exit focus mode”.
4. Exit → three-pane layout returns.

---

## 2 — Focus disabled in Search

1. Open Search.
2. “Enter focus mode” is **disabled**.
3. **Cmd+Shift+M** / **Ctrl+Shift+M** → still Search.
4. **Escape** → history; focus button is **enabled** again.

---

## 3 — Settings while focus is on

1. Enter focus mode.
2. Open Settings.
3. **Escape** → focus mode remains (`history-focus-pane` visible).
4. “Exit focus mode” → history layout.
