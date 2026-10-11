#!/usr/bin/env node
// Verify-the-verifier: runs the behavior suites once per deliberate in-memory fault and requires the
// named checks to go red. Exit 0 only when every mutant is DETECTED *and* its child run was clean
// (exit 0, no signal/timeout, a matching report, complete cleanup). See README.md.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTATIONS } from "./patches.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD_TIMEOUT_MS = 8 * 60_000;
const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const names = wanted.length ? wanted : Object.keys(MUTATIONS);

/**
 * Judges one finished child run. Pure so the regression test can feed it the false-green shapes:
 * a child that prints DETECTED and then fails cleanup, crashes, times out or leaves no report.
 */
export function judgeMutantRun({ name, run, evidence, report, cleanup }) {
  const problems = [];
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (run.error) problems.push(`spawn error: ${run.error.message}`);
  if (run.signal) problems.push(`child killed by ${run.signal}`);
  if (run.status !== 0) problems.push(`child exit status ${run.status}`);
  if (!output.includes(`SENSITIVITY ${name}: DETECTED`))
    problems.push("child did not print DETECTED");
  if (!report) problems.push("report.json missing");
  else {
    if (report.meta?.mutation !== name) problems.push("report is for a different mutation");
    const byId = new Map(report.results.map((r) => [r.id, r.verdict]));
    for (const id of MUTATIONS[name].expectedRed) {
      if (byId.get(id) !== "FAIL")
        problems.push(`expected-red ${id} is ${byId.get(id) ?? "NOT_RUN"}`);
    }
  }
  if (!cleanup) problems.push("cleanup.json missing");
  else if (cleanup.complete !== true) problems.push("child cleanup incomplete");
  return { detected: problems.length === 0, problems, evidence };
}

function runMutant(name) {
  const run = spawnSync(process.execPath, [resolve(HERE, "run.mjs"), `--mutate=${name}`], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: CHILD_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const output = `${run.stdout}${run.stderr}`;
  const evidence = output.match(/evidence: (.+)/)?.[1] ?? null;
  const read = (file) => {
    const path = evidence && resolve(evidence, file);
    return path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  };
  const verdict = judgeMutantRun({
    name,
    run,
    evidence,
    report: read("report.json"),
    cleanup: read("cleanup.json"),
  });
  const redLines = output.split("\n").filter((line) => line.includes("expected-red"));
  console.log(
    `${verdict.detected ? "DETECTED  " : "UNDETECTED"} ${name}\n${redLines.join("\n")}` +
      (verdict.problems.length ? `\n  rejected: ${verdict.problems.join("; ")}` : ""),
  );
  return {
    name,
    ...verdict,
    childStatus: run.status,
    childSignal: run.signal,
    node: process.version,
    expectedRed: MUTATIONS[name].expectedRed,
    redLines,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const unknown = names.filter((name) => !MUTATIONS[name]);
  if (unknown.length) {
    console.error(
      `unknown mutation(s): ${unknown.join(", ")}; known: ${Object.keys(MUTATIONS).join(", ")}`,
    );
    process.exit(2);
  }
  const rows = names.map(runMutant);
  const outDir = resolve(HERE, "evidence");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(outDir, `sensitivity-${stamp}.json`),
    JSON.stringify(
      { node: { version: process.version, execPath: process.execPath }, rows },
      null,
      2,
    ),
  );
  const missed = rows.filter((row) => !row.detected);
  console.log(`\n${rows.length - missed.length}/${rows.length} mutants detected`);
  process.exitCode = missed.length ? 1 : 0;
}
