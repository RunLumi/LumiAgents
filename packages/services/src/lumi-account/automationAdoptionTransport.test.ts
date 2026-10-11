import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImportCandidate,
  buildManagedAutomationCreateBody,
  classifyLocalAutomation,
  resolveZoneOffsetTable,
  type AdoptableLocalAutomation,
} from "./automationAdoptionMapping.js";
import { LumiAutomationAdoptionHostTransport } from "./automationAdoptionTransport.js";
import { LumiAccountError } from "./errors.js";

const hex = (letter: string) => letter.repeat(32);
const ORG = `org_${hex("a")}`;
const PROJECT = `prj_${hex("b")}`;
const AGENT = `agd_${hex("c")}`;
const BINDING = `wsb_${hex("d")}`;
const USER = `usr_${hex("e")}`;
const NOW = Date.parse("2026-10-08T00:00:00Z");
const PROMPT = "SUPER SECRET PROMPT api_key=sk-test-123";

test("recovery requires complete exact-project pages before accepting correlation", async () => {
  const item = {
    automation_id: `aut_${hex("a")}`,
    org_id: ORG,
    project_id: PROJECT,
    description: "lumi-local:fixture",
    status: "active",
    version: 1,
    execution_principal: { kind: "user", id: USER },
    target: { workspace_binding_id: BINDING },
  };
  let pages: unknown[] = [];
  let paths: string[] = [];
  const transport = new LumiAutomationAdoptionHostTransport(async (path) => {
    paths.push(path);
    return Response.json(pages.shift());
  });
  for (const response of [
    { items: [] },
    { items: [{ ...item, project_id: `prj_${hex("f")}` }], has_more: false },
    { items: [item], has_more: true, next_cursor: null },
  ]) {
    pages = [response];
    await assert.rejects(transport.findManagedByCorrelation(ORG, PROJECT, "lumi-local:fixture"));
  }
  pages = [
    { items: [item], has_more: true, next_cursor: "page2" },
    { items: [], has_more: false },
  ];
  paths = [];
  assert.equal(
    (await transport.findManagedByCorrelation(ORG, PROJECT, "lumi-local:fixture"))?.automationId,
    item.automation_id,
  );
  assert.equal(paths.length, 2);
  assert.ok(paths[1]?.includes("cursor=page2"));
  pages = [
    { items: [item], has_more: true, next_cursor: "repeat" },
    { items: [], has_more: true, next_cursor: "repeat" },
  ];
  await assert.rejects(transport.findManagedByCorrelation(ORG, PROJECT, "lumi-local:fixture"));
  pages = [
    { items: [item], has_more: true, next_cursor: "page2" },
    { items: [{ ...item, automation_id: `aut_${hex("b")}` }], has_more: false },
  ];
  await assert.rejects(
    transport.findManagedByCorrelation(ORG, PROJECT, "lumi-local:fixture"),
    /lumi_automation_conflict/,
  );
});

function local(overrides: Partial<AdoptableLocalAutomation> = {}): AdoptableLocalAutomation {
  return {
    automationId: "automation-0b2c1b1a-1111-4222-8333-444455556666",
    title: "Nightly review",
    cronExpr: "0 9 * * 1-5",
    recurring: true,
    locationKind: "local",
    enabled: true,
    lifecycleStatus: "active",
    ...overrides,
  };
}

test("only faithfully representable schedules are adoptable; everything else stays local", () => {
  assert.deepEqual(classifyLocalAutomation(local(), NOW), {
    adoptable: true,
    scheduleKind: "cron",
  });
  assert.deepEqual(
    classifyLocalAutomation(local({ recurring: false, nextRunAt: NOW + 60_000 }), NOW),
    { adoptable: true, scheduleKind: "one_time" },
  );
  const refused: [Partial<AdoptableLocalAutomation>, string][] = [
    [{ scheduleRule: { unit: "hourly" } }, "unsupported_schedule_rule"],
    [{ cronExpr: "0 0 9 * * *" }, "unsupported_schedule_expression"],
    [{ maxRuns: 3 }, "unsupported_bounded_runs"],
    [{ endAt: NOW + 1 }, "unsupported_bounded_runs"],
    [{ targetTaskId: "task-1" }, "unsupported_session_binding"],
    [{ botDeliveryTarget: { provider: "x" } }, "unsupported_external_delivery"],
    [{ locationKind: "remote" }, "unsupported_remote_workspace"],
    [{ enabled: false, lifecycleStatus: "paused" }, "unsupported_not_active"],
    [{ recurring: false, nextRunAt: NOW - 1 }, "unsupported_one_time_elapsed"],
  ];
  for (const [overrides, reason] of refused)
    assert.deepEqual(classifyLocalAutomation(local(overrides), NOW), { adoptable: false, reason });
});

test("preview candidates and create bodies carry metadata only, never the prompt", () => {
  const original = { ...local(), prompt: PROMPT } as AdoptableLocalAutomation;
  const candidate = buildImportCandidate(original, "cron");
  const body = buildManagedAutomationCreateBody({
    automation: original,
    scheduleKind: "cron",
    projectId: PROJECT,
    agentDefinitionId: AGENT,
    workspaceBindingId: BINDING,
    modelAlias: "coding-default",
    principalUserId: USER,
    timezone: "UTC",
    nowMs: NOW,
  });
  for (const value of [candidate, body]) {
    const serialized = JSON.stringify(value);
    assert.equal(serialized.includes("SECRET"), false);
    assert.equal(serialized.includes("sk-test"), false);
    assert.equal("prompt" in value, false);
  }
  assert.equal(body.description, `lumi-local:${original.automationId}`);
  assert.deepEqual(body.schedule.kind, "cron");
  assert.deepEqual(Object.keys(body).sort(), [
    "agent_definition_id",
    "description",
    "execution_policy",
    "execution_principal",
    "name",
    "project_id",
    "schedule",
    "target",
  ]);
});

