/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ZCodeManagedToolDecisionRequestParams } from "@zcode/shared";
import { LumiManagedToolHostTransport } from "./managedToolTransport.js";
import { LumiDeviceHostTransport } from "./deviceTransport.js";

const id = (prefix: string) => `${prefix}_${"a".repeat(32)}`;
const summary = "input_digest=" + "b".repeat(64) + ";operation=write;type=object";
const input: ZCodeManagedToolDecisionRequestParams = {
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
    policyVersion: 1,
    policySnapshotId: id("pol"),
  },
  traceId: "trace_fixture",
  sessionId: "local-session",
  toolCallId: id("tcl"),
  localToolCallId: "local-tool",
  tool: {
    toolId: id("tool"),
    name: "ReviewedWrite",
    fingerprint: "b".repeat(64),
    riskClass: "filesystem_write",
    source: "built_in",
    capabilityIds: [],
    catalogued: true,
  },
  argumentsSummary: summary,
  argumentsHash: createHash("sha256").update(summary).digest("hex"),
};
const decision = {
  decision: "allow",
  run_id: id("run"),
  tool_call_id: id("tcl"),
  tool_id: id("tool"),
  tool_fingerprint: input.tool.fingerprint,
  risk_class: input.tool.riskClass,
  policy_version: 1,
  policy_state: "ok",
  arguments_hash: input.argumentsHash,
};
const credential = {
  id: id("dvc"),
  orgId: id("org"),
  token: "c".repeat(64),
  tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  policyVersion: 1,
};

test("only a completed admission releases allow before an actual file handler", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lumi-device-admission-")),
    file = join(dir, "sentinel.txt");
  let claimCount = 0,
    release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport = new LumiManagedToolHostTransport(
    async (path, _body, headers) => {
      if (path.endsWith("tool-decisions")) return decision;
      claimCount++;
      assert.match(headers?.["Idempotency-Key"] ?? "", /^[0-9a-f-]{36}$/);
      await gate;
      return { ...decision, status: "allowed", execution_started_at: new Date().toISOString() };
    },
    () => credential,
  );
  try {
    await writeFile(file, "before");
    const execution = transport.decide(input).then(async (result) => {
      assert.equal(result.decision, "allow");
      await writeFile(file, "after");
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(claimCount, 1);
    assert.equal(await readFile(file, "utf8"), "before");
    release();
    await execution;
    assert.equal(await readFile(file, "utf8"), "after");
  } finally {
    release();
    await rm(dir, { recursive: true, force: true });
  }
});

test("refused, ambiguous or unsupported admission never retries or releases allow", async () => {
  for (const fail of [
    () => {
      throw new Error("HTTP 404 old backend");
    },
    () => {
      throw new Error("HTTP 409 already claimed");
    },
    () => {
      throw new Error("response lost after commit");
    },
    () => undefined,
  ]) {
    let calls = 0;
    const transport = new LumiManagedToolHostTransport(
      async (path) => {
        calls++;
        if (path.endsWith("tool-decisions")) return decision;
        return fail();
      },
      () => credential,
    );
    await assert.rejects(transport.decide(input));
    assert.equal(calls, 2, "one decision and one claim; no automatic retry");
  }
});

test("pending approval returns its requirement without attempting a claim", async () => {
  let calls = 0;
  const transport = new LumiManagedToolHostTransport(
    async () => {
      calls++;
      return {
        ...decision,
        decision: "require_per_use_approval",
        approval_mode: "per_use",
        approval_id: id("apr"),
      };
    },
    () => credential,
  );
  assert.equal((await transport.decide(input)).decision, "require_per_use_approval");
  assert.equal(calls, 1);
});

test("result reporting sends status only and validates authoritative identity", async () => {
  let calls = 0;
  let override: Record<string, unknown> = {};
  const transport = new LumiManagedToolHostTransport(
    async (path, body, headers) => {
      calls++;
      assert.equal(path, `/api/v1/devices/runs/${id("run")}/tool-calls/${id("tcl")}/result`);
      assert.deepEqual(Object.keys(body), ["status"]);
      assert.match(headers?.["Idempotency-Key"] ?? "", /^[0-9a-f-]{36}$/);
      return {
        run_id: id("run"),
        tool_call_id: id("tcl"),
        status: body.status,
        updated_at: new Date().toISOString(),
        ...override,
      };
    },
    () => credential,
  );
  for (const status of ["completed", "failed", "cancelled"] as const)
    await transport.reportResult(input, status);
  for (const mismatch of [
    { run_id: `run_${"d".repeat(32)}` },
    { tool_call_id: `tcl_${"d".repeat(32)}` },
    { status: "allowed" },
    { org_id: `org_${"d".repeat(32)}` },
    { updated_at: null },
    { updated_at: "invalid" },
  ]) {
    override = mismatch;
    await assert.rejects(transport.reportResult(input, "completed"));
  }
  const before = calls;
  for (const request of [
    { ...input, argumentsHash: "f".repeat(64) },
    { ...input, context: { ...input.context, deviceId: `dvc_${"f".repeat(32)}` } },
    { ...input, rawOutput: "private" },
  ])
    await assert.rejects(transport.reportResult(request, "completed"));
  await assert.rejects(transport.reportResult(input, "allowed" as never));
  assert.equal(calls, before, "invalid reports must fail before network I/O");
});

test("policy snapshot id is validated and mapped from the actual policy_id wire field", async () => {
  let policyId: unknown = id("pol");
  const device = new LumiDeviceHostTransport(
    "http://127.0.0.1:8000",
    async () =>
      Response.json({
        org_id: id("org"),
        policy_id: policyId,
        policy_version: 1,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        payload: {},
      }),
    { load: async () => credential, save: async () => {} },
  );
  await device.restore();
  assert.equal((await device.policy()).id, id("pol"));
  for (const invalid of [undefined, null, "not-a-policy", {}]) {
    policyId = invalid;
    await assert.rejects(device.policy());
  }
});
