/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { LumiDeviceHostTransport } from "./deviceTransport.js";
import type { ZCodeManagedToolDecisionRequestParams } from "@zcode/shared";

const id = (prefix: string) => `${prefix}_${"a".repeat(32)}`;
const makeUntrustedToken = () => ["untrusted", "fixture"].join("-");
const params: ZCodeManagedToolDecisionRequestParams = {
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
    policySnapshotId: id("pol"),
    policyVersion: 1,
  },
  traceId: "trace_fixture",
  sessionId: "local-session",
  toolCallId: id("tcl"),
  localToolCallId: "local-tool",
  tool: {
    toolId: id("tool"),
    name: "ReviewedTool",
    fingerprint: `sha256:${"b".repeat(64)}`,
    source: "built_in",
    riskClass: "filesystem_write",
    capabilityIds: ["filesystem.write"],
    catalogued: true,
  },
  argumentsSummary: "bounded synthetic summary",
  argumentsHash: createHash("sha256").update("bounded synthetic summary").digest("hex"),
};

test("private tool transport uses DeviceToken only and rejects unbound allows", async () => {
  let calls = 0;
  let override: Record<string, unknown> = {};
  let claimOverride: Record<string, unknown> = {};
  let claimCalls = 0;
  const server = createServer(async (request, response) => {
    calls++;
    const isClaim =
      request.url === `/api/v1/devices/runs/${id("run")}/tool-calls/${id("tcl")}/result`;
    assert(isClaim || request.url === `/api/v1/runs/${id("run")}/tool-decisions`);
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, `DeviceToken ${"c".repeat(64)}`);
    assert.equal(request.headers.cookie, undefined);
    let body = "";
    for await (const part of request) body += part;
    const preflight = {
      tool_call_id: id("tcl"),
      tool_id: id("tool"),
      tool_fingerprint: params.tool.fingerprint,
      capability_ids: params.tool.capabilityIds,
      risk_class: params.tool.riskClass,
      arguments_summary: params.argumentsSummary,
    };
    if (isClaim) {
      claimCalls++;
      assert.match(String(request.headers["idempotency-key"]), /^[0-9a-f-]{36}$/);
      assert.deepEqual(JSON.parse(body), {
        status: "allowed",
        preflight,
        arguments_hash: params.argumentsHash,
        policy_version: 1,
      });
    } else assert.deepEqual(JSON.parse(body), preflight);
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        decision: "allow",
        run_id: id("run"),
        tool_call_id: id("tcl"),
        tool_id: id("tool"),
        tool_fingerprint: params.tool.fingerprint,
        risk_class: params.tool.riskClass,
        policy_version: 1,
        policy_state: "ok",
        arguments_hash: params.argumentsHash,
        ...override,
        ...(isClaim
          ? { status: "allowed", execution_started_at: new Date().toISOString(), ...claimOverride }
          : {}),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const device = new LumiDeviceHostTransport(`http://127.0.0.1:${address.port}`, fetch, {
      load: async () => ({
        id: id("dvc"),
        orgId: id("org"),
        token: "c".repeat(64),
        tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        policyVersion: 1,
      }),
      save: async () => {},
    });
    await device.restore();
    assert.equal((await device.requestManagedToolDecision(params)).decision, "allow");
    assert.equal(claimCalls, 1, "a policy allow must acquire its execution permit");
    for (const mismatch of [
      { run_id: `run_${"d".repeat(32)}` },
      { tool_call_id: `tcl_${"d".repeat(32)}` },
      { tool_id: `tool_${"d".repeat(32)}` },
      { tool_fingerprint: `sha256:${"d".repeat(64)}` },
      { risk_class: "read_only" },
      { arguments_hash: "d".repeat(64) },
      { arguments_hash: null },
      { policy_version: 2 },
      { policy_state: "stale" },
    ]) {
      override = mismatch;
      await assert.rejects(device.requestManagedToolDecision(params));
    }
    override = {};
    for (const mismatch of [
      { status: "completed" },
      { execution_started_at: null },
      { execution_started_at: "invalid" },
      { run_id: `run_${"d".repeat(32)}` },
      { tool_call_id: `tcl_${"d".repeat(32)}` },
      { tool_id: `tool_${"d".repeat(32)}` },
      { tool_fingerprint: `sha256:${"d".repeat(64)}` },
      { risk_class: "read_only" },
      { arguments_hash: "d".repeat(64) },
      { arguments_hash: null },
      { policy_version: 2 },
      { policy_state: "stale" },
      { decision: "deny" },
      { approval_id: id("apr"), approval_mode: "per_use" },
    ]) {
      claimOverride = mismatch;
      await assert.rejects(device.requestManagedToolDecision(params));
    }
    claimOverride = {};
    override = {
      approval_id: id("apr"),
      approval_mode: "per_use",
      approval_expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    assert.equal(
      (await device.requestManagedToolDecision(params)).approvalId,
      id("apr"),
      "approval-based allow requires the same claimed approval binding",
    );
    const before = calls;
    for (const input of [
      { ...params, argumentsHash: "f".repeat(64) },
      { ...params, context: { ...params.context, organizationId: `org_${"e".repeat(32)}` } },
      { ...params, context: { ...params.context, deviceId: `dvc_${"e".repeat(32)}` } },
      { ...params, token: makeUntrustedToken() },
    ])
      await assert.rejects(device.requestManagedToolDecision(input));
    assert.equal(calls, before, "invalid inputs must not reach the socket");
    override = { decision: "deny", reason: "tool_not_found", arguments_hash: null };
    const beforeDeny = claimCalls;
    assert.equal((await device.requestManagedToolDecision(params)).decision, "deny");
    assert.equal(claimCalls, beforeDeny, "denial must not attempt an execution claim");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
