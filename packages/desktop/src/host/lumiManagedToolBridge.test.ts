/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createLumiManagedToolBridge } from "./lumiManagedToolBridge.js";

test("identity replies preserve null refusal and cannot be replaced by another reply kind", async () => {
  const sent: { requestId: string }[] = [];
  const bridge = createLumiManagedToolBridge((message) => sent.push(message as never));
  const pending = bridge.resolve({} as never, "owned-workspace");
  const request = sent[0];
  assert.ok(request);
  assert.equal(
    bridge.accept({
      type: "lumi-managed-tool-decision-result",
      requestId: request.requestId,
      ok: false,
      errorCode: "refused",
    }),
    false,
  );
  const reply = {
    type: "lumi-managed-tool-identity-result",
    requestId: request.requestId,
    ok: true,
    resolution: { runId: `run_${"a".repeat(32)}`, identity: null },
  };
  assert.equal(bridge.accept({ ...reply, deviceToken: "secret" }), false);
  assert.equal(bridge.accept(reply), true);
  assert.equal((await pending).identity, null);
  assert.equal(bridge.accept(reply), false);
  bridge.dispose();
});

test("private tool bridge matches independent requests and refuses stale, malformed and expired replies", async () => {
  const sent: { requestId: string }[] = [];
  const bridge = createLumiManagedToolBridge((message) => sent.push(message as never), 25);
  const request = {} as never;
  const first = bridge.request(request, "owned-workspace");
  const second = bridge.request(request, "owned-workspace");
  const firstRequest = sent[0];
  const secondRequest = sent[1];
  assert.ok(firstRequest);
  assert.ok(secondRequest);
  assert.notEqual(firstRequest.requestId, secondRequest.requestId);
  const refusal = (requestId: string) => ({
    type: "lumi-managed-tool-decision-result",
    requestId,
    ok: false,
    errorCode: "lumi_managed_tool_refused",
  });
  assert.equal(bridge.accept({ ...refusal(firstRequest.requestId), deviceToken: "secret" }), false);
  assert.equal(bridge.accept(refusal("unrelated-request")), false);
  const secondRejected = assert.rejects(second, /lumi_managed_tool_refused/);
  assert.equal(bridge.accept(refusal(secondRequest.requestId)), true);
  await secondRejected;
  assert.equal(bridge.accept(refusal(secondRequest.requestId)), false);
  const firstRejected = assert.rejects(first, /lumi_managed_tool_timeout/);
  await delay(40);
  await firstRejected;
  assert.equal(bridge.accept(refusal(firstRequest.requestId)), false);
  const closing = assert.rejects(
    bridge.request(request, "owned-workspace"),
    /lumi_managed_tool_unavailable/,
  );
  bridge.dispose();
  await closing;
});

test("runtime capability ACK is request-bound, kind-bound and strict", async () => {
  const sent: { requestId: string; type: string; workspaceIdentity: string }[] = [];
  const bridge = createLumiManagedToolBridge((message) => sent.push(message as never));
  const id = (prefix: string) => `${prefix}_${"a".repeat(32)}`;
  const pending = bridge.reportCapabilities({} as never, "owned-workspace");
  const request = sent[0];
  assert.ok(request);
  assert.equal(request.type, "lumi-runtime-capabilities-request");
  assert.equal(request.workspaceIdentity, "owned-workspace");
  // A report ACK (same request id) cannot satisfy a capability request.
  assert.equal(
    bridge.accept({
      type: "lumi-managed-tool-report-result",
      requestId: request.requestId,
      ok: true,
      ack: { recorded: true, runId: id("run"), toolCallId: id("tcl"), status: "completed" },
    }),
    false,
  );
  const reply = {
    type: "lumi-runtime-capabilities-result",
    requestId: request.requestId,
    ok: true,
    ack: { runId: id("run"), recorded: true },
  };
  assert.equal(bridge.accept({ ...reply, extra: "PRIVATE" }), false);
  assert.equal(bridge.accept({ ...reply, ack: { runId: id("run"), recorded: false } }), false);
  assert.equal(bridge.accept(reply), true);
  assert.deepEqual(await pending, { runId: id("run"), recorded: true });
  assert.equal(bridge.accept(reply), false);

  const refused = bridge.reportCapabilities({} as never, "owned-workspace");
  const second = sent[1];
  assert.ok(second);
  const refusedAssertion = assert.rejects(refused, /lumi_runtime_capabilities_refused/);
  assert.equal(
    bridge.accept({
      type: "lumi-runtime-capabilities-result",
      requestId: second.requestId,
      ok: false,
      errorCode: "lumi_runtime_capabilities_refused",
    }),
    true,
  );
  await refusedAssertion;
  bridge.dispose();
});

test("report ACK cannot be substituted by a decision reply and late replies stay stale", async () => {
  const sent: { requestId: string }[] = [];
  const bridge = createLumiManagedToolBridge((message) => sent.push(message as never));
  const report = bridge.report({} as never, "owned-workspace");
  const request = sent[0];
  assert.ok(request);
  assert.equal(
    bridge.accept({
      type: "lumi-managed-tool-decision-result",
      requestId: request.requestId,
      ok: false,
      errorCode: "lumi_managed_tool_refused",
    }),
    false,
  );
  const id = (prefix: string) => `${prefix}_${"a".repeat(32)}`;
  const reply = {
    type: "lumi-managed-tool-report-result",
    requestId: request.requestId,
    ok: true,
    ack: { recorded: true, runId: id("run"), toolCallId: id("tcl"), status: "completed" },
  };
  assert.equal(bridge.accept({ ...reply, output: "PRIVATE_OUTPUT" }), false);
  assert.equal(bridge.accept(reply), true);
  assert.equal((await report).recorded, true);
  assert.equal(bridge.accept(reply), false);
  bridge.dispose();
});
