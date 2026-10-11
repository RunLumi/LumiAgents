/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGED_POLL_MIN_INTERVAL_MS,
  createManagedPollTrigger,
  type ManagedPollRequestMessage,
} from "./managedPoll.js";

function trigger(initial: { managed: boolean; now: number }) {
  const state = { ...initial };
  const posted: ManagedPollRequestMessage[] = [];
  const logs: string[] = [];
  const poll = createManagedPollTrigger({
    hasManagedAdoption: async () => state.managed,
    post: (message) => void posted.push(message),
    now: () => state.now,
    logWarn: (message) => void logs.push(message),
  });
  return { state, posted, logs, poll };
}

test("without a managed marker the scheduler never contacts Main for managed work", async () => {
  const t = trigger({ managed: false, now: 1_000_000 });
  assert.equal(await t.poll(), "none");
  assert.deepEqual(t.posted, []);
});

test("the request carries nothing: no ids, no token, no prompt", async () => {
  const t = trigger({ managed: true, now: 1_000_000 });
  assert.equal(await t.poll(), "requested");
  assert.deepEqual(t.posted, [{ type: "managed-poll-request" }]);
});

test("repeated ticks and manual wakes are throttled to one request per interval", async () => {
  const t = trigger({ managed: true, now: 1_000_000 });
  assert.equal(await t.poll(), "requested");
  t.state.now += MANAGED_POLL_MIN_INTERVAL_MS - 1;
  assert.equal(await t.poll(), "throttled");
  t.state.now += 1;
  assert.equal(await t.poll(), "requested");
  assert.equal(t.posted.length, 2);
});

test("a failing marker read is logged without ids and never becomes a request", async () => {
  const logs: string[] = [];
  const posted: ManagedPollRequestMessage[] = [];
  const poll = createManagedPollTrigger({
    hasManagedAdoption: async () => {
      throw new Error("sqlite: /Users/me/secret.db busy");
    },
    post: (message) => void posted.push(message),
    now: () => 1,
    logWarn: (message) => void logs.push(message),
  });
  assert.equal(await poll(), "none");
  assert.deepEqual(posted, []);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.includes("/Users/me"), false);
});
