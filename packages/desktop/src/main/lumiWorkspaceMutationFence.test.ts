import test from "node:test";
import assert from "node:assert/strict";
import {
  admitWorkspaceMutation,
  admitWorkspaceRead,
  createLumiSessionFence,
  fencedLoginTransitions,
  lumiWorkspaceFenceKey,
} from "./lumiSessionFence.js";
import { createLumiWorkspaceOwner } from "./lumiWorkspaceOwner.js";
import type { LumiWorkspaceVaultRecord } from "./lumiWorkspaceVault.js";

// 用户同时是 orgA 与 orgB 的成员：成员关系检查对两个组织都会通过，所以拒绝只能来自选择代/会话代。
const orgA = `org_${"a".repeat(32)}`;
const orgB = `org_${"7".repeat(32)}`;
const userId = `usr_${"b".repeat(32)}`;
const deviceId = `dvc_${"c".repeat(32)}`;
const projectId = `prj_${"d".repeat(32)}`;
const installationId = "1".repeat(64);
const pathOne = "/Users/private/Workspace One";
const pathTwo = "/Users/private/Workspace Two";
const hex = (n: number) => n.toString(16).padStart(32, "0");

type Write =
  | "binding-create"
  | "adoption-create"
  | "policy-sync"
  | "adoption-advance"
  | "binding-delete"
  | "adoption-rollback";
type Row = Record<string, unknown> & { workspaceKey: string; stage: string; version: number };

