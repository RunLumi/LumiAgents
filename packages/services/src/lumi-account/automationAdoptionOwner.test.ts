import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AutomationRepo } from "../session/automationRepo.js";
import {
  AutomationAdoptionError,
  createAutomationAdoptionOwner,
  type AdoptionServerPort,
  type LocalAutomationMetadata,
} from "./automationAdoptionOwner.js";
import type { ManagedAutomationProjection } from "./automationAdoptionTransport.js";
import { LumiAccountError } from "./errors.js";

const hex = (letter: string) => letter.repeat(32);
const ORG = `org_${hex("a")}`;
const PROJECT = `prj_${hex("b")}`;
const AGENT = `agd_${hex("c")}`;
const BINDING = `wsb_${hex("d")}`;
const USER = `usr_${hex("e")}`;
const STATE = `wst_${hex("f")}`;
const NOW = Date.parse("2026-10-08T00:00:00Z");
const DUE = NOW - 1000;
const PROMPT = "SECRET PROMPT TEXT";
const SHARED_DEFINITION_FACTS = {
  name: "Shared nightly",
  scheduleKind: "cron",
  scheduleExpression: "0 9 * * 1-5",
  scheduleTimezone: "UTC",
  targetKind: "eligible_device",
  targetDeviceId: null,
  offPeak: false,
};

class FakeServer implements AdoptionServerPort {
  automations = new Map<string, ManagedAutomationProjection & { correlation: string }>();
  idempotency = new Map<string, string>();
  creates = 0;
  previews = 0;
  conflicts: { code: string; subject: string }[] = [];
  failNext: Partial<Record<"create" | "pause" | "delete", number>> = {};
  keepOnDelete = false;

  async previewImport(_org: string, input: { candidates: { local_key: string }[] }) {
    this.previews++;
    return {
      items: input.candidates.map((candidate) => ({
        localKey: candidate.local_key,
        importable: this.conflicts.length === 0,
        conflicts: this.conflicts,
      })),
      commitReady: this.conflicts.length === 0,
      modelCapabilityCheck: "deferred_to_dispatch",
      localAutomationsModified: false,
    };
  }

  #fail(operation: "create" | "pause" | "delete") {
    const remaining = this.failNext[operation] ?? 0;
    if (remaining > 0) {
      this.failNext[operation] = remaining - 1;
      throw new LumiAccountError("lumi_request_refused", 503);
    }
  }

  async createManaged(_org: string, body: { description: string }, key: string) {
    this.#fail("create");
    const replay = this.idempotency.get(key);
    if (replay) return this.automations.get(replay)!;
    this.creates++;
    const automationId = `aut_${String(this.creates).padStart(32, "0")}`;
    const row = {
      automationId,
      orgId: ORG,
      projectId: PROJECT,
      description: body.description,
      status: "active",
      version: 1,
      executionPrincipalKind: "user",
      executionPrincipalId: USER,
      workspaceBindingId: BINDING,
      ...SHARED_DEFINITION_FACTS,
      correlation: body.description,
    };
    this.automations.set(automationId, row);
    this.idempotency.set(key, automationId);
    return row;
  }

  async findManagedByCorrelation(_org: string, _project: string, correlation: string) {
    return [...this.automations.values()].find((item) => item.correlation === correlation) ?? null;
  }

  async getManaged(_org: string, automationId: string) {
    const row = this.automations.get(automationId);
    if (!row) throw new LumiAccountError("lumi_request_refused", 404);
    return row;
  }

  listings = 0;
  async listManagedForProject(_org: string, _project: string) {
    this.listings++;
    return [...this.automations.values()];
  }

  /** A definition created elsewhere (another device or the web console), not by this client. */
  seedShared(overrides: Partial<ManagedAutomationProjection> = {}) {
    const automationId = `aut_${String(this.automations.size + 100).padStart(32, "0")}`;
    const row = {
      automationId,
      orgId: ORG,
      projectId: PROJECT,
      description: null,
      status: "active",
      version: 4,
      executionPrincipalKind: "user",
      executionPrincipalId: USER,
      workspaceBindingId: null,
      ...SHARED_DEFINITION_FACTS,
      ...overrides,
      correlation: "none",
    };
    this.automations.set(automationId, row);
    return row;
  }

  async pauseManaged(_org: string, automationId: string) {
    this.#fail("pause");
    const row = await this.getManaged(ORG, automationId);
    const paused = { ...row, status: "paused", version: row.version + 1 };
    this.automations.set(automationId, paused);
    return paused;
  }

  async deleteManaged(_org: string, automationId: string) {
    this.#fail("delete");
    if (this.keepOnDelete) throw new LumiAccountError("lumi_automation_release_unconfirmed");
    this.automations.delete(automationId);
  }
}

