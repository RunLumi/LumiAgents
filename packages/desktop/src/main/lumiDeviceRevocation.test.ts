// DE2E-CLI-01 item 4: after the Worker revokes this device, the running desktop and a restarted one
// refuse new managed work (turn/tool authorization, automation claim, token mint, policy sync)
// without re-enrolling, because every managed authority is re-validated with the device token.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  createManagedOccurrenceDriver,
  type LumiAccountHostTransport,
  type LumiAdoptionRecord,
} from "@zcode/services/node";
import { createLumiDeviceOwner } from "./lumiDeviceOwner.js";
import type { LumiDeviceRecord } from "./lumiDeviceVault.js";
import { authorizeManagedWorkspaceScope } from "./lumiWorkspaceAuthorization.js";
import { readWorkspaceServerState } from "./lumiWorkspaceServerState.js";
import type { LumiWorkspaceMapping } from "./lumiWorkspaceVault.js";

const origin = "https://lumi.example";
const orgId = `org_${"a".repeat(32)}`;
const userId = `usr_${"b".repeat(32)}`;
const deviceId = `dvc_${"c".repeat(32)}`;
const projectId = `prj_${"d".repeat(32)}`;
const bindingId = `wsb_${"e".repeat(32)}`;
const installationId = "installation-0123456789";
const workspaceKey = "workspace-key-1";
const token = "8".repeat(64);
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

function enrolledRecord(): LumiDeviceRecord {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    version: 1,
    origin,
    orgId,
    userId,
    orgSlug: "acme",
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    fingerprint: createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex"),
    enrollmentId: `enr_${"1".repeat(32)}`,
    approvalKey: "approval-key",
    credential: { id: deviceId, orgId, token, tokenExpiresAt: inHours(1), policyVersion: 2 },
  };
}

/** A Worker whose device-token routes behave like `require_device` once the device is revoked. */
function worker() {
  const state = { revoked: false };
  const calls: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    const auth = new Headers(init?.headers).get("authorization");
    if (path.startsWith("/api/v1/devices/enrollments")) return json({}, 500);
    if (auth !== `DeviceToken ${token}`) return json({}, 401);
    // Revocation deletes the device's tokens and the token lookup joins `status = 'active'`.
    if (state.revoked)
      return json(
        {
          error: {
            code: "authentication_required",
            message: "The device token is expired or revoked.",
            details: { reason: "device_token_expired" },
          },
        },
        401,
      );
    if (path === "/api/v1/devices/policy")
      return json({
        policy_id: `pol_${"7".repeat(32)}`,
        org_id: orgId,
        policy_version: 2,
        expires_at: inHours(5),
      });
    if (path === "/api/v1/devices/bindings")
      return json({
        items: [
          {
            id: bindingId,
            org_id: orgId,
            project_id: projectId,
            device_id: deviceId,
            workspace_identity: workspaceKey,
            display_name: "Workspace",
            environment_type: "local",
          },
        ],
        next_cursor: null,
      });
    if (path === "/api/v1/devices/automations/due") return json({ items: [] });
    return json({}, 404);
  }) as typeof fetch;
  return { state, calls, fetchImpl };
}

function vaultOver(state: { value: LumiDeviceRecord | null }) {
  return {
    async load() {
      return state.value;
    },
    async save(value: LumiDeviceRecord) {
      state.value = value;
    },
  };
}

const adoption: LumiAdoptionRecord = {
  adoptionStateId: `wst_${"f".repeat(32)}`,
  orgId,
  installationId,
  workspaceKey,
  displayName: "Workspace",
  projectId,
  deviceId,
  stage: "managed_policy",
  ownership: "org_managed",
  credentialMode: "org_managed",
  version: 1,
} as LumiAdoptionRecord;

const account = {
  async readAccount() {
    return {
      user: { id: userId, email: "x@example.com", displayName: "X" },
      organizations: [
        { id: orgId, slug: "acme", displayName: "Acme", state: "active", status: "active" },
      ],
    };
  },
  async listAdoptionRecords() {
    return [adoption];
  },
  async approveDeviceEnrollment() {
    throw new Error("re-enrollment must never be attempted");
  },
} as unknown as LumiAccountHostTransport;

const mapping = { workspaceKey } as LumiWorkspaceMapping;

/** The same composition `authorizeManagedRequest` uses for every managed turn and tool decision. */
function authorizeManaged(device: ReturnType<typeof createLumiDeviceOwner>) {
  return authorizeManagedWorkspaceScope({
    orgId,
    current: mapping,
    readServerState: () =>
      readWorkspaceServerState({ device, account, orgId, installationId }, workspaceKey),
    readCurrentPolicy: () => device.readCurrentPolicy(),
  });
}

/** The occurrence driver Main assembles over this device's lease transport. */
async function pollAutomations(device: ReturnType<typeof createLumiDeviceOwner>) {
  return createManagedOccurrenceDriver({
    orgId,
    leases: await device.automationLeases(),
    findMarkerByManagedId: async () => null,
    principalFor: async () => ({ kind: "user", id: userId }),
    currentPolicyVersion: async () => 2,
  }).poll();
}

test("a revoked device refuses new managed work at runtime and after restart, without re-enrolling", async () => {
  const server = worker();
  const disk = { value: enrolledRecord() as LumiDeviceRecord | null };
  const enrolled = disk.value;
  const ownerFor = () =>
    createLumiDeviceOwner({
      origin,
      orgId,
      userId,
      account,
      vault: vaultOver(disk),
      appVersion: "3.15.1",
      fetch: server.fetchImpl,
    });
  const running = ownerFor();

  // Positive control: the same compositions succeed while the device is active.
  const authorized = await authorizeManaged(running);
  assert.equal(authorized.workspaceBindingId, bindingId);
  assert.deepEqual(await pollAutomations(running), { started: [], skipped: [] });

  server.state.revoked = true;
  const refusedAfterRevoke = async (owner: ReturnType<typeof createLumiDeviceOwner>) => {
    // Managed turn and managed tool decision both go through this authorization first.
    await assert.rejects(authorizeManaged(owner), /lumi_device_refused/);
    // Automation: the due list is refused, so nothing is claimed.
    await assert.rejects(pollAutomations(owner), (error: unknown) => {
      assert.equal((error as { reason?: string }).reason, "device_token_expired");
      return true;
    });
    // Token mint and policy sync are refused as well; the vault keeps the dead credential only.
    await assert.rejects(owner.refresh(), /lumi_device_refused/);
    await assert.rejects(owner.syncPolicy(), /lumi_device_refused/);
    await assert.rejects(owner.readCurrentPolicy(), /lumi_device_refused/);
    // `enroll` never silently re-enrolls an identity that already holds a credential.
    await owner.enroll();
  };

  await refusedAfterRevoke(running);
  // Restart: a fresh owner over the same persisted record cannot restore authority.
  await refusedAfterRevoke(ownerFor());

  assert.equal(
    server.calls.some((path) => path.startsWith("/api/v1/devices/enrollments")),
    false,
    "no enrollment request was ever sent",
  );
  assert.equal(disk.value?.fingerprint, enrolled?.fingerprint, "the device key pair is unchanged");
  assert.equal(disk.value?.credential?.token, token, "no new credential was minted or adopted");
  // Reading the local projection never throws, so local personal mode is not blocked by it.
  await ownerFor().read();
});