function world() {
  const fence = createLumiSessionFence();
  const writes: Write[] = [];
  const reads: string[] = [];
  const hooks: { onWrite?: (write: Write) => void; onRead?: (read: string, n: number) => void } =
    {};
  const adoptions = new Map<string, Row>();
  const bindings = new Map<string, Record<string, unknown>>();
  let counter = 0;
  let orgState = "active";
  let stored = null as LumiWorkspaceVaultRecord | null;
  const saves: LumiWorkspaceVaultRecord[] = [];
  const committed = (write: Write) => {
    writes.push(write);
    hooks.onWrite?.(write);
  };
  const touched = (read: string) => {
    reads.push(read);
    hooks.onRead?.(read, reads.length);
  };
  const device = {
    status: "active" as const,
    orgId: orgA,
    device: {
      id: deviceId,
      orgId: orgA,
      tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      policyVersion: 1,
    },
  };
  const owner = createLumiWorkspaceOwner({
    origin: "https://lumi.example",
    orgId: orgA,
    userId,
    appVersion: "3.14.3",
    epoch: (key) => fence.epoch(key),
    account: {
      async readAccount() {
        const org = (id: string) => ({
          id,
          displayName: id,
          slug: "org",
          state: orgState,
          role: "owner",
          status: "active",
        });
        return {
          user: { id: userId, email: "x@example.com", displayName: "X" },
          organizations: [org(orgA), { ...org(orgB), state: "active" }],
        };
      },
      async listAdoptionRecords() {
        touched("adoptions");
        return [...adoptions.values()];
      },
      async createAdoptionRecord(input: Record<string, unknown>) {
        const row = {
          adoptionStateId: `wst_${hex(++counter)}`,
          orgId: orgA,
          installationId: input.installationId,
          workspaceKey: input.workspaceKey as string,
          displayName: input.displayName,
          projectId: input.projectId,
          deviceId: input.deviceId,
          stage: "local_unmanaged",
          ownership: "local_unmanaged",
          credentialMode: "local_credential",
          version: 1,
        };
        adoptions.set(row.workspaceKey, row);
        committed("adoption-create");
        return row;
      },
      async advanceAdoptionRecord(input: { stage: string; version: number }) {
        const current = [...adoptions.values()].find((item) => item.version === input.version)!;
        const next = {
          ...current,
          stage: input.stage,
          ownership: ["workspace_bound", "managed_policy"].includes(input.stage)
            ? "org_managed"
            : "local_unmanaged",
          version: input.version + 1,
        };
        adoptions.set(next.workspaceKey, next);
        committed("adoption-advance");
        return next;
      },
      async rollbackAdoptionRecord(input: { adoptionStateId: string }) {
        const current = [...adoptions.values()].find(
          (item) => item.adoptionStateId === input.adoptionStateId,
        )!;
        const next = {
          ...current,
          stage: "local_unmanaged",
          ownership: "local_unmanaged",
          projectId: null,
          deviceId: null,
          version: current.version + 1,
        };
        adoptions.set(next.workspaceKey, next);
        committed("adoption-rollback");
        return next;
      },
    } as never,
    device: {
      async read() {
        touched("device");
        return device;
      },
      async syncPolicy() {
        committed("policy-sync");
        return { device, policy: { id: `pol_${hex(9)}`, version: 1, expiresAt: "" } };
      },
      async listWorkspaceBindings() {
        touched("bindings");
        return [...bindings.values()];
      },
      async createWorkspaceBinding(input: Record<string, unknown>) {
        const row = {
          id: `wsb_${hex(++counter)}`,
          orgId: orgA,
          projectId: input.projectId,
          deviceId,
          workspaceIdentity: input.workspaceIdentity,
          displayName: input.displayName,
          environmentType: input.environmentType,
        };
        bindings.set(input.workspaceIdentity as string, row);
        committed("binding-create");
        return row;
      },
      async deleteWorkspaceBinding(id: string) {
        for (const [key, row] of bindings) if (row.id === id) bindings.delete(key);
        committed("binding-delete");
      },
    } as never,
    vault: {
      async load() {
        return stored;
      },
      async save(value: LumiWorkspaceVaultRecord) {
        stored = value;
        saves.push(value);
      },
      async createEmpty() {
        return {
          version: 1 as const,
          origin: "https://lumi.example",
          orgId: orgA,
          userId,
          installationId,
          mappings: [],
        };
      },
    },
  });

  const scope = (path: string) => ({
    orgId: orgA,
    workspacePath: path,
    environmentType: "local" as const,
  });
  // 全部经由生产准入函数；owner 只作为 workspaceFor 的结果出现。
  const run = {
    read: (path: string, org = orgA) =>
      admitWorkspaceRead(fence, { ...scope(path), orgId: org }, async () => owner),
    bind: (path: string) =>
      admitWorkspaceMutation(
        fence,
        "bind",
        { ...scope(path), projectId, displayName: "Customer Project" },
        async () => owner,
      ),
    advance: (path: string, stage: "account_optional" | "device_enrolled" | "workspace_bound") =>
      admitWorkspaceMutation(
        fence,
        "advance",
        { ...scope(path), projectId, stage },
        async () => owner,
      ),
    rollback: (path: string) =>
      admitWorkspaceMutation(fence, "rollback", scope(path), async () => owner),
  };
  const select = (path: string, org: string) =>
    void admitWorkspaceRead(fence, { ...scope(path), orgId: org }, async () => ({
      read: async () => null,
    }));
  const mappingOf = (path: string) => stored?.mappings.find((m) => m.workspaceIdentity === path);
  const clear = () => {
    writes.length = 0;
    reads.length = 0;
    hooks.onWrite = undefined;
    hooks.onRead = undefined;
  };
  return {
    fence,
    writes,
    hooks,
    run,
    select,
    mappingOf,
    saves,
    adoptions,
    bindings,
    clear,
    reads,
    setOrg: (s: string) => (orgState = s),
  };
}

/** Selected org = orgA, workspace bound (local_unmanaged), hooks and write log cleared. */
async function adopted(w: ReturnType<typeof world>, path: string) {
  await w.run.read(path);
  await w.run.bind(path);
  w.clear();
}

