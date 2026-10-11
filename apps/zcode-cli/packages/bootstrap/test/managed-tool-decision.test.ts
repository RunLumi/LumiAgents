/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import { createManagedToolDecisionPort } from "../src/zcode-protocol/managed-tool-decision.js";

test("managed reverse port serializes metadata and carries abort/trace outside params", async () => {
  let calls = 0;
  const abort = new AbortController();
  const request = {
    context: Object.fromEntries(
      [
        "organizationId",
        "projectId",
        "deviceId",
        "agentSessionId",
        "runId",
        "agentDefinitionId",
        "requestId",
      ].map((key, index) => [
        key,
        `${["org", "prj", "dvc", "rse", "run", "agd", "req"][index]}_${"a".repeat(32)}`,
      ]),
    ),
    trace: { traceId: "trace_fixture", spanId: "span_fixture" },
    traceId: "trace_fixture",
    sessionId: "local-session",
    toolCallId: `tcl_${"b".repeat(32)}`,
    localToolCallId: "local-tool",
    tool: {
      toolId: `tool_${"c".repeat(32)}`,
      name: "ReadTool",
      fingerprint: `sha256:${"d".repeat(64)}`,
      source: "built_in",
      riskClass: "read_only",
      capabilityIds: [],
    },
    argumentsSummary: "synthetic",
    argumentsHash: "e".repeat(64),
    signal: abort.signal,
  };
  Object.assign(request.context, { executionMode: "managed", agentDefinitionVersion: 1 });
  const port = createManagedToolDecisionPort({
    requestClient: async (
      method: string,
      params: Record<string, unknown>,
      _schema: unknown,
      options: Record<string, unknown>,
    ) => {
      calls++;
      assert.equal(method, "interaction/requestManagedToolDecision");
      assert.equal(options.signal, abort.signal);
      assert.equal(options.timeoutMs, 940_000);
      assert.equal(JSON.stringify(params).includes("signal"), false);
      assert.equal(JSON.stringify(params).includes("span_fixture"), false);
      assert.equal(params.traceId, "trace_fixture");
      return { decision: "deny" };
    },
  } as never);
  await port.requestDecision(request as never);
  await assert.rejects(
    port.requestDecision({ ...request, traceId: "other-trace" } as never),
    /managed_trace_mismatch/,
  );
  await assert.rejects(
    port.requestDecision({ ...request, tool: { ...request.tool, apiKey: "secret" } } as never),
  );
  assert.equal(calls, 1);
});

test("identity reverse port binds run and sends no tool arguments", async () => {
  const id = (prefix: string) => `${prefix}_${"a".repeat(32)}`;
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
    trace: { traceId: "trace_fixture" },
    traceId: "trace_fixture",
    sessionId: "local-session",
    tool: {
      toolId: id("tool"),
      name: "Fixture",
      fingerprint: "b".repeat(64),
      source: "built_in",
      riskClass: "external_side_effect",
      capabilityIds: [],
      catalogued: false,
    },
  };
  let runId = id("run");
  const port = createManagedToolDecisionPort({
    requestClient: async (method, params) => {
      assert.equal(method, "interaction/resolveManagedToolIdentity");
      assert.deepEqual(Object.keys(params as object).sort(), [
        "context",
        "sessionId",
        "tool",
        "traceId",
      ]);
      return { runId, identity: { ...request.tool, catalogued: true } };
    },
  } as never);
  assert.equal((await port.resolveIdentity!(request as never))?.catalogued, true);
  runId = `run_${"d".repeat(32)}`;
  await assert.rejects(port.resolveIdentity!(request as never), /managed_identity_scope_mismatch/);
});

test("automatic result port sends minimal metadata with independent cleanup deadline and bound ACK", async () => {
  const id = (prefix: string) => `${prefix}_${"a".repeat(32)}`;
  const controller = new AbortController();
  controller.abort();
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
    toolCallId: id("tcl"),
    signal: controller.signal,
    argumentsSummary: "PRIVATE_SUMMARY",
    rawOutput: "PRIVATE_OUTPUT",
  };
  let calls = 0;
  let mismatch: Record<string, unknown> = {};
  const port = createManagedToolDecisionPort({
    requestClient: async (
      method: string,
      params: Record<string, unknown>,
      _schema: unknown,
      options: Record<string, unknown>,
    ) => {
      calls++;
      assert.equal(method, "interaction/reportManagedToolResult");
      assert.deepEqual(Object.keys(params).sort(), [
        "context",
        "sessionId",
        "status",
        "toolCallId",
        "traceId",
      ]);
      assert.equal(JSON.stringify(params).includes("PRIVATE_"), false);
      assert.equal(options.signal, undefined);
      assert.equal(options.timeoutMs, 45_000);
      return {
        recorded: true,
        runId: id("run"),
        toolCallId: id("tcl"),
        status: "cancelled",
        ...mismatch,
      };
    },
  } as never);
  await port.reportResult!(request as never, "cancelled");
  for (const wrong of [
    { runId: `run_${"d".repeat(32)}` },
    { toolCallId: `tcl_${"d".repeat(32)}` },
    { status: "completed" },
  ]) {
    mismatch = wrong;
    await assert.rejects(
      port.reportResult!(request as never, "cancelled"),
      /managed_result_ack_mismatch/,
    );
  }
  const before = calls;
  await assert.rejects(
    port.reportResult!({ ...request, traceId: "other_trace" } as never, "cancelled"),
    /managed_trace_mismatch/,
  );
  await assert.rejects(
    port.reportResult!(
      { ...request, context: { ...request.context, executionMode: "local_only" } } as never,
      "cancelled",
    ),
  );
  assert.equal(calls, before);
});
