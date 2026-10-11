import assert from "node:assert/strict";
import test from "node:test";
import { LumiDeviceHostTransport } from "./deviceTransport.js";

test("private heartbeat sends bounded support with device auth and validates response", async () => {
  let calls = 0;
  let response: Record<string, unknown> = {
    server_time: "2026-10-08T00:00:00.000Z",
    policy_version: 3,
    min_client_version: null,
  };
  const credential = {
    id: `dvc_${"a".repeat(32)}`,
    orgId: `org_${"b".repeat(32)}`,
    token: "c".repeat(64),
    tokenExpiresAt: new Date(Date.now() + 60000).toISOString(),
    policyVersion: 3,
  };
  const transport = new LumiDeviceHostTransport(
    "http://127.0.0.1:8787",
    (async (url, init) => {
      calls++;
      assert.equal(String(url), "http://127.0.0.1:8787/api/v1/devices/heartbeat");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), `DeviceToken ${credential.token}`);
      assert.equal(headers.has("cookie"), false);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        app_version: "3.14.3",
        capabilities: { filesystem_write: true, process_execution: false },
      });
      return new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
    { load: async () => credential, save: async () => {} },
  );
  await transport.restore();
  const report = { filesystem_write: true, process_execution: false };
  assert.equal((await transport.heartbeat("3.14.3", report)).policyVersion, 3);
  for (const invalid of [{ process_list: true }, { filesystem_write: "yes" }, []])
    await assert.rejects(
      transport.heartbeat("3.14.3", invalid as never),
      /lumi_capability_report_invalid/,
    );
  assert.equal(calls, 1);
  response = { ...response, policy_version: -1 };
  await assert.rejects(transport.heartbeat("3.14.3", report), /lumi_device_response_invalid/);
});