test("bind: an org switch after the binding was created refuses the adoption write, keeps the binding and the mapping", async () => {
  const w = world();
  await w.run.read(pathOne);
  w.clear();
  w.hooks.onWrite = (write) => write === "binding-create" && w.select(pathOne, orgB);
  await assert.rejects(w.run.bind(pathOne), /lumi_workspace_org_changed/);
  // 已提交的服务端效果保留（不撤销、不重试）；之后的写入被前置栅栏拦下。
  assert.deepEqual(w.writes, ["binding-create"]);
  assert.equal(w.bindings.size, 1);
  assert.equal(w.adoptions.size, 0);
  assert.equal(w.mappingOf(pathOne)?.deviceBindingId ?? null, null);
});

test("bind: an org switch after the adoption was created refuses mapping save, policy sync and projection", async () => {
  const w = world();
  await w.run.read(pathOne);
  w.clear();
  w.hooks.onWrite = (write) => write === "adoption-create" && w.select(pathOne, orgB);
  const savesBefore = w.saves.length;
  await assert.rejects(w.run.bind(pathOne), /lumi_workspace_org_changed/);
  assert.deepEqual(w.writes, ["binding-create", "adoption-create"]);
  assert.equal(w.saves.length, savesBefore);
  assert.equal(w.mappingOf(pathOne)?.adoptionStateId ?? null, null);
  // 本地映射只是服务端的派生：回到 orgA 后下一次 read 从服务端行重新推导出来。
  w.select(pathOne, orgA);
  const projection = await w.run.read(pathOne);
  assert.equal(projection.projectId, projectId);
  assert.equal(w.mappingOf(pathOne)?.adoptionStateId !== null, true);
});

test("bind: switching away and back (A→B→A) mid-bind is refused", async () => {
  const w = world();
  await w.run.read(pathOne);
  w.clear();
  w.hooks.onWrite = (write) => {
    if (write !== "binding-create") return;
    w.select(pathOne, orgB);
    w.select(pathOne, orgA);
  };
  await assert.rejects(w.run.bind(pathOne), /lumi_workspace_org_changed/);
  assert.deepEqual(w.writes, ["binding-create"]);
});

test("advance: a login that begins mid-advance refuses the mapping save after the committed stage write", async () => {
  const w = world();
  await adopted(w, pathOne);
  const logins = fencedLoginTransitions(w.fence, {
    beginSignIn: async () => "begun",
    completeSignIn: async () => "done",
  });
  const savesBefore = w.saves.length;
  w.hooks.onWrite = (write) => write === "adoption-advance" && void logins.beginSignIn("Desktop");
  await assert.rejects(w.run.advance(pathOne, "account_optional"), /lumi_account_changed/);
  assert.deepEqual(w.writes, ["adoption-advance"]); // 一次提交，没有重试
  assert.equal([...w.adoptions.values()][0]?.stage, "account_optional");
  assert.equal(w.saves.length, savesBefore);
});

test("advance: a switch before the policy sync stops the sync and the stage write", async () => {
  const w = world();
  await adopted(w, pathOne);
  await w.run.advance(pathOne, "account_optional");
  await w.run.advance(pathOne, "device_enrolled");
  w.clear();
  w.hooks.onRead = (read) => read === "adoptions" && w.select(pathOne, orgB);
  await assert.rejects(w.run.advance(pathOne, "workspace_bound"), /lumi_workspace_org_changed/);
  assert.deepEqual(w.writes, []);
});

test("rollback: a stale scope after the binding delete never sends the adoption rollback nor recreates the binding", async () => {
  const w = world();
  await adopted(w, pathOne);
  w.hooks.onWrite = (write) => write === "binding-delete" && w.select(pathOne, orgB);
  await assert.rejects(w.run.rollback(pathOne), /lumi_workspace_org_changed/);
  assert.deepEqual(w.writes, ["binding-delete"]);
  assert.equal(w.bindings.size, 0); // 已提交的删除不被撤销
  assert.equal(w.mappingOf(pathOne)?.deviceBindingId !== null, true); // 映射未被陈旧结果改写
});

