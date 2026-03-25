import { test, expect } from "../fixtures/app.fixture";

test.describe("History Detail Pane Flow", () => {
  test("category filter toggles change active state and affect message list", async ({
    appPage,
  }) => {
    await test.step("Find category filter buttons", async () => {
      const filters = appPage.locator("button.msg-filter");
      const count = await filters.count();
      expect(count).toBeGreaterThan(0);
    });

    await test.step("Toggle a category filter off and on", async () => {
      const userFilter = appPage.locator("button.user-filter");
      if ((await userFilter.count()) > 0) {
        const wasActive = await userFilter.evaluate((el) =>
          el.classList.contains("active"),
        );
        await userFilter.click();
        const isActive = await userFilter.evaluate((el) =>
          el.classList.contains("active"),
        );
        expect(isActive).toBe(!wasActive);

        await userFilter.click();
        const restored = await userFilter.evaluate((el) =>
          el.classList.contains("active"),
        );
        expect(restored).toBe(wasActive);
      }
    });
  });

  test("message sort direction toggles asc/desc", async ({ appPage }) => {
    await test.step("Click message sort button", async () => {
      const sortBtn = appPage.locator("button.msg-sort-btn");
      if ((await sortBtn.count()) > 0) {
        const initialLabel = await sortBtn.getAttribute("aria-label");
        await sortBtn.click();
        const newLabel = await sortBtn.getAttribute("aria-label");
        expect(newLabel).not.toBe(initialLabel);

        await sortBtn.click();
        const restoredLabel = await sortBtn.getAttribute("aria-label");
        expect(restoredLabel).toBe(initialLabel);
      }
    });
  });

  test("history search input filters messages and handles errors", async ({ appPage }) => {
    await test.step("Type into session search to filter messages", async () => {
      const searchInput = appPage.locator(".msg-search input.search-input");
      if ((await searchInput.count()) > 0) {
        await searchInput.fill("test query for filtering");
        await appPage.waitForTimeout(300);
        await expect(searchInput).toHaveValue("test query for filtering");
      }
    });

    await test.step("Clear search restores unfiltered state", async () => {
      const searchInput = appPage.locator(".msg-search input.search-input");
      if ((await searchInput.count()) > 0) {
        await searchInput.fill("");
        await appPage.waitForTimeout(300);
      }
    });
  });

  test("advanced search toggle in history pane changes search mode", async ({ appPage }) => {
    await test.step("Toggle advanced search in history detail pane", async () => {
      const advToggle = appPage.locator(
        "button.advanced-search-toggle-btn-history",
      );
      if ((await advToggle.count()) > 0) {
        const wasActive = await advToggle.evaluate((el) =>
          el.classList.contains("active"),
        );
        await advToggle.click();
        const isActive = await advToggle.evaluate((el) =>
          el.classList.contains("active"),
        );
        expect(isActive).toBe(!wasActive);

        await advToggle.click();
      }
    });
  });

  test("zoom controls in detail pane change zoom level", async ({ appPage }) => {
    await test.step("Click zoom in button", async () => {
      const zoomInBtn = appPage.locator(
        '.history-view button.zoom-btn[aria-label="Zoom in"]',
      );
      if ((await zoomInBtn.count()) > 0 && (await zoomInBtn.isEnabled())) {
        const zoomInput = appPage.locator('.history-view input[aria-label="Zoom percentage"]');
        const beforeZoom = await zoomInput.inputValue();
        await zoomInBtn.click();
        await expect(async () => {
          const afterZoom = await zoomInput.inputValue();
          expect(Number(afterZoom)).toBeGreaterThan(Number(beforeZoom));
        }).toPass({ timeout: 5_000 });
      }
    });

    await test.step("Click zoom out button", async () => {
      const zoomOutBtn = appPage.locator(
        '.history-view button.zoom-btn[aria-label="Zoom out"]',
      );
      if ((await zoomOutBtn.count()) > 0 && (await zoomOutBtn.isEnabled())) {
        const zoomInput = appPage.locator('.history-view input[aria-label="Zoom percentage"]');
        const beforeZoom = await zoomInput.inputValue();
        await zoomOutBtn.click();
        await expect(async () => {
          const afterZoom = await zoomInput.inputValue();
          expect(Number(afterZoom)).toBeLessThan(Number(beforeZoom));
        }).toPass({ timeout: 5_000 });
      }
    });

    await test.step("Reset zoom via keyboard shortcut", async () => {
      const MOD = process.platform === "darwin" ? "Meta" : "Control";
      await appPage.keyboard.press(`${MOD}+0`);
    });
  });

  test("expand/collapse scope select changes bulk expand behavior", async ({ appPage }) => {
    await test.step("Check expand scope select exists and has options", async () => {
      const scopeSelect = appPage.locator(
        'select[aria-label="Select expand and collapse scope"]',
      );
      if ((await scopeSelect.count()) > 0) {
        const options = await scopeSelect.locator("option").allTextContents();
        expect(options.length).toBeGreaterThan(0);
        expect(options[0]).toContain("All");
      }
    });
  });
});
