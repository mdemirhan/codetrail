import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  type ElectronApplication,
  type Page,
  type TestInfo,
  _electron,
  test as base,
} from "@playwright/test";

type AppFixtures = {
  electronApp: ElectronApplication;
  appPage: Page;
};

function resolveElectronBinary(): string {
  const electronDir = path.resolve(
    __dirname,
    "../../apps/desktop/node_modules/electron",
  );
  const binRelative = fs.readFileSync(path.join(electronDir, "path.txt"), "utf-8").trim();
  return path.join(electronDir, "dist", binRelative);
}

let testCounter = 0;

export const test = base.extend<AppFixtures>({
  electronApp: async ({}, use) => {
    const appDir = path.resolve(__dirname, "../../apps/desktop");
    const electronBin = resolveElectronBinary();
    const instanceId = `pw-${process.pid}-${++testCounter}-${crypto.randomBytes(4).toString("hex")}`;
    const isHeaded = process.env.HEADED === "1";

    const electronArgs = [appDir];
    if (!isHeaded) {
      electronArgs.push(
        "--disable-gpu",
        "--disable-software-rasterizer",
      );
    }

    const app = await _electron.launch({
      executablePath: electronBin,
      args: electronArgs,
      env: {
        ...process.env,
        CODETRAIL_INSTANCE: instanceId,
        ...(isHeaded ? {} : { ELECTRON_DISABLE_SANDBOX: "1" }),
      },
      cwd: appDir,
    });

    if (!isHeaded) {
      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.setPosition(-10000, -10000);
        }
      });
    }

    await use(app);
    await app.close();
  },

  appPage: async ({ electronApp }, use, testInfo) => {
    const page = await electronApp.firstWindow();
    await page.waitForSelector(".app-shell", { timeout: 30_000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector('.workspace[aria-busy="false"]', { timeout: 30_000 });

    const tracing = page.context().tracing;
    await tracing.start({ screenshots: true, snapshots: true, sources: true });

    await use(page);

    const failed = testInfo.status !== testInfo.expectedStatus;

    const tracePath = testInfo.outputPath("trace.zip");
    await tracing.stop({ path: tracePath });

    if (failed) {
      try {
        const screenshotPath = testInfo.outputPath("failure.png");
        await page.screenshot({ path: screenshotPath, type: "png" });
        await testInfo.attach("screenshot", {
          path: screenshotPath,
          contentType: "image/png",
        });
      } catch (err) {
        console.error("[fixture] Screenshot capture failed:", err);
      }

      await testInfo.attach("trace", {
        path: tracePath,
        contentType: "application/zip",
      });
    } else {
      fs.rmSync(tracePath, { force: true });
    }
  },
});

export { expect } from "@playwright/test";
