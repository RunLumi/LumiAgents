import test from "node:test";
import assert from "node:assert/strict";
import type { P08CredentialMode } from "@zcode/shared";
import { createLumiWorkspaceOwner } from "./lumiWorkspaceOwner.js";
import {
  admitCredentialChoice,
  admitWorkspaceRead,
  createLumiSessionFence,
  fencedLoginTransitions,
  fencedSignOut,
  lumiWorkspaceFenceKey,
  type LumiSessionFence,
} from "./lumiSessionFence.js";
import type { LumiWorkspaceVaultRecord } from "./lumiWorkspaceVault.js";

const orgId = `org_${"a".repeat(32)}`;
const userId = `usr_${"b".repeat(32)}`;
const deviceId = `dvc_${"c".repeat(32)}`;
const projectId = `prj_${"d".repeat(32)}`;
const bindingId = `wsb_${"e".repeat(32)}`;
const adoptionId = `wst_${"f".repeat(32)}`;
const workspaceKey = "2".repeat(64);
const privatePath = "/Users/private/Customer Project";
const request = { orgId, workspacePath: privatePath, environmentType: "local" as const };

type Stage =
  | "local_unmanaged"
  | "account_optional"
  | "device_enrolled"
  | "workspace_bound"
  | "managed_policy"
  | "history_sync";

