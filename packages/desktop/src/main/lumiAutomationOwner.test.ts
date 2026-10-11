import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AutomationRepo, type LumiAccountHostTransport } from "@zcode/services/node";
import { createLumiAutomationAssembly } from "./lumiAutomationOwner.js";

const hex = (letter: string) => letter.repeat(32);
const ORG = `org_${hex("a")}`;
const PROJECT = `prj_${hex("b")}`;
const AGENT = `agd_${hex("c")}`;
const USER = `usr_${hex("e")}`;
const BINDING = `wsb_${hex("d")}`;
const STATE = `wst_${hex("f")}`;
const PROMPT = "TOP SECRET PROMPT sk-live-123";

test("generation changing during final account read refuses publication even for the same user", async () => {
  let generation = 1,
    reads = 0;
  const assembly = createLumiAutomationAssembly({
    generation: () => generation,
    transport: {
      readAccount: async () => {
        reads++;
        if (reads === 2) {
          await Promise.resolve();
          generation++;
        }
        return {
          user: { id: USER },
          organizations: [{ id: ORG, state: "active", status: "active" }],
        };
      },
    } as unknown as LumiAccountHostTransport,
    authorizeWorkspace: async () => {
      throw new Error("unexpected workspace");
    },
    repo: () =>
      ({
        listManagedAdoptions: async () => [],
        listManagedOccurrences: async () => [],
      }) as unknown as AutomationRepo,
  });
  await assert.rejects(assembly.readAutomationAdoptions!(ORG), /lumi_account_changed/);
  assert.equal(reads, 2);
});

test("org membership refusal happens before local marker reads", async () => {
  let reads = 0;
  const assembly = createLumiAutomationAssembly({
    transport: {
      readAccount: async () => ({ user: { id: USER }, organizations: [] }),
    } as unknown as LumiAccountHostTransport,
    authorizeWorkspace: async () => {
      throw new Error("unexpected workspace");
    },
    repo: () => {
      reads++;
      throw new Error("unexpected local read");
    },
  });
  await assert.rejects(assembly.readAutomationAdoptions!(ORG), /lumi_org_unavailable/);
  assert.equal(reads, 0);
});

test("account switch during marker read cannot publish another user's projection", async () => {
  let user = USER;
  const assembly = createLumiAutomationAssembly({
    transport: {
      readAccount: async () => ({
        user: { id: user },
        organizations: [{ id: ORG, state: "active", status: "active" }],
      }),
    } as unknown as LumiAccountHostTransport,
    authorizeWorkspace: async () => {
      throw new Error("unexpected workspace");
    },
    repo: () =>
      ({
        listManagedAdoptions: async () => {
          user = `usr_${hex("f")}`;
          return [];
        },
        listManagedOccurrences: async () => [],
      }) as unknown as AutomationRepo,
  });
  await assert.rejects(assembly.readAutomationAdoptions!(ORG), /lumi_account_changed/);
});

