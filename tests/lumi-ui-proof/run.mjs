#!/usr/bin/env node
// Lumi UI visual/behavior proof runner. See README.md for scope, ownership and limits.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  HERE,
  boundedCleanup,
  launchBrowser,
  openFixture,
  sourceFingerprint,
  startFixtureServer,
} from "./harness.mjs";
import { ALL_CLAIM_IDS } from "./lib/claimIds.mjs";
import { CREDENTIAL_BEHAVIORS } from "./lib/credentialBehaviors.mjs";
import { ENTRY_BEHAVIORS } from "./lib/entryBehaviors.mjs";
import { runForcedColorsCheck, runKeyboardChecks } from "./lib/keyboard.mjs";
import { ProofFailure, createReport, expect } from "./lib/report.mjs";
import { STARTUP_BEHAVIORS } from "./lib/startupBehaviors.mjs";
import { STATES } from "./lib/states.mjs";
import { MUTATIONS } from "./patches.mjs";
import { WORKSPACE_BEHAVIORS } from "./lib/workspaceBehaviors.mjs";

const LOCALES = ["en-US", "zh-CN"];
const WIDTHS = [320, 768, 1440];
// Must be set before the fixture server loads vite.config.ts.
const mutation = process.argv.find((arg) => arg.startsWith("--mutate="))?.slice(9);
if (mutation) process.env.LUMI_UI_PROOF_MUTATION = mutation;
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
// A mutant run only needs the behavior suites; keyboard/motion/matrix cannot see these faults.
const skipMatrix = process.argv.includes("--skip-matrix") || Boolean(mutation);
const wanted = (id) => !only || id.startsWith(only);
const suite = (prefix) => !only || only.startsWith(prefix) || prefix.startsWith(only);

// The proof is pinned to the repository's Node major (mise.toml); a shadowed toolchain is a harness error.
const REQUIRED_NODE_MAJOR = 24;
if (Number(process.versions.node.split(".")[0]) !== REQUIRED_NODE_MAJOR) {
  console.error(
    `lumi-ui-proof requires Node ${REQUIRED_NODE_MAJOR}; running ${process.version} at ${process.execPath}`,
  );
  process.exit(2);
}

/**
 * Fail closed on a selection that cannot execute a claim: an unknown mutant, or an `--only` prefix
 * matching nothing, would otherwise finish with counts {} and exit 0 (a green for missing proof).
 */
function validateSelection() {
  if (mutation && !MUTATIONS[mutation]) {
    return `unknown mutation '${mutation}'; known: ${Object.keys(MUTATIONS).join(", ")}`;
  }
  const selectable = mutation
    ? ALL_CLAIM_IDS.filter((id) => !/^(motion|matrix)\./.test(id))
    : ALL_CLAIM_IDS;
  if (only !== undefined && !selectable.some(wanted)) {
    return `--only=${only} matches no claim; known ids: ${selectable.join(", ")}`;
  }
  return null;
}
const selectionError = validateSelection();
if (selectionError) {
  console.error(`lumi-ui-proof: ${selectionError}`);
  process.exit(2);
}

const source = sourceFingerprint();
const { server, url } = await startFixtureServer();
const chrome = await launchBrowser();
const { browser, executablePath, version } = chrome;
const startedAt = new Date().toISOString();
const runKind = mutation ? `-mutant-${mutation}` : "";
const runId = `${startedAt.replace(/[:.]/g, "-")}-${source.head.slice(0, 7)}${runKind}`;
const report = createReport(
  {
    startedAt,
    source,
    browser: `${version} (${executablePath})`,
    fixtureUrl: url,
    argv: process.argv.slice(2),
    // "full" certifies every claim; a subset records its prefix and can never certify the whole gate.
    scope: only === undefined ? (mutation ? "mutant-behaviors" : "full") : `subset:${only}`,
    chromePid: chrome.pid,
    node: { version: process.version, execPath: process.execPath },
    // Name of the in-memory deliberate fault, when this is a sensitivity (verify-the-verifier) run.
    mutation: mutation ?? null,
  },
  resolve(HERE, "evidence", runId),
);

