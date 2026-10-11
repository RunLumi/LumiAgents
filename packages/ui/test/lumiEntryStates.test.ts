import assert from "node:assert/strict";
import test from "node:test";
import type { LumiAccountBridge, LumiAccountCommand, LumiAccountResult } from "@zcode/shared";
import {
  initialLumiAccountFlow as initial,
  LUMI_FLOW_TIMEOUT_CODE,
  LUMI_FLOW_TIMEOUT_MS,
  LUMI_FLOW_SLOW_MS,
  lumiAccountFlowReducer as reduce,
} from "../src/lumi/lumiAccountFlow.js";
import {
  isLumiErrorRetryable,
  LUMI_ERROR_COPY_IDS,
  lumiErrorCopyId,
} from "../src/lumi/lumiErrorCopy.js";
import { LUMI_RESTORE_SHARE_WINDOW_MS, requestStartupRestore } from "../src/lumi/lumiRestore.js";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";

const account = { user: { id: "u1", email: "a@b.co", displayName: "A" }, organizations: [] };

test("a slow restore is flagged without ending the request, and settles normally", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, { type: "slow", seq: 1 });
  assert.equal(s.slow, true);
  assert.equal(s.busy, true);
  s = reduce(s, { type: "settled", seq: 1, command: "restore", result: { ok: true, account } });
  assert.equal(s.slow, false);
  assert.equal(s.account, account);
});

test("a slow notice for a superseded or finished request is ignored", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, { type: "start", seq: 2 });
  assert.equal(reduce(s, { type: "slow", seq: 1 }), s);
  s = reduce(s, { type: "settled", seq: 2, command: "restore", result: { ok: true } });
  assert.equal(reduce(s, { type: "slow", seq: 2 }), s);
});

test("timeout ends the wait with a restore error and fences the late host completion", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, { type: "slow", seq: 1 });
  s = reduce(s, { type: "timeout", seq: 1, nextSeq: 2, command: "restore" });
  assert.equal(s.busy, false);
  assert.equal(s.slow, false);
  assert.equal(s.restored, true);
  assert.equal(s.error, LUMI_FLOW_TIMEOUT_CODE);
  assert.equal(s.errorCommand, "restore");
  // The abandoned request finally answers with an account: it must not appear.
  const afterLate = reduce(s, {
    type: "settled",
    seq: 1,
    command: "restore",
    result: { ok: true, account },
  });
  assert.equal(afterLate, s);
  assert.equal(afterLate.account, undefined);
});

test("an explicit retry after a timeout supersedes the abandoned request", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, { type: "timeout", seq: 1, nextSeq: 2, command: "restore" });
  s = reduce(s, { type: "start", seq: 3 });
  assert.equal(s.error, undefined);
  assert.equal(s.errorCommand, undefined);
  s = reduce(s, { type: "settled", seq: 1, command: "restore", result: { ok: true, account } });
  assert.equal(s.account, undefined);
  s = reduce(s, { type: "settled", seq: 3, command: "restore", result: { ok: true, account } });
  assert.equal(s.account, account);
});

test("a timeout for a request that already settled is ignored", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, { type: "settled", seq: 1, command: "restore", result: { ok: true, account } });
  s = reduce(s, { type: "start", seq: 2 });
  assert.equal(reduce(s, { type: "timeout", seq: 1, nextSeq: 3, command: "restore" }), s);
});

test("the error remembers which command failed so restore is not retried as sign-in", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, {
    type: "settled",
    seq: 1,
    command: "restore",
    result: { ok: false, code: "lumi_account_failed" },
  });
  assert.equal(s.errorCommand, "restore");
  s = reduce(s, { type: "start", seq: 2 });
  s = reduce(s, {
    type: "settled",
    seq: 2,
    command: "begin",
    result: { ok: false, code: "lumi_account_failed" },
  });
  assert.equal(s.errorCommand, "begin");
});

test("the renderer bound sits above the 5 s gate and the host's 30 s request limit", () => {
  assert.ok(LUMI_FLOW_SLOW_MS <= 5000);
  assert.ok(LUMI_FLOW_TIMEOUT_MS > 30_000);
  assert.ok(LUMI_RESTORE_SHARE_WINDOW_MS >= LUMI_FLOW_TIMEOUT_MS);
});

