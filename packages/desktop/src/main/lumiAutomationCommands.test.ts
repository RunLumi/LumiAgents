import assert from "node:assert/strict";
import test from "node:test";
import { dispatchLumiAccountCommand } from "./lumiAccountCommands.js";
import type { AutomationCommandOwner } from "./lumiAutomationCommands.js";

const ORG = `org_${"a".repeat(32)}`;
const AGENT = `agd_${"b".repeat(32)}`;
const LOCAL = "automation-0b2c1b1a-1111-4222-8333-444455556666";

type Owner = ReturnType<Parameters<typeof dispatchLumiAccountCommand>[0]["getOwner"]>;

function ownerWith(automation: AutomationCommandOwner): Owner {
  const unexpected = (name: string) => async (): Promise<never> => {
    throw new Error(`unexpected owner call: ${name}`);
  };
  return {
    beginSignIn: unexpected("beginSignIn"),
    completeSignIn: unexpected("completeSignIn"),
    cancelSignIn: () => {
      throw new Error("unexpected owner call: cancelSignIn");
    },
    readAccount: unexpected("readAccount"),
    restoreSession: unexpected("restoreSession"),
    signOut: unexpected("signOut"),
    ...automation,
  };
}

async function run(command: unknown, automation: AutomationCommandOwner = {}, trusted = true) {
  let initialized = 0;
  const result = await dispatchLumiAccountCommand({
    trusted,
    command,
    getOwner: () => {
      initialized++;
      return ownerWith(automation);
    },
  });
  return { result, initialized };
}

test("an untrusted sender can neither initialize custody nor reach automation commands", async () => {
  const { result, initialized } = await run(
    {
      action: "adopt-automation",
      orgId: ORG,
      localAutomationId: LOCAL,
      agentDefinitionId: AGENT,
      modelAlias: "m",
      confirm: true,
    },
    {},
    false,
  );
  assert.deepEqual(result, { ok: false, code: "lumi_sender_denied" });
  assert.equal(initialized, 0);
});

test("preview is a pure read with a bounded unique id list and no extra keys", async () => {
  const calls: unknown[] = [];
  const owner: AutomationCommandOwner = {
    previewAutomationAdoption: async (input) => {
      calls.push(input);
      return { rows: [], commitReady: false, modelCapabilityCheck: null };
    },
  };
  const ok = await run(
    { action: "preview-automation-adoption", orgId: ORG, localAutomationIds: [LOCAL] },
    owner,
  );
  assert.deepEqual(ok.result, {
    ok: true,
    automationPreview: { rows: [], commitReady: false, modelCapabilityCheck: null },
  });
  const tooMany = Array.from({ length: 21 }, (_, index) => `automation-${index}`);
  for (const bad of [
    { localAutomationIds: [] },
    { localAutomationIds: tooMany },
    { localAutomationIds: [LOCAL, LOCAL] },
    { localAutomationIds: ["../../etc/passwd"] },
    { localAutomationIds: [LOCAL], prompt: "smuggled" },
    { localAutomationIds: "automation-1" },
  ]) {
    const { result, initialized } = await run(
      { action: "preview-automation-adoption", orgId: ORG, ...bad },
      owner,
    );
    assert.deepEqual(result, { ok: false, code: "lumi_command_invalid" });
    void initialized;
  }
  assert.equal(calls.length, 1, "invalid commands never reach the owner");
});

test("adopt and release demand explicit confirmation and exact keys", async () => {
  const seen: string[] = [];
  const owner: AutomationCommandOwner = {
    adoptAutomation: async (input) => {
      seen.push(`adopt:${input.localAutomationId}:${input.modelAlias}:${input.expectedRevision}`);
      return {
        localAutomationId: input.localAutomationId,
        state: "managed",
        managedAutomationId: `aut_${"c".repeat(32)}`,
      };
    },
    releaseAutomation: async (input) => {
      seen.push(`release:${input.localAutomationId}`);
    },
  };
  const base = { orgId: ORG, localAutomationId: LOCAL };
  const adopt = {
    action: "adopt-automation",
    ...base,
    agentDefinitionId: AGENT,
    modelAlias: "coding-default",
    expectedRevision: 1_790_000_000_000,
  };
  for (const bad of [
    { ...adopt },
    { ...adopt, confirm: false },
    { ...adopt, confirm: true, expectedRevision: undefined },
    { ...adopt, confirm: true, expectedRevision: -1 },
    { ...adopt, confirm: true, expectedRevision: 1.5 },
    { ...adopt, confirm: true, expectedRevision: "1790000000000" },
    { ...adopt, confirm: true, extra: 1 },
    { ...adopt, confirm: true, agentDefinitionId: "agent-1" },
    { ...adopt, confirm: true, modelAlias: "Not A Slug" },
    { action: "release-automation", ...base },
    { action: "release-automation", ...base, confirm: true, orgId: "org_x" },
  ])
    assert.deepEqual((await run(bad, owner)).result, { ok: false, code: "lumi_command_invalid" });
  assert.deepEqual(seen, []);

  const adopted = await run({ ...adopt, confirm: true }, owner);
  assert.equal(adopted.result.ok, true);
  assert.deepEqual(
    await run({ action: "release-automation", ...base, confirm: true }, owner).then(
      (r) => r.result,
    ),
    { ok: true },
  );
  assert.deepEqual(seen, [`adopt:${LOCAL}:coding-default:1790000000000`, `release:${LOCAL}`]);
});

