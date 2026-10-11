import assert from "node:assert/strict";
import test from "node:test";
import {
  initialLumiAccountFlow as initial,
  lumiAccountFlowReducer as reduce,
} from "../src/lumi/lumiAccountFlow.js";

const account = {
  user: { id: "u1", email: "a@b.co", displayName: "A" },
  organizations: [],
};
const signIn = { userCode: "ABCD", verificationUrl: "https://x/y", expiresAt: "2026-01-01" };

test("restore with a session lands signed-in without a prompt", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  assert.equal(s.busy, true);
  assert.equal(s.restored, false);
  s = reduce(s, { type: "settled", seq: 1, command: "restore", result: { ok: true, account } });
  assert.equal(s.account, account);
  assert.equal(s.restored, true);
  assert.equal(s.busy, false);
});

test("a stale result cannot replace a newer request", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, { type: "start", seq: 2 });
  s = reduce(s, { type: "settled", seq: 1, command: "complete", result: { ok: true, account } });
  assert.equal(s.account, undefined);
  assert.equal(s.busy, true);
});

test("unmount invalidates an in-flight completion", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, { type: "settled", seq: 1, command: "begin", result: { ok: true, signIn } });
  assert.equal(s.signIn, signIn);
  s = reduce(s, { type: "start", seq: 2 });
  s = reduce(s, { type: "invalidate", seq: 3 });
  s = reduce(s, { type: "settled", seq: 2, command: "complete", result: { ok: true, account } });
  assert.equal(s.account, undefined);
  assert.equal(s.busy, false);
});

test("cancel returns to signed-out", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, { type: "settled", seq: 1, command: "begin", result: { ok: true, signIn } });
  s = reduce(s, { type: "start", seq: 2 });
  s = reduce(s, { type: "settled", seq: 2, command: "cancel", result: { ok: true } });
  assert.equal(s.signIn, undefined);
  assert.equal(s.account, undefined);
});

test("errors surface a code and clear on the next request", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, {
    type: "settled",
    seq: 1,
    command: "begin",
    result: { ok: false, code: "denied" },
  });
  assert.equal(s.error, "denied");
  assert.equal(s.restored, true);
  s = reduce(s, { type: "start", seq: 2 });
  assert.equal(s.error, undefined);
  s = reduce(s, { type: "failed", seq: 2, code: "lumi_account_failed" });
  assert.equal(s.error, "lumi_account_failed");
});

test("logout clears the Lumi projection only", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, { type: "settled", seq: 1, command: "complete", result: { ok: true, account } });
  s = reduce(s, { type: "start", seq: 2 });
  s = reduce(s, { type: "settled", seq: 2, command: "logout", result: { ok: true } });
  assert.equal(s.account, undefined);
  assert.equal(s.signIn, undefined);
});

test("cancel supersedes an in-flight completion and ignores its late account", () => {
  let s = reduce(initial, { type: "start", seq: 1 });
  s = reduce(s, { type: "start", seq: 2 });
  s = reduce(s, { type: "settled", seq: 2, command: "cancel", result: { ok: true } });
  const cancelled = s;
  s = reduce(s, { type: "settled", seq: 1, command: "complete", result: { ok: true, account } });
  assert.equal(s, cancelled);
  assert.equal(s.account, undefined);
  assert.equal(s.busy, false);
});
