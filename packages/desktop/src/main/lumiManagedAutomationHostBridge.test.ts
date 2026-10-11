/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import { createManagedAutomationHostBridge } from "./lumiManagedAutomationHostBridge.js";

const suffix = "0123456789abcdef0123456789abcdef";
const input = {
  localAutomationId: "automation-1",
  workspacePath: "/ws",
  prompt: "p",
  modelAlias: "coding-default",
  managedContext: {
    organizationId: `org_${suffix}`,
    projectId: `prj_${suffix}`,
    deviceId: `dvc_${suffix}`,
    agentSessionId: `rse_${suffix}`,
    runId: `run_${suffix}`,
    agentDefinitionId: `agd_${suffix}`,
    agentDefinitionVersion: 1,
    requestId: `req_${suffix}`,
    executionMode: "managed" as const,
  },
};

function host() {
  const posted: Record<string, unknown>[] = [];
  return { posted, postMessage: (message: Record<string, unknown>) => void posted.push(message) };
}

test("a dispatch is one validated message to one host and resolves with its reply", async () => {
  const target = host();
  const bridge = createManagedAutomationHostBridge({ resolveHost: () => target, timeoutMs: 1_000 });
  const pending = bridge.dispatch(input);
  assert.equal(target.posted.length, 1);
  const message = target.posted[0]!;
  assert.equal(message.type, "lumi-managed-automation-run");
  assert.equal(typeof message.requestId, "string");
  bridge.handleResult({
    type: "lumi-managed-automation-run-result",
    requestId: message.requestId as string,
    ok: true,
    taskId: "task-9",
  });
  assert.deepEqual(await pending, { ok: true, taskId: "task-9" });
});

test("with no host the dispatch is refused without posting and availability says so", async () => {
  const bridge = createManagedAutomationHostBridge({ resolveHost: () => null, timeoutMs: 1_000 });
  assert.equal(bridge.available(), false);
  assert.deepEqual(await bridge.dispatch(input), {
    ok: false,
    errorCode: "lumi_managed_automation_host_unavailable",
  });
});

test("a reply for an unknown or already-answered request is ignored and cannot satisfy another", async () => {
  const target = host();
  const bridge = createManagedAutomationHostBridge({ resolveHost: () => target, timeoutMs: 1_000 });
  const first = bridge.dispatch(input);
  const requestId = target.posted[0]!.requestId as string;
  bridge.handleResult({
    type: "lumi-managed-automation-run-result",
    requestId: "someone-else",
    ok: true,
    taskId: "forged",
  });
  bridge.handleResult({
    type: "lumi-managed-automation-run-result",
    requestId,
    ok: false,
    errorCode: "lumi_managed_automation_prompt_failed",
  });
  bridge.handleResult({
    type: "lumi-managed-automation-run-result",
    requestId,
    ok: true,
    taskId: "late",
  });
  assert.deepEqual(await first, {
    ok: false,
    errorCode: "lumi_managed_automation_prompt_failed",
  });
});

test("no reply within the bound is a stable timeout, and a late reply is dropped", async () => {
  const target = host();
  const bridge = createManagedAutomationHostBridge({ resolveHost: () => target, timeoutMs: 10 });
  const result = await bridge.dispatch(input);
  assert.deepEqual(result, { ok: false, errorCode: "lumi_managed_automation_host_timeout" });
  bridge.handleResult({
    type: "lumi-managed-automation-run-result",
    requestId: target.posted[0]!.requestId as string,
    ok: true,
    taskId: "late",
  });
});

test("a message the host schema would reject never leaves Main", async () => {
  const target = host();
  const bridge = createManagedAutomationHostBridge({ resolveHost: () => target, timeoutMs: 1_000 });
  const result = await bridge.dispatch({ ...input, prompt: "" });
  assert.deepEqual(result, { ok: false, errorCode: "lumi_managed_automation_request_invalid" });
  assert.deepEqual(target.posted, []);
});

const otherRun = `run_${"9".repeat(32)}`;
const dispatchInput = (runId: string) => ({
  ...input,
  managedContext: { ...input.managedContext, runId },
});

