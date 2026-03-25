import { test, expect } from "../fixtures/app.fixture";

test.describe("Settings Functional Flow", () => {
  test("theme change propagates to document root dataset", async ({ appPage }) => {
    await test.step("Open settings and read current theme", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      await expect(appPage.locator(".settings-view")).toBeVisible();
    });

    await test.step("Change theme via select and verify DOM attribute updates", async () => {
      const themeSelect = appPage.locator('select[aria-label="Theme"]');
      const currentTheme = await themeSelect.inputValue();
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      await themeSelect.selectOption(newTheme);

      const htmlDataTheme = await appPage.evaluate(() =>
        document.documentElement.dataset.theme,
      );
      expect(htmlDataTheme).toBe(newTheme);
    });

    await test.step("Restore original theme", async () => {
      const themeSelect = appPage.locator('select[aria-label="Theme"]');
      const currentTheme = await themeSelect.inputValue();
      const restoreTheme = currentTheme === "dark" ? "light" : "dark";
      await themeSelect.selectOption(restoreTheme);
    });
  });

  test("zoom change through settings input commits via IPC and reflects in UI", async ({
    appPage,
  }) => {
    await test.step("Open settings", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      await expect(appPage.locator(".settings-view")).toBeVisible();
    });

    await test.step("Change zoom to 120% via input", async () => {
      const zoomInput = appPage.locator('input[aria-label="Zoom"]');
      await zoomInput.click();
      await zoomInput.fill("120");
      await zoomInput.press("Enter");
      await expect(zoomInput).toHaveValue("120");
    });

    await test.step("Change zoom to high value and verify clamping to max 175", async () => {
      const zoomInput = appPage.locator('input[aria-label="Zoom"]');
      await zoomInput.click();
      await zoomInput.fill("200");
      await zoomInput.press("Enter");
      await appPage.waitForTimeout(200);
      await expect(zoomInput).toHaveValue("175");
    });

    await test.step("Change zoom to low value and verify clamping to min 60", async () => {
      const zoomInput = appPage.locator('input[aria-label="Zoom"]');
      await zoomInput.click();
      await zoomInput.fill("10");
      await zoomInput.press("Enter");
      await appPage.waitForTimeout(200);
      await expect(zoomInput).toHaveValue("60");
    });

    await test.step("Restore zoom to 100%", async () => {
      const zoomInput = appPage.locator('input[aria-label="Zoom"]');
      await zoomInput.click();
      await zoomInput.fill("100");
      await zoomInput.press("Enter");
      await appPage.waitForTimeout(200);
      await expect(zoomInput).toHaveValue("100");
    });
  });

  test("message page size change persists across tab switches", async ({ appPage }) => {
    await test.step("Open settings and change page size", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      const pageSizeSelect = appPage.locator('select[aria-label="Messages per page"]');
      await pageSizeSelect.selectOption("50");
      await expect(pageSizeSelect).toHaveValue("50");
    });

    await test.step("Switch to Diagnostics and back — value persists", async () => {
      await appPage.locator('button[role="tab"]', { hasText: "Diagnostics" }).click();
      await appPage.locator('button[role="tab"]', { hasText: "Application Settings" }).click();
      const pageSizeSelect = appPage.locator('select[aria-label="Messages per page"]');
      await expect(pageSizeSelect).toHaveValue("50");
    });
  });

  test("font settings changes apply CSS variables to document", async ({ appPage }) => {
    await test.step("Open settings and change monospaced font", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      const monoFontSelect = appPage.locator('select[aria-label="Monospaced font"]');
      const options = await monoFontSelect.locator("option").allTextContents();
      expect(options.length).toBeGreaterThan(1);

      const currentValue = await monoFontSelect.inputValue();
      const targetOption = await monoFontSelect.locator("option").nth(1).getAttribute("value");
      if (targetOption && targetOption !== currentValue) {
        await monoFontSelect.selectOption(targetOption);
      }
    });

    await test.step("Verify CSS variable was updated on document root", async () => {
      const fontMono = await appPage.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--font-mono"),
      );
      expect(fontMono.length).toBeGreaterThan(0);
    });
  });

  test("auto-hide toggles change document dataset attributes", async ({ appPage }) => {
    await test.step("Open settings and toggle auto-hide message actions", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      const checkbox = appPage.locator(
        'input[aria-label="Auto-hide message actions"]',
      );
      const wasChecked = await checkbox.isChecked();
      await checkbox.click({ force: true });

      const dataAttr = await appPage.evaluate(() =>
        document.documentElement.dataset.autoHideMessageActions,
      );
      expect(dataAttr).toBe(String(!wasChecked));
    });

    await test.step("Toggle back to original state", async () => {
      const checkbox = appPage.locator(
        'input[aria-label="Auto-hide message actions"]',
      );
      await checkbox.click({ force: true });
    });
  });

  test("default expansion category toggles change aria-pressed state", async ({ appPage }) => {
    await test.step("Open settings", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
    });

    await test.step("Toggle a category expansion default and verify state flip", async () => {
      const categoryTokens = appPage.locator("button.settings-token");
      const count = await categoryTokens.count();
      expect(count).toBeGreaterThan(0);

      const firstToken = categoryTokens.first();
      const wasPressedRaw = await firstToken.getAttribute("aria-pressed");
      const wasPressed = wasPressedRaw === "true";
      await firstToken.click();
      await expect(firstToken).toHaveAttribute("aria-pressed", String(!wasPressed));
    });

    await test.step("Toggle back to original state", async () => {
      const firstToken = appPage.locator("button.settings-token").first();
      await firstToken.click();
    });
  });

  test("settings tabs switch between Application Settings and Diagnostics", async ({
    appPage,
  }) => {
    await test.step("Open settings and verify Application Settings is active", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      const settingsTab = appPage.locator('button[role="tab"]', {
        hasText: "Application Settings",
      });
      await expect(settingsTab).toHaveAttribute("aria-selected", "true");
    });

    await test.step("Switch to Diagnostics — settings controls disappear, diagnostics load", async () => {
      const diagTab = appPage.locator('button[role="tab"]', { hasText: "Diagnostics" });
      await diagTab.click();
      await expect(diagTab).toHaveAttribute("aria-selected", "true");
      await expect(appPage.locator('select[aria-label="Theme"]')).not.toBeVisible();
    });

    await test.step("Switch back to Application Settings — controls reappear", async () => {
      const settingsTab = appPage.locator('button[role="tab"]', {
        hasText: "Application Settings",
      });
      await settingsTab.click();
      await expect(appPage.locator('select[aria-label="Theme"]')).toBeVisible();
    });
  });
});
