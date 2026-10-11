import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AutomationRepo } from "./automationRepo.js";
import { AutomationManagedAdoptionError } from "./automationManagedAdoption.js";

const ORG = `org_${"a".repeat(32)}`;
const OTHER_ORG = `org_${"b".repeat(32)}`;
const MANAGED = `aut_${"c".repeat(32)}`;
const OTHER_MANAGED = `aut_${"d".repeat(32)}`;
const DUE = 1_000;
const NOW = 2_000;

test("scheduler expiration housekeeping cannot rewrite a suppressed original", async () => {
  await withRepo(async (repo) => {
    const now = Date.now();
    const row = await repo.create(
      {
        title: "bounded fixture",
        cronExpr: "* * * * *",
        prompt: "private fixture",
        workspacePath: "/tmp/ws",
        recurring: true,
        endAt: now + 1000,
      },
      { nextRunAt: now + 500 },
    );
    await repo.beginManagedAdoption({ localAutomationId: row.automationId, orgId: ORG, idempotencyKey: "preservation-control" });
    const before = JSON.stringify(await repo.get(row.automationId));
    assert.deepEqual(await repo.claimDue(now + 2000), []);
    assert.equal(JSON.stringify(await repo.get(row.automationId)), before);
    await repo.claimManualRuns(now + 2000);
    assert.equal(JSON.stringify(await repo.get(row.automationId)), before);
  });
});

async function withRepo(run: (repo: AutomationRepo, dbPath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "lumi-automation-adoption-"));
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

async function createDue(repo: AutomationRepo, title: string, workspacePath: string) {
  return repo.create(
    {
      title,
      cronExpr: "* * * * *",
      prompt: `secret prompt for ${title}`,
      workspacePath,
      recurring: true,
    },
    { nextRunAt: DUE },
  );
}

const refuses = (code: string) => (error: unknown) =>
  error instanceof AutomationManagedAdoptionError && error.code === code;

test("a marker suppresses local claiming without rewriting the original, and removal restores it", async () => {
  await withRepo(async (repo) => {
    const original = await createDue(repo, "adopted", "/tmp/ws-a");
    const unrelated = await createDue(repo, "unrelated", "/tmp/ws-b");
    const before = JSON.stringify(await repo.get(original.automationId));

    await repo.beginManagedAdoption({
      localAutomationId: original.automationId,
      orgId: ORG,
      idempotencyKey: "key-1",
    });
    const claimed = await repo.claimDue(NOW);
    assert.deepEqual(
      claimed.map((item) => item.automationId),
      [unrelated.automationId],
      "only the unmarked automation is claimable",
    );
    assert.equal(JSON.stringify(await repo.get(original.automationId)), before);

    await repo.releaseClaim(unrelated.automationId);
    await repo.beginManagedRelease(original.automationId);
    assert.deepEqual(
      (await repo.claimDue(NOW)).map((item) => item.automationId),
      [unrelated.automationId],
      "releasing still suppresses until the server confirmed the managed copy is off",
    );
    await repo.releaseClaim(unrelated.automationId);
    assert.equal(await repo.completeManagedRelease(original.automationId), true);

    const restored = await repo.claimDue(NOW);
    assert.deepEqual(
      restored.map((item) => item.automationId).sort(),
      [original.automationId, unrelated.automationId].sort(),
    );
    const again = restored.find((item) => item.automationId === original.automationId)!;
    assert.equal(again.nextRunAt, DUE, "the original schedule was never touched");
    assert.equal(again.prompt, original.prompt);
  });
});

