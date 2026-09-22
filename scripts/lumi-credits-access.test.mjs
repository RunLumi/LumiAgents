// Lumi-specific access regressions. No Electron process or installer is exercised.
// Run: node --experimental-strip-types --test scripts/lumi-credits-access.test.mjs
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { after, test } from "node:test";
import { createCustomAboutDialogHtml } from "../packages/desktop/src/main/aboutWindow.ts";

// Import a byte-for-byte copy of the real module with only the locale package
// stubbed. File lookup and HTML rendering use production functions and real IO.
// Electron is dynamically imported only by showLicensesWindow, which is not called.
const fixture = mkdtempSync(join(tmpdir(), "lumi-credits-test-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
writeFileSync(join(fixture, "package.json"), JSON.stringify({ type: "module" }));
const shared = join(fixture, "node_modules/@zcode/shared");
mkdirSync(shared, { recursive: true });
writeFileSync(join(shared, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }));
writeFileSync(join(shared, "index.js"), 'export const DEFAULT_LOCALE = "zh-CN";\n');
copyFileSync(
  new URL("../packages/desktop/src/main/licensesWindow.ts", import.meta.url),
  join(fixture, "licensesWindow.ts"),
);
const { resolveLegalMaterialDirs, readLegalMaterials, createLicensesWindowHtml } = await import(
  pathToFileURL(join(fixture, "licensesWindow.ts")).href
);
const workspace = join(fixture, "checkout");
const moduleDir = join(workspace, "packages/desktop/out/main");
const resources = join(fixture, "resources");
mkdirSync(workspace, { recursive: true });
mkdirSync(resources, { recursive: true });
for (const file of ["LICENSE", "NOTICE.md", "THIRD-PARTY-NOTICES.md"]) {
  writeFileSync(join(workspace, file), `fixture: ${file}`);
}

test("development resolves the repository root, not the packages directory", () => {
  assert.deepEqual(
    resolveLegalMaterialDirs({ isPackaged: false, resourcesPath: resources, moduleDir }),
    [workspace],
  );
});

test("an explicit development workspace root takes precedence", () => {
  assert.deepEqual(
    resolveLegalMaterialDirs({
      isPackaged: false,
      resourcesPath: resources,
      moduleDir,
      workspaceRoot: workspace,
    }),
    [workspace],
  );
});

test("packaged lookup never falls back to an unrelated checkout", () => {
  const dirs = resolveLegalMaterialDirs({
    isPackaged: true,
    resourcesPath: resources,
    moduleDir,
    workspaceRoot: workspace,
  });
  assert.deepEqual(dirs, [resources]);
  assert.ok(readLegalMaterials(dirs).every((material) => material.content === null));
});

test("development reads all three legal files from the real fixture root", () => {
  const materials = readLegalMaterials(
    resolveLegalMaterialDirs({ isPackaged: false, resourcesPath: resources, moduleDir }),
  );
  assert.equal(materials.length, 3);
  for (const material of materials) {
    assert.equal(material.content, `fixture: ${material.fileName}`);
    assert.equal(material.path, join(workspace, material.fileName));
  }
});

test("the real legal renderer escapes materials and preserves both credits", () => {
  const html = createLicensesWindowHtml({
    applicationName: "Lumi Agents",
    locale: "en-US",
    materials: [{ fileName: "NOTICE.md", content: "<script>bad()</script>", path: null }],
  });
  assert.ok(html.includes("CLOUDJET SOLUTIONS PTE. LTD."));
  assert.ok(html.includes("Copyright 2026 Z.AI Co., Ltd"));
  assert.ok(html.includes("&lt;script&gt;bad()&lt;/script&gt;"));
  assert.ok(!html.includes("<script>bad()</script>"));
});

function aboutEvents() {
  const html = createCustomAboutDialogHtml({
    applicationName: "Lumi Agents",
    appVersion: "test",
    optimizationLine: "",
    versionLabel: "version",
    okButtonLabel: "OK",
    licensesButtonLabel: "Credits and Licenses",
  });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const callbacks = {};
  const calls = { closed: 0, opened: [] };
  runInNewContext(script, {
    document: {
      querySelector: () => ({ addEventListener: (_, fn) => { callbacks.ok = fn; } }),
      getElementById: () => ({ addEventListener: (_, fn) => { callbacks.credits = fn; } }),
    },
    window: {
      close: () => { calls.closed += 1; },
      open: (url) => { calls.opened.push(url); },
      addEventListener: (_, fn) => { callbacks.keydown = fn; },
    },
  });
  return { callbacks, calls };
}

test("Enter does not close About while activating the Credits button", () => {
  const { callbacks, calls } = aboutEvents();
  callbacks.keydown({ key: "Enter" });
  callbacks.credits();
  assert.equal(calls.closed, 0);
  assert.deepEqual(calls.opened, ["zcode-about://licenses"]);
});

test("Escape and the OK button still close About", () => {
  const { callbacks, calls } = aboutEvents();
  callbacks.keydown({ key: "Escape" });
  callbacks.ok();
  assert.equal(calls.closed, 2);
});

// Execute the actual CI predicate with fixture content, not a duplicated predicate.
const workflow = readFileSync(new URL("../.github/workflows/dco-license.yml", import.meta.url), "utf8");
const predicate = workflow.match(/node -e '([^\n]+)' \|\|/u)?.[1];
assert.ok(predicate, "The whitespace-tolerant trademark gate must remain wired in CI");
function trademarkGate(text) {
  let status = 0;
  runInNewContext(predicate, {
    require: (name) => {
      assert.equal(name, "node:fs");
      return { readFileSync: () => text };
    },
    process: { exit: (code) => { status = code; } },
  });
  return status;
}

test("the trademark gate accepts the corrected copyright/trademark declaration", () => {
  assert.equal(
    trademarkGate(
      "Apache copyright applies to covered files; it does **not**\n" +
        "grant trademark permission. This policy does **not** retract copyright permissions.",
    ),
    0,
  );
  assert.equal(
    trademarkGate(
      "it does **not**\r\n grant trademark permission; and does **not** retract copyright permissions",
    ),
    0,
  );
});

test("the trademark gate still rejects a missing copyright/trademark boundary", () => {
  assert.equal(trademarkGate("it does **not** grant trademark permission"), 1);
  assert.equal(trademarkGate("it does **not** retract copyright permissions"), 1);
});
