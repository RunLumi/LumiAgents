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
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

function newRecord(credentialToken: string | null, expires = inHours(1)): LumiDeviceRecord {
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
    credential: credentialToken
      ? { id: deviceId, orgId, token: credentialToken, tokenExpiresAt: expires, policyVersion: 1 }
      : null,
  };
}

function memoryVault(initial: LumiDeviceRecord | null) {
  const state = { value: initial, saves: 0 };
  return {
    state,
    async load() {
      return state.value;
    },
    async save(value: LumiDeviceRecord) {
      state.saves += 1;
      state.value = value;
    },
  };
}

function harness(vault: ReturnType<typeof memoryVault>, rotatedExpiry = inHours(2)) {
  const calls: string[] = [];
  const account = {
    async readAccount() {
      return {
        user: { id: userId, email: "x@example.com", displayName: "X" },
        organizations: [
          { id: orgId, slug: "acme", displayName: "Acme", state: "active", status: "active" },
        ],
      };
    },
    async createDeviceRecoveryChallenge() {
      calls.push("challenge");
      return { challenge: "c".repeat(32) };
    },
    async recoverDeviceToken() {
      calls.push("recover");
      return { deviceToken: "9".repeat(64), expiresAt: rotatedExpiry, policyVersion: 2 };
    },
    async approveDeviceEnrollment() {
      calls.push("approve");
    },
  } as unknown as LumiAccountHostTransport;
  const fetchImpl = (async (url: URL | string) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path.endsWith("/policy"))
      return new Response(
        JSON.stringify({
          id: `pol_${"7".repeat(32)}`,
          org_id: orgId,
          policy_version: 2,
          expires_at: inHours(5),
        }),
      );
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const owner = createLumiDeviceOwner({
    origin,
    orgId,
    userId,
    account,
    vault,
    appVersion: "3.14.3",
    fetch: fetchImpl,
  });
  return { owner, calls };
}

test("recover refuses before the server rotates the token once the session has been replaced", async () => {
  const vault = memoryVault(newRecord("8".repeat(64)));
  const before = vault.state.value;
  const { owner, calls } = harness(vault);
  // The session is replaced while the challenge is being fetched.
  const guard = () => {
    if (calls.includes("challenge")) throw new Error("lumi_account_changed");
  };
  await assert.rejects(owner.recover(guard), /lumi_account_changed/);
  assert.deepEqual(calls, ["challenge"]);
  assert.equal(vault.state.value, before);
  assert.equal(vault.state.saves, 0);
});

test("a recovery interrupted by sign-out after the server rotated keeps the vault coherent and stops there", async () => {
  const vault = memoryVault(newRecord("8".repeat(64)));
  const { owner, calls } = harness(vault);
  const guard = () => {
    if (calls.includes("recover")) throw new Error("lumi_account_changed");
  };
  await assert.rejects(owner.recover(guard), /lumi_account_changed/);
  // The rotated token is persisted exactly once, so the next recover/read starts from it.
  assert.equal(vault.state.saves, 1);
  assert.equal(vault.state.value?.credential?.token, "9".repeat(64));
  assert.equal(vault.state.value?.credential?.id, deviceId);
  // No policy fetch/ack happened after the interruption.
  assert.equal(
    calls.some((path) => path.includes("/devices/policy")),
    false,
  );
});

test("enroll and read are refused up front for a replaced session and write nothing", async () => {
  const vault = memoryVault(null);
  const { owner, calls } = harness(vault);
  const dead = () => {
    throw new Error("lumi_account_changed");
  };
  await assert.rejects(owner.enroll(dead), /lumi_account_changed/);
  await assert.rejects(owner.read(dead), /lumi_account_changed/);
  await assert.rejects(owner.syncPolicy(dead), /lumi_account_changed/);
  await assert.rejects(owner.refresh(dead), /lumi_account_changed/);
  assert.equal(vault.state.saves, 0);
  assert.equal(vault.state.value, null);
  assert.deepEqual(calls, []);
});

test("enroll stops before creating a key pair when the session changes during the account read", async () => {
  const vault = memoryVault(null);
  const { owner, calls } = harness(vault);
  let reads = 0;
  const guard = () => {
    reads += 1;
    if (reads > 1) throw new Error("lumi_account_changed");
  };
  await assert.rejects(owner.enroll(guard), /lumi_account_changed/);
  assert.equal(vault.state.value, null);
  assert.deepEqual(calls, []);
});

test("a stale owner can neither replace the device key pair nor regress a newer credential", async () => {
  const shared = newRecord("8".repeat(64), inHours(1));
  const vault = memoryVault(shared);
  const stale = harness(vault, inHours(1.5));
  // Load the stale owner's memory while the vault still holds the old credential.
  await stale.owner.read();
  // Another owner (e.g. built after a sign-out/sign-in) moves the credential forward.
  const newer = {
    ...shared,
    credential: { ...shared.credential!, token: "7".repeat(64), tokenExpiresAt: inHours(6) },
  };
  vault.state.value = newer;
  const savesBefore = vault.state.saves;
  await assert.rejects(stale.owner.recover(), /lumi_device_conflict/);
  assert.equal(vault.state.value?.credential?.token, "7".repeat(64));
  assert.equal(vault.state.value?.credential?.tokenExpiresAt, newer.credential.tokenExpiresAt);
  assert.equal(vault.state.saves, savesBefore);
  // The key pair, enrollment and approval key are untouched.
  assert.equal(vault.state.value?.fingerprint, shared.fingerprint);
  assert.equal(vault.state.value?.privateKeyPem, shared.privateKeyPem);
  assert.equal(vault.state.value?.enrollmentId, shared.enrollmentId);
});

test("a stale owner with no record never overwrites an existing device identity", async () => {
  const vault = memoryVault(null);
  const stale = harness(vault);
  await stale.owner.read(); // loads "not enrolled"
  const existing = newRecord("8".repeat(64));
  vault.state.value = existing; // another owner enrolled meanwhile
  await assert.rejects(stale.owner.enroll(), /lumi_device_conflict/);
  assert.equal(vault.state.value, existing);
  assert.equal(vault.state.saves, 0);
});

test("a stale owner never adopts or replaces another owner's pending device identity", async () => {
  const vault = memoryVault(null);
  const stale = harness(vault);
  await stale.owner.read();
  const pending = newRecord(null);
  vault.state.value = pending;
  await assert.rejects(stale.owner.enroll(), /lumi_device_conflict/);
  assert.equal(vault.state.value, pending);
  assert.equal(vault.state.saves, 0);
  assert.equal(stale.calls.includes("approve"), false);
});