function cancelAck(
  target: ReturnType<typeof host>,
  index: number,
  override: Record<string, unknown> = {},
) {
  const message = target.posted[index]!;
  return {
    type: "lumi-managed-automation-cancel-result" as const,
    requestId: message.requestId as string,
    runId: message.runId as string,
    ok: true,
    outcome: "stopped" as const,
    ...override,
  } as Parameters<ReturnType<typeof createManagedAutomationHostBridge>["handleCancelResult"]>[0];
}

test("cancel goes only to the host that received the run, as a strict message with no credential", async () => {
  const first = host();
  const second = host();
  let current = first;
  const bridge = createManagedAutomationHostBridge({
    resolveHost: () => current,
    timeoutMs: 1_000,
    cancelTimeoutMs: 1_000,
  });
  void bridge.dispatch(input);
  current = second; // a later dispatch lands on another host; the first run must still cancel on `first`
  void bridge.dispatch(dispatchInput(otherRun));
  assert.equal(first.posted.length, 1);
  assert.equal(second.posted.length, 1);

  const cancelling = bridge.cancel(input.managedContext.runId);
  assert.equal(second.posted.length, 1, "the other host is never asked");
  assert.equal(first.posted.length, 2);
  const message = first.posted[1]!;
  assert.deepEqual(Object.keys(message).sort(), ["requestId", "runId", "type"]);
  assert.equal(message.type, "lumi-managed-automation-cancel");
  assert.equal(message.runId, input.managedContext.runId);
  bridge.handleCancelResult(cancelAck(first, 1));
  assert.deepEqual(await cancelling, { ok: true, outcome: "stopped" });
  bridge.dispose();
});

test("an unknown run is refused without posting anything", async () => {
  const target = host();
  const bridge = createManagedAutomationHostBridge({ resolveHost: () => target, timeoutMs: 1_000 });
  assert.deepEqual(await bridge.cancel(otherRun), {
    ok: false,
    errorCode: "lumi_managed_automation_run_unknown",
  });
  assert.deepEqual(target.posted, []);
});

test("cancel works while the dispatch reply is still pending", async () => {
  const target = host();
  const bridge = createManagedAutomationHostBridge({
    resolveHost: () => target,
    timeoutMs: 1_000,
    cancelTimeoutMs: 1_000,
  });
  const dispatching = bridge.dispatch(input);
  const cancelling = bridge.cancel(input.managedContext.runId);
  bridge.handleCancelResult(cancelAck(target, 1, { outcome: "prevented" }));
  assert.deepEqual(await cancelling, { ok: true, outcome: "prevented" });
  bridge.handleResult({
    type: "lumi-managed-automation-run-result",
    requestId: target.posted[0]!.requestId as string,
    ok: false,
    errorCode: "lumi_managed_automation_cancelled",
  });
  assert.deepEqual(await dispatching, {
    ok: false,
    errorCode: "lumi_managed_automation_cancelled",
  });
});

test("duplicate and concurrent cancels are idempotent: one request, then already_cancelled", async () => {
  const target = host();
  const bridge = createManagedAutomationHostBridge({
    resolveHost: () => target,
    timeoutMs: 1_000,
    cancelTimeoutMs: 1_000,
  });
  void bridge.dispatch(input);
  const a = bridge.cancel(input.managedContext.runId);
  const b = bridge.cancel(input.managedContext.runId);
  assert.equal(target.posted.length, 2, "concurrent callers share one request");
  bridge.handleCancelResult(cancelAck(target, 1));
  assert.deepEqual(await a, { ok: true, outcome: "stopped" });
  assert.deepEqual(await b, { ok: true, outcome: "stopped" });
  assert.deepEqual(await bridge.cancel(input.managedContext.runId), {
    ok: true,
    outcome: "already_cancelled",
  });
  assert.equal(target.posted.length, 2, "a confirmed run is not asked again");
  bridge.dispose();
});

