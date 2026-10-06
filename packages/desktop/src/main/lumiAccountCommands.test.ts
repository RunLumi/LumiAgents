import test from "node:test";
import assert from "node:assert/strict";
import { dispatchLumiAccountCommand } from "./lumiAccountCommands.js";

test("foreign sender and arbitrary route cannot initialize account custody", async () => {
  let calls = 0;
  const getOwner = () => {
    calls++;
    throw new Error("should not initialize");
  };
  const openExternal = async () => {
    throw new Error("should not open");
  };
  assert.deepEqual(
    await dispatchLumiAccountCommand({ trusted: false, command: "begin", getOwner, openExternal }),
    { ok: false, code: "lumi_sender_denied" },
  );
  assert.deepEqual(
    await dispatchLumiAccountCommand({
      trusted: true,
      command: "/api/secret",
      getOwner,
      openExternal,
    }),
    { ok: false, code: "lumi_command_invalid" },
  );
  assert.deepEqual(
    await dispatchLumiAccountCommand({
      trusted: true,
      command: { route: "read" },
      getOwner,
      openExternal,
    }),
    { ok: false, code: "lumi_command_invalid" },
  );
  assert.equal(calls, 0);
});
test("trusted begin opens only the owner-generated verification URL", async () => {
  const signIn = {
    userCode: "1234ABCD",
    verificationUrl: "https://lumi.example/desktop?user_code=1234ABCD",
    expiresAt: "later",
  };
  let opened = "";
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
    openExternal: async (url) => {
      opened = url;
    },
  });
  assert.deepEqual(result, { ok: true, signIn });
  assert.equal(opened, signIn.verificationUrl);
});
test("raw upstream error never crosses IPC", async () => {
  const result = await dispatchLumiAccountCommand({
    trusted: true,
    command: "read",
    getOwner: () => {
      throw new Error("sensitive upstream body");
    },
    openExternal: async () => {},
  });
  assert.deepEqual(result, { ok: false, code: "lumi_account_failed" });
});
