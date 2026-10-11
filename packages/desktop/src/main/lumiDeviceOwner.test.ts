import assert from "node:assert/strict";
import test from "node:test";
import { createLumiDeviceOwner } from "./lumiDeviceOwner.js";

test("Main device owner reports trusted runtime before policy ACK and stops on heartbeat failure", async () => {
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  let refuse = false;
  const id = (prefix: string) => `${prefix}_${"a".repeat(32)}`;
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  globalThis.fetch = (async (url, init) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path.endsWith("heartbeat")) {
      assert.deepEqual(JSON.parse(String(init?.body)).capabilities, {
        filesystem_write: true,
        process_execution: false,
      });
      if (refuse)
        return new Response(JSON.stringify({ error: { code: "device_invalid" } }), { status: 422 });
      return Response.json({
        server_time: "2026-10-08T00:00:00.000Z",
        policy_version: 1,
        min_client_version: null,
      });
    }
    if (path.endsWith("/policy"))
      return Response.json({
        org_id: id("org"),
        policy_id: id("pol"),
        policy_version: 1,
        expires_at: expiresAt,
      });
    if (path.endsWith("/ack")) return new Response(null, { status: 204 });
    throw new Error("unexpected route");
  }) as typeof fetch;
  try {
    const owner = createLumiDeviceOwner({
      origin: "http://127.0.0.1:8787",
      orgId: id("org"),
      userId: id("usr"),
      appVersion: "3.14.3",
      account: {} as never,
      vault: {
        load: async () =>
          ({
            credential: {
              id: id("dvc"),
              orgId: id("org"),
              token: "a".repeat(64),
              tokenExpiresAt: expiresAt,
              policyVersion: 1,
            },
          }) as never,
        save: async () => {},
      },
      readRuntimeCapabilities: async () => ({ filesystem_write: true, process_execution: false }),
    });
    await owner.syncPolicy();
    assert.deepEqual(paths, [
      "/api/v1/devices/heartbeat",
      "/api/v1/devices/policy",
      "/api/v1/devices/policy/ack",
    ]);
    paths.length = 0;
    refuse = true;
    await assert.rejects(owner.syncPolicy());
    assert.deepEqual(paths, ["/api/v1/devices/heartbeat"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runtime refresh is heartbeat-only, deduplicated by content, and re-sent after a refusal", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  const paths: string[] = [];
  let refuse = false;
  const id = (prefix: string) => `${prefix}_${"a".repeat(32)}`;
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  globalThis.fetch = (async (url, init) => {
    paths.push(new URL(String(url)).pathname);
    bodies.push(JSON.parse(String(init?.body)).capabilities);
    if (refuse)
      return new Response(JSON.stringify({ error: { code: "device_invalid" } }), { status: 422 });
    return Response.json({
      server_time: "2026-10-08T00:00:00.000Z",
      policy_version: 1,
      min_client_version: null,
    });
  }) as typeof fetch;
  let live: Record<string, boolean> = {};
  try {
    const owner = createLumiDeviceOwner({
      origin: "http://127.0.0.1:8787",
      orgId: id("org"),
      userId: id("usr"),
      appVersion: "3.14.3",
      account: {} as never,
      vault: {
        load: async () =>
          ({
            credential: {
              id: id("dvc"),
              orgId: id("org"),
              token: "a".repeat(64),
              tokenExpiresAt: expiresAt,
              policyVersion: 1,
            },
          }) as never,
        save: async () => {},
      },
      // Provider mirrors Main's live-lease union; empty when no runtime is live.
      readRuntimeCapabilities: async () => live,
    });
    await owner.refreshRuntimeCapabilities();
    await owner.refreshRuntimeCapabilities();
    assert.deepEqual(bodies, [{}], "an unchanged (empty) report is sent once");
    live = { filesystem_write: true, process_execution: false };
    await owner.refreshRuntimeCapabilities();
    await owner.refreshRuntimeCapabilities();
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[1], { filesystem_write: true, process_execution: false });
    // A refused publish must not be remembered as delivered.
    live = { filesystem_write: false, process_execution: false };
    refuse = true;
    await assert.rejects(owner.refreshRuntimeCapabilities());
    refuse = false;
    await owner.refreshRuntimeCapabilities();
    assert.equal(bodies.length, 4);
    assert.deepEqual(bodies[3], { filesystem_write: false, process_execution: false });
    assert.ok(paths.every((path) => path === "/api/v1/devices/heartbeat"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