test("rollback: a stale scope after the adoption rollback refuses the mapping save and the projection", async () => {
  const w = world();
  await adopted(w, pathOne);
  const before = w.mappingOf(pathOne);
  w.hooks.onWrite = (write) => write === "adoption-rollback" && w.select(pathOne, orgB);
  await assert.rejects(w.run.rollback(pathOne), /lumi_workspace_org_changed/);
  assert.deepEqual(w.writes, ["binding-delete", "adoption-rollback"]);
  assert.deepEqual(w.mappingOf(pathOne), before);
});

test("read: a switch while the server state is being read refuses before the mapping is saved", async () => {
  const w = world();
  await adopted(w, pathOne);
  const savesBefore = w.saves.length;
  w.hooks.onRead = (read) => read === "bindings" && w.select(pathOne, orgB);
  await assert.rejects(w.run.read(pathOne), /lumi_workspace_org_changed/);
  assert.equal(w.saves.length, savesBefore);
});

test("read: ABA across the final read still returns no projection", async () => {
  const w = world();
  await adopted(w, pathOne);
  w.hooks.onRead = (read) => {
    if (read !== "adoptions") return;
    w.select(pathOne, orgB);
    w.select(pathOne, orgA);
  };
  await assert.rejects(w.run.read(pathOne), /lumi_workspace_org_changed/);
});

test("membership removed between the server write and the mapping save refuses the completion", async () => {
  const w = world();
  await w.run.read(pathOne);
  w.clear();
  w.hooks.onWrite = (write) => write === "adoption-create" && w.setOrg("suspended");
  await assert.rejects(w.run.bind(pathOne), /lumi_workspace_org_unavailable/);
  assert.deepEqual(w.writes, ["binding-create", "adoption-create"]);
  assert.equal(w.mappingOf(pathOne)?.adoptionStateId ?? null, null);
});

test("command scope: a deselected org is refused at admission before the owner is reached", async () => {
  const w = world();
  await w.run.read(pathOne);
  w.select(pathOne, orgB);
  w.clear();
  await assert.rejects(w.run.bind(pathOne), /lumi_workspace_org_changed/);
  await assert.rejects(w.run.rollback(pathOne), /lumi_workspace_org_changed/);
  assert.deepEqual(w.writes, []);
  assert.equal(w.reads.length, 0);
});

test("several workspaces stay independent: switching W1 never refuses W2 and W2's mapping is saved", async () => {
  const w = world();
  await w.run.read(pathOne);
  await w.run.read(pathTwo);
  w.clear();
  w.hooks.onWrite = (write) => write === "adoption-create" && w.select(pathOne, orgB);
  // 同一 owner 串行执行：W1 的写入期间 W1 被切走，W2 排在后面，但它的 key 没变。
  const first = w.run.bind(pathOne);
  const second = w.run.bind(pathTwo);
  const [a, b] = await Promise.allSettled([first, second]);
  assert.equal(a.status, "rejected");
  assert.equal(b.status, "fulfilled");
  assert.equal(w.mappingOf(pathOne)?.adoptionStateId ?? null, null);
  assert.equal(w.mappingOf(pathTwo)?.adoptionStateId !== null, true);
  // 选择代按 workspace key 独立：W1 被切走，W2 仍选择 orgA。
  assert.notDeepEqual(w.fence.epoch(pathOne), w.fence.epoch(pathTwo));
  assert.doesNotThrow(() =>
    w.fence.assertOrgSelected(lumiWorkspaceFenceKey({ workspacePath: pathTwo }), orgA),
  );
});

test("an unchanged scope completes bind, advance and rollback normally", async () => {
  const w = world();
  await w.run.read(pathOne);
  const bound = await w.run.bind(pathOne);
  assert.equal(bound.projectId, projectId);
  const advanced = await w.run.advance(pathOne, "account_optional");
  assert.equal(advanced.stage, "account_optional");
  const rolled = await w.run.rollback(pathOne);
  assert.equal(rolled.stage, "local_unmanaged");
  assert.equal(w.mappingOf(pathOne)?.deviceBindingId ?? null, null);
});
