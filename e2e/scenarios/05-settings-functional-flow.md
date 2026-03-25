# Scenario: Settings Functional Flow

**Test file:** `e2e/tests/settings-functional-flow.test.ts`

## Preconditions

- Settings opens on the **Application Settings** tab.

---

## 1 — Theme and document dataset

1. Change `select[aria-label="Theme"]` dark ↔ light; assert `document.documentElement.dataset.theme`.
2. Restore the original theme.

---

## 2 — Zoom (Settings, IPC)

1. Enter 120% zoom (Enter).
2. 200 → clamped to max 175.
3. 10 → clamped to min 60.
4. Restore 100%.

---

## 3 — Messages per page + tab persistence

1. Set “Messages per page” to 50.
2. Switch to Diagnostics, then back to Application Settings; value stays 50.

---

## 4 — Font and CSS variable

1. Change monospaced font to another option when possible.
2. Computed `--font-mono` is non-empty.

---

## 5 — Auto-hide and dataset

1. Toggle “Auto-hide message actions”; assert `dataset.autoHideMessageActions`.
2. Restore previous state.

---

## 6 — Default expansion categories

1. `button.settings-token`: `aria-pressed` toggles and restores.

---

## 7 — Tabs

1. Application Settings is selected.
2. Diagnostics → Theme selector disappears.
3. Application Settings → Theme selector appears again.
