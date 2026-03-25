import { test, expect } from "../fixtures/app.fixture";
import { UI_PROVIDER_IDS } from "../helpers/providers";

test.describe("Provider Toggle Flow", () => {
  test("each enabled provider in settings opens disable dialog; cancel preserves state", async ({
    appPage,
  }) => {
    await test.step("Open settings", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      await expect(appPage.locator(".settings-view")).toBeVisible();
    });

    for (const provider of UI_PROVIDER_IDS) {
      await test.step(`Provider ${provider}: disable attempt shows dialog, cancel`, async () => {
        const label = appPage.locator(`label.settings-switch-${provider}`);
        if ((await label.count()) === 0) {
          return;
        }
        const checkbox = label.locator("input[type='checkbox']");
        if (!(await checkbox.isChecked())) {
          return;
        }

        await checkbox.click({ force: true });
        const dialog = appPage.locator("dialog[open].confirm-dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.locator(".confirm-dialog-title")).toContainText("Disable");

        await dialog.locator("button.tb-btn").first().click();
        await expect(dialog).not.toBeVisible();
        await expect(checkbox).toBeChecked();
      });
    }

    await test.step("Return to history", async () => {
      await appPage.keyboard.press("Escape");
    });
  });

  test("each project pane provider tag toggles active class when clicked", async ({
    appPage,
  }) => {
    const tags = appPage.locator(".project-pane button.tag");
    const tagCount = await tags.count();
    expect(tagCount).toBeGreaterThan(0);
    expect(tagCount).toBe(UI_PROVIDER_IDS.length);

    for (let i = 0; i < tagCount; i++) {
      const tag = tags.nth(i);
      await test.step(`Provider tag ${i + 1}/${tagCount}: toggle off and on`, async () => {
        const wasActive = await tag.evaluate((el) =>
          el.classList.contains("active"),
        );
        await tag.click();
        expect(
          await tag.evaluate((el) => el.classList.contains("active")),
        ).toBe(!wasActive);

        await tag.click();
        expect(
          await tag.evaluate((el) => el.classList.contains("active")),
        ).toBe(wasActive);
      });
    }
  });
});
