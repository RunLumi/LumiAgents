import test from "node:test";
import assert from "node:assert/strict";
import { createLumiWorkspaceOwner } from "./lumiWorkspaceOwner.js";
import type { LumiWorkspaceVaultRecord } from "./lumiWorkspaceVault.js";

const orgId = `org_${"a".repeat(32)}`;
const userId = `usr_${"b".repeat(32)}`;
const deviceId = `dvc_${"c".repeat(32)}`;
const projectId = `prj_${"d".repeat(32)}`;
const bindingId = `wsb_${"e".repeat(32)}`;
const adoptionId = `wst_${"f".repeat(32)}`;
let serverWorkspaceKey = "2".repeat(64);
const privatePath = "/Users/private/Customer Project";

function state(stage: string, version: number, bound = true) {
  return {
    adoptionStateId: adoptionId,
    orgId,
    installationId: "1".repeat(64),
    workspaceKey: serverWorkspaceKey,
    displayName: "Customer Project",
    projectId: bound ? projectId : null,
    deviceId: bound ? deviceId : null,
    stage,
    ownership:
      stage === "workspace_bound" || stage === "managed_policy" ? "org_managed" : "local_unmanaged",
    credentialMode: "local_credential",
    version,
  } as const;
}

test("workspace adoption uses opaque identity, one-step stages, and ordered rollback", async () => {
  // 闭包内赋值不参与控制流分析；显式声明联合类型，避免被收窄为 null/never。
  let stored = null as LumiWorkspaceVaultRecord | null;
  const vault = {
    async load() {
      return stored;
    },
    async save(value: LumiWorkspaceVaultRecord) {
      stored = value;
    },
    async createEmpty() {
      return {
        version: 1 as const,
        origin: "https://lumi.example",
        orgId,
        userId,
        installationId: "1".repeat(64),
        mappings: [],
      };
    },
  };
  let adoption = null as ReturnType<typeof state> | null;
  let binding: Record<string, unknown> | null = null;
  const order: string[] = [];
  const account = {
    origin: "https://lumi.example",
    async readAccount() {
      return {
        user: { id: userId, email: "private@example.com", displayName: "Private" },
        organizations: [
          {
            id: orgId,
            displayName: "Org",
            slug: "org",
            state: "active",
            role: "owner",
            status: "active",
          },
        ],
      };
    },
    async listProjects() {
      return [
        { id: projectId, name: "Project", slug: "project", archived: false, visibility: "org" },
      ];
    },
    async listAdoptionRecords() {
      return adoption ? [adoption] : [];
    },
    async createAdoptionRecord(
      input: { workspaceKey: string; displayName: string; rebindVersion?: number },
      key: string,
    ) {
      assert.equal(input.displayName, "Customer Project");
      serverWorkspaceKey = input.workspaceKey;
      assert.notEqual(input.workspaceKey, privatePath);
      assert.equal(key.length > 0, true);
      if (adoption) {
        assert.equal(input.rebindVersion, adoption.version);
        assert.equal(adoption.projectId, null);
        order.push("p08-rebind");
        adoption = state("local_unmanaged", adoption.version + 1);
      } else {
        order.push("p08-create");
        adoption = state("local_unmanaged", 1);
      }
      return adoption;
    },
    async advanceAdoptionRecord(input: { stage: string; version: number }) {
      assert.equal(input.version, adoption?.version);
      order.push("p08-" + input.stage);
      adoption = state(input.stage, input.version + 1);
      return adoption;
    },
    async rollbackAdoptionRecord(input: { version: number }) {
      assert.equal(input.version, adoption?.version);
      order.push("p08-rollback");
      adoption = state("local_unmanaged", input.version + 1, false);
      return adoption;
    },
  };
  const device = {
    async read() {
      return {
        status: "active" as const,
        orgId,
        device: {
          id: deviceId,
          orgId,
          tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          policyVersion: 1,
        },
      };
    },
    async syncPolicy() {
      order.push("policy-ack");
      return {
        device: {
          status: "active" as const,
          orgId,
          device: {
            id: deviceId,
            orgId,
            tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            policyVersion: 1,
          },
        },
        policy: {
          id: `pol_${"7".repeat(32)}`,
          version: 1,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      };
    },
    async readCurrentPolicy() {
      return {
        id: `pol_${"7".repeat(32)}`,
        version: 1,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    },
    async listWorkspaceBindings() {
      return binding
        ? [
            {
              id: binding.id as string,
              orgId: binding.org_id as string,
              projectId: binding.project_id as string,
              deviceId: binding.device_id as string,
              workspaceIdentity: binding.workspace_identity as string,
              displayName: binding.display_name as string,
              environmentType: binding.environment_type as "local",
            },
          ]
        : [];
    },
    async createWorkspaceBinding(input: {
      workspaceIdentity: string;
      displayName: string;
      environmentType: string;
    }) {
      assert.equal(input.workspaceIdentity.includes("Users"), false);
      order.push("p03-create");
      binding = {
        id: bindingId,
        org_id: orgId,
        project_id: projectId,
        device_id: deviceId,
        workspace_identity: input.workspaceIdentity,
        display_name: input.displayName,
        environment_type: input.environmentType,
      };
      return {
        id: bindingId,
        orgId,
        projectId,
        deviceId,
        workspaceIdentity: input.workspaceIdentity,
        displayName: input.displayName,
        environmentType: input.environmentType,
      };
    },
    async deleteWorkspaceBinding(id: string) {
      assert.equal(id, bindingId);
      order.push("p03-delete");
      binding = null;
    },
  };
  const owner = createLumiWorkspaceOwner({
    origin: "https://lumi.example",
    orgId,
    userId,
    appVersion: "3.14.3",
    account: account as never,
    device: device as never,
    vault,
  });
  const request = {
    orgId,
    workspacePath: privatePath,
    environmentType: "local" as const,
  };
  const before = await owner.read(request);
  assert.equal(before.stage, "local_unmanaged");
  assert.equal(JSON.stringify(before).includes(privatePath), false);
  assert.equal(stored?.mappings[0]?.workspaceIdentity, privatePath);

  const adopted = await owner.bind({
    ...request,
    projectId,
    displayName: "Customer Project",
  });
  assert.equal(adopted.stage, "local_unmanaged");
  assert.equal(adopted.ownership, "local_unmanaged");
  await assert.rejects(
    owner.advance({ ...request, projectId, stage: "managed_policy" }),
    /lumi_workspace_stage_invalid/,
  );
  for (const stage of [
    "account_optional",
    "device_enrolled",
    "workspace_bound",
    "managed_policy",
  ] as const) {
    await owner.advance({ ...request, projectId, stage });
  }
  assert.equal(adoption?.stage, "managed_policy");
  assert.equal(adoption?.ownership, "org_managed");
  assert.equal(order.includes("policy-ack"), true);
  const authorized = await owner.authorizeManagedWorkspace(privatePath);
  assert.equal(authorized.projectId, projectId);
  assert.equal(authorized.deviceId, deviceId);
  assert.equal(authorized.workspaceBindingId, bindingId);
  assert.equal(authorized.policySnapshotId, `pol_${"7".repeat(32)}`);
  assert.equal(authorized.workspaceKey.includes("Users"), false);
  await owner.rollback(request);
  assert.deepEqual(order.slice(-2), ["p03-delete", "p08-rollback"]);
  assert.equal(adoption?.stage, "local_unmanaged");
  assert.equal(binding, null);
  const rebound = await owner.bind({ ...request, projectId, displayName: "Customer Project" });
  assert.equal(rebound.stage, "local_unmanaged");
  assert.equal(rebound.projectId, projectId);
  assert.equal(rebound.ownership, "local_unmanaged");
  assert.equal(order.includes("p08-rebind"), true);
  await owner.rollback(request);
  assert.equal(adoption?.projectId, null);
  assert.equal(adoption?.deviceId, null);
});
