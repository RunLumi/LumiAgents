import test from "node:test";
import assert from "node:assert/strict";
import { dispatchLumiAccountCommand } from "./lumiAccountCommands.js";

type Owner = ReturnType<Parameters<typeof dispatchLumiAccountCommand>[0]["getOwner"]>;

const valid = {
  action: "set-workspace-credential-mode",
  orgId: `org_${"a".repeat(32)}`,
  projectId: `prj_${"d".repeat(32)}`,
  workspacePath: "/work/space",
  environmentType: "local",
  credentialMode: "metadata_only",
  expectedStage: "workspace_bound",
  expectedVersion: 3,
  confirm: true,
};

function harness() {
  const calls: unknown[] = [];
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected owner call");
  };
  const owner = {
    beginSignIn: unexpected,
    completeSignIn: unexpected,
    cancelSignIn: () => {
      throw new Error("unexpected owner call");
    },
    readAccount: unexpected,
    restoreSession: unexpected,
    signOut: unexpected,
    async setWorkspaceCredentialMode(command: unknown) {
      calls.push(command);
      return { stage: "workspace_bound" };
    },
  } as unknown as Owner;
  const run = (command: unknown, trusted = true) =>
    dispatchLumiAccountCommand({ trusted, command, getOwner: () => owner });
  return { calls, run };
}

test("a well-formed credential choice reaches the owner exactly once", async () => {
  const { calls, run } = harness();
  const result = await run(valid);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test("untrusted senders never reach the credential choice", async () => {
  const { calls, run } = harness();
  assert.deepEqual(await run(valid, false), { ok: false, code: "lumi_sender_denied" });
  assert.equal(calls.length, 0);
});

test("malformed credential choices are refused at the bridge", async () => {
  const { calls, run } = harness();
  const bad: Record<string, unknown>[] = [
    { ...valid, confirm: undefined },
    { ...valid, confirm: false },
    { ...valid, credentialMode: "copy_local_key" },
    { ...valid, credentialMode: undefined },
    { ...valid, expectedStage: "history_sync" },
    { ...valid, expectedStage: "bogus" },
    { ...valid, expectedVersion: 0 },
    { ...valid, expectedVersion: 1.5 },
    { ...valid, expectedVersion: "3" },
    { ...valid, projectId: "prj_short" },
    { ...valid, orgId: "org_short" },
    { ...valid, environmentType: "cloud" },
    // 没有任何密钥/凭据字段可以搭车：多余字段一律拒绝。
    { ...valid, secret: "lumi-canary" },
    { ...valid, apiKey: "lumi-canary" },
    { ...valid, stage: "managed_policy" },
  ];
  for (const command of bad)
    assert.deepEqual(await run(command), { ok: false, code: "lumi_command_invalid" });
  assert.equal(calls.length, 0);
});

test("owner refusals surface only stable lumi_ codes", async () => {
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected owner call");
  };
  const owner = {
    beginSignIn: unexpected,
    completeSignIn: unexpected,
    cancelSignIn: unexpected,
    readAccount: unexpected,
    restoreSession: unexpected,
    signOut: unexpected,
    async setWorkspaceCredentialMode() {
      throw new Error("lumi_workspace_stale");
    },
  } as unknown as Owner;
  assert.deepEqual(
    await dispatchLumiAccountCommand({ trusted: true, command: valid, getOwner: () => owner }),
    { ok: false, code: "lumi_workspace_stale" },
  );
});
