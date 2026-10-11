import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getBootstrapHomeDir,
  getBootstrapSettingsFile,
  getDataBaseDir,
  setDataBaseDir,
} from "@zcode/services/node";
import { applyEarlyDataBaseDirBootstrap } from "./desktopDataBaseDirBootstrap.js";
import { applyEarlyChromiumHardwareAccelerationBootstrap } from "./desktopChromiumHardwareAccelerationBootstrap.js";

// 全部使用合成目录：fake OS HOME + 显式拥有的 profile 根，不读取任何真实个人文件。
interface Fixture {
  root: string;
  osHome: string;
  owned: string;
  otherRoot: string;
}

async function writeSettings(base: string, value: unknown): Promise<string> {
  const dir = join(base, ".zcode", "v2");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "setting.json");
  await writeFile(file, JSON.stringify(value), "utf-8");
  return file;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lumi-bootstrap-state-root-"));
  const fixture: Fixture = {
    root,
    osHome: join(root, "os-home"),
    owned: join(root, "owned-profile"),
    otherRoot: join(root, "synthetic-other-root"),
  };
  const savedEnv = { ...process.env };
  setDataBaseDir(null);
  try {
    await run(fixture);
  } finally {
    setDataBaseDir(null);
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
    await rm(root, { recursive: true, force: true });
  }
}

test("settings home precedence: explicit data root > desktop home > HOME > USERPROFILE", () => {
  assert.equal(
    getBootstrapHomeDir({
      ZCODE_DATA_BASE_DIR: " /owned ",
      ZCODE_DESKTOP_HOME_DIR: "/desktop",
      HOME: "/home",
    }),
    "/owned",
  );
  assert.equal(
    getBootstrapHomeDir({ ZCODE_DESKTOP_HOME_DIR: "/desktop", HOME: "/home" }),
    "/desktop",
  );
  assert.equal(getBootstrapHomeDir({ HOME: "/home", USERPROFILE: "/profile" }), "/home");
  assert.equal(getBootstrapHomeDir({ USERPROFILE: "/profile" }), "/profile");
  assert.equal(
    getBootstrapSettingsFile({ ZCODE_DATA_BASE_DIR: "/owned" }),
    join("/owned", ".zcode", "v2", "setting.json"),
  );
});

test("explicit ZCODE_DATA_BASE_DIR survives early bootstrap despite fake OS-home dataBaseDir", async () => {
  await withFixture(async ({ osHome, owned, otherRoot }) => {
    await writeSettings(osHome, { dataBaseDir: otherRoot });
    setDataBaseDir(owned);
    const env = { HOME: osHome, ZCODE_DATA_BASE_DIR: owned };

    const applied = applyEarlyDataBaseDirBootstrap(undefined, env);

    assert.equal(applied, null);
    assert.equal(getDataBaseDir(), owned);
  });
});

test("explicit root ignores a dataBaseDir even inside its own settings file", async () => {
  await withFixture(async ({ osHome, owned, otherRoot }) => {
    await writeSettings(owned, { dataBaseDir: otherRoot });
    setDataBaseDir(owned);

    const applied = applyEarlyDataBaseDirBootstrap(undefined, {
      HOME: osHome,
      ZCODE_DATA_BASE_DIR: owned,
    });

    assert.equal(applied, null);
    assert.equal(getDataBaseDir(), owned);
  });
});

test("positive control: installed behavior still applies the settings dataBaseDir from OS home", async () => {
  await withFixture(async ({ osHome, otherRoot }) => {
    await writeSettings(osHome, { dataBaseDir: otherRoot });

    const applied = applyEarlyDataBaseDirBootstrap(undefined, { HOME: osHome });

    assert.equal(applied, otherRoot);
    assert.equal(getDataBaseDir(), otherRoot);
  });
});

test("hardware-acceleration bootstrap reads the explicit root, not fake OS home", async () => {
  await withFixture(async ({ osHome, owned }) => {
    await writeSettings(osHome, { desktopChromiumHardwareAccelerationEnabled: false });
    await writeSettings(owned, { desktopChromiumHardwareAccelerationEnabled: true });
    process.env.HOME = osHome;
    process.env.ZCODE_DATA_BASE_DIR = owned;
    let disabled = 0;

    const enabled = applyEarlyChromiumHardwareAccelerationBootstrap({
      disableHardwareAcceleration: () => {
        disabled += 1;
      },
    });

    assert.equal(enabled, true);
    assert.equal(disabled, 0);
  });
});

test("hardware-acceleration positive control: installed behavior honours OS-home setting", async () => {
  await withFixture(async ({ osHome }) => {
    await writeSettings(osHome, { desktopChromiumHardwareAccelerationEnabled: false });
    process.env.HOME = osHome;
    delete process.env.ZCODE_DATA_BASE_DIR;
    delete process.env.ZCODE_DESKTOP_HOME_DIR;
    let disabled = 0;

    const enabled = applyEarlyChromiumHardwareAccelerationBootstrap({
      disableHardwareAcceleration: () => {
        disabled += 1;
      },
    });

    assert.equal(enabled, false);
    assert.equal(disabled, 1);
  });
});
