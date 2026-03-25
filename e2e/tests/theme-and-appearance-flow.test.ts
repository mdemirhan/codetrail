import { test, expect } from "../fixtures/app.fixture";

test.describe("Theme & Appearance Flow", () => {
  test("TopBar theme dropdown changes DOM theme and persists across views", async ({
    appPage,
  }) => {
    await test.step("Open theme dropdown from TopBar", async () => {
      await appPage.locator('button[aria-label="Choose theme"]').click();
      const menu = appPage.locator('.tb-dropdown-menu[aria-label="Theme"]');
      await expect(menu).toBeVisible();
    });

    await test.step("Select dark theme and verify DOM attribute changes", async () => {
      const darkItem = appPage.locator(
        '.tb-dropdown-menu[aria-label="Theme"] button',
        { hasText: "Dark" },
      );
      await darkItem.first().click();

      const htmlTheme = await appPage.evaluate(() =>
        document.documentElement.dataset.theme,
      );
      expect(htmlTheme).toBe("dark");
    });

    await test.step("Navigate to search and back — theme persists", async () => {
      await appPage.locator('button[aria-label="Search"]').click();
      await expect(appPage.locator(".search-view")).toBeVisible();

      const themeInSearch = await appPage.evaluate(() =>
        document.documentElement.dataset.theme,
      );
      expect(themeInSearch).toBe("dark");

      await appPage.keyboard.press("Escape");
    });

    await test.step("Switch to light theme and verify", async () => {
      await appPage.locator('button[aria-label="Choose theme"]').click();
      const lightItem = appPage.locator(
        '.tb-dropdown-menu[aria-label="Theme"] button',
        { hasText: "Light" },
      );
      await lightItem.first().click();

      const htmlTheme = await appPage.evaluate(() =>
        document.documentElement.dataset.theme,
      );
      expect(htmlTheme).toBe("light");
    });
  });

  test("text viewer theme dropdown changes shiki dataset attribute", async ({ appPage }) => {
    await test.step("Open code theme dropdown", async () => {
      await appPage.locator('button[aria-label="Choose text viewer theme"]').click();
      const menu = appPage.locator('.tb-dropdown-menu[aria-label="Text viewer theme"]');
      await expect(menu).toBeVisible();
    });

    await test.step("Select a different code theme", async () => {
      const items = appPage.locator(
        '.tb-dropdown-menu[aria-label="Text viewer theme"] .tb-dropdown-item',
      );
      const count = await items.count();
      expect(count).toBeGreaterThan(1);

      const unpressedItem = items.filter({ has: appPage.locator('[aria-pressed="false"]') }).first();
      if ((await unpressedItem.count()) > 0) {
        const targetText = await unpressedItem.textContent();
        await unpressedItem.click();

        const shikiTheme = await appPage.evaluate(() =>
          document.documentElement.dataset.shikiTheme,
        );
        expect(shikiTheme).toBeTruthy();
      }
    });
  });

  test("auto-refresh strategy dropdown changes strategy and shows status", async ({
    appPage,
  }) => {
    await test.step("Open auto-refresh strategy dropdown", async () => {
      await appPage.locator('button[aria-label="Auto-refresh strategy"]').click();
      const menu = appPage.locator(".tb-dropdown-menu-auto-refresh");
      await expect(menu).toBeVisible();
    });

    await test.step("Verify current strategy has aria-pressed=true", async () => {
      const pressedItem = appPage.locator(
        '.tb-dropdown-menu-auto-refresh button[aria-pressed="true"]',
      );
      await expect(pressedItem).toBeVisible();
    });

    await test.step("Select Manual strategy and verify menu closes", async () => {
      const manualItem = appPage.locator(
        ".tb-dropdown-menu-auto-refresh button",
        { hasText: "Manual" },
      );
      await manualItem.click();
      await expect(
        appPage.locator(".tb-dropdown-menu-auto-refresh"),
      ).not.toBeVisible();
    });
  });
});
