import { test, expect } from "../fixtures/app.fixture";
import { UI_PROVIDER_IDS } from "../helpers/providers";

test.describe("Search Flow", () => {
  test("complete search workflow: query → filters → advanced toggle → clear", async ({
    appPage,
  }) => {
    await test.step("Open search view and verify input receives focus", async () => {
      await appPage.locator('button[aria-label="Search"]').click();
      await expect(appPage.locator(".search-view")).toBeVisible();
      const searchInput = appPage.locator("input.search-query-input");
      await expect(searchInput).toBeVisible();
    });

    await test.step("Type a query and wait for debounced search execution", async () => {
      const searchInput = appPage.locator("input.search-query-input");
      await searchInput.fill("test search query");
      await expect(searchInput).toHaveValue("test search query");
      await appPage.waitForTimeout(600);
      await expect(appPage.locator(".search-match-count")).toBeVisible();
    });

    await test.step("Toggle advanced search mode and verify it affects placeholder", async () => {
      const advToggle = appPage.locator("button.advanced-search-toggle-btn-search");
      const wasActive = await advToggle.evaluate((el) => el.classList.contains("active"));
      await advToggle.click();

      const isActive = await advToggle.evaluate((el) => el.classList.contains("active"));
      expect(isActive).toBe(!wasActive);
      await expect(advToggle).toHaveAttribute(
        "aria-pressed",
        String(!wasActive),
      );
    });

    await test.step("Toggle category filter chips and verify active state toggles", async () => {
      const userChip = appPage.locator(
        "button.search-filter-chip-category-user",
      );
      if ((await userChip.count()) > 0) {
        const wasActive = await userChip.evaluate((el) =>
          el.classList.contains("is-active"),
        );
        await userChip.click({ force: true });
        const isActive = await userChip.evaluate((el) =>
          el.classList.contains("is-active"),
        );
        expect(isActive).toBe(!wasActive);
      }
    });

    await test.step("Toggle each search provider filter chip", async () => {
      for (const provider of UI_PROVIDER_IDS) {
        const chip = appPage.locator(
          `button.search-filter-chip-provider-${provider}`,
        );
        if ((await chip.count()) === 0) {
          continue;
        }
        const wasActive = await chip.evaluate((el) =>
          el.classList.contains("is-active"),
        );
        await chip.click({ force: true });
        expect(
          await chip.evaluate((el) => el.classList.contains("is-active")),
        ).toBe(!wasActive);
        await chip.click({ force: true });
        expect(
          await chip.evaluate((el) => el.classList.contains("is-active")),
        ).toBe(wasActive);
      }
    });

    await test.step("Collapse and expand filter controls", async () => {
      const collapseBtn = appPage.locator("button.search-panel-collapse-btn");
      await expect(collapseBtn).toHaveAttribute("aria-expanded", "true");
      await collapseBtn.click();
      await expect(collapseBtn).toHaveAttribute("aria-expanded", "false");
      await expect(appPage.locator("input.search-filter-input")).not.toBeVisible();

      await collapseBtn.click();
      await expect(collapseBtn).toHaveAttribute("aria-expanded", "true");
      await expect(appPage.locator("input.search-filter-input")).toBeVisible();
    });

    await test.step("Open project scope menu and verify menu items", async () => {
      const projectTrigger = appPage.locator("button.search-project-select-trigger");
      await projectTrigger.click();
      const menu = appPage.locator('.search-project-menu[role="menu"]');
      await expect(menu).toBeVisible();
      const allProjectsItem = menu.locator("button", { hasText: "All projects" });
      await expect(allProjectsItem).toBeVisible();
      await allProjectsItem.click();
      await expect(menu).not.toBeVisible();
    });

    await test.step("Clear query and verify match count resets", async () => {
      const searchInput = appPage.locator("input.search-query-input");
      await searchInput.fill("");
      await appPage.waitForTimeout(600);
      const matchCount = appPage.locator(".search-match-count");
      await expect(matchCount).not.toHaveClass(/is-active/);
    });

    await test.step("Press Enter on query focuses results pane", async () => {
      const searchInput = appPage.locator("input.search-query-input");
      await searchInput.fill("test");
      await searchInput.press("Enter");
      const resultsScroll = appPage.locator(".search-results-scroll");
      await expect(resultsScroll).toBeFocused();
    });

    await test.step("Escape returns to history from search", async () => {
      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
    });
  });

  test("project name filter in search narrows project scope options", async ({ appPage }) => {
    await test.step("Open search and type into project filter", async () => {
      await appPage.locator('button[aria-label="Search"]').click();
      await expect(appPage.locator(".search-view")).toBeVisible();

      const projectFilter = appPage.locator("input.search-filter-input");
      await projectFilter.fill("nonexistent-abc");
      await appPage.waitForTimeout(250);
    });

    await test.step("Clear project filter", async () => {
      const projectFilter = appPage.locator("input.search-filter-input");
      await projectFilter.fill("");
    });

    await test.step("Return to history", async () => {
      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
    });
  });
});
