import assert from "node:assert/strict";
import test from "node:test";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";
import { createProviderRuntimeHeadersPort } from "../src/zcode-protocol/provider-runtime-headers.js";

const suffix = "0123456789abcdef0123456789abcdef";
const managedContext = {
  organizationId: `org_${suffix}`,
  projectId: `prj_${suffix}`,
  deviceId: `dvc_${suffix}`,
  agentSessionId: `rse_${suffix}`,
  runId: `run_${suffix}`,
  agentDefinitionId: `agd_${suffix}`,
  agentDefinitionVersion: 3,
  requestId: `req_${suffix}`,
  executionMode: "managed" as const,
};

test("per-attempt provider auth carries only the current P05 managed context", async () => {
  let capturedParams: Record<string, unknown> | undefined;
  const context = {
    requestClient: async (_method: string, params: Record<string, unknown>) => {
      capturedParams = params;
      return { headersApplied: true, requestAuth: { apiKey: "ephemeral" } };
    },
    notify: () => undefined,
  } as unknown as ZCodeProtocolAgentServerContext;
  const port = createProviderRuntimeHeadersPort(context, {
    workspacePath: "/tmp/lumi-managed",
    workspaceKey: "managed-workspace-key",
  });

  await port.refreshBeforeModelRequest({
    attempt: 1,
    modelId: "coding-default",
    providerId: "lumi-managed",
    reason: "model-request",
    sessionId: "session-1" as never,
    traceContext: {} as never,
    managedContext,
  });

  assert.deepEqual(capturedParams?.managedContext, managedContext);
  assert.equal(capturedParams?.accountAccess, undefined);
  assert.equal(capturedParams?.providerId, "lumi-managed");
});
