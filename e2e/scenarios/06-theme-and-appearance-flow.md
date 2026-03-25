# Scenario: Theme & Appearance Flow (Top Bar)

**Test file:** `e2e/tests/theme-and-appearance-flow.test.ts`

> Note: Theme changes inside the Settings screen are covered in `05-settings-functional-flow.md`. This file covers **Top Bar** theme, text viewer theme, and refresh strategy.

## Preconditions

- Top bar is reachable from history or the current view.

---

## 1 — Top Bar theme menu

1. Open “Choose theme”.
2. Select **Dark**; `dataset.theme === "dark"`.
3. Open Search; theme stays dark; Escape to history.
4. Select **Light**; `dataset.theme === "light"`.

---

## 2 — Text viewer (Shiki) theme

1. Open “Choose text viewer theme”.
2. Select a theme that was not pressed; `dataset.shikiTheme` is set.

---

## 3 — Auto-refresh strategy

1. Open “Auto-refresh strategy”.
2. The active strategy has `aria-pressed="true"`.
3. Select **Manual**; menu closes.
