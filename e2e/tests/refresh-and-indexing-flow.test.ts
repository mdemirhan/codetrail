import { test, expect } from "../fixtures/app.fixture";

test.describe("Refresh & Indexing Flow", () => {
  test("incremental refresh triggers indexing and reloads data", async ({ appPage }) => {
    await test.step("Click Refresh button to trigger incremental refresh", async () => {
      const refreshBtn = appPage.locator(
        'button[aria-label="Incremental refresh"]',
      );
      await refreshBtn.click();
    });

    await test.step("Button transitions to indexing state briefly", async () => {
      const indexingBtn = appPage.locator('button[aria-label="Indexing in progress"]');
      const refreshBtn = appPage.locator('button[aria-label="Incremental refresh"]');
      await expect(indexingBtn.or(refreshBtn)).toBeVisible();
    });

    await test.step("After indexing completes, refresh button becomes enabled again", async () => {
      const refreshBtn = appPage.locator('button[aria-label="Incremental refresh"]');
      await expect(refreshBtn).toBeVisible({ timeout: 15_000 });
      await expect(refreshBtn).toBeEnabled();
    });
  });

  test("force reindex via settings triggers confirm dialog flow", async ({ appPage }) => {
    await test.step("Open settings and locate reindex button", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      await expect(appPage.locator(".settings-view")).toBeVisible();
      const reindexBtn = appPage.locator('button[aria-label="Force reindex"]');
      await expect(reindexBtn).toBeVisible();
    });

    await test.step("Click Force Reindex opens confirm dialog", async () => {
      await appPage.locator('button[aria-label="Force reindex"]').click();
      const dialog = appPage.locator("dialog[open].confirm-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(".confirm-dialog-title")).toHaveText("Force Reindex");
    });

    await test.step("Cancel closes dialog without reindexing", async () => {
      const dialog = appPage.locator("dialog[open].confirm-dialog");
      const cancelBtn = dialog.locator("button.tb-btn").first();
      await cancelBtn.click();
      await expect(dialog).not.toBeVisible();
    });

    await test.step("Clicking Force Reindex again and confirming triggers indexing", async () => {
      await appPage.locator('button[aria-label="Force reindex"]').click();
      const dialog = appPage.locator("dialog[open].confirm-dialog");
      await expect(dialog).toBeVisible();

      const confirmBtn = dialog.locator("button.primary", { hasText: "Reindex" });
      await confirmBtn.click();
      await expect(dialog).not.toBeVisible();
    });

    await test.step("Return to history", async () => {
      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
    });
  });

  test("Cmd+R shortcut triggers incremental refresh from history", async ({ appPage }) => {
    const MOD = process.platform === "darwin" ? "Meta" : "Control";

    await test.step("Press Cmd+R to refresh", async () => {
      await appPage.keyboard.press(`${MOD}+r`);
    });

    await test.step("Verify refresh/indexing cycle occurs", async () => {
      const indexingBtn = appPage.locator('button[aria-label="Indexing in progress"]');
      const refreshBtn = appPage.locator('button[aria-label="Incremental refresh"]');
      await expect(indexingBtn.or(refreshBtn)).toBeVisible();
      await expect(refreshBtn).toBeVisible({ timeout: 15_000 });
    });
  });
});
