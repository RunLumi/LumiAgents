import assert from "node:assert/strict";
import test from "node:test";
import {
  LUMI_MANAGED_CORRELATION_HEADERS,
  createLumiManagedRequestDependencies,
  type ManagedRunContext,
} from "@zcode/provider";
import { resolveModelForAttempt } from "../src/model/runner-runtime-headers.js";
import type { AiSdkModelTextRequest, ResolvedAiSdkModel } from "../src/model/runner-runtime.js";

const opaqueId = "0123456789abcdef0123456789abcdef";
const context: ManagedRunContext = {
  organizationId: `org_${opaqueId}`,
  projectId: `prj_${opaqueId}`,
  deviceId: `dvc_${opaqueId}`,
  agentSessionId: `rse_${opaqueId}`,
  runId: `run_${opaqueId}`,
  agentDefinitionId: `agd_${opaqueId}`,
  agentDefinitionVersion: 1,
  requestId: `req_${opaqueId}`,
  executionMode: "managed",
};

test("managed request auth source crosses the per-attempt runtime header seam", async () => {
  const dependencies = createLumiManagedRequestDependencies({
    context,
    sessionToken: "runtime-only-session-token",
  });
  let receivedInput: unknown;
  const request = {
    messages: [],
    tools: [],
    refreshRuntimeHeadersBeforeAttempt: async (input: unknown) => {
      receivedInput = input;
      return {
        headersApplied: true,
        requestAuth: await dependencies.requestAuth.source?.resolve(input as never),
      };
    },
  } as unknown as AiSdkModelTextRequest;

  const resolved = await resolveModelForAttempt({
    attempt: 3,
    request,
    resolveModel: (requestAuth) =>
      ({
        providerId: "lumi-managed",
        modelId: "coding-default",
        requestAuth,
      }) as unknown as ResolvedAiSdkModel,
  });

  assert.equal(resolved.providerId, "lumi-managed");
  assert.deepEqual(receivedInput, {
    attempt: 3,
    reason: "model-request",
    abortSignal: undefined,
    providerId: "lumi-managed",
    modelId: "coding-default",
    traceContext: undefined,
  });
  assert.equal(
    (resolved as unknown as { requestAuth: { headers: Record<string, string> } }).requestAuth
      .headers[LUMI_MANAGED_CORRELATION_HEADERS.runId],
    context.runId,
  );
});
