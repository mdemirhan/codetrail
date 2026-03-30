import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/app.fixture";

function activePane(appPage: Page) {
  return appPage.locator('[data-pane-active="true"]').first();
}

test.describe("Pane Focus Controller Flow", () => {
  test("restores the last active pane when search, settings, and help close", async ({
    appPage,
  }) => {
    const currentPane = activePane(appPage);

    const expandSessionsButton = appPage.getByRole("button", { name: "Expand Sessions pane" });
    if (await expandSessionsButton.count()) {
      await expandSessionsButton.click({ force: true });
    }

    await test.step("Search restores the session pane", async () => {
      await appPage.locator(".session-pane .panel-header").click({ position: { x: 12, y: 12 } });
      await expect(currentPane).toHaveAttribute("data-history-pane", "session");

      await appPage.locator('.titlebar button[aria-label="Search"]').click();
      await expect(appPage.locator(".search-view")).toBeVisible();

      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".search-view")).toHaveCount(0);
      await expect(currentPane).toHaveAttribute("data-history-pane", "session");
      await expect(appPage.locator(".list-scroll.session-list")).toBeFocused();
    });

    await test.step("Settings restores the project pane", async () => {
      await appPage.locator(".project-pane .panel-header").click({ position: { x: 12, y: 12 } });
      await expect(currentPane).toHaveAttribute("data-history-pane", "project");

      await appPage.locator('.titlebar button[aria-label="Open settings"]').click();
      await expect(appPage.locator(".settings-view")).toBeVisible();

      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".settings-view")).toHaveCount(0);
      await expect(currentPane).toHaveAttribute("data-history-pane", "project");
      await expect(appPage.locator(".list-scroll.project-list")).toBeFocused();
    });

    await test.step("Help restores the message pane", async () => {
      await appPage.locator(".msg-scroll.message-list").focus();
      await expect(currentPane).toHaveAttribute("data-history-pane", "message");

      await appPage.locator('.titlebar button[aria-label="Open help"]').click();
      await expect(appPage.locator(".help-view")).toBeVisible();

      await appPage.getByRole("button", { name: "Return to history view" }).click();
      await expect(appPage.locator(".help-view")).toHaveCount(0);
      await expect(currentPane).toHaveAttribute("data-history-pane", "message");
      await expect(appPage.locator(".msg-scroll.message-list")).toBeFocused();
    });
  });

  test("preserves pane focus through pane chrome and overlay menus", async ({ appPage }) => {
    const currentPane = activePane(appPage);

    await test.step("Project pane chrome keeps the project pane active", async () => {
      await appPage.locator(".project-pane .panel-header").click({ position: { x: 12, y: 12 } });
      await expect(currentPane).toHaveAttribute("data-history-pane", "project");

      await appPage.locator(".project-pane .tag-row").click({ position: { x: 220, y: 10 } });
      await expect(currentPane).toHaveAttribute("data-history-pane", "project");

      await appPage.getByRole("button", { name: "Incremental refresh" }).click();
      await expect(currentPane).toHaveAttribute("data-history-pane", "project");
    });

    await test.step("Top bar and project dropdown overlays restore the prior pane", async () => {
      await appPage.locator(".project-pane-sort-field-btn").click();
      await expect(appPage.locator('dialog[aria-label="Project sort field"]')).toBeVisible();

      await appPage.locator(".project-pane-sort-field-btn").click();
      await expect(appPage.locator('dialog[aria-label="Project sort field"]')).toHaveCount(0);
      await expect(currentPane).toHaveAttribute("data-history-pane", "project");

      await appPage.locator('.titlebar button[aria-label="Choose theme"]').click();
      await expect(appPage.locator('[aria-label="Theme"]')).toBeVisible();

      await appPage.locator('.titlebar button[aria-label="Choose theme"]').click();
      await expect(appPage.locator('[aria-label="Theme"]')).toHaveCount(0);
      await expect(currentPane).toHaveAttribute("data-history-pane", "project");
    });

    await test.step("Session pane header keeps the session pane active", async () => {
      const expandSessionsButton = appPage.getByRole("button", { name: "Expand Sessions pane" });
      if (await expandSessionsButton.count()) {
        await expandSessionsButton.click({ force: true });
      }

      await appPage.locator(".session-pane .panel-header").click({ position: { x: 12, y: 12 } });
      await expect(currentPane).toHaveAttribute("data-history-pane", "session");
    });
  });
});
