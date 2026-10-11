import test from "node:test";
import assert from "node:assert/strict";
import { LumiAccountHostTransport, LumiDeviceHostTransport } from "@zcode/services/node";
import { createLumiSessionFence, admitSession, withSessionGuard } from "./lumiSessionFence.js";
import { createLumiWorkspaceOwner } from "./lumiWorkspaceOwner.js";
import type { LumiWorkspaceVaultRecord } from "./lumiWorkspaceVault.js";

const orgId = `org_${"a".repeat(32)}`;
const userId = `usr_${"b".repeat(32)}`;
const deviceId = `dvc_${"c".repeat(32)}`;
const projectId = `prj_${"d".repeat(32)}`;
const hex = (n: number, width = 32) => n.toString(16).padStart(width, "0");

function adoptionRow(n: number) {
  return {
    adoption_state_id: `wst_${hex(n)}`,
    org_id: orgId,
    external_installation_id: "1".repeat(64),
    external_workspace_key: hex(n, 64),
    display_name: `Workspace ${n}`,
    bound_project_id: null,
    bound_device_id: null,
    stage: "local_unmanaged",
    ownership: "local_unmanaged",
    credential_mode: "local_credential",
    version: 1,
  };
}

function bindingRow(n: number) {
  return {
    id: `wsb_${hex(n)}`,
    org_id: orgId,
    project_id: projectId,
    device_id: deviceId,
    workspace_identity: hex(n, 64),
    display_name: `Workspace ${n}`,
    environment_type: "local",
  };
}

const activeDevice = {
  status: "active" as const,
  orgId,
  device: {
    id: deviceId,
    orgId,
    tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    policyVersion: 1,
  },
};

async function realDeviceTransport(items: unknown[]) {
  const transport = new LumiDeviceHostTransport(
    "https://lumi.example",
    async () => new Response(JSON.stringify({ items, next_cursor: null, has_more: false })),
    {
      async load() {
        return { ...activeDevice.device, token: "e".repeat(64) };
      },
      async save() {},
    },
  );
  await transport.restore();
  return transport;
}

async function scenario(options: { adoptionRows: unknown[]; bindingRows: unknown[] }) {
  const writes: string[] = [];
  // The real account facade, signed in through its own exchange, serving the adoption list route.
  const real = new LumiAccountHostTransport("https://lumi.example", async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/auth/device-code"))
      return Response.json({
        device_code: "private-code",
        user_code: "1234ABCD",
        verification_uri: "/desktop",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    if (path.endsWith("/device-code/exchange")) {
      const response = Response.json({ session: {} });
      response.headers.append(
        "Set-Cookie",
        "lumi_session=" + "a".repeat(64) + "; HttpOnly; Secure",
      );
      response.headers.append("Set-Cookie", "lumi_csrf=" + "b".repeat(64) + "; Secure");
      return response;
    }
    if (path.endsWith("/adoption/bindings"))
      return Response.json({ items: options.adoptionRows, count: options.adoptionRows.length });
    throw new Error("unexpected request " + path);
  });
  await real.beginSignIn("Test Desktop");
  await real.completeSignIn();
  const account = {
    origin: "https://lumi.example",
    async readAccount() {
      return {
        user: { id: userId, email: "x@example.com", displayName: "X" },
        organizations: [
          { id: orgId, slug: "acme", displayName: "Org", state: "active", status: "active" },
        ],
      };
    },
    listAdoptionRecords: (id: string) => real.listAdoptionRecords(id),
    async createAdoptionRecord() {
      writes.push("create-adoption");
      throw new Error("must not be reached");
    },
  } as unknown as LumiAccountHostTransport;
  const devices = await realDeviceTransport(options.bindingRows);
  const device = {
    async read() {
      return activeDevice;
    },
    async syncPolicy() {
      writes.push("sync-policy");
      throw new Error("must not be reached");
    },
    async readCurrentPolicy() {
      throw new Error("must not be reached");
    },
    listWorkspaceBindings: () => devices.listWorkspaceBindings(),
    async createWorkspaceBinding() {
      writes.push("create-binding");
      throw new Error("must not be reached");
    },
    async deleteWorkspaceBinding() {
      writes.push("delete-binding");
    },
  };
  let stored = null as LumiWorkspaceVaultRecord | null;
  const owner = createLumiWorkspaceOwner({
    origin: "https://lumi.example",
    orgId,
    userId,
    appVersion: "3.14.3",
    account,
    device,
    vault: {
      async load() {
        return stored;
      },
      async save(value) {
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
    },
  });
  return { owner, writes };
}

const workspace = {
  orgId,
  workspacePath: "/Users/private/Customer Project",
  environmentType: "local" as const,
};
const bindCommand = { ...workspace, projectId, displayName: "Customer Project" };

test("100 or more adoption rows: bind, read and rollback refuse and create nothing", async () => {
  const { owner, writes } = await scenario({
    adoptionRows: Array.from({ length: 100 }, (_, i) => adoptionRow(i + 1)),
    bindingRows: [],
  });
  await assert.rejects(owner.bind(bindCommand), /lumi_page_incomplete/);
  await assert.rejects(owner.read(workspace), /lumi_page_incomplete/);
  await assert.rejects(owner.rollback(workspace), /lumi_page_incomplete/);
  assert.deepEqual(writes, []);
});

test("100 or more device bindings: bind refuses and creates neither a second binding nor a row", async () => {
  const { owner, writes } = await scenario({
    adoptionRows: [],
    bindingRows: Array.from({ length: 100 }, (_, i) => bindingRow(i + 1)),
  });
  await assert.rejects(owner.bind(bindCommand), /lumi_page_incomplete/);
  assert.deepEqual(writes, []);
});

test("a complete list below the ceiling still reaches the create path (positive control)", async () => {
  const { owner, writes } = await scenario({
    adoptionRows: Array.from({ length: 99 }, (_, i) => adoptionRow(i + 1)),
    bindingRows: Array.from({ length: 99 }, (_, i) => bindingRow(i + 1)),
  });
  await assert.rejects(owner.bind(bindCommand), /must not be reached/);
  assert.deepEqual(writes, ["create-binding"]);
});

test("withSessionGuard refuses a result once the session was replaced, and admitSession is per call", async () => {
  const fence = createLumiSessionFence();
  const guard = admitSession(fence);
  guard();
  fence.bump();
  assert.throws(guard, /lumi_account_changed/);
  admitSession(fence)(); // a new admission sees the new session

  await assert.rejects(
    withSessionGuard(fence, async () => {
      fence.bump(); // sign-out during the work
      return "late result";
    }),
    /lumi_account_changed/,
  );
  assert.equal(await withSessionGuard(fence, async () => "ok"), "ok");
});
