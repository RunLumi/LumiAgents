// Regression tests for the proof harness's own false-green cases. Run with:
//   <node24> --test tests/lumi-ui-proof/regressions.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { judgeMutantRun } from "./sensitivity.mjs";
import { MUTATIONS } from "./patches.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = "reread-keeps-projection";
const detectedOutput = `SENSITIVITY ${NAME}: DETECTED\n`;
const goodReport = {
  meta: { mutation: NAME },
  results: MUTATIONS[NAME].expectedRed.map((id) => ({ id, verdict: "FAIL" })),
};
const clean = () => ({
  name: NAME,
  run: { status: 0, signal: null, stdout: detectedOutput, stderr: "" },
  evidence: "x",
  report: goodReport,
  cleanup: { complete: true },
});
const judge = (patch) => judgeMutantRun({ ...clean(), ...patch });

test("a clean detected mutant is accepted", () => {
  assert.equal(judge({}).detected, true);
});

test("DETECTED printed but child cleanup failed (exit 3) is rejected", () => {
  const v = judge({
    run: { status: 3, signal: null, stdout: detectedOutput, stderr: "" },
    cleanup: { complete: false },
  });
  assert.equal(v.detected, false);
  assert.match(v.problems.join(";"), /exit status 3/);
  assert.match(v.problems.join(";"), /cleanup incomplete/);
});

test("timeout, signal, spawn error, missing report or cleanup never count as detection", () => {
  for (const patch of [
    { run: { status: null, signal: "SIGKILL", stdout: detectedOutput, stderr: "" } },
    { run: { status: 0, error: new Error("ENOENT"), stdout: detectedOutput, stderr: "" } },
    { report: null },
    { cleanup: null },
    { run: { status: 1, signal: null, stdout: "build crash", stderr: "" }, report: null },
  ]) {
    assert.equal(judge(patch).detected, false, JSON.stringify(Object.keys(patch)));
  }
});

test("an expected-red claim that passed or never ran is rejected", () => {
  const [first] = MUTATIONS[NAME].expectedRed;
  const passed = {
    ...goodReport,
    results: goodReport.results.map((r) => (r.id === first ? { ...r, verdict: "PASS" } : r)),
  };
  const missing = { ...goodReport, results: goodReport.results.filter((r) => r.id !== first) };
  assert.equal(judge({ report: passed }).detected, false);
  assert.equal(judge({ report: missing }).detected, false);
  assert.equal(judge({ report: { ...goodReport, meta: { mutation: "other" } } }).detected, false);
});

const run = (...args) =>
  spawnSync(process.execPath, [resolve(HERE, "run.mjs"), ...args], { encoding: "utf8" });

test("an --only prefix matching no claim exits nonzero with a diagnostic and no browser", () => {
  const result = run("--only=nonexistent-proof-prefix");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /matches no claim/);
});

test("an unknown mutation exits nonzero", () => {
  assert.equal(run("--mutate=nope").status, 2);
});

test("a real selected claim still executes, records its subset scope and exits 0", () => {
  const result = run("--only=entry.restore-called-once");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /counts: \{"PASS":1\}/);
});

import { coverageGaps, staleFiles } from "./check-evidence.mjs";

test("evidence whose product or verifier hashes differ from disk is stale", () => {
  assert.deepEqual(staleFiles({ a: "1" }, { a: "1" }, "p"), []);
  assert.match(staleFiles({ a: "1" }, { a: "2" }, "p")[0], /a changed/);
  assert.match(staleFiles({}, { a: "2" }, "p")[0], /not recorded/);
  assert.match(staleFiles(undefined, { a: "2" }, "p")[0], /no hashes/);
});

import { CREDENTIAL_BEHAVIORS } from "./lib/credentialBehaviors.mjs";
import { ENTRY_BEHAVIORS } from "./lib/entryBehaviors.mjs";
import { KEYBOARD_CLAIM_IDS } from "./lib/keyboard.mjs";
import { STARTUP_BEHAVIORS, forbiddenHostCalls } from "./lib/startupBehaviors.mjs";
import { WORKSPACE_BEHAVIORS } from "./lib/workspaceBehaviors.mjs";

test("every mutant's expected-red claim names a real claim (no stale id can go 'undetected' silently)", () => {
  const ids = new Set(
    [...ENTRY_BEHAVIORS, ...WORKSPACE_BEHAVIORS, ...CREDENTIAL_BEHAVIORS, ...STARTUP_BEHAVIORS]
      .map((b) => b.id)
      .concat(KEYBOARD_CLAIM_IDS),
  );
  for (const [name, mutant] of Object.entries(MUTATIONS)) {
    for (const id of mutant.expectedRed) assert.ok(ids.has(id), `${name}: unknown claim ${id}`);
  }
});

test("startup claims have unique ids and each carries a surface and a host init", () => {
  const ids = STARTUP_BEHAVIORS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const b of STARTUP_BEHAVIORS) {
    assert.ok(["root", "welcome"].includes(b.surface), b.id);
    assert.ok(b.startup && Array.isArray(b.startup.providers), b.id);
  }
});

test("the forbidden-host-call classifier flags writes and not reads", () => {
  const call = (target, method) => ({ target, method });
  const bad = forbiddenHostCalls([
    call("credentialService", "save"),
    call("oauthService", "startLogin"),
    call("settingService", "update"),
    call("providerSettingsService", "create"),
    call("oauthService", "logout"),
  ]);
  assert.equal(bad.length, 5);
  const fine = forbiddenHostCalls([
    call("credentialService", "load"),
    call("oauthService", "getProviders"),
    call("settingService", "get"),
    call("providerSettingsService", "getView"),
    call("fileService", "ensureConversationWorkspace"),
  ]);
  assert.equal(fine.length, 0);
});

test("coverage across subset runs: a missing, failed or blocked claim is a gap, never inferred", () => {
  const rep = (...rows) => ({ results: rows.map(([id, verdict]) => ({ id, verdict })) });
  assert.deepEqual(coverageGaps([rep(["a", "PASS"]), rep(["b", "PASS"])], ["a", "b"]), []);
  assert.deepEqual(coverageGaps([rep(["a", "PASS"])], ["a", "b"]), ["b: not run"]);
  assert.deepEqual(coverageGaps([rep(["a", "FAIL"])], ["a"]), ["a: FAIL"]);
  assert.deepEqual(coverageGaps([rep(["a", "BLOCKED"]), rep(["a", "PASS"])], ["a"]), [
    "a: BLOCKED/PASS",
  ]);
});

test("claim ids are unique across suites", async () => {
  const { ALL_CLAIM_IDS } = await import("./lib/claimIds.mjs");
  assert.equal(new Set(ALL_CLAIM_IDS).size, ALL_CLAIM_IDS.length);
});
