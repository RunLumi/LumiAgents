// Lumi-specific regression checks. Run with the repository's pinned Node version:
// node --experimental-strip-types --test scripts/lumi-maintainer-credit.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCustomAboutDialogHtml } from "../packages/desktop/src/main/aboutWindow.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const about = read("packages/desktop/src/main/about.ts");
const legal = read("packages/desktop/src/main/licensesWindow.ts");
const rights = read("RIGHTS.md");
const rootPackage = JSON.parse(read("package.json"));
const desktopPackage = JSON.parse(read("packages/desktop/package.json"));
const company = "CLOUDJET SOLUTIONS PTE. LTD.";
const englishCredit = `Developed and maintained by ${company}`;
const chineseCredit = `由 ${company} 开发和维护。`;
const inheritedCopyright = "Copyright 2026 Z.AI Co., Ltd";
const baseInput = {
  applicationName: "Lumi Agents",
  appVersion: "0.0.0-test",
  optimizationLine: "",
  versionLabel: "version",
  okButtonLabel: "OK",
  licensesButtonLabel: "Credits and Licenses",
};

// These source-contract checks complement the actual HTML renderer tests below.
// They do not claim to launch Electron or validate a packaged installer.

test("Cloudjet stewardship is explicit without claiming an upstream transfer", () => {
  assert.ok(rights.includes("CLOUDJET SOLUTIONS PTE. LTD."));
  assert.ok(rights.includes("201708398E"));
  assert.ok(rights.includes("not a transfer of copyright"));
  assert.ok(rights.includes("Inherited ZCode material"));
  assert.ok(rights.includes(inheritedCopyright));
  assert.ok(rights.includes("only to the extent"));
});

test("package metadata names Cloudjet while the public license remains Apache-2.0", () => {
  assert.equal(rootPackage.author, company);
  assert.equal(desktopPackage.author, company);
  assert.equal(rootPackage.license, "Apache-2.0");
  assert.equal(rootPackage.name, "zcode");
});

test("English and Chinese product copy identifies the same maintainer", () => {
  assert.ok(about.includes(`maintainerCredit: "${englishCredit}"`));
  assert.ok(about.includes(`maintainerCredit: "${chineseCredit}"`));
});

test("About passes a maintainer credit rather than manufacturing a copyright", () => {
  assert.match(about, /maintainerCredit: aboutMessages\.maintainerCredit/);
  assert.doesNotMatch(about, /formatAboutCopyright|getFullYear\(/);
  assert.ok(about.includes(inheritedCopyright));
});

test("the primary panel displays the English maintainer credit", () => {
  const html = createCustomAboutDialogHtml({ ...baseInput, maintainerCredit: englishCredit });
  assert.ok(html.includes(englishCredit));
  assert.doesNotMatch(html, /Copyright|Z\.AI Co\., Ltd|undefined/);
});

test("the primary panel displays the Chinese maintainer credit", () => {
  const html = createCustomAboutDialogHtml({ ...baseInput, maintainerCredit: chineseCredit });
  assert.ok(html.includes(chineseCredit));
});

test("existing callers can still render a copyright notice", () => {
  const html = createCustomAboutDialogHtml({ ...baseInput, copyright: inheritedCopyright });
  assert.ok(html.includes(inheritedCopyright));
  assert.doesNotMatch(html, /undefined/);
});

test("a maintainer credit never suppresses an explicitly supplied copyright", () => {
  const html = createCustomAboutDialogHtml({
    ...baseInput,
    maintainerCredit: englishCredit,
    copyright: inheritedCopyright,
  });
  assert.ok(html.includes(englishCredit));
  assert.ok(html.includes(inheritedCopyright));
});

test("maintainer text is escaped, not interpreted as HTML", () => {
  const html = createCustomAboutDialogHtml({
    ...baseInput,
    maintainerCredit: `<img src=x onerror="alert('x')"> & maintainer`,
  });
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; maintainer"));
  assert.doesNotMatch(html, /<img src=x/);
});

test("optional attribution never renders undefined", () => {
  assert.doesNotMatch(createCustomAboutDialogHtml(baseInput), /undefined/);
});

test("Credits and Licenses retains the existing offline routing", () => {
  const html = createCustomAboutDialogHtml(baseInput);
  assert.ok(html.includes('id="licenses-button">Credits and Licenses</button>'));
  assert.ok(html.includes('window.open("zcode-about://licenses")'));
  assert.ok(about.includes('licensesButtonLabel: "Credits and Licenses"'));
  assert.ok(about.includes('licensesButtonLabel: "致谢与开源许可"'));
  assert.ok(about.includes("showLicensesWindow(aboutWindow, locale, ABOUT_APPLICATION_NAME)"));
});

test("the legal surface explicitly renders the original fixed-year copyright", () => {
  assert.ok(legal.includes(`const UPSTREAM_ZCODE_COPYRIGHT = "${inheritedCopyright}"`));
  assert.ok(legal.includes("escapeHtml(UPSTREAM_ZCODE_COPYRIGHT)"));
  assert.doesNotMatch(legal, /getFullYear\(/);
});

test("the legal surface identifies the maintainer without replacing other owners", () => {
  assert.ok(legal.includes(`Lumi Agents is developed and maintained by ${company}`));
  assert.ok(legal.includes(`Lumi Agents 由 ${company} 开发和维护。`));
  assert.ok(legal.includes("escapeHtml(messages.maintainerCredit)"));
  assert.ok(legal.includes("other contributors under their applicable licenses"));
});

test("independent-fork and non-official-distribution notices remain in both locales", () => {
  assert.ok(legal.includes("independent fork of ZCode, not an official ZCode or Z.AI distribution"));
  assert.ok(legal.includes("独立维护分支，不是 ZCode 或 Z.AI 的官方发行版"));
});

test("all existing packaged legal-material entries and escaping are preserved", () => {
  assert.match(legal, /LEGAL_NOTICES_FILE_NAME = "THIRD-PARTY-NOTICES\.md"/);
  assert.ok(legal.includes('[LEGAL_NOTICES_FILE_NAME, "LICENSE", "NOTICE.md"] as const'));
  assert.ok(legal.includes("escapeHtml(material.content)"));
  assert.ok(legal.includes('content="default-src \'none\''));
});

test("modified upstream source retains prominent modification notices", () => {
  for (const path of ["about.ts", "aboutWindow.ts"]) {
    assert.ok(read(`packages/desktop/src/main/${path}`).startsWith("// Modified for Lumi Agents"));
  }
});

test("the inherited Apache license and Z.AI notice are byte-for-byte unchanged", () => {
  const license = readFileSync(new URL("LICENSE", root));
  const blobHash = createHash("sha1")
    .update(`blob ${license.length}\0`)
    .update(license)
    .digest("hex");
  // Baseline blob at 143ed56ab15f638339685357f5537e5784b09214.
  assert.equal(blobHash, "550d8df4cfc74878663a511caa97852f15fd9592");
  assert.ok(license.toString("utf8").includes(inheritedCopyright));
});
