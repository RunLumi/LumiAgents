// DE2E-CLI-03: a Worker-side token expiry (401 `device_token_expired` before the local
// `tokenExpiresAt`) must surface as `reauth_required` with recovery offered, persist across a
// restart, and never re-enroll or discard the key; `device_revoked` stays distinct.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import type { LumiAccountHostTransport } from "@zcode/services/node";
import { createLumiDeviceOwner } from "./lumiDeviceOwner.js";
import type { LumiDeviceRecord } from "./lumiDeviceVault.js";

const origin = "https://lumi.example";
const orgId = `org_${"a".repeat(32)}`;
const userId = `usr_${"b".repeat(32)}`;
const deviceId = `dvc_${"c".repeat(32)}`;
const token = "8".repeat(64);
const recovered = "9".repeat(64);
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
    // Locally the token is still valid for hours: only the Worker knows it is not.
    credential: { id: deviceId, orgId, token, tokenExpiresAt: inHours(6), policyVersion: 2 },
  };
}

function harness(refusal: { status: number; reason: string }) {
  const disk = { value: enrolled() as LumiDeviceRecord | null };
  const original = disk.value!;
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    const auth = new Headers(init?.headers).get("authorization");
    if (path.startsWith("/api/v1/devices/enrollments")) return json({}, 500);
    if (auth === `DeviceToken ${token}`)
      return json(
        {
          error: {
            code: "refused",
            message: "ignored by the client",
            details: { reason: refusal.reason, extra: "never trusted" },
          },
        },
        refusal.status,
      );
    if (path === "/api/v1/devices/policy")
      return json({
        policy_id: `pol_${"7".repeat(32)}`,
        org_id: orgId,
        policy_version: 3,
        expires_at: inHours(5),
      });
    if (path === "/api/v1/devices/heartbeat")
      return json({
        server_time: "2026-10-12T00:00:00.000Z",
        policy_version: 3,
        min_client_version: null,
      });
    return json({});
  }) as typeof fetch;
  const account = {
    async readAccount() {
      throw new Error("re-enrollment must never be attempted");
    },
    async createDeviceRecoveryChallenge() {
      calls.push("recovery-challenge");
      return { challenge: "c".repeat(32) };
    },
    async recoverDeviceToken() {
      calls.push("recovery-renew");
      return { deviceToken: recovered, expiresAt: inHours(24), policyVersion: 3 };
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

test("a Worker-expired token becomes reauth_required, persists across restart and recovers without re-enrolling", async () => {
  const h = harness({ status: 401, reason: "device_token_expired" });
  const running = h.ownerFor();
  assert.equal((await running.read()).status, "active", "positive control: locally valid");

  await assert.rejects(running.syncPolicy(), /lumi_device_token_expired/);
  assert.equal((await running.read()).status, "reauth_required", "recovery is offered");
  assert.ok(Date.parse(h.disk.value!.credential!.tokenExpiresAt) <= Date.now());
  assert.equal(h.disk.value!.credential!.token, token, "the credential is aged, not discarded");
  assert.equal(h.disk.value!.privateKeyPem, h.original.privateKeyPem, "the key is kept");

  // Restart: the persisted state alone says reauth_required.
  const restarted = h.ownerFor();
  assert.equal((await restarted.read()).status, "reauth_required");

  // Recovery (not enrollment) renews the same device identity.
  const after = await restarted.recover();
  assert.equal(after.status, "active");
  assert.equal(h.disk.value!.credential!.token, recovered);
  assert.equal(h.disk.value!.credential!.id, deviceId);
  assert.equal(h.disk.value!.fingerprint, h.original.fingerprint);
  assert.equal(
    h.calls.some((path) => path.startsWith("/api/v1/devices/enrollments")),
    false,
    "no enrollment request",
  );
});

test("a device route answering device_revoked persists revoked, never reauth_required", async () => {
  const h = harness({ status: 403, reason: "device_revoked" });
  const owner = h.ownerFor();
  await assert.rejects(owner.syncPolicy(), /lumi_device_revoked/);
  assert.equal((await owner.read()).status, "revoked", "distinct from reauth_required");
  assert.equal((await h.ownerFor().read()).status, "revoked", "persisted across restart");
  assert.equal(h.disk.value!.credential!.token, token, "the token is not aged as expired");
  assert.equal(h.calls.includes("recovery-challenge"), false);
});

test("other refusals, including a 403 claiming device_token_expired, are not treated as expiry", async () => {
  for (const refusal of [
    { status: 403, reason: "device_token_expired" },
    { status: 401, reason: "something_else" },
    { status: 500, reason: "device_token_expired" },
  ]) {
    const h = harness(refusal);
    const owner = h.ownerFor();
    await assert.rejects(owner.syncPolicy(), /lumi_device_refused/, JSON.stringify(refusal));
    assert.equal((await owner.read()).status, "active", JSON.stringify(refusal));
    assert.deepEqual(h.disk.value, h.original);
  }
});