test("only an ACK matching both the request and the run confirms a cancel", async () => {
  const target = host();
  const bridge = createManagedAutomationHostBridge({
    resolveHost: () => target,
    timeoutMs: 1_000,
    cancelTimeoutMs: 40,
  });
  void bridge.dispatch(input);
  const cancelling = bridge.cancel(input.managedContext.runId);
  bridge.handleCancelResult(cancelAck(target, 1, { runId: otherRun })); // right request, wrong run
  bridge.handleCancelResult(cancelAck(target, 1, { requestId: "forged" })); // right run, wrong request
  assert.deepEqual(await cancelling, {
    ok: false,
    errorCode: "lumi_managed_automation_host_timeout",
  });
  // A late genuine ACK after the timeout is dropped and does not mark the run confirmed.
  bridge.handleCancelResult(cancelAck(target, 1));
  void bridge.cancel(input.managedContext.runId);
  assert.equal(target.posted.length, 3, "an unconfirmed run is asked again, not memoised");
  bridge.dispose();
});

test("a host refusal and a throwing host are stable failures that a retry can recover from", async () => {
  const target = host();
  let broken = false;
  const bridge = createManagedAutomationHostBridge({
    resolveHost: () => ({
      postMessage: (message) => {
        if (broken) throw new Error("channel closed /Users/me");
        target.postMessage(message as Record<string, unknown>);
      },
    }),
    timeoutMs: 1_000,
    cancelTimeoutMs: 1_000,
  });
  void bridge.dispatch(input);
  const refused = bridge.cancel(input.managedContext.runId);
  bridge.handleCancelResult(
    cancelAck(target, 1, {
      ok: false,
      outcome: undefined,
      errorCode: "lumi_managed_automation_stop_failed",
    }),
  );
  assert.deepEqual(await refused, { ok: false, errorCode: "lumi_managed_automation_stop_failed" });
  broken = true;
  assert.deepEqual(await bridge.cancel(input.managedContext.runId), {
    ok: false,
    errorCode: "lumi_managed_automation_host_unavailable",
  });
  broken = false;
  const retry = bridge.cancel(input.managedContext.runId);
  bridge.handleCancelResult(cancelAck(target, 2));
  assert.deepEqual(await retry, { ok: true, outcome: "stopped" });
  bridge.dispose();
});

// ---- Stop authority is never evicted while a run may still be active (spec 07 invariants) ----

const CAP = 256;
const runN = (n: number) => `run_${n.toString(16).padStart(32, "0")}`;
type Bridge = ReturnType<typeof createManagedAutomationHostBridge>;

function acceptRun(bridge: Bridge, target: ReturnType<typeof host>, n: number) {
  const before = target.posted.length;
  const pending = bridge.dispatch(dispatchInput(runN(n)));
  assert.equal(target.posted.length, before + 1, "run " + n + " was posted");
  bridge.handleResult({
    type: "lumi-managed-automation-run-result",
    requestId: target.posted[before]!.requestId as string,
    ok: true,
    taskId: "task-" + n,
  });
  return pending;
}

function cappedBridge(targets: ReturnType<typeof host>[]) {
  let next = 0;
  return createManagedAutomationHostBridge({
    resolveHost: () => targets[next++ % targets.length]!,
    timeoutMs: 1_000,
    cancelTimeoutMs: 1_000,
  });
}

test("accepted dispatches never evict stop authority: the 257th is refused, the 1st still cancels on its host", async () => {
  const first = host();
  const second = host();
  const bridge = cappedBridge([first, second]);
  for (let n = 1; n <= CAP; n++)
    assert.deepEqual(await acceptRun(bridge, n % 2 === 1 ? first : second, n), {
      ok: true,
      taskId: "task-" + n,
    });
  assert.equal(bridge.available(), false, "at the bound the poll must not claim");
  const postedBefore = first.posted.length + second.posted.length;
  assert.deepEqual(await bridge.dispatch(dispatchInput(runN(CAP + 1))), {
    ok: false,
    errorCode: "lumi_managed_automation_host_busy",
  });
  assert.equal(first.posted.length + second.posted.length, postedBefore, "a refused dispatch posts nothing");

  const oldest = bridge.cancel(runN(1));
  assert.equal(first.posted.at(-1)!.runId, runN(1));
  bridge.handleCancelResult(cancelAck(first, first.posted.length - 1));
  assert.deepEqual(await oldest, { ok: true, outcome: "stopped" });
  const newest = bridge.cancel(runN(CAP));
  assert.equal(second.posted.at(-1)!.runId, runN(CAP));
  bridge.handleCancelResult(cancelAck(second, second.posted.length - 1));
  assert.deepEqual(await newest, { ok: true, outcome: "stopped" });
  bridge.dispose();
});