test("manual runs of an adopted original are not claimable or startable locally", async () => {
  await withRepo(async (repo) => {
    const original = await createDue(repo, "adopted", "/tmp/ws-a");
    const manual = await repo.runNow(original.automationId, { now: NOW });
    assert.ok(manual, "an unmarked original can still run manually");
    await repo.releaseManualClaim(original.automationId, original.workspaceKey);

    await repo.beginManagedAdoption({
      localAutomationId: original.automationId,
      orgId: ORG,
      idempotencyKey: "key-1",
    });
    assert.equal(await repo.runNow(original.automationId, { now: NOW + 1 }), null);
    assert.deepEqual(await repo.claimManualRuns(NOW + 1), []);
  });
});

test("begin is idempotent, refuses a foreign organization, a missing original and a busy one", async () => {
  await withRepo(async (repo) => {
    const original = await createDue(repo, "adopted", "/tmp/ws-a");
    const first = await repo.beginManagedAdoption({
      localAutomationId: original.automationId,
      orgId: ORG,
      idempotencyKey: "key-1",
    });
    const replay = await repo.beginManagedAdoption({
      localAutomationId: original.automationId,
      orgId: ORG,
      idempotencyKey: "different-key-ignored",
    });
    assert.equal(replay.idempotencyKey, first.idempotencyKey, "the first key stays authoritative");
    assert.equal(first.correlation, `lumi-local:${original.automationId}`);
    await assert.rejects(
      repo.beginManagedAdoption({
        localAutomationId: original.automationId,
        orgId: OTHER_ORG,
        idempotencyKey: "key-2",
      }),
      refuses("automation_adoption_conflict"),
    );
    await assert.rejects(
      repo.beginManagedAdoption({
        localAutomationId: "automation-missing",
        orgId: ORG,
        idempotencyKey: "k",
      }),
      refuses("automation_adoption_not_found"),
    );

    const busy = await createDue(repo, "busy", "/tmp/ws-b");
    await repo.claimDue(NOW);
    await assert.rejects(
      repo.beginManagedAdoption({
        localAutomationId: busy.automationId,
        orgId: ORG,
        idempotencyKey: "k3",
      }),
      refuses("automation_adoption_busy"),
    );
  });
});

test("every crash window leaves the original suppressed and recoverable", async () => {
  await withRepo(async (repo, dbPath) => {
    const original = await createDue(repo, "adopted", "/tmp/ws-a");
    await repo.beginManagedAdoption({
      localAutomationId: original.automationId,
      orgId: ORG,
      idempotencyKey: "key-1",
    });
    // Crash after step A: a fresh process sees a suppressed marker with no managed id.
    repo.close();
    const reopened = new AutomationRepo(dbPath);
    try {
      const pending = await reopened.getManagedAdoption(original.automationId);
      assert.equal(pending?.state, "suppressed");
      assert.equal(pending?.managedAutomationId, null);
      assert.deepEqual(await reopened.claimDue(NOW), [], "neither scheduler runs it");

      // Recovery replays creation; recording is idempotent and refuses a second managed id.
      const recorded = await reopened.recordManagedAutomationCreated({
        localAutomationId: original.automationId,
        managedAutomationId: MANAGED,
      });
      assert.equal(recorded.state, "managed");
      await reopened.recordManagedAutomationCreated({
        localAutomationId: original.automationId,
        managedAutomationId: MANAGED,
      });
      await assert.rejects(
        reopened.recordManagedAutomationCreated({
          localAutomationId: original.automationId,
          managedAutomationId: OTHER_MANAGED,
        }),
        refuses("automation_adoption_conflict"),
      );
      assert.equal(
        (await reopened.getManagedAdoptionByManagedId(ORG, MANAGED))?.localAutomationId,
        original.automationId,
      );
      assert.equal(await reopened.getManagedAdoptionByManagedId(OTHER_ORG, MANAGED), null);
      await assert.rejects(
        reopened.completeManagedRelease(original.automationId),
        refuses("automation_adoption_state_invalid"),
        "a managed marker cannot be dropped without going through releasing",
      );
    } finally {
      reopened.close();
    }
  });
});

