import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Thrown by `expect`; distinguishes an assertion verdict from a harness crash in the report. */
export class ProofFailure extends Error {}

export function expect(condition, message) {
  if (!condition) throw new ProofFailure(message);
}

export function expectEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new ProofFailure(`${message}: expected ${e}, got ${a}`);
}

/**
 * Collects PASS/FAIL verdicts. A failing check never aborts the run, so one broken claim does not
 * hide the others; a harness exception is recorded as BLOCKED, never as PASS.
 */
export function createReport(meta, outDir) {
  mkdirSync(dirname(outDir), { recursive: true });
  // Non-recursive on the run directory itself: an existing run's evidence is never reused.
  mkdirSync(outDir, { recursive: false });
  const results = [];
  const screenshots = [];
  return {
    outDir,
    results: () => results,
    screenshot: async (page, name) => {
      mkdirSync(resolve(outDir, "screens"), { recursive: true });
      const path = `screens/${name}.png`;
      await page.screenshot({ path: resolve(outDir, path) });
      screenshots.push(path);
      return path;
    },
    async check(id, claim, run) {
      try {
        const evidence = await run();
        results.push({ id, claim, verdict: "PASS", evidence: evidence ?? "" });
      } catch (error) {
        const verdict = error instanceof ProofFailure ? "FAIL" : "BLOCKED";
        results.push({ id, claim, verdict, evidence: String(error?.message ?? error) });
      }
      const last = results.at(-1);
      console.log(
        `${last.verdict.padEnd(7)} ${id}  ${last.verdict === "PASS" ? "" : last.evidence}`,
      );
    },
    finish() {
      const counts = results.reduce(
        (acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }),
        {},
      );
      writeFileSync(
        resolve(outDir, "report.json"),
        JSON.stringify({ meta, counts, results, screenshots }, null, 2),
      );
      const rows = results
        .map(
          (r) =>
            `| ${r.verdict} | ${r.id} | ${r.claim} | ${String(r.evidence).replaceAll("|", "\\|").replaceAll("\n", " ")} |`,
        )
        .join("\n");
      writeFileSync(
        resolve(outDir, "REPORT.md"),
        `# Lumi UI proof run\n\n` +
          `- head: \`${meta.source.head}\` (${meta.source.branch}); worktree is dirty, so the file hashes in report.json pin the exact sources\n` +
          `- scope: ${meta.scope}\n- node: ${meta.node.version} (${meta.node.execPath})\n- browser: ${meta.browser}\n- started: ${meta.startedAt}\n- counts: ${JSON.stringify(counts)}\n- screenshots: ${screenshots.length}\n\n` +
          `Scope: React-rendered fixture over the real UI components with a synthetic \`lumiAccount\` bridge. ` +
          `It does not prove Electron, keychain, IPC, Main owner fences, or any backend.\n\n` +
          `| Verdict | Id | Claim | Evidence |\n| --- | --- | --- | --- |\n${rows}\n`,
      );
      return counts;
    },
  };
}
