import { test, expect } from "../fixtures/app.fixture";

test.describe("View Navigation Flow", () => {
  test("full view cycle: history → search → help → settings → history", async ({ appPage }) => {
    await test.step("App starts in history layout with three-pane structure", async () => {
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
      await expect(appPage.locator(".project-pane")).toBeVisible();
      await expect(appPage.locator(".session-pane")).toBeVisible();
    });

    await test.step("Navigate to search — workspace switches to search layout", async () => {
      await appPage.locator('button[aria-label="Search"]').click();
      await expect(appPage.locator(".workspace")).toHaveClass(/search-layout/);
      await expect(appPage.locator(".search-view")).toBeVisible();
      await expect(appPage.locator(".search-query-input")).toBeVisible();
      await expect(appPage.locator(".project-pane")).not.toBeVisible();
    });

    await test.step("Toggle search off — returns to history with three panes", async () => {
      await appPage.locator('button[aria-label="Search"]').click();
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
      await expect(appPage.locator(".project-pane")).toBeVisible();
    });

    await test.step("Navigate to help — shortcuts and syntax content is interactive", async () => {
      await appPage.locator('button[aria-label="Open help"]').click();
      await expect(appPage.locator(".help-view")).toBeVisible();
      const shortcutGroups = appPage.locator(".help-group-label");
      const groupCount = await shortcutGroups.count();
      expect(groupCount).toBeGreaterThan(1);
    });

    await test.step("Escape from help restores history with maintained pane state", async () => {
      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
      await expect(appPage.locator(".help-view")).not.toBeVisible();
    });

    await test.step("Navigate to settings — tab bar renders and Appearance loads", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      await expect(appPage.locator(".settings-view")).toBeVisible();
      await expect(appPage.locator('select[aria-label="Theme"]')).toBeVisible();
    });

    await test.step("Escape from settings restores history", async () => {
      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
      await expect(appPage.locator(".settings-view")).not.toBeVisible();
    });
  });

  test("direct navigation between non-history views", async ({ appPage }) => {
    await test.step("Go to search, then directly to settings without returning to history", async () => {
      await appPage.locator('button[aria-label="Search"]').click();
      await expect(appPage.locator(".search-view")).toBeVisible();

      await appPage.locator('button[aria-label="Open settings"]').click();
      await expect(appPage.locator(".settings-view")).toBeVisible();
      await expect(appPage.locator(".search-view")).not.toBeVisible();
    });

    await test.step("From settings, go directly to help", async () => {
      await appPage.locator('button[aria-label="Open help"]').click();
      await expect(appPage.locator(".help-view")).toBeVisible();
      await expect(appPage.locator(".settings-view")).not.toBeVisible();
    });

    await test.step("Escape returns to history regardless of navigation depth", async () => {
      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
    });
  });
});