test("a confirmed stop frees an active slot so admission resumes, and the stopped run answers already_cancelled", async () => {
  const target = host();
  const bridge = cappedBridge([target]);
  for (let n = 1; n <= CAP; n++) await acceptRun(bridge, target, n);
  assert.equal(bridge.available(), false);
  const stopping = bridge.cancel(runN(7));
  bridge.handleCancelResult(cancelAck(target, target.posted.length - 1, { outcome: "prevented" }));
  assert.deepEqual(await stopping, { ok: true, outcome: "prevented" });
  assert.equal(bridge.available(), true);
  assert.deepEqual(await acceptRun(bridge, target, CAP + 1), { ok: true, taskId: "task-" + (CAP + 1) });
  assert.equal(bridge.available(), false, "the slot is taken again");
  assert.deepEqual(await bridge.cancel(runN(7)), { ok: true, outcome: "already_cancelled" });
  bridge.dispose();
});

test("an unconfirmed stop (timeout, wrong ACK) keeps the run active and cancelable", async () => {
  const target = host();
  const bridge = createManagedAutomationHostBridge({
    resolveHost: () => target,
    timeoutMs: 1_000,
    cancelTimeoutMs: 20,
  });
  for (let n = 1; n <= CAP; n++) await acceptRun(bridge, target, n);
  const stopping = bridge.cancel(runN(3));
  bridge.handleCancelResult(cancelAck(target, target.posted.length - 1, { runId: runN(4) }));
  assert.deepEqual(await stopping, { ok: false, errorCode: "lumi_managed_automation_host_timeout" });
  assert.equal(bridge.available(), false, "no slot was freed by a mis-ACK or timeout");
  const retry = bridge.cancel(runN(3));
  bridge.handleCancelResult(cancelAck(target, target.posted.length - 1));
  assert.deepEqual(await retry, { ok: true, outcome: "stopped" });
  bridge.dispose();
});

test("retire after a proven terminal frees a slot; the retired run is then unknown and nothing else is touched", async () => {
  const target = host();
  const bridge = cappedBridge([target]);
  for (let n = 1; n <= CAP; n++) await acceptRun(bridge, target, n);
  bridge.retire(runN(1));
  bridge.retire(runN(99_999)); // unknown run: a no-op, never throws
  assert.equal(bridge.available(), true);
  const postedBefore = target.posted.length;
  assert.deepEqual(await bridge.cancel(runN(1)), {
    ok: false,
    errorCode: "lumi_managed_automation_run_unknown",
  });
  assert.equal(target.posted.length, postedBefore);
  const other = bridge.cancel(runN(2));
  bridge.handleCancelResult(cancelAck(target, target.posted.length - 1));
  assert.deepEqual(await other, { ok: true, outcome: "stopped" });
  bridge.dispose();
});

test("a dispatch timeout or Host refusal is not a terminal proof: the run stays cancelable", async () => {
  const target = host();
  const bridge = createManagedAutomationHostBridge({
    resolveHost: () => target,
    timeoutMs: 10,
    cancelTimeoutMs: 1_000,
  });
  assert.deepEqual(await bridge.dispatch(dispatchInput(runN(1))), {
    ok: false,
    errorCode: "lumi_managed_automation_host_timeout",
  });
  const refusing = bridge.dispatch(dispatchInput(runN(2)));
  bridge.handleResult({
    type: "lumi-managed-automation-run-result",
    requestId: target.posted[1]!.requestId as string,
    ok: false,
    errorCode: "lumi_managed_automation_prompt_failed",
  });
  await refusing;
  for (const n of [1, 2]) {
    const stopping = bridge.cancel(runN(n));
    assert.equal(target.posted.at(-1)!.runId, runN(n), "the owning host is still asked");
    bridge.handleCancelResult(cancelAck(target, target.posted.length - 1));
    assert.deepEqual(await stopping, { ok: true, outcome: "stopped" });
  }
  bridge.dispose();
});

