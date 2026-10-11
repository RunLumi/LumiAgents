#!/usr/bin/env node
// Confirms evidence reports were produced by the *current* product sources and verifier files.
// Usage: check-evidence.mjs <run-dir | sensitivity-*.json>...   Exit 1 on any mismatch/missing hash.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFingerprint } from "./harness.mjs";
import { ALL_CLAIM_IDS } from "./lib/claimIds.mjs";

const current = sourceFingerprint();

/** Differences between a report's pinned hashes and the files on disk now. */
export function staleFiles(reported, now, label) {
  if (!reported) return [`${label}: no hashes recorded`];
  const names = new Set([...Object.keys(reported), ...Object.keys(now)]);
  return [...names]
    .filter((name) => reported[name] !== now[name])
    .map((name) => `${label}: ${name} ${reported[name] ? "changed" : "not recorded"}`);
}

function runsOf(target) {
  if (target.endsWith(".json")) {
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    return (parsed.rows ?? parsed).map((row) => row.evidence).filter(Boolean);
  }
  return [resolve(target)];
}

/**
 * Whether the given (current, non-mutant) reports together PASS every claim: the union of subset runs
 * stands in for one full run when the machine is too slow to finish a single run. Missing, failed or
 * blocked claims are listed; nothing is inferred.
 */
export function coverageGaps(reports, allIds) {
  const verdicts = new Map();
  for (const report of reports) {
    for (const r of report.results) {
      verdicts.set(r.id, [...(verdicts.get(r.id) ?? []), r.verdict]);
    }
  }
  return allIds.flatMap((id) => {
    const seen = verdicts.get(id);
    if (!seen) return [`${id}: not run`];
    return seen.includes("PASS") && seen.every((v) => v === "PASS")
      ? []
      : [`${id}: ${seen.join("/")}`];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const coversAll = process.argv.includes("--covers-all");
  const targets = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (!targets.length) {
    console.error("usage: check-evidence.mjs <run-dir | sensitivity.json>...");
    process.exit(2);
  }
  let bad = 0;
  const reports = [];
  for (const dir of targets.flatMap(runsOf)) {
    const report = JSON.parse(readFileSync(resolve(dir, "report.json"), "utf8"));
    const { meta } = report;
    if (!meta.mutation) reports.push(report);
    const problems = [
      ...staleFiles(meta.source?.files, current.files, "product"),
      ...staleFiles(meta.source?.harness, current.harness, "harness"),
    ];
    console.log(
      `${problems.length ? "STALE" : "CURRENT"} ${dir}${problems.length ? `\n  ${problems.join("\n  ")}` : ""}`,
    );
    bad += problems.length ? 1 : 0;
  }
  if (coversAll) {
    const gaps = coverageGaps(reports, ALL_CLAIM_IDS);
    console.log(
      gaps.length
        ? `COVERAGE GAPS (${gaps.length} of ${ALL_CLAIM_IDS.length})\n  ${gaps.join("\n  ")}`
        : `COVERAGE COMPLETE: ${ALL_CLAIM_IDS.length} claims PASS across ${reports.length} current report(s)`,
    );
    bad += gaps.length ? 1 : 0;
  }
  process.exit(bad ? 1 : 0);
}