/** Opens a fresh page, runs `fn`, then fails the check if the page logged errors or 4xx/5xx. */
async function withFixture(id, options, fn) {
  const fx = await openFixture(browser, url, options);
  try {
    const result = await fn(fx);
    expect(
      fx.navigations.length === 0,
      `page navigated unexpectedly to ${fx.navigations.join(", ")}`,
    );
    // No tolerance list: every console error and page error is a verdict, in the shell too.
    expect(fx.problems.length === 0, `page problems: ${fx.problems.join(" | ")}`);
    return result;
  } catch (error) {
    await report.screenshot(fx.page, `FAILED__${id}`).catch(() => undefined);
    // A product-caused reload destroys the page context mid-claim; that is a verdict, not a harness error.
    if (
      fx.navigations.length > 0 &&
      /Execution context was destroyed/.test(String(error?.message))
    ) {
      throw new ProofFailure(`page navigated unexpectedly to ${fx.navigations.join(", ")}`);
    }
    throw error;
  } finally {
    await fx.close();
  }
}

/**
 * Elements whose box leaves the viewport. The shared stylesheet clips `#root`, so document
 * scrollWidth stays equal to clientWidth while content is cut off; the real signal is geometry.
 */
const outOfBounds = (page, width) =>
  page.evaluate((limit) => {
    const bad = [];
    for (const el of document.querySelectorAll("main *")) {
      if (el.tagName === "OPTION" || el.closest("svg")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.left < -0.5 || r.right > limit + 0.5)) {
        bad.push(
          `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}:${el.textContent?.trim().slice(0, 20)}`,
        );
      }
    }
    return bad.slice(0, 4);
  }, width);

async function runBehaviors(surface, behaviors) {
  for (const behavior of behaviors.filter((b) => wanted(b.id))) {
    await report.check(behavior.id, behavior.claim, () =>
      withFixture(
        behavior.id,
        { surface, locale: "en-US", width: 768, auto: behavior.auto },
        behavior.run,
      ),
    );
  }
}

/** Startup claims mount the real Root / WelcomeScreen; each names its own surface and host init. */
async function runStartupBehaviors(isWanted) {
  for (const behavior of STARTUP_BEHAVIORS.filter((b) => isWanted(b.id))) {
    await report.check(behavior.id, behavior.claim, () =>
      withFixture(
        behavior.id,
        {
          surface: behavior.surface,
          locale: "en-US",
          width: 768,
          auto: behavior.auto,
          startup: behavior.startup,
          pauseClock: true,
        },
        behavior.run,
      ),
    );
  }
}

async function runMatrix() {
  for (const state of STATES.filter((s) => wanted(`matrix.${s.id}`))) {
    await report.check(
      `matrix.${state.id}`,
      `${state.id}: renders in EN+ZH at 320/768/1440 with no overflow, clipped controls, raw message ids or page errors`,
      async () => {
        const shots = [];
        const failures = [];
        // Every viewport/locale is attempted so one failing width cannot hide the others.
        for (const locale of LOCALES) {
          for (const width of WIDTHS) {
            const label = `${state.id}__${locale}__${width}`;
            try {
              await withFixture(
                label,
                { surface: state.surface, locale, width, auto: state.auto, startup: state.startup },
                async (fx) => {
                  await state.drive(fx);
                  shots.push(await report.screenshot(fx.page, label));
                  const { scrollWidth, clientWidth } = await fx.overflow();
                  expect(
                    scrollWidth <= clientWidth,
                    `horizontal overflow ${scrollWidth}>${clientWidth}`,
                  );
                  const clipped = await outOfBounds(fx.page, width);
                  expect(
                    clipped.length === 0,
                    `content outside the viewport: ${clipped.join(", ")}`,
                  );
                  const text = await fx.page.locator("main").innerText();
                  expect(
                    !/lumi(Entry|Workspace|Error|Account)\./.test(text),
                    "raw message id rendered",
                  );
                },
              );
            } catch (error) {
              if (!(error instanceof ProofFailure)) throw error;
              failures.push(`${locale}@${width}: ${error.message}`);
            }
          }
        }
        expect(failures.length === 0, failures.join(" || "));
        return `${shots.length} screenshots`;
      },
    );
  }
}

