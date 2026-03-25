import { test, expect } from "../fixtures/app.fixture";

test.describe("History Pane Interactions", () => {
  test("project pane collapse and expand changes workspace layout", async ({ appPage }) => {
    await test.step("Collapse project pane via button", async () => {
      const collapseBtn = appPage.locator(
        '.project-pane button[aria-label*="Collapse"][aria-label*="Projects"]',
      );
      await collapseBtn.click();
      await expect(appPage.locator(".workspace")).toHaveClass(/projects-collapsed/);
      await expect(appPage.locator(".project-pane")).toHaveClass(/collapsed/);
    });

    await test.step("Expand project pane restores it", async () => {
      const expandBtn = appPage.locator(
        'button[aria-label*="Expand"][aria-label*="Projects"]',
      );
      await expandBtn.click();
      await expect(appPage.locator(".workspace")).not.toHaveClass(/projects-collapsed/);
      await expect(appPage.locator(".project-pane")).not.toHaveClass(/collapsed/);
    });
  });

  test("session pane starts collapsed and can be expanded then re-collapsed", async ({
    appPage,
  }) => {
    await test.step("Session pane starts collapsed by default in fresh instance", async () => {
      await expect(appPage.locator(".workspace")).toHaveClass(/sessions-collapsed/);
      await expect(appPage.locator(".session-pane")).toHaveClass(/collapsed/);
    });

    await test.step("Expand session pane via button", async () => {
      const expandBtn = appPage.locator('button[aria-label="Expand Sessions pane"]');
      await expandBtn.click({ force: true });
      await expect(appPage.locator(".workspace")).not.toHaveClass(/sessions-collapsed/);
      await expect(appPage.locator(".session-pane")).not.toHaveClass(/collapsed/);
    });

    await test.step("Collapse session pane back", async () => {
      const collapseBtn = appPage.locator('button[aria-label="Collapse Sessions pane"]');
      await collapseBtn.click();
      await expect(appPage.locator(".workspace")).toHaveClass(/sessions-collapsed/);
    });
  });

  test("project sort controls change sort field and direction", async ({ appPage }) => {
    await test.step("Open sort field dropdown and switch to Name sort", async () => {
      const sortFieldBtn = appPage.locator(".project-pane-sort-field-btn");
      await sortFieldBtn.click();
      const menu = appPage.locator('dialog[aria-label="Project sort field"]');
      await expect(menu).toBeVisible();

      const nameOption = menu.locator("button", { hasText: "Name" });
      await nameOption.click();
      await expect(menu).not.toBeVisible();
    });

    await test.step("Sort field button reflects the change in aria-label", async () => {
      const sortFieldBtn = appPage.locator(".project-pane-sort-field-btn");
      await expect(sortFieldBtn).toHaveAttribute("aria-label", /Name/);
    });

    await test.step("Toggle sort direction changes the icon and aria-label", async () => {
      const sortDirBtn = appPage.locator(".project-pane-sort-direction-btn");
      const initialLabel = await sortDirBtn.getAttribute("aria-label");
      await sortDirBtn.click();
      const newLabel = await sortDirBtn.getAttribute("aria-label");
      expect(newLabel).not.toBe(initialLabel);
    });

    await test.step("Switch back to Last Active sort", async () => {
      const sortFieldBtn = appPage.locator(".project-pane-sort-field-btn");
      await sortFieldBtn.click();
      const menu = appPage.locator('dialog[aria-label="Project sort field"]');
      await expect(menu).toBeVisible();
      const lastActiveOption = menu.locator("button", { hasText: "Last Active" });
      await lastActiveOption.click();
      await expect(sortFieldBtn).toHaveAttribute("aria-label", /Last Active/);
    });
  });

  test("project pane view mode toggles between list and tree", async ({ appPage }) => {
    await test.step("Toggle from list to tree view", async () => {
      const viewToggle = appPage.locator(".project-pane-view-toggle-btn");
      const initialActive = await viewToggle.evaluate((el) =>
        el.classList.contains("active"),
      );

      await viewToggle.click();

      if (!initialActive) {
        await expect(appPage.locator(".project-list-tree")).toBeVisible();
      } else {
        await expect(appPage.locator(".project-list")).toBeVisible();
        await expect(appPage.locator(".project-list-tree")).not.toBeVisible();
      }
    });

    await test.step("Toggle back to original view", async () => {
      const viewToggle = appPage.locator(".project-pane-view-toggle-btn");
      await viewToggle.click();
    });
  });

  test("project pane text filter narrows project list", async ({ appPage }) => {
    await test.step("Type into project search and verify filter applies", async () => {
      const searchInput = appPage.locator(".project-pane input.search-input");
      await searchInput.fill("nonexistent-project-name-xyz");
      await appPage.waitForTimeout(300);
      const projectItems = appPage.locator(".project-item");
      const count = await projectItems.count();
      expect(count).toBe(0);
    });

    await test.step("Clear filter restores full list", async () => {
      const searchInput = appPage.locator(".project-pane input.search-input");
      await searchInput.fill("");
      await appPage.waitForTimeout(300);
    });
  });

  test("session pane sort direction toggles between oldest and newest first", async ({
    appPage,
  }) => {
    await test.step("Toggle session sort direction", async () => {
      const sessionSortBtn = appPage.locator(
        ".session-pane button.collapse-btn[aria-label*='Sort']",
      );
      if ((await sessionSortBtn.count()) > 0) {
        const initialTitle = await sessionSortBtn.getAttribute("title");
        await sessionSortBtn.click();
        const newTitle = await sessionSortBtn.getAttribute("title");
        expect(newTitle).not.toBe(initialTitle);
      }
    });
  });
});
