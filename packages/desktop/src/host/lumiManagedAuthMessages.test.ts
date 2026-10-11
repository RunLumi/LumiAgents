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
  executionMode: "managed",
};

test("private managed auth request admits scope metadata only", () => {
  const message = {
    type: "lumi-managed-request-auth-request",
    requestId: "host-correlation-id",
    sessionId: "zcode-task-session",
    workspaceIdentity: "/local/workspace",
    providerId: "lumi-managed",
    modelId: "coding-default",
    managedContext: context,
  };
  assert.equal(hostResponseMessageSchema.safeParse(message).success, true);
  assert.equal(
    hostResponseMessageSchema.safeParse({ ...message, prompt: "private prompt" }).success,
    false,
  );
});

test("private managed auth result accepts only exact session-token material on success", () => {
  assert.equal(
    hostIncomingMessageSchema.safeParse({
      type: "lumi-managed-request-auth-result",
      requestId: "host-correlation-id",
      ok: true,
      apiKey: "a".repeat(64),
    }).success,
    true,
  );
  assert.equal(
    hostIncomingMessageSchema.safeParse({
      type: "lumi-managed-request-auth-result",
      requestId: "host-correlation-id",
      ok: true,
      apiKey: "short",
    }).success,
    false,
  );
  assert.equal(
    hostIncomingMessageSchema.safeParse({
      type: "lumi-managed-request-auth-result",
      requestId: "host-correlation-id",
      ok: false,
      apiKey: "a".repeat(64),
      errorCode: "lumi_managed_auth_refused",
    }).success,
    false,
  );
});
