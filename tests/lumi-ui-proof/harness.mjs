import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  closeSync,
  readdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer as createNetServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { ProofFailure } from "./lib/report.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "../..");

const CHROME_CANDIDATES = [
  process.env.LUMI_UI_PROOF_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

/** UI sources under test; their hashes pin the evidence to the exact bytes that rendered. */
export const SOURCES_UNDER_TEST = [
  "packages/ui/src/lumi/LumiEntryPanel.tsx",
  "packages/ui/src/lumi/useLumiAccountFlow.ts",
  "packages/ui/src/lumi/lumiAccountFlow.ts",
  "packages/ui/src/lumi/lumiRestore.ts",
  "packages/ui/src/lumi/lumiErrorCopy.ts",
  "packages/ui/src/settings/LumiWorkspaceSection.tsx",
  "packages/ui/src/settings/LumiWorkspaceCredentialChoice.tsx",
  "packages/ui/src/styles.css",
  "packages/ui/src/i18n/locales/en-US.ts",
  "packages/ui/src/i18n/locales/zh-CN.ts",
];

const sha256 = (path) =>
  createHash("sha256")
    .update(readFileSync(resolve(REPO, path)))
    .digest("hex");

/** The verifier's own files (runner, harness, claims, patches, fixture); pinned beside the product hashes. */
export function harnessFiles() {
  const base = "tests/lumi-ui-proof";
  const list = (dir, ext) =>
    readdirSync(resolve(REPO, base, dir))
      .filter((name) => name.endsWith(ext))
      .map((name) => `${base}/${dir ? `${dir}/` : ""}${name}`);
  return [
    ...list("", ".mjs"),
    ...list("lib", ".mjs"),
    ...list("src", ".ts"),
    ...list("src", ".tsx"),
    `${base}/vite.config.ts`,
    `${base}/index.html`,
  ].sort();
}

export function sourceFingerprint() {
  const files = Object.fromEntries(SOURCES_UNDER_TEST.map((path) => [path, sha256(path)]));
  const harness = Object.fromEntries(harnessFiles().map((path) => [path, sha256(path)]));
  const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
  return {
    head: git("rev-parse", "HEAD"),
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    files,
    harness,
  };
}

function freePort() {
  return new Promise((done, fail) => {
    const probe = createNetServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

export async function startFixtureServer() {
  const server = await createServer({
    configFile: resolve(HERE, "vite.config.ts"),
    logLevel: "error",
    // Never collide with (or attach to) another tree's dev server.
    server: { port: await freePort(), strictPort: true },
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error("fixture server did not report a local URL");
  return { server, url: url.replace(/\/$/, "") };
}

/**
 * Chrome is started as an owned child with file-backed stdio and driven over CDP. With
 * `chromium.launch()` Chrome's updater/crashpad helpers inherit Playwright's stderr pipe, so
 * `browser.close()` cannot resolve until those helpers exit (~10 s after Chrome itself is gone).
 * Here nothing inherits a pipe we wait on, and exit is verified on the owned PID.
 */
export async function launchBrowser() {
  const executablePath = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!executablePath) throw new Error("No Chrome/Chromium found; set LUMI_UI_PROOF_CHROME.");
  // A fresh throwaway profile: no real personal profile, cookies or extensions.
  const profileDir = mkdtempSync(resolve(tmpdir(), "lumi-ui-proof-chrome-"));
  const log = openSync(resolve(profileDir, "chrome.log"), "a");
  const child = spawn(
    executablePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-crash-reporter",
      "--disable-breakpad",
      "about:blank",
    ],
    { stdio: ["ignore", log, log], detached: true },
  );
  closeSync(log);
  let exited = false;
  const exit = new Promise((done) =>
    child.once("exit", (code, signal) => {
      exited = true;
      done({ code, signal });
    }),
  );
  const portFile = resolve(profileDir, "DevToolsActivePort");
  const endpoint = await until(
    () => {
      if (exited) throw new Error("Chrome exited before opening its debugging port");
      return existsSync(portFile) ? readFileSync(portFile, "utf8").split("\n")[0] : "";
    },
    "chrome debugging port",
    15_000,
    { harnessError: true },
  ).then((port) => `http://127.0.0.1:${port}`);
  const browser = await chromium.connectOverCDP(endpoint);

  /** SIGTERM the owned process group and require a real exit; a SIGKILL fallback is a failure. */
  async function stop(graceMs = 5000) {
    if (exited) return { ...(await exit), forced: false };
    process.kill(-child.pid, "SIGTERM");
    const timer = new Promise((done) => setTimeout(() => done("timeout"), graceMs));
    const result = await Promise.race([exit, timer]);
    if (result !== "timeout") return { ...result, forced: false };
    process.kill(-child.pid, "SIGKILL");
    await exit;
    throw new Error(`Chrome pid ${child.pid} ignored SIGTERM for ${graceMs} ms; SIGKILLed`);
  }
  const removeProfile = () => rmSync(profileDir, { recursive: true, force: true });
  return {
    browser,
    executablePath,
    version: browser.version(),
    pid: child.pid,
    stop,
    removeProfile,
  };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Poll from Node so waiting still works while the page clock is faked. A timeout means the UI never
 * reached (or never left) the state the claim names, so it is a proof FAIL, not a harness error;
 * pass `harnessError: true` for waits that only gate the harness itself (fixture boot).
 */
export async function until(read, describe, timeoutMs = 8000, { harnessError = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) {
      const message = `timed out waiting for: ${describe}`;
      throw harnessError ? new Error(message) : new ProofFailure(message);
    }
    await sleep(40);
  }
}

/**
 * Opens one fixture page. The page clock is faked so the 5 s / 35 s UI timers can be crossed
 * without waiting; `t` formats real messages through the real Intl provider.
 */
export async function openFixture(browser, base, options) {
  const {
    surface,
    locale,
    width,
    height = 900,
    reducedMotion = false,
    forcedColors = false,
    startup,
    pauseClock = false,
    orgs = 1,
    auto = {},
  } = options;
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
    locale,
    forcedColors: forcedColors ? "active" : "none",
  });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    // Resource failures are reported with their URL below; the bare console line has none.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      problems.push(`console.error: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      problems.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  await page.clock.install({ time: new Date("2026-10-09T09:00:00Z") });
  // A running fake clock still tracks real time, so a slow first load could cross a 5 s timer by
  // itself. Startup claims pause it: only explicit `advance` moves time.
  if (pauseClock) await page.clock.pauseAt(new Date("2026-10-09T09:00:01Z"));
  await page.addInitScript(
    (init) => {
      window.__proofInit = init;
    },
    { auto, startup },
  );
  // A fixture page is single-document: any later navigation is a product-caused reload unless the
  // claim says it expects one (`allowNavigation`, used by the next-launch check).
  const navigations = [];
  let navigationAllowed = false;
  await page.goto(`${base}/?surface=${surface}&locale=${locale}&orgs=${orgs}`);
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && !navigationAllowed) navigations.push(frame.url());
  });

  const api = {
    page,
    problems,
    navigations,
    allowNavigation: () => {
      navigationAllowed = true;
    },
    close: () => context.close(),
    t: (id, values) =>
      page.evaluate(([i, v]) => (window.__startup ?? window.__proof).t(i, v), [id, values]),
    hostCalls: () => page.evaluate(() => window.__startup.hostCalls()),
    startupCompleted: () => page.evaluate(() => window.__startup.completed),
    hostOpens: () => page.evaluate(() => window.__startup.externalOpens),
    requestLogin: (provider) => page.evaluate((p) => window.__startup.requestLogin(p), provider),
    setZcodeUser: (user) => page.evaluate((u) => window.__startup.setZcodeUser(u), user),
    calls: () => page.evaluate(() => window.__proof.calls()),
    callsOf: async (key) => (await api.calls()).filter((call) => call.key === key),
    waitCall: (key, count = 1) =>
      until(
        async () => (await api.callsOf(key)).length >= count && (await api.callsOf(key)),
        `${count} '${key}' call(s)`,
      ),
    settle: (n, result) => page.evaluate(([i, r]) => window.__proof.settle(i, r), [n, result]),
    rejectCall: (n) => page.evaluate((i) => window.__proof.rejectCall(i), n),
    setAuto: (table) => page.evaluate((tbl) => window.__proof.setAuto(tbl), table),
    opens: () => page.evaluate(() => window.__proof.externalOpens),
    signedIn: () => page.evaluate(() => window.__proof.signedIn),
    advance: (ms) => page.clock.runFor(ms),
    overflow: () =>
      page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      })),
  };
  // The Intl probe installs `t` after first render; wait so callers can rely on real copy.
  await until(
    () =>
      page.evaluate(() => {
        const t = (window.__startup ?? window.__proof)?.t;
        return Boolean(t) && t("lumiEntry.continue") !== "lumiEntry.continue";
      }),
    "intl ready",
    8000,
    { harnessError: true },
  );
  return api;
}

const CLEANUP_STAGE_MS = 10_000;

/**
 * Runs each teardown stage with a bound and records which one (if any) did not finish. A stage that
 * rejects or times out makes `complete` false; the caller must turn that into a nonzero exit.
 */
export async function boundedCleanup(stages, limitMs = CLEANUP_STAGE_MS) {
  const rows = [];
  for (const [name, run] of stages) {
    const started = Date.now();
    let status = "ok";
    let timer;
    try {
      await Promise.race([
        run(),
        new Promise((_, fail) => {
          timer = setTimeout(() => fail(new Error(`timed out after ${limitMs} ms`)), limitMs);
        }),
      ]);
    } catch (error) {
      status = `FAILED: ${error?.message ?? error}`;
    } finally {
      clearTimeout(timer);
    }
    const row = { name, status, ms: Date.now() - started };
    console.log(`cleanup ${name}: ${status} (${row.ms} ms)`);
    rows.push(row);
  }
  return { complete: rows.every((row) => row.status === "ok"), stages: rows };
}
