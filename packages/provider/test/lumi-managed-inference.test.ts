import assert from "node:assert/strict";
import test from "node:test";
import {
  LUMI_MANAGED_CORRELATION_HEADERS,
  createLumiManagedOpenAiCompatibleConfig,
  createLumiManagedRequestAuthSource,
  createLumiManagedRequestDependencies,
  serializeManagedRunContext,
  type ManagedRunContext,
} from "../src/lumi-managed-inference.js";

const opaqueId = "0123456789abcdef0123456789abcdef";
const organizationId = `org_${opaqueId}`;
const projectId = `prj_${opaqueId}`;
const deviceId = `dvc_${opaqueId}`;
const agentSessionId = `rse_${opaqueId}`;
const runId = `run_${opaqueId}`;
const agentDefinitionId = `agd_${opaqueId}`;
const requestId = `req_${opaqueId}`;
const sessionToken = "runtime-only-session-token";

const context: ManagedRunContext = {
  organizationId,
  projectId,
  deviceId,
  agentSessionId,
  runId,
  agentDefinitionId,
  agentDefinitionVersion: 3,
  requestId,
  externalId: "zcode-session-123",
  executionMode: "managed",
};

test("managed static config contains no session credential", () => {
  const config = createLumiManagedOpenAiCompatibleConfig({
    controlPlaneBaseUrl: "https://control-plane.example",
    organizationId,
    // Legacy callers may still pass this field; the static projection must ignore it.
    sessionToken,
  });

  assert.deepEqual(config, {
    providerId: "lumi-managed",
    kind: "openai-compatible",
    baseURL: "https://control-plane.example/api/v1/inference",
    headers: { "X-Org-ID": organizationId },
  });
  assert.equal("apiKey" in config, false);
  assert.equal(JSON.stringify(config).includes(sessionToken), false);
});

test("managed run headers contain only bounded, non-secret correlation fields", async () => {
  const source = createLumiManagedRequestAuthSource({ context, sessionToken });
  const auth = await source.resolve({
    attempt: 2,
    providerId: "lumi-managed",
    modelId: "coding-default",
  });

  assert.deepEqual(auth.headers, {
    [LUMI_MANAGED_CORRELATION_HEADERS.organizationId]: organizationId,
    [LUMI_MANAGED_CORRELATION_HEADERS.projectId]: projectId,
    [LUMI_MANAGED_CORRELATION_HEADERS.deviceId]: deviceId,
    [LUMI_MANAGED_CORRELATION_HEADERS.agentSessionId]: agentSessionId,
    [LUMI_MANAGED_CORRELATION_HEADERS.runId]: runId,
    [LUMI_MANAGED_CORRELATION_HEADERS.agentDefinitionId]: agentDefinitionId,
    [LUMI_MANAGED_CORRELATION_HEADERS.agentDefinitionVersion]: "3",
    [LUMI_MANAGED_CORRELATION_HEADERS.requestId]: requestId,
    [LUMI_MANAGED_CORRELATION_HEADERS.externalId]: "zcode-session-123",
    [LUMI_MANAGED_CORRELATION_HEADERS.executionMode]: "managed",
  });
  assert.equal(auth.apiKey, sessionToken);
  assert.equal(
    Object.values(auth.headers).some((value) => value.includes(sessionToken)),
    false,
  );
});

test("managed context is normalized independently for each run", async () => {
  const first = createLumiManagedRequestDependencies({
    context,
    sessionToken,
  });
  const secondContext: ManagedRunContext = {
    ...context,
    runId: `run_${"f".repeat(32)}`,
    requestId: `req_${"e".repeat(32)}`,
  };
  const second = createLumiManagedRequestDependencies({
    context: secondContext,
    sessionToken: "second-runtime-token",
  });

  const firstAuth = await first.requestAuth.source.resolve({ attempt: 1 });
  const secondAuth = await second.requestAuth.source.resolve({ attempt: 1 });

  assert.equal(firstAuth.headers[LUMI_MANAGED_CORRELATION_HEADERS.runId], runId);
  assert.equal(firstAuth.headers[LUMI_MANAGED_CORRELATION_HEADERS.requestId], requestId);
  assert.equal(secondAuth.headers[LUMI_MANAGED_CORRELATION_HEADERS.runId], secondContext.runId);
  assert.equal(
    secondAuth.headers[LUMI_MANAGED_CORRELATION_HEADERS.requestId],
    secondContext.requestId,
  );
  assert.notEqual(firstAuth.apiKey, secondAuth.apiKey);
});

test("local-only context is explicit and cannot create managed auth", () => {
  const localContext = { ...context, executionMode: "local_only" as const };
  assert.throws(
    () => createLumiManagedRequestAuthSource({ context: localContext, sessionToken }),
    /managed run context/,
  );
  assert.equal(serializeManagedRunContext(localContext).execution_mode, "local_only");
});

test("managed context rejects an unknown execution mode", () => {
  assert.throws(
    () =>
      serializeManagedRunContext({
        ...context,
        executionMode: "unknown" as never,
      }),
    /execution mode is invalid/,
  );
});

test("serialized managed context and auth source contain no session token", () => {
  const serialized = serializeManagedRunContext(context);
  const source = createLumiManagedRequestAuthSource({ context, sessionToken });
  const dependencies = createLumiManagedRequestDependencies({ context, sessionToken });

  assert.deepEqual(serialized, {
    org_id: organizationId,
    project_id: projectId,
    device_id: deviceId,
    agent_session_id: agentSessionId,
    run_id: runId,
    agent_definition_id: agentDefinitionId,
    agent_definition_version: 3,
    request_id: requestId,
    external_id: "zcode-session-123",
    execution_mode: "managed",
  });
  assert.equal(JSON.stringify(serialized).includes(sessionToken), false);
  assert.equal(JSON.stringify(source).includes(sessionToken), false);
  assert.deepEqual(Object.keys(source), ["resolve"]);
  assert.equal(Object.hasOwn(source, "sessionToken"), false);
  assert.equal(Object.hasOwn(dependencies.requestAuth.source, "sessionToken"), false);
});