function setup(initial: {
  stage: Stage;
  mode?: P08CredentialMode;
  persistModeOnly?: boolean;
  swapRowAfterPatch?: boolean;
  fence?: LumiSessionFence;
}) {
  const row = {
    stage: initial.stage,
    mode: initial.mode ?? ("local_credential" as P08CredentialMode),
    version: 3,
  };
  const calls: { kind: string; body: Record<string, unknown> }[] = [];
  let signedInUser = userId;
  let orgState = "active";
  let bindingProjectId = projectId;
  let rowAdoptionId = adoptionId;
  let generation = 0;
  let listCalls = 0;
  // 钩子在对应 await 边界内同步执行，用来在"请求飞行中"改变账号/组织/会话代。
  const hooks: {
    onBindings?: () => void;
    onPatch?: () => void;
    onList?: (call: number) => void;
    onWorkspaceFor?: () => void;
  } = {};
  let stored: LumiWorkspaceVaultRecord | null = {
    version: 1,
    origin: "https://lumi.example",
    orgId,
    userId,
    installationId: "1".repeat(64),
    mappings: [
      {
        workspaceIdentity: privatePath,
        workspaceKey,
        adoptionStateId: adoptionId,
        deviceBindingId: bindingId,
        projectId,
        displayName: "Customer Project",
        environmentType: "local",
      },
    ],
  };
  const record = () => ({
    adoptionStateId: rowAdoptionId,
    orgId,
    installationId: "1".repeat(64),
    workspaceKey,
    displayName: "Customer Project",
    projectId,
    deviceId,
    stage: row.stage,
    ownership:
      row.stage === "workspace_bound" || row.stage === "managed_policy"
        ? ("org_managed" as const)
        : ("local_unmanaged" as const),
    credentialMode: row.mode,
    version: row.version,
  });
  const activeDevice = {
    status: "active" as const,
    orgId,
    device: {
      id: deviceId,
      orgId,
      tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      policyVersion: 1,
    },
  };
  const owner = createLumiWorkspaceOwner({
    origin: "https://lumi.example/console?secret=ignored",
    orgId,
    userId,
    appVersion: "3.14.3",
    // 带 fence 时用生产同一个实现；否则退回到只含会话代的最小替身（旧用例）。
    epoch: initial.fence
      ? (key) => initial.fence!.epoch(key)
      : () => ({ session: generation, org: 0 }),
    account: {
      async readAccount() {
        return {
          user: { id: signedInUser, email: "x@example.com", displayName: "X" },
          organizations: [
            {
              id: orgId,
              displayName: "Org",
              slug: "org",
              state: orgState,
              role: "owner",
              status: "active",
            },
          ],
        };
      },
      async listAdoptionRecords() {
        const rows = [record()];
        listCalls += 1;
        hooks.onList?.(listCalls);
        return rows;
      },
      async advanceAdoptionRecord(input: {
        stage: Stage;
        credentialMode: P08CredentialMode;
        version: number;
      }) {
        calls.push({ kind: "advance", body: { ...input } });
        row.stage = input.stage;
        row.mode = input.credentialMode;
        row.version = input.version + 1;
        return record();
      },
      async changeAdoptionCredentialMode(input: {
        credentialMode: P08CredentialMode;
        version: number;
      }) {
        calls.push({ kind: "mode", body: { ...input } });
        // 复现 F3：服务端可能对仅改标签的 PATCH 返回 200 却不落库。
        if (initial.persistModeOnly !== false) {
          row.mode = input.credentialMode;
          row.version = input.version + 1;
        }
        // 模拟 PATCH 后另一端把行替换成别的记录：重读到的行不再是被请求的那一行。
        if (initial.swapRowAfterPatch) rowAdoptionId = `wst_${"8".repeat(32)}`;
        // 服务端此刻已提交；账号变化发生在响应返回之前（延迟的 PATCH）。
        hooks.onPatch?.();
        return { ...record(), credentialMode: input.credentialMode };
      },
    } as never,
    device: {
      async read() {
        return activeDevice;
      },
      async syncPolicy() {
        return {
          device: activeDevice,
          policy: { id: `pol_${"7".repeat(32)}`, version: 1, expiresAt: "" },
        };
      },
      async listWorkspaceBindings() {
        hooks.onBindings?.();
        return [
          {
            id: bindingId,
            orgId,
            projectId: bindingProjectId,
            deviceId,
            workspaceIdentity: workspaceKey,
            displayName: "Customer Project",
            environmentType: "local" as const,
          },
        ];
      },
    } as never,
    vault: {
      async load() {
        return stored;
      },
      async save(value: LumiWorkspaceVaultRecord) {
        stored = value;
      },
      async createEmpty() {
        throw new Error("unexpected");
      },
    },
  });
  const choose = (
    credentialMode: P08CredentialMode,
    expected: { stage?: Exclude<Stage, "history_sync">; version?: number } = {},
  ) => {
    const command = {
      ...request,
      projectId,
      credentialMode,
      expectedStage: expected.stage ?? (row.stage as Exclude<Stage, "history_sync">),
      expectedVersion: expected.version ?? row.version,
    };
    // 有 fence 时走生产同一条准入函数，并且让 workspaceFor 本身跨一个 await。
    return initial.fence
      ? admitCredentialChoice(initial.fence, command, async () => {
          hooks.onWorkspaceFor?.();
          await Promise.resolve();
          return owner;
        })
      : owner.setCredentialMode(command);
  };
  return {
    owner,
    row,
    calls,
    choose,
    signOutAs: (id: string) => (signedInUser = id),
    setOrgState: (state: string) => (orgState = state),
    rebindServerBinding: (id: string) => (bindingProjectId = id),
    hooks,
    bumpGeneration: () => generation++,
    listCalls: () => listCalls,
  };
}

test("projection carries the server label, version and a bare console origin", async () => {
  const { owner } = setup({ stage: "workspace_bound", mode: "metadata_only" });
  const projection = await owner.read(request);
  assert.equal(projection.credentialMode, "metadata_only");
  assert.equal(projection.adoptionVersion, 3);
  assert.equal(projection.credentialConsoleUrl, "https://lumi.example");
  assert.equal(JSON.stringify(projection).includes(privatePath), false);
});

test("a mode-only change sends the current stage, the label and the version, then reads back", async () => {
  const { choose, calls, row } = setup({ stage: "managed_policy" });
  const projection = await choose("org_managed_credential");
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]!.body).sort(), [
    "adoptionStateId",
    "clientAppVersion",
    "credentialMode",
    "orgId",
    "stage",
    "version",
  ]);
  assert.equal(calls[0]!.body.stage, "managed_policy");
  assert.equal(calls[0]!.body.version, 3);
  assert.equal(projection.credentialMode, "org_managed_credential");
  assert.equal(projection.adoptionVersion, row.version);
  assert.equal(projection.stage, "managed_policy");
});