test("attach preview is a pure read and attach demands confirmation, exact keys and server-shaped ids", async () => {
  const MANAGED = `aut_${"d".repeat(32)}`;
  const seen: string[] = [];
  const owner: AutomationCommandOwner = {
    previewAutomationAttach: async (input) => {
      seen.push(`preview:${input.localAutomationId}`);
      return {
        localAutomationId: input.localAutomationId,
        title: "t",
        adoptable: true,
        revision: 1,
        projectId: `prj_${"e".repeat(32)}`,
        candidates: [],
        truncated: false,
      };
    },
    attachAutomation: async (input) => {
      seen.push(`attach:${input.managedAutomationId}:${input.expectedRevision}:${input.expectedVersion}`);
      return {
        localAutomationId: input.localAutomationId,
        state: "managed",
        origin: "attached",
        managedAutomationId: input.managedAutomationId,
      };
    },
  };
  const base = { orgId: ORG, localAutomationId: LOCAL };
  const attach = {
    action: "attach-automation",
    ...base,
    managedAutomationId: MANAGED,
    expectedRevision: 7,
    expectedVersion: 3,
  };
  const confirmed = { ...attach, confirm: true, acknowledgeLocalInstructions: true };
  for (const bad of [
    { ...attach },
    { ...attach, confirm: false },
    { ...attach, confirm: true },
    { ...attach, confirm: true, acknowledgeLocalInstructions: false },
    { ...attach, confirm: true, acknowledgeLocalInstructions: "true" },
    { ...confirmed, confirm: false },
    { ...confirmed, extra: 1 },
    { ...confirmed, prompt: "smuggled" },
    { ...confirmed, managedAutomationId: "aut_x" },
    { ...confirmed, managedAutomationId: undefined },
    { ...confirmed, expectedVersion: 0 },
    { ...confirmed, expectedVersion: undefined },
    { ...confirmed, expectedRevision: -1 },
    { ...confirmed, expectedRevision: 1.5 },
    { ...confirmed, localAutomationId: "../../etc/passwd" },
    { action: "preview-automation-attach", ...base, managedAutomationId: MANAGED },
    { action: "preview-automation-attach", orgId: ORG, localAutomationId: "" },
  ])
    assert.deepEqual((await run(bad, owner)).result, { ok: false, code: "lumi_command_invalid" });
  assert.deepEqual(seen, [], "invalid commands never reach the owner");

  const preview = await run({ action: "preview-automation-attach", ...base }, owner);
  assert.equal(preview.result.ok && preview.result.automationAttachPreview?.adoptable, true);
  const attached = await run(confirmed, owner);
  assert.deepEqual(attached.result, {
    ok: true,
    automationAdoption: {
      localAutomationId: LOCAL,
      state: "managed",
      origin: "attached",
      managedAutomationId: MANAGED,
    },
  });
  assert.deepEqual(seen, [`preview:${LOCAL}`, `attach:${MANAGED}:7:3`]);
  assert.deepEqual((await run(confirmed, {})).result, {
    ok: false,
    code: "lumi_command_unsupported",
  });
});

test("owner failures surface only stable codes, never message text", async () => {
  const failing = (error: unknown): AutomationCommandOwner => ({
    readAutomationAdoptions: async () => {
      throw error;
    },
  });
  const read = { action: "read-automation-adoptions", orgId: ORG };
  assert.deepEqual(
    (
      await run(
        read,
        failing(Object.assign(new Error("x"), { code: "automation_adoption_pending_recovery" })),
      )
    ).result,
    { ok: false, code: "automation_adoption_pending_recovery" },
  );
  assert.deepEqual(
    (await run(read, failing(new Error("sqlite: /Users/me/secret.db token=abc")))).result,
    { ok: false, code: "lumi_automation_action_failed" },
  );
  assert.deepEqual((await run(read, {})).result, { ok: false, code: "lumi_command_unsupported" });
});
