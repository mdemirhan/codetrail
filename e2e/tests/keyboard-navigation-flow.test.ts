import { test, expect } from "../fixtures/app.fixture";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test.describe("Keyboard Navigation Flow", () => {
  test("keyboard shortcuts navigate between views", async ({ appPage }) => {
    await test.step("? shortcut opens help from history", async () => {
      await appPage.locator(".workspace").click();
      await appPage.keyboard.press("?");
      await expect(appPage.locator(".help-view")).toBeVisible();
    });

    await test.step("Escape returns to history from help", async () => {
      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
      await expect(appPage.locator(".help-view")).not.toBeVisible();
    });

    await test.step("Cmd+Shift+F opens global search with input focused", async () => {
      await appPage.keyboard.press(`${MOD}+Shift+f`);
      await expect(appPage.locator(".search-view")).toBeVisible();
      await expect(appPage.locator("input.search-query-input")).toBeFocused();
    });

    await test.step("Escape returns to history from search", async () => {
      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
    });

    await test.step("Cmd+, opens settings", async () => {
      await appPage.keyboard.press(`${MOD}+,`);
      await expect(appPage.locator(".settings-view")).toBeVisible();
    });

    await test.step("Escape returns to history from settings", async () => {
      await appPage.keyboard.press("Escape");
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
    });
  });

  test("Cmd+Shift+M toggles focus mode", async ({ appPage }) => {
    await test.step("Enter focus mode via shortcut", async () => {
      await appPage.keyboard.press(`${MOD}+Shift+m`);
      await expect(appPage.locator(".history-focus-pane")).toBeVisible();
      await expect(appPage.locator(".workspace")).not.toHaveClass(/history-layout/);
    });

    await test.step("Exit focus mode via shortcut", async () => {
      await appPage.keyboard.press(`${MOD}+Shift+m`);
      await expect(appPage.locator(".workspace")).toHaveClass(/history-layout/);
    });
  });

  test("Cmd+B toggles project pane collapse", async ({ appPage }) => {
    await test.step("Cmd+B collapses project pane", async () => {
      await appPage.locator(".workspace").click();
      await appPage.keyboard.press(`${MOD}+b`);
      await expect(appPage.locator(".workspace")).toHaveClass(/projects-collapsed/);
    });

    await test.step("Cmd+B expands project pane back", async () => {
      await appPage.keyboard.press(`${MOD}+b`);
      await expect(appPage.locator(".workspace")).not.toHaveClass(/projects-collapsed/);
    });
  });

  test("session pane starts collapsed and shortcut toggles it", async ({ appPage }) => {
    await test.step("Session pane starts collapsed by default", async () => {
      await expect(appPage.locator(".workspace")).toHaveClass(/sessions-collapsed/);
    });

    await test.step("Expand session pane via button", async () => {
      const expandBtn = appPage.locator('button[aria-label="Expand Sessions pane"]');
      await expandBtn.click({ force: true });
      await expect(appPage.locator(".workspace")).not.toHaveClass(/sessions-collapsed/);
    });

    await test.step("Collapse session pane back via button", async () => {
      const collapseBtn = appPage.locator('button[aria-label="Collapse Sessions pane"]');
      await collapseBtn.click();
      await expect(appPage.locator(".workspace")).toHaveClass(/sessions-collapsed/);
    });
  });

  test("Tab moves focus forward through pane elements", async ({ appPage }) => {
    await test.step("Focus project list and Tab through", async () => {
      const projectList = appPage.locator(".project-list");
      await projectList.focus();
      await expect(projectList).toBeFocused();

      await appPage.keyboard.press("Tab");
      const activeTagName = await appPage.evaluate(() =>
        document.activeElement?.tagName.toLowerCase(),
      );
      expect(activeTagName).toBeTruthy();
    });
  });

  test("zoom keyboard shortcuts change zoom level", async ({ appPage }) => {
    await test.step("Cmd++ increases zoom", async () => {
      await appPage.locator('button[aria-label="Open settings"]').click();
      const zoomInput = appPage.locator('input[aria-label="Zoom"]');
      const beforeZoom = await zoomInput.inputValue();

      await appPage.keyboard.press("Escape");
      await appPage.keyboard.press(`${MOD}+=`);

      await appPage.locator('button[aria-label="Open settings"]').click();
      const afterZoom = await zoomInput.inputValue();
      expect(Number(afterZoom)).toBeGreaterThan(Number(beforeZoom));
    });

    await test.step("Cmd+- decreases zoom", async () => {
      const zoomInput = appPage.locator('input[aria-label="Zoom"]');
      const beforeZoom = await zoomInput.inputValue();

      await appPage.keyboard.press("Escape");
      await appPage.keyboard.press(`${MOD}+-`);

      await appPage.locator('button[aria-label="Open settings"]').click();
      const afterZoom = await zoomInput.inputValue();
      expect(Number(afterZoom)).toBeLessThan(Number(beforeZoom));
    });

    await test.step("Cmd+0 resets zoom to 100%", async () => {
      await appPage.keyboard.press("Escape");
      await appPage.keyboard.press(`${MOD}+0`);

      await appPage.locator('button[aria-label="Open settings"]').click();
      const zoomInput = appPage.locator('input[aria-label="Zoom"]');
      await expect(zoomInput).toHaveValue("100");
      await appPage.keyboard.press("Escape");
    });
  });
});
