import test from "node:test";
import assert from "node:assert/strict";
import { dispatchLumiAccountCommand } from "./lumiAccountCommands.js";

type Owner = ReturnType<Parameters<typeof dispatchLumiAccountCommand>[0]["getOwner"]>;

// 补全 AccountOwner 的必选成员：未被被测命令使用的方法一旦被调用即失败，
// 这样既满足类型，又能证明命令没有越权触达其他 owner 能力。
function ownerWith(overrides: Partial<Owner>): Owner {
  const unexpected = (name: string) => async (): Promise<never> => {
    throw new Error(`unexpected owner call: ${name}`);
  };
  return {
    beginSignIn: unexpected("beginSignIn"),
    completeSignIn: unexpected("completeSignIn"),
    cancelSignIn: () => {
      throw new Error("unexpected owner call: cancelSignIn");
    },
    readAccount: unexpected("readAccount"),
    restoreSession: unexpected("restoreSession"),
    signOut: unexpected("signOut"),
    ...overrides,
  };
}

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
  const owner = ownerWith({
    recoverDevice: async (org: string) => {
      assert.equal(org, orgId);
      recoveries++;
      return { status: "active" } as Awaited<ReturnType<NonNullable<Owner["recoverDevice"]>>>;
    },
  });
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

test("workspace binding requires explicit confirmation and rejects injected authority fields", async () => {
  const orgId = `org_${"a".repeat(32)}`;
  const projectId = `prj_${"b".repeat(32)}`;
  let binds = 0;
  const owner = ownerWith({
    bindWorkspace: async (command: {
      orgId: string;
      projectId: string;
      workspacePath: string;
      displayName: string;
      confirm: true;
    }) => {
      assert.equal(command.orgId, orgId);
      assert.equal(command.projectId, projectId);
      assert.equal(command.workspacePath, "/local/private/workspace");
      binds++;
      return {
        status: "local_unmanaged",
        orgId,
        workspaceKey: "a".repeat(64),
        stage: "local_unmanaged",
        ownership: "local_unmanaged",
        credentialMode: "local_credential",
        adoptionVersion: 1,
        credentialConsoleUrl: "https://lumi.example",
        deviceUsable: true,
        projectId,
        deviceId: `dvc_${"c".repeat(32)}`,
        adoptionStateId: `wst_${"d".repeat(32)}`,
        workspaceBindingId: `wsb_${"e".repeat(32)}`,
        displayName: "Workspace",
      };
    },
  });
  const base = {
    action: "bind-workspace",
    orgId,
    projectId,
    workspacePath: "/local/private/workspace",
    environmentType: "local",
    displayName: "Workspace",
  };
  assert.deepEqual(
    await dispatchLumiAccountCommand({
      trusted: true,
      command: base,
      getOwner: () => owner,
    }),
    { ok: false, code: "lumi_command_invalid" },
  );
  assert.deepEqual(
    await dispatchLumiAccountCommand({
      trusted: true,
      command: { ...base, confirm: true, accessToken: "not-allowed" },
      getOwner: () => owner,
    }),
    { ok: false, code: "lumi_command_invalid" },
  );
  assert.equal(binds, 0);
  const result = await dispatchLumiAccountCommand({
    trusted: true,
    command: { ...base, confirm: true },
    getOwner: () => owner,
  });
  assert.equal(result.ok, true);
  assert.equal(binds, 1);
});
