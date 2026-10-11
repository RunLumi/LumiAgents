/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// spec 07「Downgrade compatibility guard / Managed occurrence journal / Mutation freshness」的真实 SQLite 证明。
// 旧客户端模拟：用「没有 marker 过滤」的 claim 语句（来自 marker 改动前的 claimDue/claimManualRuns/runNow，
// 仅去掉 NOT_MANAGED_ADOPTED_SQL 一行）直接打开同一个库文件；这是存储层证据，不是旧二进制的运行证据。
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AutomationManagedAdoptionError } from "./automationManagedAdoption.js";
import { AutomationRepo } from "./automationRepo.js";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

const ORG = `org_${"a".repeat(32)}`;
const MANAGED = `aut_${"c".repeat(32)}`;
const OCC = `occ_${"1".repeat(32)}`;
const OCC_2 = `occ_${"2".repeat(32)}`;
const RUN = `run_${"3".repeat(32)}`;
const DUE = 1_000;
const NOW = 2_000;

async function withRepo(run: (repo: AutomationRepo, dbPath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "lumi-automation-guard-"));
  const dbPath = join(directory, "tasks-index.sqlite");
  const repo = new AutomationRepo(dbPath);
  try {
    await repo.ensureReady();
    await run(repo, dbPath);
  } finally {
    repo.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function createDue(repo: AutomationRepo, title: string) {
  return repo.create(
    {
      title,
      cronExpr: "* * * * *",
      prompt: `private prompt of ${title}`,
      workspacePath: `/tmp/${title}`,
      recurring: true,
    },
    { nextRunAt: DUE },
  );
}

/** marker 之前的 claimDue 认领语句（逐字，无 marker 过滤）。 */
const OLD_CLAIM_DUE_UPDATE = `UPDATE automations
  SET running = 1, claimed_at = @now, dispatch_status = 'claimed', updated_at = @now
  WHERE automation_id = @id AND running = 0`;
/** marker 之前的 claimManualRuns / runNow 认领语句（逐字）。 */
const OLD_MANUAL_CLAIM_UPDATE = `UPDATE automations
  SET running = 1, claimed_at = @now, updated_at = @now
  WHERE automation_id = @id AND running = 0`;
const OLD_SELECT_DUE = `SELECT automation_id FROM automations
  WHERE enabled = 1 AND running = 0
    AND (retry_at IS NULL AND next_run_at IS NOT NULL AND next_run_at <= @now)`;

function readRow(dbPath: string, id: string) {
  const db = new DatabaseSync(dbPath);
  try {
    return db
      .prepare("SELECT running, claimed_at, updated_at FROM automations WHERE automation_id=?")
      .get(id);
  } finally {
    db.close();
  }
}

test("an older build that ignores the marker cannot claim an adopted original (positive control included)", async () => {
  await withRepo(async (repo, dbPath) => {
    const adopted = await createDue(repo, "adopted");
    const unrelated = await createDue(repo, "unrelated");
    await repo.beginManagedAdoption({
      localAutomationId: adopted.automationId,
      orgId: ORG,
      idempotencyKey: "guard-1",
    });
    const before = readRow(dbPath, adopted.automationId);

    const old = new DatabaseSync(dbPath);
    try {
      // 旧 SELECT 没有 marker 过滤：两条都「到期」，说明不是 selection 帮了忙。
      const selected = (
        old.prepare(OLD_SELECT_DUE).all({ now: NOW }) as { automation_id: string }[]
      )
        .map((row) => row.automation_id)
        .sort();
      assert.deepEqual(selected, [adopted.automationId, unrelated.automationId].sort());

      const control = old
        .prepare(OLD_CLAIM_DUE_UPDATE)
        .run({ id: unrelated.automationId, now: NOW });
      assert.equal(
        control.changes,
        1,
        "positive control: the old statement claims an unmarked row",
      );

      for (const sql of [OLD_CLAIM_DUE_UPDATE, OLD_MANUAL_CLAIM_UPDATE]) {
        const result = old.prepare(sql).run({ id: adopted.automationId, now: NOW });
        assert.equal(result.changes, 0, "the old claim becomes a silent no-op for an adopted row");
      }
    } finally {
      old.close();
    }
    assert.deepEqual(readRow(dbPath, adopted.automationId), before, "original row is unchanged");

    // 释放后（标记删除）同一条旧语句恢复认领：守卫可逆、不依赖任何对原任务的写入。
    await repo.beginManagedRelease(adopted.automationId);
    await repo.completeManagedRelease(adopted.automationId);
    const reopened = new DatabaseSync(dbPath);
    try {
      const restored = reopened
        .prepare(OLD_CLAIM_DUE_UPDATE)
        .run({ id: adopted.automationId, now: NOW });
      assert.equal(restored.changes, 1);
    } finally {
      reopened.close();
    }
  });
});

test("the guard is created by the migration ledger and recorded as 0005", async () => {
  await withRepo(async (_repo, dbPath) => {
    const db = new DatabaseSync(dbPath);
    try {
      const ids = (
        db.prepare("SELECT id FROM tasks_schema_migration ORDER BY id").all() as { id: string }[]
      ).map((row) => row.id);
      assert.ok(ids.includes("0004_automation_managed_adoption"));
      assert.ok(ids.includes("0005_automation_managed_guard"));
      assert.ok(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_automations_managed_claim_guard'",
          )
          .get(),
      );
    } finally {
      db.close();
    }
  });
});

