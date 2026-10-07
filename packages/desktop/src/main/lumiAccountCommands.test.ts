import test from "node:test";
import assert from "node:assert/strict";
import { dispatchLumiAccountCommand } from "./lumiAccountCommands.js";

test("foreign sender and arbitrary route cannot initialize account custody", async () => {
  let calls = 0;
  const getOwner = () => {
    calls++;
    throw new Error("should not initialize");
  };
  assert.deepEqual(
    await dispatchLumiAccountCommand({ trusted: false, command: "begin", getOwner }),
    { ok: false, code: "lumi_sender_denied" },
  );
  assert.deepEqual(
    await dispatchLumiAccountCommand({
      trusted: true,
      command: "/api/secret",
      getOwner,
    }),
    { ok: false, code: "lumi_command_invalid" },
  );
  assert.deepEqual(
    await dispatchLumiAccountCommand({
      trusted: true,
      command: { route: "read" },
      getOwner,
    }),
    { ok: false, code: "lumi_command_invalid" },
  );
  assert.equal(calls, 0);
});
test("trusted begin returns only owner-generated approval projection", async () => {
  const signIn = {
    userCode: "1234ABCD",
    verificationUrl: "https://lumi.example/desktop?user_code=1234ABCD",
    expiresAt: "later",
  };
  const owner = {
    beginSignIn: async () => signIn,
    completeSignIn: async () => {},
    cancelSignIn: () => {},
    readAccount: async () => ({
      user: { id: "id", email: "x@example.com", displayName: "X" },
      organizations: [],
    }),
    restoreSession: async () => false,
    signOut: async () => {},
  };
  const result = await dispatchLumiAccountCommand({
    trusted: true,
    command: "begin",
    getOwner: () => owner,
  });
  assert.deepEqual(result, { ok: true, signIn });
  assert.equal(result.ok && result.signIn?.verificationUrl, signIn.verificationUrl);
});
test("raw upstream error never crosses IPC", async () => {
  const result = await dispatchLumiAccountCommand({
    trusted: true,
    command: "read",
    getOwner: () => {
      throw new Error("sensitive upstream body");
    },
  });
  assert.deepEqual(result, { ok: false, code: "lumi_account_failed" });
});

test("device recovery requires explicit confirmation and stays in the main owner", async () => {
  const orgId = `org_${"a".repeat(32)}`;
  let recoveries = 0;
  const owner = {
    recoverDevice: async (org: string) => {
      assert.equal(org, orgId);
      recoveries++;
      return { status: "active" };
    },
  };
  assert.deepEqual(
    await dispatchLumiAccountCommand({
      trusted: true,
      command: { action: "recover-device", orgId },
      getOwner: () => owner,
    }),
    { ok: false, code: "lumi_command_unsupported" },
  );
  assert.equal(recoveries, 0);
  assert.deepEqual(
    await dispatchLumiAccountCommand({
      trusted: true,
      command: { action: "recover-device", orgId, confirm: true },
      getOwner: () => owner,
    }),
    { ok: true, device: { status: "active" } },
  );
  assert.equal(recoveries, 1);
});
