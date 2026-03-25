# Scenario: View Navigation Flow

**Test file:** `e2e/tests/view-navigation-flow.test.ts`

## Preconditions

- The app launches via the Playwright Electron fixture; history layout is the default view.

---

## Scenario A — Full view cycle (history → search → help → settings → history)

1. The app opens in history layout; project and session panes are visible.
2. **Search** switches to the search view; workspace uses `search-layout`, the search box is visible, side panes are hidden.
3. **Search** is clicked again to return to history; the three panes are visible again.
4. **Help** opens the help view; more than one shortcut group label is visible.
5. **Escape** returns to history; help closes.
6. **Settings** opens settings; the Theme selector is visible.
7. **Escape** returns to history.

**Expected:** Each transition uses the correct layout and content; Escape returns to history.

---

## Scenario B — Direct navigation between non-history views

1. Open Search.
2. Open Settings (without returning to history first); search closes, settings appear.
3. Open Help; settings close.
4. **Escape** returns to history.

**Expected:** Top-bar direct switches work; a single Escape returns to history.
