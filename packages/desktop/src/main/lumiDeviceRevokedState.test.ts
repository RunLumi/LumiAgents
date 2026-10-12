// DE2E-CLI-04: the Worker deletes a revoked device's tokens, so device routes answer 401
// `device_token_expired` (recovery offered); recovery then answers `device_revoked`. That must be
// persisted for exactly this device as a distinct `revoked` state that survives a restart, offers
// no recovery, sends nothing further with the token, and never re-enrolls.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  LumiAccountError,
  LumiAutomationLeaseError,
  type LumiAccountHostTransport,
} from "@zcode/services/node";
import { createLumiDeviceOwner } from "./lumiDeviceOwner.js";
import type { LumiDeviceRecord } from "./lumiDeviceVault.js";

const origin = "https://lumi.example";
const orgId = `org_${"a".repeat(32)}`;
const userId = `usr_${"b".repeat(32)}`;
const deviceId = `dvc_${"c".repeat(32)}`;
const token = "8".repeat(64);
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

function enrolled(): LumiDeviceRecord {
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
    credential: { id: deviceId, orgId, token, tokenExpiresAt: inHours(6), policyVersion: 2 },
  };
}

/** The deployed Worker after revocation: token lookup 401, recovery 409 `device_revoked`. */
function revokedWorker() {
  const disk = { value: enrolled() as LumiDeviceRecord | null };
  const original = disk.value!;
  const calls: string[] = [];
  const fetchImpl = (async (url: URL | string) => {
    calls.push(new URL(String(url)).pathname);
    return new Response(
      JSON.stringify({
        error: { code: "authentication_required", details: { reason: "device_token_expired" } },
      }),
      { status: 401 },
    );
  }) as typeof fetch;
  const account = {
    async readAccount() {
      calls.push("account-read");
      return {
        user: { id: userId, email: "x@example.com", displayName: "X" },
        organizations: [
          { id: orgId, slug: "acme", displayName: "Acme", state: "active", status: "active" },
        ],
      };
    },
    async createDeviceRecoveryChallenge() {
      calls.push("recovery-challenge");
      throw new LumiAccountError("lumi_device_revoked", 409);
    },
    async recoverDeviceToken() {
      calls.push("recovery-renew");
      throw new Error("unreachable");
    },
    async approveDeviceEnrollment() {
      throw new Error("re-enrollment must never be attempted");
    },
  } as unknown as LumiAccountHostTransport;
  const ownerFor = () =>
    createLumiDeviceOwner({
      origin,
      orgId,
      userId,
      account,
      vault: {
        load: async () => disk.value,
        save: async (value) => {
          disk.value = value;
        },
      },
      appVersion: "3.15.1",
      fetch: fetchImpl,
    });
  return { disk, original, calls, ownerFor };
}

test("revoked: expiry offers recovery, recovery is refused, revoked is persisted and final", async () => {
  const w = revokedWorker();
  const owner = w.ownerFor();
  await assert.rejects(owner.syncPolicy(), /lumi_device_token_expired/);
  assert.equal((await owner.read()).status, "reauth_required", "the Worker cannot say more yet");

  await assert.rejects(owner.recover(), /lumi_device_revoked/);
  assert.equal((await owner.read()).status, "revoked");
  assert.ok(Number.isFinite(Date.parse(w.disk.value!.revokedAt ?? "")));
  assert.equal(w.disk.value!.credential!.id, deviceId, "recorded for exactly this device");
  assert.equal(w.disk.value!.privateKeyPem, w.original.privateKeyPem, "nothing is discarded");

  const restarted = w.ownerFor();
  assert.equal((await restarted.read()).status, "revoked", "persisted across restart");
  const before = w.calls.length;
  await assert.rejects(restarted.recover(), /lumi_device_revoked/);
  await assert.rejects(restarted.syncPolicy(), /lumi_device_revoked/);
  await assert.rejects(restarted.readCurrentPolicy(), /lumi_device_revoked/);
  await assert.rejects(restarted.automationLeases(), /lumi_device_revoked/);
  assert.equal(w.calls.length, before, "nothing is sent for a revoked device");
  assert.equal((await restarted.enroll()).status, "revoked", "no silent re-enrollment");
  assert.deepEqual(w.calls.slice(before), ["account-read"], "enroll only re-reads the account");
});

test("the automation poll path records an expiry through the same owner handling", async () => {
  const w = revokedWorker();
  const owner = w.ownerFor();
  await owner.read();
  // What the lease transport throws for the due list after the Worker dropped the token.
  await owner.observeServerRefusal(new LumiAutomationLeaseError(401, "device_token_expired"));
  assert.equal((await owner.read()).status, "reauth_required");
  await owner.observeServerRefusal(new LumiAutomationLeaseError(403, "device_revoked"));
  assert.equal((await w.ownerFor().read()).status, "revoked");
  // Unrelated refusals change nothing.
  const fresh = revokedWorker();
  const other = fresh.ownerFor();
  await other.read();
  await other.observeServerRefusal(new LumiAutomationLeaseError(409, "occurrence_already_claimed"));
  await other.observeServerRefusal(new LumiAutomationLeaseError(403, "device_token_expired"));
  assert.deepEqual(fresh.disk.value, fresh.original);
});