test("zone offset tables are bounded and expose daylight-saving transitions", () => {
  assert.deepEqual(resolveZoneOffsetTable("UTC", NOW), {
    utc_offset_seconds: 0,
    utc_offset_transitions: [],
  });
  const newYork = resolveZoneOffsetTable("America/New_York", NOW);
  assert.equal(newYork.utc_offset_seconds, -4 * 3600);
  assert.equal(newYork.utc_offset_transitions.length, 2);
  assert.equal(newYork.utc_offset_transitions[0]?.offset_seconds, -5 * 3600);
  assert.equal(
    Date.parse("2026-11-01T06:00:00Z") / 1000,
    newYork.utc_offset_transitions[0]?.at_utc,
  );
  assert.throws(() => resolveZoneOffsetTable("Not/AZone", NOW));
});

function previewTransport(respond: (body: Record<string, unknown>) => Record<string, unknown>) {
  const sent: unknown[] = [];
  const transport = new LumiAutomationAdoptionHostTransport(async (path, method, body) => {
    assert.equal(method, "POST");
    assert.ok(path.endsWith("/adoption/automation-imports/preview"));
    sent.push(body);
    return Response.json(respond(body as Record<string, unknown>));
  });
  return { transport, sent };
}

const previewInput = () => ({
  candidates: [buildImportCandidate(local(), "cron")],
  adoptionStateIds: [`wst_${hex("f")}`],
});

test("preview reads the server verdict and refuses a self-contradicting one", async () => {
  const input = previewInput();
  const key = input.candidates[0]!.local_key;
  const ok = previewTransport(() => ({
    org_id: ORG,
    model_capability_check: "deferred_to_dispatch",
    items: [
      {
        local_key: key,
        importable: false,
        conflicts: [{ code: "tool_not_permitted", subject: "shell" }],
      },
    ],
    commit_ready: false,
    local_automations_modified: false,
  }));
  const preview = await ok.transport.previewImport(ORG, input);
  assert.deepEqual(preview.items[0]?.conflicts, [{ code: "tool_not_permitted", subject: "shell" }]);
  assert.equal(preview.commitReady, false);
  assert.equal(JSON.stringify(ok.sent).includes("prompt"), false);

  const contradiction = previewTransport(() => ({
    org_id: ORG,
    model_capability_check: "deferred_to_dispatch",
    items: [{ local_key: key, importable: true, conflicts: [{ code: "x", subject: "y" }] }],
    commit_ready: true,
    local_automations_modified: false,
  }));
  await assert.rejects(
    contradiction.transport.previewImport(ORG, input),
    (error: unknown) => error instanceof LumiAccountError && error.code === "lumi_response_invalid",
  );
  const foreignKey = previewTransport(() => ({
    org_id: ORG,
    model_capability_check: "deferred_to_dispatch",
    items: [{ local_key: "someone-elses", importable: true, conflicts: [] }],
    commit_ready: true,
    local_automations_modified: false,
  }));
  await assert.rejects(foreignKey.transport.previewImport(ORG, input));
});

test("whole-automation conflicts with a null subject remain blocked rather than malformed", async () => {
  const input = previewInput();
  const transport = previewTransport(() => ({
    org_id: ORG,
    model_capability_check: "deferred_to_dispatch",
    items: [
      {
        local_key: input.candidates[0]!.local_key,
        importable: false,
        conflicts: [{ code: "automation_not_available", subject: null }],
      },
    ],
    commit_ready: false,
    local_automations_modified: false,
  }));
  const result = await transport.transport.previewImport(ORG, input);
  assert.equal(result.commitReady, false);
  assert.deepEqual(result.items[0]!.conflicts, [{ code: "automation_not_available", subject: "" }]);
});

test("release readback refuses to treat a still-present managed automation as removed", async () => {
  const automationId = `aut_${hex("1")}`;
  const present = {
    automation_id: automationId,
    org_id: ORG,
    project_id: PROJECT,
    description: null,
    status: "active",
    version: 3,
    execution_principal: { kind: "user", id: USER },
    target: { workspace_binding_id: BINDING },
  };
  const transport = new LumiAutomationAdoptionHostTransport(async (_path, method) =>
    method === "GET" ? Response.json(present) : Response.json({}),
  );
  await assert.rejects(
    transport.deleteManaged(ORG, automationId, 3),
    (error: unknown) =>
      error instanceof LumiAccountError && error.code === "lumi_automation_release_unconfirmed",
  );
  await assert.rejects(
    transport.pauseManaged(ORG, automationId, 3),
    (error: unknown) =>
      error instanceof LumiAccountError && error.code === "lumi_automation_release_unconfirmed",
  );
  const gone = new LumiAutomationAdoptionHostTransport(async (_path, method) => {
    if (method === "GET") throw new LumiAccountError("lumi_request_refused", 404);
    return Response.json({});
  });
  await gone.deleteManaged(ORG, automationId, 3);
});