async function harness(run: (h: Awaited<ReturnType<typeof create>>) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "lumi-adoption-owner-"));
  const repo = new AutomationRepo(join(directory, "tasks-index.sqlite"));
  await repo.ensureReady();
  try {
    await run(await create(repo));
  } finally {
    repo.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function create(repo: AutomationRepo) {
  const server = new FakeServer();
  const original = await repo.create(
    {
      title: "Nightly",
      cronExpr: "0 9 * * 1-5",
      prompt: PROMPT,
      workspacePath: "/tmp/ws",
      recurring: true,
    },
    { nextRunAt: DUE },
  );
  const failRecord = { remaining: 0 };
  const owner = createAutomationAdoptionOwner({
    server,
    context: {
      userId: async () => USER,
      resolveWorkspace: async () => ({
        projectId: PROJECT,
        workspaceBindingId: BINDING,
        adoptionStateId: STATE,
      }),
      timezone: () => "UTC",
      now: () => NOW,
    },
    local: {
      async readMetadata(id): Promise<LocalAutomationMetadata | null> {
        const row = await repo.get(id);
        if (!row) return null;
        const { prompt: _prompt, ...metadata } = row;
        return { ...metadata, revision: row.updatedAt };
      },
      getMarker: (id) => repo.getManagedAdoption(id),
      getMarkerByManagedId: (orgId, managedId) => repo.getManagedAdoptionByManagedId(orgId, managedId),
      beginAttach: (input) => repo.beginManagedAttach(input),
      beginAdoption: (input) => repo.beginManagedAdoption(input),
      async recordCreated(input) {
        if (failRecord.remaining-- > 0) throw new Error("simulated crash before step B");
        return repo.recordManagedAutomationCreated(input);
      },
      beginRelease: (id) => repo.beginManagedRelease(id),
      completeRelease: (id) => repo.completeManagedRelease(id),
    },
  });
  /** 谁会执行下一次触发：本地 scheduler 的真实 claimDue vs 服务端仍 active 且标记为 managed。 */
  async function whoRuns() {
    const localRuns = (await repo.claimDue(NOW)).some(
      (item) => item.automationId === original.automationId,
    );
    if (localRuns) await repo.releaseClaim(original.automationId);
    const marker = await repo.getManagedAdoption(original.automationId);
    const managedRuns =
      marker?.state === "managed" &&
      [...server.automations.values()].some(
        (item) => item.automationId === marker.managedAutomationId && item.status === "active",
      );
    assert.equal(localRuns && managedRuns, false, "both schedulers could run the same original");
    return { localRuns, managedRuns };
  }
  return { repo, server, owner, original, whoRuns, failRecord };
}

const adoptInput = (id: string) => ({
  orgId: ORG,
  localAutomationId: id,
  agentDefinitionId: AGENT,
  modelAlias: "coding-default",
  confirm: true,
});
const refuses = (code: string) => (error: unknown) =>
  error instanceof AutomationAdoptionError && error.code === code;

test("preview and cancel create nothing locally or remotely", async () => {
  await harness(async ({ repo, server, owner, original, whoRuns }) => {
    const before = JSON.stringify(await repo.get(original.automationId));
    const preview = await owner.preview({
      orgId: ORG,
      localAutomationIds: [original.automationId, "automation-gone"],
    });
    assert.equal(preview.commitReady, true);
    assert.deepEqual(
      preview.rows.map((row) => row.adoptable),
      [true, false],
    );
    assert.equal(server.creates, 0);
    assert.equal(server.automations.size, 0);
    assert.deepEqual(await repo.listManagedAdoptions(), []);
    assert.equal(JSON.stringify(await repo.get(original.automationId)), before);
    assert.deepEqual(await whoRuns(), { localRuns: true, managedRuns: false });
    assert.equal(JSON.stringify(preview).includes("SECRET"), false);
  });
});

test("an unconfirmed, unadoptable or conflicting import writes no marker", async () => {
  await harness(async ({ repo, server, owner, original }) => {
    await assert.rejects(
      owner.adopt({ ...adoptInput(original.automationId), confirm: false }),
      refuses("automation_adoption_confirm_required"),
    );
    server.conflicts = [{ code: "tool_not_permitted", subject: "shell" }];
    await assert.rejects(
      owner.adopt(adoptInput(original.automationId)),
      refuses("automation_adoption_blocked"),
    );
    const bounded = await repo.create(
      {
        title: "bounded",
        cronExpr: "0 9 * * *",
        prompt: "x",
        workspacePath: "/tmp/ws",
        recurring: true,
        maxRuns: 3,
      },
      { nextRunAt: DUE },
    );
    server.conflicts = [];
    await assert.rejects(owner.adopt(adoptInput(bounded.automationId)), (error: unknown) => {
      assert.ok(error instanceof AutomationAdoptionError);
      assert.equal(error.code, "automation_adoption_not_adoptable");
      assert.equal(error.detail?.reason, "unsupported_bounded_runs");
      return true;
    });
    assert.deepEqual(await repo.listManagedAdoptions(), []);
    assert.equal(server.creates, 0);
  });
});

test("confirm preserves the original and hands execution to exactly one scheduler", async () => {
  await harness(async ({ repo, server, owner, original, whoRuns }) => {
    const result = await owner.adopt(adoptInput(original.automationId));
    assert.equal(result.state, "managed");
    const kept = await repo.get(original.automationId);
    assert.equal(kept?.prompt, PROMPT, "the local original keeps its prompt");
    assert.equal(kept?.nextRunAt, DUE);
    assert.deepEqual(await whoRuns(), { localRuns: false, managedRuns: true });
    const body = [...server.automations.values()][0]!;
    assert.equal(JSON.stringify(body).includes("SECRET"), false);
    assert.equal(
      (await owner.adopt(adoptInput(original.automationId))).managedAutomationId,
      result.managedAutomationId,
      "adopting twice is idempotent",
    );
    assert.equal(server.creates, 1);
  });
});

test("every crash window keeps at most one scheduler and never duplicates the managed copy", async () => {
  await harness(async ({ repo, server, owner, original, whoRuns, failRecord }) => {
    // Window 1: the marker is written, the server create fails.
    server.failNext.create = 1;
    await assert.rejects(
      owner.adopt(adoptInput(original.automationId)),
      refuses("automation_adoption_pending_recovery"),
    );
    assert.deepEqual(await whoRuns(), { localRuns: false, managedRuns: false });
    assert.equal(server.creates, 0);

    // Window 2: the server created it, but recording the managed id crashed.
    failRecord.remaining = 1;
    await assert.rejects(
      owner.adopt(adoptInput(original.automationId)),
      refuses("automation_adoption_pending_recovery"),
    );
    assert.equal(server.creates, 1);
    assert.deepEqual(await whoRuns(), { localRuns: false, managedRuns: false });

    // Recovery after the idempotency record is gone must still find it by correlation.
    server.idempotency.clear();
    assert.equal(await owner.recoverOne(ORG, original.automationId), "managed");
    assert.equal(server.creates, 1, "recovery never creates a second managed automation");
    assert.deepEqual(await whoRuns(), { localRuns: false, managedRuns: true });
    assert.equal((await repo.getManagedAdoption(original.automationId))?.state, "managed");
  });
});

test("recovery without a managed copy keeps the original suppressed and decides nothing for the user", async () => {
  await harness(async ({ server, owner, original, whoRuns }) => {
    server.failNext.create = 1;
    await assert.rejects(owner.adopt(adoptInput(original.automationId)));
    assert.equal(await owner.recoverOne(ORG, original.automationId), "pending");
    assert.equal(server.creates, 0);
    assert.deepEqual(await whoRuns(), { localRuns: false, managedRuns: false });
    assert.equal(
      (await owner.release({ orgId: ORG, localAutomationId: original.automationId })).state,
      "local",
    );
    assert.deepEqual(await whoRuns(), { localRuns: true, managedRuns: false });
  });
});

test("release deletes and reads back the managed copy before the local original resumes", async () => {
  await harness(async ({ repo, server, owner, original, whoRuns }) => {
    await owner.adopt(adoptInput(original.automationId));

    server.failNext.pause = 1;
    await assert.rejects(
      owner.release({ orgId: ORG, localAutomationId: original.automationId }),
      refuses("automation_adoption_release_pending"),
    );
    assert.equal((await repo.getManagedAdoption(original.automationId))?.state, "releasing");
    assert.equal(
      (await whoRuns()).localRuns,
      false,
      "still suppressed while the managed copy may be live",
    );

    server.keepOnDelete = true;
    await assert.rejects(
      owner.release({ orgId: ORG, localAutomationId: original.automationId }),
      refuses("automation_adoption_release_pending"),
    );
    assert.equal((await whoRuns()).localRuns, false);

    server.keepOnDelete = false;
    assert.deepEqual(
      await owner.release({ orgId: ORG, localAutomationId: original.automationId }),
      { state: "local" },
    );
    assert.equal(server.automations.size, 0);
    assert.deepEqual(await whoRuns(), { localRuns: true, managedRuns: false });
    assert.equal((await repo.get(original.automationId))?.prompt, PROMPT);
    assert.equal(
      (await repo.get(original.automationId))?.nextRunAt,
      DUE,
      "the original schedule survived the round trip",
    );
  });
});

test("a confirm for a revision the user did not see writes no marker and never creates remotely", async () => {
  await harness(async ({ repo, server, owner, original }) => {
    const preview = await owner.preview({
      orgId: ORG,
      localAutomationIds: [original.automationId],
    });
    const row = preview.rows[0];
    assert.equal(row?.adoptable && row.revision, original.updatedAt);

    // updated_at 是毫秒粒度：与创建同一毫秒内的改动无法区分，测试里显式隔开。
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repo.update(original.automationId, { title: "edited after the user looked" });
    await assert.rejects(
      owner.adopt({ ...adoptInput(original.automationId), expectedRevision: original.updatedAt }),
      refuses("automation_adoption_changed"),
    );
    assert.equal(server.creates, 0);
    assert.equal(await repo.getManagedAdoption(original.automationId), null);

    const fresh = await repo.get(original.automationId);
    const adopted = await owner.adopt({
      ...adoptInput(original.automationId),
      expectedRevision: fresh!.updatedAt,
    });
    assert.equal(adopted.state, "managed");
    assert.equal(server.creates, 1);
  });
});

const attachInput = (id: string, managed: { automationId: string; version: number }) => ({
  orgId: ORG,
  localAutomationId: id,
  managedAutomationId: managed.automationId,
  expectedVersion: managed.version,
  confirm: true,
  acknowledgeLocalInstructions: true,
});

test("attach refuses without the local-instructions acknowledgement, before any read or write", async () => {
  await harness(async ({ repo, server, owner, original }) => {
    const shared = server.seedShared();
    const serverBefore = JSON.stringify([...server.automations.values()]);
    for (const acknowledgeLocalInstructions of [false, undefined, "true", 1] as unknown[]) {
      await assert.rejects(
        owner.attach({
          ...attachInput(original.automationId, shared),
          acknowledgeLocalInstructions,
        } as never),
        refuses("automation_adoption_confirm_required"),
      );
    }
    assert.deepEqual(await repo.listManagedAdoptions(), [], "no marker: the original keeps running");
    assert.equal(JSON.stringify([...server.automations.values()]), serverBefore);
    assert.equal(server.creates, 0);
  });
});

test("attach preview lists existing definitions read-only and names every refusal", async () => {
  await harness(async ({ repo, server, owner, original }) => {
    const ok = server.seedShared();
    const paused = server.seedShared({ status: "paused" });
    const stranger = server.seedShared({ executionPrincipalId: `usr_${hex("9")}` });
    const otherBinding = server.seedShared({ workspaceBindingId: `wsb_${hex("8")}` });
    const ownBinding = server.seedShared({ workspaceBindingId: BINDING });
    const pinned = server.seedShared({ targetDeviceId: `dev_${hex("7")}` });
    const offPeak = server.seedShared({ offPeak: true });
    const before = JSON.stringify(await repo.get(original.automationId));
    const preview = await owner.previewAttach({
      orgId: ORG,
      localAutomationId: original.automationId,
    });
    assert.ok(preview.adoptable);
    const verdict = new Map(preview.candidates.map((c) => [c.managedAutomationId, c.refusal]));
    assert.equal(verdict.get(ok.automationId), undefined);
    assert.equal(verdict.get(ownBinding.automationId), undefined);
    assert.equal(verdict.get(paused.automationId), "automation_attach_inactive");
    assert.equal(verdict.get(stranger.automationId), "automation_attach_principal_mismatch");
    assert.equal(verdict.get(otherBinding.automationId), "automation_attach_binding_mismatch");
    assert.equal(verdict.get(pinned.automationId), "automation_attach_device_pinned");
    assert.equal(verdict.get(offPeak.automationId), "automation_attach_off_peak");
    assert.equal(server.creates, 0);
    assert.deepEqual(await repo.listManagedAdoptions(), []);
    assert.equal(JSON.stringify(await repo.get(original.automationId)), before);
    assert.equal(JSON.stringify(preview).includes("SECRET"), false);
  });
});

test("attach suppresses the original, uploads and mutates nothing, and keeps one executor", async () => {
  await harness(async ({ repo, server, owner, original, whoRuns }) => {
    const shared = server.seedShared();
    const serverBefore = JSON.stringify([...server.automations.values()]);
    const before = JSON.stringify(await repo.get(original.automationId));
    const result = await owner.attach(attachInput(original.automationId, shared));
    assert.deepEqual(result, { state: "managed", managedAutomationId: shared.automationId });
    const marker = await repo.getManagedAdoption(original.automationId);
    assert.equal(marker?.origin, "attached");
    assert.equal(marker?.state, "managed");
    assert.equal(marker?.managedAutomationId, shared.automationId);
    assert.equal(server.creates, 0, "attach must not create a parallel resource");
    assert.equal(JSON.stringify([...server.automations.values()]), serverBefore);
    assert.equal(JSON.stringify(await repo.get(original.automationId)), before);
    assert.deepEqual(await whoRuns(), { localRuns: false, managedRuns: true });
  });
});

test("attach refuses unconfirmed, stale, mismatched or unattachable targets without a marker", async () => {
  await harness(async ({ repo, server, owner, original, whoRuns }) => {
    const shared = server.seedShared();
    const refused = (input: Parameters<typeof owner.attach>[0], code: string) =>
      assert.rejects(owner.attach(input), refuses(code));
    await refused(
      { ...attachInput(original.automationId, shared), confirm: false },
      "automation_adoption_confirm_required",
    );
    await refused(
      attachInput(original.automationId, { ...shared, version: shared.version - 1 }),
      "automation_attach_changed",
    );
    await refused(
      { ...attachInput(original.automationId, shared), expectedRevision: -1 },
      "automation_adoption_changed",
    );
    const stranger = server.seedShared({ executionPrincipalId: `usr_${hex("9")}` });
    await refused(
      attachInput(original.automationId, stranger),
      "automation_attach_principal_mismatch",
    );
    const elsewhere = server.seedShared({ projectId: `prj_${hex("6")}` });
    await refused(
      attachInput(original.automationId, elsewhere),
      "automation_attach_project_mismatch",
    );
    await assert.rejects(
      owner.attach(
        attachInput(original.automationId, { automationId: `aut_${hex("5")}`, version: 1 }),
      ),
      (error: unknown) => error instanceof LumiAccountError && error.status === 404,
    );
    assert.deepEqual(await repo.listManagedAdoptions(), []);
    assert.deepEqual(await whoRuns(), { localRuns: true, managedRuns: false });
  });
});

test("one managed definition attaches to one local original; a replay is idempotent", async () => {
  await harness(async ({ repo, server, owner, original }) => {
    const shared = server.seedShared();
    const rival = await repo.create(
      {
        title: "Rival",
        cronExpr: "0 9 * * *",
        prompt: "x",
        workspacePath: "/tmp/ws",
        recurring: true,
      },
      { nextRunAt: DUE },
    );
    await owner.attach(attachInput(original.automationId, shared));
    await owner.attach(attachInput(original.automationId, shared));
    assert.equal((await repo.listManagedAdoptions()).length, 1);
    await assert.rejects(
      owner.attach(attachInput(rival.automationId, shared)),
      refuses("automation_attach_already_attached"),
    );
    const other = server.seedShared();
    await assert.rejects(
      owner.attach(attachInput(original.automationId, other)),
      refuses("automation_adoption_not_adoptable"),
    );
    assert.equal((await repo.listManagedAdoptions()).length, 1);
    assert.equal(await repo.getManagedAdoption(rival.automationId), null);
  });
});

test("returning an attached original only drops local suppression; the shared definition is untouched", async () => {
  await harness(async ({ repo, server, owner, original, whoRuns }) => {
    const shared = server.seedShared();
    await owner.attach(attachInput(original.automationId, shared));
    const serverBefore = JSON.stringify([...server.automations.values()]);
    server.failNext = { pause: 1, delete: 1 };
    await owner.release({ orgId: ORG, localAutomationId: original.automationId });
    assert.equal(JSON.stringify([...server.automations.values()]), serverBefore);
    assert.equal(server.failNext.pause, 1, "release must not pause a shared definition");
    assert.equal(server.failNext.delete, 1, "release must not delete a shared definition");
    assert.deepEqual(await repo.listManagedAdoptions(), []);
    assert.deepEqual(await whoRuns(), { localRuns: true, managedRuns: false });
  });
});

test("an attached original is never re-adopted into a created definition", async () => {
  await harness(async ({ repo, server, owner, original }) => {
    await owner.attach(attachInput(original.automationId, server.seedShared()));
    await assert.rejects(
      owner.adopt(adoptInput(original.automationId)),
      refuses("automation_adoption_not_adoptable"),
    );
    assert.equal(server.creates, 0);
    assert.equal((await repo.listManagedAdoptions()).length, 1);
  });
});