function deferredBridge() {
  const calls: LumiAccountCommand[] = [];
  const resolvers: Array<(result: LumiAccountResult) => void> = [];
  const rejecters: Array<(error: unknown) => void> = [];
  const bridge: LumiAccountBridge = {
    request(command) {
      calls.push(command);
      return new Promise((resolve, reject) => {
        resolvers.push(resolve);
        rejecters.push(reject);
      });
    },
  };
  return { bridge, calls, resolvers, rejecters };
}

test("gate and panel share one launch restore request", async () => {
  const { bridge, calls, resolvers } = deferredBridge();
  const first = requestStartupRestore(bridge);
  const second = requestStartupRestore(bridge);
  assert.equal(calls.length, 1);
  resolvers[0]?.({ ok: true, account });
  assert.deepEqual(await first, { ok: true, account });
  assert.deepEqual(await second, { ok: true, account });
  // Settled: the next restore is a new host request, not a cached projection.
  void requestStartupRestore(bridge);
  assert.equal(calls.length, 2);
});

test("a rejected shared restore reaches every joiner and is not cached", async () => {
  const { bridge, calls, rejecters } = deferredBridge();
  const first = requestStartupRestore(bridge);
  const second = requestStartupRestore(bridge);
  rejecters[0]?.(new Error("boom"));
  await assert.rejects(first, /boom/);
  await assert.rejects(second, /boom/);
  void requestStartupRestore(bridge);
  assert.equal(calls.length, 2);
});

test("a hung shared restore is not joined once it is older than the share window", () => {
  const { bridge, calls } = deferredBridge();
  let clock = 1000;
  void requestStartupRestore(bridge, () => clock);
  clock += LUMI_RESTORE_SHARE_WINDOW_MS - 1;
  void requestStartupRestore(bridge, () => clock);
  assert.equal(calls.length, 1);
  clock += 1;
  void requestStartupRestore(bridge, () => clock);
  assert.equal(calls.length, 2);
});

test("different bridges never share a restore", () => {
  const a = deferredBridge();
  const b = deferredBridge();
  void requestStartupRestore(a.bridge);
  void requestStartupRestore(b.bridge);
  assert.equal(a.calls.length, 1);
  assert.equal(b.calls.length, 1);
});

test("an incomplete page maps to dedicated, non-retryable copy that never claims large-list support", () => {
  assert.equal(lumiErrorCopyId("lumi_page_incomplete"), "lumiError.pageIncomplete");
  assert.equal(isLumiErrorRetryable("lumi_page_incomplete"), false);
  for (const messages of [enUS, zhCN]) {
    const copy = messages["lumiError.pageIncomplete"] ?? "";
    assert.ok(copy.length > 0);
    assert.ok(!/\b100\b/.test(copy), "copy must not advertise a supported size");
  }
});

test("unknown codes fall back to the generic copy and stay retryable", () => {
  assert.equal(lumiErrorCopyId("lumi_something_new"), "lumiError.generic");
  assert.equal(isLumiErrorRetryable("lumi_something_new"), true);
  assert.equal(isLumiErrorRetryable("lumi_request_timeout"), true);
});

test("every user-facing Lumi key exists in both locales with non-empty text", () => {
  const keys = (messages: Record<string, string>) =>
    Object.keys(messages)
      .filter((key) => /^lumi(Entry|Workspace|Error|Account)\./.test(key))
      .sort();
  assert.deepEqual(keys(enUS), keys(zhCN));
  for (const id of [
    ...LUMI_ERROR_COPY_IDS,
    "lumiEntry.restoringSlow",
    "lumiEntry.restoreFailed",
    "lumiEntry.checkAgain",
    "lumiWorkspace.reload",
    "lumiWorkspace.noProjects",
    "lumiWorkspace.noProjectsHint",
  ]) {
    assert.ok(enUS[id]?.trim(), `en-US missing ${id}`);
    assert.ok(zhCN[id]?.trim(), `zh-CN missing ${id}`);
  }
});
