// The 15-minute device token (P03-CG) must be rotated by proof of possession before it expires,
// without any user action. Before this, only the Settings "Refresh device token" command rotated
// it, so the managed automation poll stopped silently 15 minutes after enrollment (journey E).
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify, createPublicKey } from "node:crypto";
import type { LumiAccountHostTransport } from "@zcode/services/node";
import { createLumiDeviceOwner } from "./lumiDeviceOwner.js";
import type { LumiDeviceRecord } from "./lumiDeviceVault.js";

const origin = "https://lumi.example";
const orgId = `org_${"a".repeat(32)}`;
const userId = `usr_${"b".repeat(32)}`;
const deviceId = `dvc_${"c".repeat(32)}`;
const firstToken = "8".repeat(64);
const rotatedToken = "9".repeat(64);
const NOW = Date.parse("2026-10-12T08:00:00.000Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

function worker(tokenExpiresInMs: number) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const disk: { value: LumiDeviceRecord } = {
    value: {
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
      credential: {
        id: deviceId,
        orgId,
        token: firstToken,
        tokenExpiresAt: at(tokenExpiresInMs),
        policyVersion: 2,
      },
    },
  };
  const calls: { path: string; token?: string }[] = [];
  const nonce = "n".repeat(32);
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const token = String((init?.headers as Record<string, string>)?.Authorization ?? "").replace(
      "DeviceToken ",
      "",
    );
    calls.push({ path, token });
    if (path === "/api/v1/devices/token/nonce")
      return Response.json({ nonce, expires_at: at(60_000) });
    if (path === "/api/v1/devices/token") {
      const body = JSON.parse(String(init?.body)) as { signature: string };
      assert.ok(
        verify(
          null,
          Buffer.from(nonce),
          createPublicKey(disk.value.publicKeyPem),
          Buffer.from(body.signature, "hex"),
        ),
        "the rotation is signed by the device key",
      );
      return Response.json({
        device_token: rotatedToken,
        token_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        policy_version: 2,
      });
    }
    if (path === "/api/v1/devices/automations/due") return Response.json({ items: [] });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const owner = createLumiDeviceOwner({
    origin,
    orgId,
    userId,
    account: {} as LumiAccountHostTransport,
    vault: {
      load: async () => disk.value,
      save: async (value) => {
        disk.value = value;
      },
    },
    appVersion: "3.15.1",
    fetch: fetchImpl,
  });
  return { owner, calls, disk };
}

test("a token inside the refresh margin is rotated by proof of possession before the due poll", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  try {
    const w = worker(3 * 60_000);
    const leases = await w.owner.automationLeases();
    await leases.listDue();
    assert.deepEqual(
      w.calls.map((call) => call.path),
      ["/api/v1/devices/token/nonce", "/api/v1/devices/token", "/api/v1/devices/automations/due"],
    );
    assert.equal(w.calls.at(-1)?.token, rotatedToken, "the poll uses the rotated token");
    assert.equal(w.disk.value.credential?.token, rotatedToken, "the rotation is persisted");
  } finally {
    mock.timers.reset();
  }
});

test("a token with ample life is not rotated", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  try {
    const w = worker(10 * 60_000);
    await (await w.owner.automationLeases()).listDue();
    assert.deepEqual(
      w.calls.map((call) => call.path),
      ["/api/v1/devices/automations/due"],
    );
  } finally {
    mock.timers.reset();
  }
});

test("a lease port kept across time rotates once the token enters the margin", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  try {
    const w = worker(10 * 60_000);
    const leases = await w.owner.automationLeases();
    await leases.listDue();
    mock.timers.tick(7 * 60_000); // a long managed run: 3 minutes left on the original token
    await leases.listDue();
    assert.deepEqual(
      w.calls.map((call) => call.path),
      [
        "/api/v1/devices/automations/due",
        "/api/v1/devices/token/nonce",
        "/api/v1/devices/token",
        "/api/v1/devices/automations/due",
      ],
    );
    assert.equal(w.calls.at(-1)?.token, rotatedToken);
  } finally {
    mock.timers.reset();
  }
});

test("an expired token is never rotated silently; it still needs human recovery", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  try {
    const w = worker(-60_000);
    const leases = await w.owner.automationLeases();
    await assert.rejects(leases.listDue(), /lumi_device_token_expired/);
    assert.deepEqual(w.calls, [], "nothing is sent with an expired token");
    assert.equal((await w.owner.read()).status, "reauth_required");
  } finally {
    mock.timers.reset();
  }
});
