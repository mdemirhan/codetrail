import { test, expect } from "../fixtures/app.fixture";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test.describe("Focus Mode Flow", () => {
  test("entering focus mode hides side panes and shows detail only", async ({ appPage }) => {
    await test.step("Verify starting in normal history layout", async () => {
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
      await expect(appPage.locator(".project-pane")).toBeVisible();
      await expect(appPage.locator(".session-pane")).toBeVisible();
    });

    await test.step("Click Focus button", async () => {
      await appPage.locator('button[aria-label="Enter focus mode"]').click();
      await expect(appPage.locator(".history-focus-pane")).toBeVisible();
      await expect(appPage.locator(".workspace")).not.toHaveClass(/history-layout/);
    });

    await test.step("Side panes are not visible in focus mode", async () => {
      await expect(appPage.locator(".project-pane")).not.toBeVisible();
      await expect(appPage.locator(".session-pane")).not.toBeVisible();
    });

    await test.step("Focus button label changes to exit", async () => {
      await expect(
        appPage.locator('button[aria-label="Exit focus mode"]'),
      ).toBeVisible();
      await expect(
        appPage.locator('button[aria-label="Enter focus mode"]'),
      ).not.toBeVisible();
    });

    await test.step("Exit focus mode restores three-pane layout", async () => {
      await appPage.locator('button[aria-label="Exit focus mode"]').click();
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
      await expect(appPage.locator(".project-pane")).toBeVisible();
      await expect(appPage.locator(".session-pane")).toBeVisible();
    });
  });

  test("focus mode is disabled when not in history view", async ({ appPage }) => {
    await test.step("Navigate to search", async () => {
      await appPage.locator('button[aria-label="Search"]').click();
      await expect(appPage.locator(".search-view")).toBeVisible();
    });

    await test.step("Focus button is disabled in search view", async () => {
      const focusBtn = appPage.locator('button[aria-label="Enter focus mode"]');
      await expect(focusBtn).toBeDisabled();
    });

    await test.step("Cmd+Shift+M shortcut has no effect in search", async () => {
      await appPage.keyboard.press(`${MOD}+Shift+m`);
      await expect(appPage.locator(".search-view")).toBeVisible();
    });

    await test.step("Return to history and verify focus mode works again", async () => {
      await appPage.keyboard.press("Escape");
      const focusBtn = appPage.locator('button[aria-label="Enter focus mode"]');
      await expect(focusBtn).toBeEnabled();
    });
  });

  test("focus mode state resets when navigating to other views and back", async ({
    appPage,
  }) => {
    await test.step("Enter focus mode", async () => {
      await appPage.locator('button[aria-label="Enter focus mode"]').click();
      await expect(appPage.locator(".history-focus-pane")).toBeVisible();
    });

    await test.step("Open settings while in focus mode", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      await expect(appPage.locator(".settings-view")).toBeVisible();
    });

    await test.step("Return via Escape — focus mode is preserved", async () => {
      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".history-focus-pane")).toBeVisible();
      await expect(appPage.locator(".workspace")).not.toHaveClass(/history-layout/);
    });

    await test.step("Exit focus mode for cleanup", async () => {
      await appPage.locator('button[aria-label="Exit focus mode"]').click();
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
    });
  });
});
