# E2E scenarios

The Markdown files in this folder **map 1:1** to Playwright tests in `e2e/tests/*.test.ts`. Application: Electron (Code Trail). Fixture: `e2e/fixtures/app.fixture.ts`.

| # | Scenario file | Test file |
|---|---------------|-----------|
| 01 | `01-view-navigation-flow.md` | `view-navigation-flow.test.ts` |
| 02 | `02-history-pane-interactions.md` | `history-pane-interactions.test.ts` |
| 03 | `03-history-detail-pane-flow.md` | `history-detail-pane-flow.test.ts` |
| 04 | `04-search-flow.md` | `search-flow.test.ts` |
| 05 | `05-settings-functional-flow.md` | `settings-functional-flow.test.ts` |
| 06 | `06-theme-and-appearance-flow.md` | `theme-and-appearance-flow.test.ts` |
| 07 | `07-keyboard-navigation-flow.md` | `keyboard-navigation-flow.test.ts` |
| 08 | `08-focus-mode-flow.md` | `focus-mode-flow.test.ts` |
| 09 | `09-refresh-and-indexing-flow.md` | `refresh-and-indexing-flow.test.ts` |
| 10 | `10-provider-toggle-flow.md` | `provider-toggle-flow.test.ts` |

Run: `bun run e2e` or `npx playwright test --config e2e/playwright.config.ts`.