test("adoption refuses a stale local revision even when edits share the same millisecond", async (t) => {
  t.mock.method(Date, "now", () => 2_000_000);
  await withRepo(async (repo) => {
    const original = await createDue(repo, "adopted");
    const seen = original.updatedAt;
    // 固定时钟复现：同毫秒编辑也必须使预览版本失效，不能靠测试 sleep 掩盖竞争。
    await repo.update(original.automationId, { title: "edited after preview" });
    await assert.rejects(
      repo.beginManagedAdoption({
        localAutomationId: original.automationId,
        orgId: ORG,
        idempotencyKey: "stale",
        expectedRevision: seen,
      }),
      (error: unknown) =>
        error instanceof AutomationManagedAdoptionError &&
        error.code === "automation_adoption_changed",
    );
    assert.equal(await repo.getManagedAdoption(original.automationId), null);

    const fresh = await repo.get(original.automationId);
    const marker = await repo.beginManagedAdoption({
      localAutomationId: original.automationId,
      orgId: ORG,
      idempotencyKey: "fresh",
      expectedRevision: fresh!.updatedAt,
    });
    assert.equal(marker.state, "suppressed");
  });
});

test("pause, resume and restart advance preview revisions even after wall-clock rollback", async (t) => {
  let clock = 2_000_000;
  t.mock.method(Date, "now", () => clock);
  await withRepo(async (repo) => {
    const original = await createDue(repo, "revision control");
    let revision = original.updatedAt;
    for (const edit of [
      () => repo.setEnabled(original.automationId, false),
      () => repo.setEnabled(original.automationId, true),
      () => repo.restart(original.automationId, { nextRunAt: DUE }),
      () => repo.update(original.automationId, { title: "changed after clock rollback" }),
    ]) {
      clock -= 1_000;
      await edit();
      const current = await repo.get(original.automationId);
      assert.ok(current!.updatedAt > revision);
      await assert.rejects(
        repo.beginManagedAdoption({
          localAutomationId: original.automationId,
          orgId: ORG,
          idempotencyKey: "stale-clock",
          expectedRevision: revision,
        }),
        (error: unknown) =>
          error instanceof AutomationManagedAdoptionError &&
          error.code === "automation_adoption_changed",
      );
      assert.equal(await repo.getManagedAdoption(original.automationId), null);
      revision = current!.updatedAt;
    }
  });
});

test("the occurrence journal only moves forward and never stores credentials", async () => {
  await withRepo(async (repo, dbPath) => {
    const original = await createDue(repo, "adopted");
    const base = {
      occurrenceId: OCC,
      orgId: ORG,
      localAutomationId: original.automationId,
      managedAutomationId: MANAGED,
    };
    const starting = await repo.recordManagedOccurrence({ ...base, state: "starting" });
    assert.equal(starting.state, "starting");
    assert.equal(
      (await repo.recordManagedOccurrence({ ...base, state: "starting" })).state,
      "starting",
    );
    const started = await repo.recordManagedOccurrence({ ...base, state: "started", runId: RUN });
    assert.equal(started.runId, RUN);
    await assert.rejects(repo.recordManagedOccurrence({ ...base, state: "starting" }));
    const settled = await repo.recordManagedOccurrence({ ...base, state: "settled" });
    assert.equal(settled.state, "settled");
    assert.equal(settled.runId, RUN, "run id survives later transitions");
    await assert.rejects(
      repo.recordManagedOccurrence({ ...base, state: "ambiguous", reason: "late" }),
    );

    await assert.rejects(
      repo.recordManagedOccurrence({ ...base, occurrenceId: OCC_2, state: "started", runId: RUN }),
      "a journal row must begin at starting",
    );
    await assert.rejects(
      repo.recordManagedOccurrence({
        ...base,
        occurrenceId: OCC_2,
        state: "starting",
        reason: "free text with spaces",
      }),
    );

    const db = new DatabaseSync(dbPath);
    try {
      const columns = (
        db.prepare("PRAGMA table_info(automation_managed_occurrences)").all() as { name: string }[]
      )
        .map((column) => column.name)
        .join(",");
      assert.doesNotMatch(columns, /token|prompt|secret|path|fence/);
    } finally {
      db.close();
    }
  });
});

test("restart converts every non-terminal journal row to ambiguous and never to a retry", async () => {
  await withRepo(async (repo) => {
    const original = await createDue(repo, "adopted");
    const base = {
      orgId: ORG,
      localAutomationId: original.automationId,
      managedAutomationId: MANAGED,
    };
    await repo.recordManagedOccurrence({ ...base, occurrenceId: OCC, state: "starting" });
    await repo.recordManagedOccurrence({ ...base, occurrenceId: OCC_2, state: "starting" });
    await repo.recordManagedOccurrence({
      ...base,
      occurrenceId: OCC_2,
      state: "started",
      runId: RUN,
    });
    await repo.recordManagedOccurrence({ ...base, occurrenceId: OCC_2, state: "settled" });

    const changed = await repo.markInterruptedManagedOccurrences("process_restarted");
    assert.deepEqual(
      changed.map((row) => row.occurrenceId),
      [OCC],
      "the settled row is terminal and untouched",
    );
    const rows = await repo.listManagedOccurrences({ orgId: ORG });
    assert.deepEqual(Object.fromEntries(rows.map((row) => [row.occurrenceId, row.state])), {
      [OCC]: "ambiguous",
      [OCC_2]: "settled",
    });
    assert.equal(rows.find((row) => row.occurrenceId === OCC)?.reason, "process_restarted");
    assert.deepEqual(await repo.markInterruptedManagedOccurrences("process_restarted"), []);
  });
});
