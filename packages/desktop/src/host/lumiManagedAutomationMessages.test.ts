/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import test from "node:test";
import assert from "node:assert/strict";
import { hostIncomingMessageSchema, hostResponseMessageSchema } from "@zcode/shared";

const suffix = "0123456789abcdef0123456789abcdef";
const context = {
  organizationId: `org_${suffix}`,
  projectId: `prj_${suffix}`,
  deviceId: `dvc_${suffix}`,
  agentSessionId: `rse_${suffix}`,
  runId: `run_${suffix}`,
  agentDefinitionId: `agd_${suffix}`,
  agentDefinitionVersion: 1,
  requestId: `req_${suffix}`,
  externalId: `occ_${suffix}`,
  executionMode: "managed",
  policySnapshotId: `pol_${suffix}`,
  policyVersion: 3,
};
const run = {
  type: "lumi-managed-automation-run",
  requestId: "main-correlation-1",
  localAutomationId: "automation-0b2c1b1a-1111-4222-8333-444455556666",
  workspacePath: "/local/workspace",
  prompt: "summarize today",
  modelAlias: "coding-default",
  managedContext: context,
};

test("the managed automation run request carries the prompt and server context but no credential", () => {
  assert.equal(hostIncomingMessageSchema.safeParse(run).success, true);
  assert.equal(
    hostIncomingMessageSchema.safeParse({ ...run, mode: "build", workspaceIdentity: "id" }).success,
    true,
  );
  for (const smuggled of [
    { apiKey: "a".repeat(64) },
    { deviceToken: "tok" },
    { leaseToken: "lease" },
    { fence: 4 },
    { sessionCookie: "c" },
  ])
    assert.equal(
      hostIncomingMessageSchema.safeParse({ ...run, ...smuggled }).success,
      false,
      JSON.stringify(Object.keys(smuggled)),
    );
});

test("the managed automation run request is refused unless the context is managed and bounded", () => {
  const bad = [
    { managedContext: { ...context, executionMode: "local_only" } },
    { managedContext: { ...context, runId: "run_short" } },
    { modelAlias: "Not A Slug" },
    { localAutomationId: "../../etc/passwd" },
    { prompt: "" },
    { prompt: "x".repeat(100_001) },
    { workspacePath: "" },
    { requestId: "" },
  ];
  for (const override of bad)
    assert.equal(
      hostIncomingMessageSchema.safeParse({ ...run, ...override }).success,
      false,
      JSON.stringify(Object.keys(override)),
    );
});

const cancel = {
  type: "lumi-managed-automation-cancel",
  requestId: "main-cancel-1",
  runId: `run_${suffix}`,
};

test("the managed automation cancel carries a run id and nothing else", () => {
  assert.equal(hostIncomingMessageSchema.safeParse(cancel).success, true);
  for (const smuggled of [
    { apiKey: "a".repeat(64) },
    { deviceToken: "tok" },
    { leaseToken: "lease" },
    { fence: 4 },
    { sessionCookie: "c" },
    { prompt: "echo" },
    { taskId: "t" },
    { managedContext: context },
  ])
    assert.equal(
      hostIncomingMessageSchema.safeParse({ ...cancel, ...smuggled }).success,
      false,
      JSON.stringify(Object.keys(smuggled)),
    );
  for (const bad of [
    { runId: "run_short" },
    { runId: `req_${suffix}` },
    { runId: "../../etc/passwd" },
    { runId: undefined },
    { requestId: "" },
    { requestId: "x".repeat(129) },
  ])
    assert.equal(hostIncomingMessageSchema.safeParse({ ...cancel, ...bad }).success, false);
});

test("the managed automation cancel ack is a closed outcome/refusal shape", () => {
  const ok = {
    type: "lumi-managed-automation-cancel-result",
    requestId: "r",
    runId: `run_${suffix}`,
    ok: true,
    outcome: "stopped",
  };
  const refused = {
    type: "lumi-managed-automation-cancel-result",
    requestId: "r",
    runId: `run_${suffix}`,
    ok: false,
    errorCode: "lumi_managed_automation_run_unknown",
  };
  assert.equal(hostResponseMessageSchema.safeParse(ok).success, true);
  assert.equal(hostResponseMessageSchema.safeParse({ ...ok, outcome: "prevented" }).success, true);
  assert.equal(
    hostResponseMessageSchema.safeParse({ ...ok, outcome: "already_cancelled" }).success,
    true,
  );
  assert.equal(hostResponseMessageSchema.safeParse(refused).success, true);
  for (const bad of [
    { ...ok, outcome: undefined },
    { ...ok, outcome: "completed" },
    { ...ok, errorCode: "lumi_x" },
    { ...refused, outcome: "stopped" },
    { ...refused, errorCode: undefined },
    { ...refused, errorCode: "free text / path" },
    { ...ok, runId: "run_short" },
    { ...ok, runId: undefined },
    { ...ok, taskId: "t" },
    { ...ok, leaseToken: "lease" },
  ])
    assert.equal(hostResponseMessageSchema.safeParse(bad).success, false, JSON.stringify(bad));
});

test("the managed automation run result is a closed success/refusal shape", () => {
  const ok = { type: "lumi-managed-automation-run-result", requestId: "r", ok: true, taskId: "t" };
  const refused = {
    type: "lumi-managed-automation-run-result",
    requestId: "r",
    ok: false,
    errorCode: "lumi_managed_automation_refused",
  };
  assert.equal(hostResponseMessageSchema.safeParse(ok).success, true);
  assert.equal(hostResponseMessageSchema.safeParse(refused).success, true);
  for (const bad of [
    { ...ok, taskId: undefined },
    { ...ok, errorCode: "lumi_x" },
    { ...refused, taskId: "t" },
    { ...refused, errorCode: undefined },
    { ...refused, errorCode: "free text / path" },
    { ...ok, prompt: "echo" },
  ])
    assert.equal(hostResponseMessageSchema.safeParse(bad).success, false);
});
