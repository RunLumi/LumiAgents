/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import { createManagedToolDecisionPort } from "../src/zcode-protocol/managed-tool-decision.js";

const id = (prefix: string) => `${prefix}_${"a".repeat(32)}`;
const capabilities = {
  filesystem_write: true,
  process_execution: false,
  network_access: false,
  mcp_execution: false,
  browser_use: false,
  computer_use: false,
};
const request = {
  context: {
    organizationId: id("org"),
    projectId: id("prj"),
    deviceId: id("dvc"),
    agentSessionId: id("rse"),
    runId: id("run"),
    agentDefinitionId: id("agd"),
    agentDefinitionVersion: 1,
    requestId: id("req"),
    executionMode: "managed",
  },
  trace: { traceId: "trace_fixture", spanId: "span_fixture" },
  traceId: "trace_fixture",
  sessionId: "local-session",
  capabilities,
};

test("runtime capability port sends only the strict booleans and binds the ack to the run", async () => {
  let ackRun = id("run");
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const port = createManagedToolDecisionPort({
    requestClient: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      return { runId: ackRun, recorded: true };
    },
  } as never);
  await port.reportRuntimeCapabilities!(request as never);
  assert.equal(calls[0].method, "interaction/reportRuntimeCapabilities");
  assert.deepEqual(Object.keys(calls[0].params).sort(), [
    "capabilities",
    "context",
    "sessionId",
    "traceId",
  ]);
  assert.deepEqual(calls[0].params.capabilities, capabilities);
  assert.equal(JSON.stringify(calls[0].params).includes("span_fixture"), false);
  ackRun = `run_${"d".repeat(32)}`;
  await assert.rejects(
    port.reportRuntimeCapabilities!(request as never),
    /managed_capabilities_scope_mismatch/,
  );
});

test("runtime capability port refuses extra inventory, non-boolean values and trace mismatch before IO", async () => {
  let calls = 0;
  const port = createManagedToolDecisionPort({
    requestClient: async () => {
      calls++;
      return { runId: id("run"), recorded: true };
    },
  } as never);
  await assert.rejects(
    port.reportRuntimeCapabilities!({
      ...request,
      capabilities: { ...capabilities, tools: ["Bash"] },
    } as never),
  );
  await assert.rejects(
    port.reportRuntimeCapabilities!({
      ...request,
      capabilities: { ...capabilities, filesystem_write: "true" },
    } as never),
  );
  await assert.rejects(
    port.reportRuntimeCapabilities!({
      ...request,
      capabilities: { filesystem_write: true },
    } as never),
  );
  await assert.rejects(
    port.reportRuntimeCapabilities!({ ...request, traceId: "other" } as never),
    /managed_trace_mismatch/,
  );
  assert.equal(calls, 0);
});