test("attach is one local transaction that suppresses the original and refuses every unsafe replay", async () => {
  await withRepo(async (repo) => {
    const original = await createDue(repo, "attached", "/tmp/ws-a");
    const rival = await createDue(repo, "rival", "/tmp/ws-b");
    const before = JSON.stringify(await repo.get(original.automationId));
    const input = {
      localAutomationId: original.automationId,
      orgId: ORG,
      managedAutomationId: MANAGED,
      idempotencyKey: "attach-1",
    };

    await assert.rejects(
      repo.beginManagedAttach({ ...input, expectedRevision: original.updatedAt + 1 }),
      refuses("automation_adoption_changed"),
    );
    await assert.rejects(
      repo.beginManagedAttach({ ...input, localAutomationId: "automation-gone" }),
      refuses("automation_adoption_not_found"),
    );
    assert.deepEqual(await repo.listManagedAdoptions(), [], "a refused attach writes nothing");

    const marker = await repo.beginManagedAttach({
      ...input,
      expectedRevision: original.updatedAt,
    });
    assert.equal(marker.origin, "attached");
    assert.equal(marker.state, "managed");
    assert.equal(marker.managedAutomationId, MANAGED);
    assert.equal(JSON.stringify(await repo.get(original.automationId)), before);
    assert.deepEqual(
      (await repo.claimDue(NOW)).map((item) => item.automationId),
      [rival.automationId],
      "only the unattached original is claimable locally",
    );
    await repo.releaseClaim(rival.automationId);

    assert.equal((await repo.beginManagedAttach(input)).localAutomationId, original.automationId);
    await assert.rejects(
      repo.beginManagedAttach({ ...input, managedAutomationId: OTHER_MANAGED }),
      refuses("automation_adoption_conflict"),
    );
    await assert.rejects(
      repo.beginManagedAttach({ ...input, orgId: OTHER_ORG }),
      refuses("automation_adoption_conflict"),
    );
    await assert.rejects(
      repo.beginManagedAttach({ ...input, localAutomationId: rival.automationId }),
      refuses("automation_adoption_conflict"),
      "one shared definition maps to one local original",
    );
    assert.equal(await repo.getManagedAdoption(rival.automationId), null);
  });
});

test("migration 0006 adds origin with the old default and rejects unknown origins", async () => {
  await withRepo(async (repo, dbPath) => {
    const original = await createDue(repo, "legacy", "/tmp/ws-a");
    const { DatabaseSync } = createRequire(import.meta.url)(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      const ids = (
        db.prepare("SELECT id FROM tasks_schema_migration ORDER BY id").all() as { id: string }[]
      ).map((row) => row.id);
      assert.ok(ids.includes("0006_automation_managed_attach"));
      // A build that predates 0006 inserts without the column; the row must read as `created`.
      db.prepare(
        `INSERT INTO automation_managed_adoptions
          (local_automation_id, org_id, managed_automation_id, state, idempotency_key, correlation, created_at, updated_at)
         VALUES (@id, @org, NULL, 'suppressed', 'k', 'lumi-local:x', 1, 1)`,
      ).run({ id: original.automationId, org: ORG });
      assert.throws(() =>
        db
          .prepare("UPDATE automation_managed_adoptions SET origin = 'shared' WHERE 1 = 1")
          .run(),
      );
    } finally {
      db.close();
    }
    assert.equal((await repo.getManagedAdoption(original.automationId))?.origin, "created");
  });
});

test("preview-style reads and an unmarked original never create or alter any marker", async () => {
  await withRepo(async (repo) => {
    const original = await createDue(repo, "adopted", "/tmp/ws-a");
    const before = JSON.stringify(await repo.get(original.automationId));
    assert.equal(await repo.getManagedAdoption(original.automationId), null);
    assert.deepEqual(await repo.listManagedAdoptions(), []);
    assert.equal(JSON.stringify(await repo.get(original.automationId)), before);
    assert.equal((await repo.claimDue(NOW)).length, 1);
  });
});
