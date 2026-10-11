import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeLiveRuntimeCapabilities,
  publishLumiRuntimeCapabilities,
  type LumiRuntimeCapabilityLease,
} from "./lumiRuntimeCapabilityPublication.js";
import type { ZCodeManagedRuntimeCapabilities } from "@zcode/shared";

const empty: ZCodeManagedRuntimeCapabilities = {
  filesystem_write: false,
  process_execution: false,
  network_access: false,
  mcp_execution: false,
  browser_use: false,
  computer_use: false,
};
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("failed publish rolls back before queued replacement and never erases its success", async () => {
  const lease: LumiRuntimeCapabilityLease = { runtimeCapabilities: { ...empty } };
  const entered = deferred(),
    release = deferred();
  let secondAdmitted = false;
  const first = publishLumiRuntimeCapabilities(
    lease,
    { ...empty, filesystem_write: true },
    {
      isCurrent: () => true,
      authorize: async () => {},
      publish: async () => {
        entered.resolve();
        await release.promise;
      },
    },
  );
  const refusal = assert.rejects(first, /heartbeat refused/);
  await entered.promise;
  const input = { ...empty, network_access: true };
  const second = publishLumiRuntimeCapabilities(lease, input, {
    isCurrent: () => true,
    authorize: async () => {
      secondAdmitted = true;
      assert.deepEqual(lease.runtimeCapabilities, empty);
    },
    publish: async () => {
      assert.equal(lease.runtimeCapabilities?.network_access, true);
    },
  });
  input.network_access = false;
  await Promise.resolve();
  assert.equal(secondAdmitted, false);
  assert.equal(lease.runtimeCapabilities?.filesystem_write, true);
  release.reject(new Error("heartbeat refused"));
  await refusal;
  await second;
  assert.equal(lease.runtimeCapabilities?.network_access, true);
  assert.equal(lease.runtimeCapabilities?.filesystem_write, false);
});

test("lease removed during authorization cannot publish or replace snapshot", async () => {
  const lease: LumiRuntimeCapabilityLease = { runtimeCapabilities: { ...empty } };
  let current = true,
    publishes = 0;
  await assert.rejects(
    publishLumiRuntimeCapabilities(
      lease,
      { ...empty, filesystem_write: true },
      {
        isCurrent: () => current,
        authorize: async () => {
          current = false;
        },
        publish: async () => {
          publishes++;
        },
      },
    ),
    /lumi_runtime_capabilities_refused/,
  );
  assert.equal(publishes, 0);
  assert.deepEqual(lease.runtimeCapabilities, empty);
});

test("queued report for a removed lease is refused before authorization or IO", async () => {
  const lease: LumiRuntimeCapabilityLease = {};
  let current = true,
    calls = 0;
  const entered = deferred(),
    release = deferred();
  const first = publishLumiRuntimeCapabilities(lease, empty, {
    isCurrent: () => current,
    authorize: async () => {},
    publish: async () => {
      entered.resolve();
      await release.promise;
    },
  });
  const firstRefusal = assert.rejects(first, /lumi_runtime_capabilities_refused/);
  await entered.promise;
  const second = publishLumiRuntimeCapabilities(lease, empty, {
    isCurrent: () => current,
    authorize: async () => {
      calls++;
    },
    publish: async () => {
      calls++;
    },
  });
  const secondRefusal = assert.rejects(second, /lumi_runtime_capabilities_refused/);
  current = false;
  release.resolve();
  await firstRefusal;
  await secondRefusal;
  assert.equal(calls, 0);
});

test("the merged report is the union for one device owner and empty when nothing is live", () => {
  const owner = {};
  const other = {};
  assert.deepEqual(mergeLiveRuntimeCapabilities([], owner), {});
  assert.deepEqual(
    mergeLiveRuntimeCapabilities([{ deviceOwner: owner }, { deviceOwner: other }], owner),
    {},
    "a lease that never reported is not support",
  );
  const merged = mergeLiveRuntimeCapabilities(
    [
      { deviceOwner: owner, runtimeCapabilities: { ...empty, filesystem_write: true } },
      { deviceOwner: owner, runtimeCapabilities: { ...empty, browser_use: true } },
      { deviceOwner: other, runtimeCapabilities: { ...empty, computer_use: true } },
    ],
    owner,
  );
  assert.deepEqual(merged, { ...empty, filesystem_write: true, browser_use: true });
});