async function runReducedMotion() {
  const spinnerAnimation = (fx) =>
    fx.page.evaluate(() => {
      const spinner = document.querySelector("svg.animate-spin, svg[class*='animate-spin']");
      return spinner ? getComputedStyle(spinner).animationName : "NO_SPINNER";
    });
  const cases = [
    ["entry", "entry-restoring"],
    ["workspace", "workspace-loading"],
  ];
  for (const [surface, stateId] of cases) {
    const state = STATES.find((s) => s.id === stateId);
    await report.check(
      `motion.${stateId}`,
      `${stateId}: spinner animates normally and is static under prefers-reduced-motion (positive control included)`,
      async () => {
        const normal = await withFixture(
          `${stateId}-motion`,
          { surface, locale: "en-US", width: 768, auto: state.auto },
          async (fx) => {
            await state.drive(fx);
            return spinnerAnimation(fx);
          },
        );
        const reduced = await withFixture(
          `${stateId}-reduced`,
          { surface, locale: "en-US", width: 768, auto: state.auto, reducedMotion: true },
          async (fx) => {
            await state.drive(fx);
            const name = await spinnerAnimation(fx);
            await report.screenshot(fx.page, `${stateId}__reduced-motion__768`);
            return name;
          },
        );
        expect(
          normal !== "none" && normal !== "NO_SPINNER",
          `control: spinner should animate, got ${normal}`,
        );
        expect(reduced === "none", `reduced motion: expected animation-name none, got ${reduced}`);
        return `normal=${normal}, reduced=${reduced}`;
      },
    );
  }
}

/**
 * A mutant run passes only if every check named in `expectedRed` is FAIL (not BLOCKED, not PASS):
 * a build error or a probe that never ran is not a detected product fault.
 */
function sensitivityVerdict() {
  const { expectedRed } = MUTATIONS[mutation];
  const byId = new Map(report.results().map((r) => [r.id, r]));
  const rows = expectedRed.map((id) => ({
    id,
    verdict: byId.get(id)?.verdict ?? "NOT_RUN",
    why: byId.get(id)?.evidence,
  }));
  const detected = rows.every((row) => row.verdict === "FAIL");
  for (const row of rows)
    console.log(`  expected-red ${row.id}: ${row.verdict}${row.why ? ` — ${row.why}` : ""}`);
  console.log(`SENSITIVITY ${mutation}: ${detected ? "DETECTED" : "UNDETECTED"}`);
  return detected;
}

let crashed;
try {
  if (suite("entry.")) await runBehaviors("entry", ENTRY_BEHAVIORS);
  if (suite("workspace.")) {
    await runBehaviors("workspace", [...WORKSPACE_BEHAVIORS, ...CREDENTIAL_BEHAVIORS]);
  }
  if (suite("startup.")) {
    // Mutants only run the startup claims they name, like the keyboard claims below.
    await runStartupBehaviors((id) =>
      mutation ? MUTATIONS[mutation].expectedRed.includes(id) : wanted(id),
    );
  }
  if (suite("keyboard.")) {
    // Mutants only run the keyboard claims they name; a clean run runs every selected one.
    const keyboardWanted = (id) =>
      mutation ? MUTATIONS[mutation].expectedRed.includes(id) : wanted(id);
    if (!mutation || MUTATIONS[mutation].expectedRed.some((id) => id.startsWith("keyboard."))) {
      await runKeyboardChecks({ report, withFixture, LOCALES, WIDTHS, wanted: keyboardWanted });
      await runForcedColorsCheck({ report, withFixture, wanted: keyboardWanted });
    }
  }
  if (!mutation && suite("motion.")) await runReducedMotion();
  if (!skipMatrix && suite("matrix.")) await runMatrix();
} catch (error) {
  // A harness crash must never be masked by the checks that happened to pass before it.
  crashed = error;
  console.error(`HARNESS CRASH: ${error?.stack ?? error}`);
} finally {
  const detected = mutation ? sensitivityVerdict() : undefined;
  const counts = report.finish();
  const cleanup = await boundedCleanup([
    ["browser.disconnect", () => browser.close()],
    ["chrome.exit", () => chrome.stop()],
    ["chrome.profile-removed", async () => chrome.removeProfile()],
    ["server.close", () => server.close()],
  ]);
  writeFileSync(resolve(report.outDir, "cleanup.json"), JSON.stringify(cleanup, null, 2));
  console.log(`\nevidence: ${report.outDir}\ncounts: ${JSON.stringify(counts)}`);
  const executed = report.results().length;
  const failing = (counts.FAIL ?? 0) + (counts.BLOCKED ?? 0) > 0;
  // A mutant is expected to fail checks; the run succeeds only when the fault was detected.
  let code = mutation ? (detected ? 0 : 1) : failing ? 1 : 0;
  if (crashed) code = 1;
  if (executed === 0) {
    console.error("NO CLAIMS EXECUTED: a run that proved nothing is not a pass");
    code = 4;
  }
  // Incomplete cleanup is a harness failure, never hidden by the verdict; leaked handles would
  // otherwise keep the process alive, so exit explicitly (nonzero) once it is recorded.
  if (!cleanup.complete) {
    console.error(`CLEANUP INCOMPLETE: ${JSON.stringify(cleanup.stages)}`);
    code = 3;
  }
  process.exit(code);
}