test("every label is accepted at a bound stage and local labels at a local stage", async () => {
  for (const mode of ["local_credential", "metadata_only"] as const) {
    const { choose } = setup({ stage: "account_optional", mode: "org_managed_credential" });
    const projection = await choose(mode);
    assert.equal(projection.credentialMode, mode);
    assert.equal(projection.ownership, "local_unmanaged");
  }
});

test("the organization label is refused before any request while the workspace is local", async () => {
  for (const stage of ["local_unmanaged", "account_optional", "device_enrolled"] as const) {
    const { choose, calls } = setup({ stage });
    await assert.rejects(
      choose("org_managed_credential"),
      /lumi_workspace_credential_mode_invalid/,
    );
    assert.equal(calls.length, 0);
  }
});

test("stale stage or version fences refuse and send nothing", async () => {
  const { choose, calls } = setup({ stage: "workspace_bound" });
  await assert.rejects(choose("metadata_only", { version: 2 }), /lumi_workspace_stale/);
  await assert.rejects(
    choose("metadata_only", { stage: "device_enrolled" }),
    /lumi_workspace_stale/,
  );
  assert.equal(calls.length, 0);
});

test("choosing the label the server already holds writes nothing", async () => {
  const { choose, calls } = setup({ stage: "workspace_bound", mode: "metadata_only" });
  const projection = await choose("metadata_only");
  assert.equal(projection.credentialMode, "metadata_only");
  assert.equal(calls.length, 0);
});

test("a 200 that the server did not persist is a refusal, not a success", async () => {
  const { choose, calls } = setup({ stage: "managed_policy", persistModeOnly: false });
  await assert.rejects(choose("metadata_only"), /lumi_workspace_credential_not_persisted/);
  assert.equal(calls.length, 1);
});

test("history sync is not constructible even from a server row at that stage", async () => {
  const { choose, calls, owner } = setup({ stage: "history_sync" });
  await assert.rejects(
    choose("metadata_only", { stage: "managed_policy" }),
    /lumi_workspace_stage_invalid/,
  );
  await assert.rejects(
    owner.advance({ ...request, projectId, stage: "history_sync" as never }),
    /lumi_workspace_stage_invalid/,
  );
  assert.equal(calls.length, 0);
});

test("invalid labels and versions are rejected as invalid input", async () => {
  const { choose, calls } = setup({ stage: "workspace_bound" });
  await assert.rejects(choose("copy_local_key" as never), /lumi_workspace_invalid/);
  await assert.rejects(choose("metadata_only", { version: 0 }), /lumi_workspace_invalid/);
  await assert.rejects(choose("metadata_only", { version: 1.5 }), /lumi_workspace_invalid/);
  assert.equal(calls.length, 0);
});

test("a late account change fences the choice before any request", async () => {
  const { choose, calls, signOutAs } = setup({ stage: "workspace_bound" });
  signOutAs(`usr_${"9".repeat(32)}`);
  await assert.rejects(choose("metadata_only"), /lumi_account_changed/);
  assert.equal(calls.length, 0);
});

