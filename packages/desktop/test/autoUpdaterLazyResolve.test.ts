/* Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0. */
import { describe, expect, it, vi } from "vitest";

// Mirrors electron-updater on an unpackaged Linux launch: its `autoUpdater` getter constructs
// AppImageUpdater, which throws for the non-semver version an unpackaged app reports.
const { resolveAutoUpdater } = vi.hoisted(() => ({
  resolveAutoUpdater: vi.fn(() => {
    throw new Error('App version is not a valid semver version: "0.0"');
  }),
}));

vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.0", on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  Menu: { getApplicationMenu: () => null },
}));

vi.mock("electron-updater", () => ({
  CancellationToken: class {},
  Provider: class {},
  default: {
    get autoUpdater() {
      return resolveAutoUpdater();
    },
  },
}));

vi.mock("../src/main/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("autoUpdater resolution", () => {
  it("does not construct the platform updater when an unpackaged app imports or initializes it", async () => {
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    await expect(initAutoUpdater()).resolves.toBeUndefined();
    expect(resolveAutoUpdater).not.toHaveBeenCalled();
  });
});