async function withAssembly(
  run: (ctx: {
    repo: AutomationRepo;
    sent: string[];
    assembly: ReturnType<typeof createLumiAutomationAssembly>;
    localId: string;
    created: {
      rows: Map<string, Record<string, unknown>>;
      mutations: string[];
      onPreview?: () => void;
      onCreate?: () => void;
      onGet?: () => void;
    };
  }) => Promise<void>,
  generation: () => number = () => 1,
) {
  const directory = await mkdtemp(join(tmpdir(), "lumi-main-automation-"));
  const repo = new AutomationRepo(join(directory, "tasks-index.sqlite"));
  await repo.ensureReady();
  const sent: string[] = [];
  const server: {
    rows: Map<string, Record<string, unknown>>;
    mutations: string[];
    onPreview?: () => void;
    onCreate?: () => void;
    onGet?: () => void;
  } = { rows: new Map<string, Record<string, unknown>>(), mutations: [] };
  const created = server.rows;
  const transport = {
    readAccount: async () => ({
      user: { id: USER, email: "u@example.com", displayName: "U" },
      organizations: [{ id: ORG, state: "active", status: "active" }],
    }),
    automations: () => ({
      previewImport: async (_org: string, input: { candidates: { local_key: string }[] }) => {
        sent.push(JSON.stringify(input));
        server.onPreview?.();
        return {
          items: input.candidates.map((candidate) => ({
            localKey: candidate.local_key,
            importable: true,
            conflicts: [],
          })),
          commitReady: true,
          modelCapabilityCheck: "deferred_to_dispatch",
          localAutomationsModified: false,
        };
      },
      createManaged: async (_org: string, body: { description: string }) => {
        sent.push(JSON.stringify(body));
        const row = {
          automationId: `aut_${hex("1")}`,
          orgId: ORG,
          projectId: PROJECT,
          description: body.description,
          status: "active",
          version: 1,
          executionPrincipalKind: "user",
          executionPrincipalId: USER,
          workspaceBindingId: BINDING,
        };
        created.set(row.automationId, row);
        server.onCreate?.();
        return row;
      },
      findManagedByCorrelation: async () => null,
      listManagedForProject: async () => [...created.values()],
      getManaged: async (_org: string, id: string) => {
        server.onGet?.();
        return created.get(id)!;
      },
      pauseManaged: async (_org: string, id: string) => {
        server.mutations.push(`pause:${id}`);
        return created.get(id)!;
      },
      deleteManaged: async (_org: string, id: string) => {
        server.mutations.push(`delete:${id}`);
        created.delete(id);
      },
    }),
  } as unknown as LumiAccountHostTransport;
  const assembly = createLumiAutomationAssembly({
    transport,
    repo: () => repo,
    generation,
    authorizeWorkspace: async () => ({
      projectId: PROJECT,
      workspaceBindingId: BINDING,
      adoptionStateId: STATE,
    }),
  });
  const original = await repo.create(
    {
      title: "Nightly",
      cronExpr: "0 9 * * 1-5",
      prompt: PROMPT,
      workspacePath: "/tmp/ws",
      recurring: true,
    },
    { nextRunAt: 1_000 },
  );
  try {
    await run({ repo, sent, assembly, localId: original.automationId, created: server });
  } finally {
    repo.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("the prompt never leaves the device across preview, adopt and read", async () => {
  await withAssembly(async ({ repo, sent, assembly, localId }) => {
    const preview = await assembly.previewAutomationAdoption!({
      orgId: ORG,
      localAutomationIds: [localId],
    });
    assert.equal(preview.commitReady, true);
    assert.deepEqual(await repo.listManagedAdoptions(), [], "preview wrote no marker");

    const row = preview.rows[0];
    assert.ok(row?.adoptable);
    const adopted = await assembly.adoptAutomation!({
      orgId: ORG,
      localAutomationId: localId,
      agentDefinitionId: AGENT,
      modelAlias: "coding-default",
      expectedRevision: row.revision,
    });
    assert.deepEqual(adopted, {
      localAutomationId: localId,
      state: "managed",
      origin: "created",
      managedAutomationId: `aut_${hex("1")}`,
    });
    const listed = await assembly.readAutomationAdoptions!(ORG);
    assert.deepEqual(listed, [adopted]);
    assert.ok(sent.length >= 2);
    for (const payload of [...sent, JSON.stringify(preview), JSON.stringify(listed)]) {
      assert.equal(payload.includes("SECRET"), false);
      assert.equal(payload.includes("sk-live"), false);
    }
    assert.equal((await repo.get(localId))?.prompt, PROMPT, "the original keeps its prompt");
  });
});

test("a bot-delivery original is classified not adoptable and stays untouched locally", async () => {
  await withAssembly(async ({ repo, assembly }) => {
    const delivering = await repo.create(
      {
        title: "Delivers",
        cronExpr: "0 9 * * *",
        prompt: "x",
        workspacePath: "/tmp/ws",
        recurring: true,
        botDeliveryTarget: { provider: "feishu", botId: "b", chatId: "c" } as never,
      },
      { nextRunAt: 1_000 },
    );
    const preview = await assembly.previewAutomationAdoption!({
      orgId: ORG,
      localAutomationIds: [delivering.automationId],
    });
    assert.deepEqual(preview.rows[0], {
      localAutomationId: delivering.automationId,
      title: "Delivers",
      adoptable: false,
      reason: "unsupported_external_delivery",
    });
    await assert.rejects(
      assembly.adoptAutomation!({
        orgId: ORG,
        localAutomationId: delivering.automationId,
        agentDefinitionId: AGENT,
        modelAlias: "coding-default",
        expectedRevision: delivering.updatedAt,
      }),
    );
    assert.deepEqual(await repo.listManagedAdoptions(), []);
  });
});

test("a sign-out or account replacement mid-confirm fences every later step", async () => {
  // 确认过程中（adopt 内部的新鲜 preview 请求期间）用户登出再登录：同一用户也算另一代。
  let generation = 1;
  await withAssembly(
    async ({ repo, sent, assembly, localId, created }) => {
      const preview = await assembly.previewAutomationAdoption!({
        orgId: ORG,
        localAutomationIds: [localId],
      });
      const row = preview.rows[0];
      assert.ok(row?.adoptable);
      created.onPreview = () => {
        generation++;
      };
      const before = sent.length;
      await assert.rejects(
        assembly.adoptAutomation!({
          orgId: ORG,
          localAutomationId: localId,
          agentDefinitionId: AGENT,
          modelAlias: "coding-default",
          expectedRevision: row.revision,
        }),
        /lumi_account_changed/,
      );
      assert.equal(sent.length, before + 1, "only the in-flight preview was sent, no create");
      assert.deepEqual(await repo.listManagedAdoptions(), [], "no suppression marker was written");
    },
    () => generation,
  );
});

test("a generation change after the server create keeps the original suppressed, never both", async () => {
  let generation = 1;
  await withAssembly(
    async ({ repo, assembly, localId, created }) => {
      const preview = await assembly.previewAutomationAdoption!({
        orgId: ORG,
        localAutomationIds: [localId],
      });
      const row = preview.rows[0];
      assert.ok(row?.adoptable);
      created.onCreate = () => {
        generation++;
      };
      await assert.rejects(
        assembly.adoptAutomation!({
          orgId: ORG,
          localAutomationId: localId,
          agentDefinitionId: AGENT,
          modelAlias: "coding-default",
          expectedRevision: row.revision,
        }),
        // 标记已写之后的任何失败都是「待恢复」，错误码不会冒充成功，也不会回滚成本地再跑。
        /automation_adoption_pending_recovery/,
      );
      const marker = await repo.getManagedAdoption(localId);
      assert.equal(marker?.state, "suppressed", "marker written before create, not yet recorded");
      assert.equal(created.rows.size, 1, "the server copy exists; recovery will find it");
      assert.deepEqual(await repo.claimDue(Date.now()), [], "the original is not claimable");
    },
    () => generation,
  );
});

test("a confirm for a stale revision is refused without any server write", async () => {
  await withAssembly(async ({ repo, sent, assembly, localId }) => {
    const preview = await assembly.previewAutomationAdoption!({
      orgId: ORG,
      localAutomationIds: [localId],
    });
    const row = preview.rows[0];
    assert.ok(row?.adoptable);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repo.update(localId, { title: "edited in another window" });
    const before = sent.length;
    await assert.rejects(
      assembly.adoptAutomation!({
        orgId: ORG,
        localAutomationId: localId,
        agentDefinitionId: AGENT,
        modelAlias: "coding-default",
        expectedRevision: row.revision,
      }),
      /automation_adoption_changed/,
    );
    assert.equal(sent.length, before);
    assert.deepEqual(await repo.listManagedAdoptions(), []);
  });
});

test("read reports ambiguous occurrences per original and nothing else about them", async () => {
  await withAssembly(async ({ repo, assembly, localId }) => {
    const preview = await assembly.previewAutomationAdoption!({
      orgId: ORG,
      localAutomationIds: [localId],
    });
    const row = preview.rows[0];
    assert.ok(row?.adoptable);
    const adopted = await assembly.adoptAutomation!({
      orgId: ORG,
      localAutomationId: localId,
      agentDefinitionId: AGENT,
      modelAlias: "coding-default",
      expectedRevision: row.revision,
    });
    await repo.recordManagedOccurrence({
      occurrenceId: `occ_${hex("7")}`,
      orgId: ORG,
      localAutomationId: localId,
      managedAutomationId: adopted.managedAutomationId!,
      state: "starting",
    });
    await repo.markInterruptedManagedOccurrences("process_restarted");
    const listed = await assembly.readAutomationAdoptions!(ORG);
    assert.deepEqual(listed, [{ ...adopted, ambiguousOccurrences: 1 }]);
    assert.equal(JSON.stringify(listed).includes("occ_"), false);
  });
});

function sharedDefinition(overrides: Record<string, unknown> = {}) {
  return {
    automationId: `aut_${hex("2")}`,
    orgId: ORG,
    projectId: PROJECT,
    description: null,
    status: "active",
    version: 3,
    executionPrincipalKind: "user",
    executionPrincipalId: USER,
    workspaceBindingId: null,
    name: "Shared nightly",
    scheduleKind: "cron",
    scheduleExpression: "0 9 * * 1-5",
    scheduleTimezone: "UTC",
    targetKind: "eligible_device",
    targetDeviceId: null,
    offPeak: false,
    ...overrides,
  };
}

test("attach through Main is explicit, sends no body, and return never touches the shared definition", async () => {
  await withAssembly(async ({ repo, sent, assembly, localId, created }) => {
    const shared = sharedDefinition();
    created.rows.set(shared.automationId, shared);
    const preview = await assembly.previewAutomationAttach!({
      orgId: ORG,
      localAutomationId: localId,
    });
    assert.ok(preview.adoptable);
    assert.deepEqual(await repo.listManagedAdoptions(), [], "preview wrote no marker");
    const candidate = preview.candidates.find((c) => c.managedAutomationId === shared.automationId);
    assert.equal(candidate?.attachable, true);
    assert.equal(JSON.stringify(preview).includes("SECRET"), false);

    const attached = await assembly.attachAutomation!({
      orgId: ORG,
      localAutomationId: localId,
      managedAutomationId: shared.automationId,
      expectedRevision: preview.revision,
      expectedVersion: shared.version,
      acknowledgeLocalInstructions: true,
    });
    assert.deepEqual(attached, {
      localAutomationId: localId,
      state: "managed",
      origin: "attached",
      managedAutomationId: shared.automationId,
    });
    assert.deepEqual(sent, [], "attach uploads no body, not even bounded metadata");
    assert.deepEqual(await assembly.readAutomationAdoptions!(ORG), [attached]);
    assert.equal((await repo.get(localId))?.prompt, PROMPT, "the original keeps its prompt");

    await assembly.releaseAutomation!({ orgId: ORG, localAutomationId: localId });
    assert.deepEqual(created.mutations, [], "return never pauses or deletes the shared definition");
    assert.ok(created.rows.has(shared.automationId));
    assert.deepEqual(await repo.listManagedAdoptions(), []);
  });
});

test("an account change before the attach write leaves the original running locally", async () => {
  let generation = 1;
  await withAssembly(async ({ repo, assembly, localId, created }) => {
    const shared = sharedDefinition();
    created.rows.set(shared.automationId, shared);
    const preview = await assembly.previewAutomationAttach!({
      orgId: ORG,
      localAutomationId: localId,
    });
    assert.ok(preview.adoptable);
    // The account changes while Main is validating the definition, i.e. before the local write.
    created.onGet = () => {
      generation = 2;
    };
    await assert.rejects(
      assembly.attachAutomation!({
        orgId: ORG,
        localAutomationId: localId,
        managedAutomationId: shared.automationId,
        expectedRevision: preview.revision,
        expectedVersion: shared.version,
        acknowledgeLocalInstructions: true,
      }),
      /lumi_account_changed/,
    );
    assert.deepEqual(await repo.listManagedAdoptions(), [], "no marker, so nothing is suppressed");
  }, () => generation);
});
