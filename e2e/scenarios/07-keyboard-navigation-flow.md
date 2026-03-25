# Scenario: Keyboard Navigation Flow

**Test file:** `e2e/tests/keyboard-navigation-flow.test.ts`

## Modifiers

Tests use **Meta** on macOS and **Control** on Windows/Linux (same shortcuts as in the app).

---

## 1 — Navigate between views

1. Click the workspace; **`?`** → Help opens.
2. **Escape** → history.
3. **Cmd+Shift+F** (macOS) / **Ctrl+Shift+F** → Search; search input focused.
4. **Escape** → history.
5. **Cmd+,** / **Ctrl+,** → Settings.
6. **Escape** → history.

---

## 2 — Focus mode

1. **Cmd+Shift+M** / **Ctrl+Shift+M** → focus layout (`history-focus-pane`).
2. Same shortcut → history layout.

---

## 3 — Project pane **Cmd+B** / **Ctrl+B**

1. **Cmd+B** / **Ctrl+B** → `projects-collapsed`.
2. Same shortcut → expand.

---

## 4 — Session pane (buttons)

1. Assert session pane starts collapsed.
2. Expand / Collapse via buttons.

---

## 5 — Tab focus

1. Focus `.project-list`.
2. **Tab** → focus moves to another element.

---

## 6 — Zoom shortcuts

1. Open Settings; read zoom; Escape.
2. **Cmd+=** / **Ctrl+=** → zoom increases; open Settings and read again.
3. **Cmd+-** / **Ctrl+-** → zoom decreases.
4. **Cmd+0** / **Ctrl+0** → 100%; Escape closes Settings.