test("a post that throws never delivered the run: no stop authority is kept and no slot is held", async () => {
  const bridge = createManagedAutomationHostBridge({
    resolveHost: () => ({
      postMessage: () => {
        throw new Error("closed");
      },
    }),
    timeoutMs: 1_000,
  });
  for (let n = 1; n <= CAP + 5; n++)
    assert.deepEqual(await bridge.dispatch(dispatchInput(runN(n))), {
      ok: false,
      errorCode: "lumi_managed_automation_host_unavailable",
    });
  assert.equal(bridge.available(), true);
  assert.deepEqual(await bridge.cancel(runN(1)), {
    ok: false,
    errorCode: "lumi_managed_automation_run_unknown",
  });
});

test("stop-confirmed memory is bounded separately and never evicts a still-active run", async () => {
  const target = host();
  const bridge = cappedBridge([target]);
  await acceptRun(bridge, target, 0); // stays active throughout
  for (let n = 1; n <= CAP + 10; n++) {
    await acceptRun(bridge, target, n);
    const stopping = bridge.cancel(runN(n));
    bridge.handleCancelResult(cancelAck(target, target.posted.length - 1));
    await stopping;
  }
  assert.equal(bridge.available(), true, "confirmed runs do not consume active capacity");
  assert.deepEqual(await bridge.cancel(runN(1)), {
    ok: false,
    errorCode: "lumi_managed_automation_run_unknown",
  });
  assert.deepEqual(await bridge.cancel(runN(CAP + 10)), { ok: true, outcome: "already_cancelled" });
  const stillActive = bridge.cancel(runN(0));
  bridge.handleCancelResult(cancelAck(target, target.posted.length - 1));
  assert.deepEqual(await stillActive, { ok: true, outcome: "stopped" });
  bridge.dispose();
});

test("a repeated run id never replaces the recorded owning host", async () => {
  const first = host();
  const second = host();
  const bridge = cappedBridge([first, second]);
  await acceptRun(bridge, first, 1);
  const postedBefore = first.posted.length + second.posted.length;
  assert.deepEqual(await bridge.dispatch(dispatchInput(runN(1))), {
    ok: false,
    errorCode: "lumi_managed_automation_run_duplicate",
  });
  assert.equal(first.posted.length + second.posted.length, postedBefore);
  const stopping = bridge.cancel(runN(1));
  assert.equal(first.posted.at(-1)!.runId, runN(1), "still stopped on the original host");
  assert.equal(second.posted.length, 0);
  bridge.handleCancelResult(cancelAck(first, first.posted.length - 1));
  assert.deepEqual(await stopping, { ok: true, outcome: "stopped" });
  bridge.dispose();
});

test("concurrent cancels at capacity share one request and one confirmation frees exactly one slot", async () => {
  const target = host();
  const bridge = cappedBridge([target]);
  for (let n = 1; n <= CAP; n++) await acceptRun(bridge, target, n);
  const a = bridge.cancel(runN(5));
  const b = bridge.cancel(runN(5));
  assert.equal(target.posted.length, CAP + 1, "one stop request for both callers");
  bridge.handleCancelResult(cancelAck(target, CAP));
  assert.deepEqual(await a, { ok: true, outcome: "stopped" });
  assert.deepEqual(await b, { ok: true, outcome: "stopped" });
  await acceptRun(bridge, target, CAP + 1);
  assert.equal(bridge.available(), false, "only one slot was freed");
  bridge.dispose();
});

test("a host that throws on post fails the dispatch instead of hanging", async () => {
  const bridge = createManagedAutomationHostBridge({
    resolveHost: () => ({
      postMessage: () => {
        throw new Error("channel closed /Users/me");
      },
    }),
    timeoutMs: 1_000,
  });
  assert.deepEqual(await bridge.dispatch(input), {
    ok: false,
    errorCode: "lumi_managed_automation_host_unavailable",
  });
});