test("a stage advance keeps the label the server holds instead of resetting it", async () => {
  for (const mode of ["metadata_only", "org_managed_credential", "local_credential"] as const) {
    const { owner, calls } = setup({ stage: "device_enrolled", mode });
    const projection = await owner.advance({ ...request, projectId, stage: "workspace_bound" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body.credentialMode, mode);
    assert.equal(projection.credentialMode, mode);
    assert.equal(projection.stage, "workspace_bound");
  }
});

test("an organization that is no longer active fences the choice before any request", async () => {
  const { choose, calls, setOrgState } = setup({ stage: "workspace_bound" });
  setOrgState("suspended");
  await assert.rejects(choose("metadata_only"), /lumi_workspace_org_unavailable/);
  assert.equal(calls.length, 0);
});

test("a choice for another organization or project sends nothing", async () => {
  const { owner, calls, row } = setup({ stage: "workspace_bound" });
  const base = {
    ...request,
    projectId,
    credentialMode: "metadata_only" as const,
    expectedStage: "workspace_bound" as const,
    expectedVersion: row.version,
  };
  await assert.rejects(
    owner.setCredentialMode({ ...base, orgId: `org_${"7".repeat(32)}` }),
    /lumi_workspace_org_unavailable/,
  );
  await assert.rejects(
    owner.setCredentialMode({ ...base, projectId: `prj_${"7".repeat(32)}` }),
    /lumi_workspace_binding_missing/,
  );
  assert.equal(calls.length, 0);
});

test("a server binding that moved to another project refuses before any request", async () => {
  const { choose, calls, rebindServerBinding } = setup({ stage: "workspace_bound" });
  rebindServerBinding(`prj_${"6".repeat(32)}`);
  await assert.rejects(choose("metadata_only"), /lumi_workspace_mismatch/);
  assert.equal(calls.length, 0);
});

test("two choices fenced on the same version cannot both write", async () => {
  const { choose, calls, row } = setup({ stage: "workspace_bound" });
  const results = await Promise.allSettled([choose("metadata_only"), choose("local_credential")]);
  assert.deepEqual(
    results.map((item) => item.status),
    ["fulfilled", "rejected"],
  );
  assert.match(String((results[1] as PromiseRejectedResult).reason), /lumi_workspace_stale/);
  assert.equal(calls.length, 1);
  assert.equal(row.mode, "metadata_only");
});

test("a re-read that returns a different record is not a persisted choice", async () => {
  const { choose, calls } = setup({ stage: "managed_policy", swapRowAfterPatch: true });
  await assert.rejects(choose("metadata_only"), /lumi_workspace_credential_not_persisted/);
  assert.equal(calls.length, 1);
});

test("no request body or projection carries a path or secret-shaped field", async () => {
  const { choose, calls } = setup({ stage: "managed_policy" });
  const projection = await choose("org_managed_credential");
  // 请求体既不含路径也不含工作区密钥；投影按既有契约带不透明 workspaceKey，但不含路径。
  const requests = JSON.stringify(calls);
  for (const forbidden of [privatePath, workspaceKey, "apiKey", "secret"])
    assert.equal(requests.includes(forbidden), false, forbidden);
  const rendered = JSON.stringify(projection);
  for (const forbidden of [privatePath, "apiKey", "secret"])
    assert.equal(rendered.includes(forbidden), false, forbidden);
});

const otherUser = `usr_${"9".repeat(32)}`;

test("an account switch during the pre-PATCH read refuses before any request", async () => {
  const { choose, calls, hooks, signOutAs } = setup({ stage: "workspace_bound" });
  hooks.onBindings = () => signOutAs(otherUser);
  await assert.rejects(choose("metadata_only"), /lumi_account_changed/);
  assert.equal(calls.length, 0);
});

test("membership removal during the pre-PATCH read refuses before any request", async () => {
  const { choose, calls, hooks, setOrgState } = setup({ stage: "workspace_bound" });
  hooks.onBindings = () => setOrgState("suspended");
  await assert.rejects(choose("metadata_only"), /lumi_workspace_org_unavailable/);
  assert.equal(calls.length, 0);
});

test("a session replaced during the pre-PATCH read refuses before any request", async () => {
  const { choose, calls, hooks, bumpGeneration } = setup({ stage: "workspace_bound" });
  hooks.onBindings = () => bumpGeneration();
  await assert.rejects(choose("metadata_only"), /lumi_account_changed/);
  assert.equal(calls.length, 0);
});

test("a delayed PATCH that outlives an account switch is not completed, undone or retried", async () => {
  const { choose, calls, hooks, signOutAs, row, listCalls } = setup({ stage: "managed_policy" });
  hooks.onPatch = () => signOutAs(otherUser);
  await assert.rejects(choose("metadata_only"), /lumi_account_changed/);
  // 服务端已提交旧作用域的写入：没有撤销、没有重试，也没有确认读取。
  assert.equal(calls.length, 1);
  assert.equal(row.mode, "metadata_only");
  assert.equal(listCalls(), 1);
});

test("membership removal while the PATCH is in flight refuses the completion", async () => {
  const { choose, calls, hooks, setOrgState, listCalls } = setup({ stage: "managed_policy" });
  hooks.onPatch = () => setOrgState("suspended");
  await assert.rejects(choose("metadata_only"), /lumi_workspace_org_unavailable/);
  assert.equal(calls.length, 1);
  assert.equal(listCalls(), 1);
});

test("switching away and back (ABA) during the PATCH is refused by the session generation", async () => {
  const { choose, calls, hooks, signOutAs, bumpGeneration, listCalls } = setup({
    stage: "managed_policy",
  });
  hooks.onPatch = () => {
    // 同一用户、同一组织重新登录：身份检查全部通过，只有会话代能看出差别。
    signOutAs(otherUser);
    signOutAs(userId);
    bumpGeneration();
  };
  await assert.rejects(choose("metadata_only"), /lumi_account_changed/);
  assert.equal(calls.length, 1);
  assert.equal(listCalls(), 1);
});

test("an account switch during the confirming read refuses before the projection is returned", async () => {
  const { choose, calls, hooks, signOutAs } = setup({ stage: "managed_policy" });
  hooks.onList = (call) => {
    if (call === 2) signOutAs(otherUser);
  };
  await assert.rejects(choose("metadata_only"), /lumi_account_changed/);
  assert.equal(calls.length, 1);
});

test("a session replaced during the confirming read is refused even when the row persisted", async () => {
  const { choose, hooks, bumpGeneration, row } = setup({ stage: "managed_policy" });
  hooks.onList = (call) => {
    if (call === 2) bumpGeneration();
  };
  await assert.rejects(choose("metadata_only"), /lumi_account_changed/);
  assert.equal(row.mode, "metadata_only");
});

test("a choice queued behind a slower one is fenced by the generation at call time", async () => {
  const { owner, calls, hooks, bumpGeneration, row } = setup({ stage: "managed_policy" });
  const next = (credentialMode: P08CredentialMode, expectedVersion: number) =>
    owner.setCredentialMode({
      ...request,
      projectId,
      credentialMode,
      expectedStage: "managed_policy",
      expectedVersion,
    });
  hooks.onPatch = () => bumpGeneration();
  const first = next("metadata_only", row.version);
  // 第二次选择基于第一次成功后的版本，只有"调用时的会话代"才能把它拦住。
  const second = next("local_credential", row.version + 1);
  const [a, b] = await Promise.allSettled([first, second]);
  assert.equal(a.status, "rejected");
  assert.equal(b.status, "rejected");
  assert.match(String((b as PromiseRejectedResult).reason), /lumi_account_changed/);
  assert.equal(calls.length, 1);
});

// ---- 生产 fence（lumiSessionFence）+ 真实 workspace owner：多组织用户的组织切换/ABA/登录迁移 ----

const orgB = `org_${"7".repeat(32)}`;
const selectOrg = (fence: LumiSessionFence, id: string) =>
  // 与生产 readWorkspace 相同的准入函数；渲染层切换组织时就是发出这个读取。
  admitWorkspaceRead(fence, { ...request, orgId: id }, async () => ({ read: async () => null }));

function fenced(initial: { stage: Stage }) {
  const fence = createLumiSessionFence();
  const world = setup({ ...initial, fence });
  void selectOrg(fence, orgId); // 用户当前选择的组织：orgId（用户同时仍是 orgB 的成员）
  return { fence, ...world };
}

test("an org switch during the PATCH is refused although the old org membership still passes", async () => {
  const { fence, choose, calls, hooks, row, listCalls } = fenced({ stage: "managed_policy" });
  hooks.onPatch = () => void selectOrg(fence, orgB);
  await assert.rejects(choose("metadata_only"), /lumi_workspace_org_changed/);
  // 旧组织的成员关系仍有效（org 校验会通过），所以拒绝只可能来自选择代：写入既不撤销也不重试。
  assert.equal(calls.length, 1);
  assert.equal(row.mode, "metadata_only");
  assert.equal(listCalls(), 1);
});

test("switching org away and back (A→B→A) during the PATCH is still refused", async () => {
  const { fence, choose, calls, hooks, listCalls } = fenced({ stage: "managed_policy" });
  hooks.onPatch = () => {
    void selectOrg(fence, orgB);
    void selectOrg(fence, orgId);
  };
  await assert.rejects(choose("metadata_only"), /lumi_workspace_org_changed/);
  assert.equal(calls.length, 1);
  assert.equal(listCalls(), 1);
});

test("an org switch while workspaceFor() is still resolving refuses before any request", async () => {
  const { fence, choose, calls, hooks } = fenced({ stage: "managed_policy" });
  hooks.onWorkspaceFor = () => void selectOrg(fence, orgB);
  await assert.rejects(choose("metadata_only"), /lumi_workspace_org_changed/);
  assert.equal(calls.length, 0);
});

test("a late command for an org that is no longer selected is refused at admission", async () => {
  const { fence, choose, calls, hooks } = fenced({ stage: "workspace_bound" });
  void selectOrg(fence, orgB);
  let resolved = false;
  hooks.onWorkspaceFor = () => (resolved = true);
  await assert.rejects(choose("metadata_only"), /lumi_workspace_org_changed/);
  assert.equal(resolved, false); // 连 workspaceFor 都没有被调用
  assert.equal(calls.length, 0);
});

test("re-reading the same org mid-PATCH does not invalidate the operation", async () => {
  const { fence, choose, hooks } = fenced({ stage: "managed_policy" });
  hooks.onPatch = () => void selectOrg(fence, orgId);
  const projection = await choose("metadata_only");
  assert.equal(projection.credentialMode, "metadata_only");
});

test("a login that has begun but not completed already invalidates an in-flight choice", async () => {
  const { fence, choose, calls, hooks, listCalls } = fenced({ stage: "managed_policy" });
  let finish!: () => void;
  const pending = new Promise<string>((resolve) => (finish = () => resolve("signed-in")));
  const logins = fencedLoginTransitions(fence, {
    beginSignIn: async () => "begun",
    completeSignIn: () => pending,
  });
  let completion!: Promise<string>;
  hooks.onPatch = () => {
    completion = logins.completeSignIn(); // 交换尚未返回：旧实现此时不会 bump
  };
  await assert.rejects(choose("metadata_only"), /lumi_account_changed/);
  assert.equal(calls.length, 1);
  assert.equal(listCalls(), 1);
  finish();
  assert.equal(await completion, "signed-in");
});

test("beginning a new sign-in invalidates choices admitted under the old session", async () => {
  const { fence, choose, calls, hooks } = fenced({ stage: "workspace_bound" });
  const logins = fencedLoginTransitions(fence, {
    beginSignIn: async () => "begun",
    completeSignIn: async () => "done",
  });
  hooks.onBindings = () => void logins.beginSignIn("Desktop");
  await assert.rejects(choose("metadata_only"), /lumi_account_changed/);
  assert.equal(calls.length, 0);
});

test("a login transition clears the selection so the next session re-selects its org", async () => {
  const fence = createLumiSessionFence();
  const key = lumiWorkspaceFenceKey(request);
  fence.selectOrg(key, orgId);
  const before = fence.epoch(key);
  fence.bump();
  assert.notDeepEqual(fence.epoch(key), before);
  assert.doesNotThrow(() => fence.assertOrgSelected(key, orgB));
});

test("sign-out fences at both ends, even when the transport sign-out fails", async () => {
  const fence = createLumiSessionFence();
  const seen: number[] = [];
  await assert.rejects(
    fencedSignOut(
      fence,
      async () => void seen.push(fence.generation()),
      async () => {
        seen.push(fence.generation());
        throw new Error("transport_failed");
      },
    ),
    /transport_failed/,
  );
  assert.deepEqual(seen, [1, 1]);
  assert.equal(fence.generation(), 2);
});

test("an unchanged account completes normally across every fence", async () => {
  const { choose, calls } = setup({ stage: "managed_policy" });
  const projection = await choose("metadata_only");
  assert.equal(projection.credentialMode, "metadata_only");
  assert.equal(calls.length, 1);
});
