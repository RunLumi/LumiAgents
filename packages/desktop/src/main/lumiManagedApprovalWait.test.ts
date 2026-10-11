/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import { waitForLumiManagedApproval } from "./lumiManagedApprovalWait.js";
import type { ZCodeManagedToolDecisionResult } from "@zcode/shared";
const id = (prefix: string) => `${prefix}_${"a".repeat(32)}`;
const base = {
  runId: id("run"),
  toolCallId: id("tcl"),
  toolId: id("tool"),
  toolFingerprint: "b".repeat(64),
  riskClass: "external_side_effect",
  policyVersion: 1,
  policyState: "ok",
  approvalId: id("apr"),
  approvalMode: "per_use",
  approvalExpiresAt: new Date(10_000).toISOString(),
} as const;

test("approval waits revalidate each poll and only a bound allow exits", async () => {
  let now = 0,
    calls = 0,
    sleeps = 0;
  const result = await waitForLumiManagedApproval(
    async () => {
      calls++;
      return { ...base, decision: calls < 3 ? "require_per_use_approval" : "allow" };
    },
    {
      now: () => now,
      timeoutMs: 5000,
      pollMs: 100,
      wait: async (ms) => {
        now += ms;
        sleeps++;
      },
    },
  );
  assert.equal(result.decision, "allow");
  assert.equal(calls, 3);
  assert.equal(sleeps, 2);
});
test("denial and lost live lease stop approval polling without fabricating allow", async () => {
  let calls = 0;
  const denied = await waitForLumiManagedApproval(async () => {
    calls++;
    return { ...base, decision: "deny" };
  });
  assert.equal(denied.decision, "deny");
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    waitForLumiManagedApproval(
      async () => {
        if (++calls > 1) throw new Error("lumi_managed_auth_refused");
        return { ...base, decision: "require_per_use_approval" };
      },
      { now: () => 0, wait: async () => {} },
    ),
    /lumi_managed_auth_refused/,
  );
  assert.equal(calls, 2);
});
test("expired wait and changed approval binding cannot release a permit", async () => {
  let now = 0,
    calls = 0;
  await assert.rejects(
    waitForLumiManagedApproval(
      async () => {
        calls++;
        return { ...base, decision: "require_per_use_approval" };
      },
      {
        now: () => now,
        timeoutMs: 200,
        pollMs: 100,
        wait: async (ms) => {
          now += ms;
        },
      },
    ),
    /lumi_approval_wait_expired/,
  );
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    waitForLumiManagedApproval(
      async () =>
        ({
          ...base,
          decision: ++calls === 1 ? "require_per_use_approval" : "allow",
          approvalId: calls === 1 ? id("apr") : `apr_${"d".repeat(32)}`,
        }) as ZCodeManagedToolDecisionResult,
      { now: () => 0, wait: async () => {} },
    ),
    /lumi_approval_binding_changed/,
  );
  await assert.rejects(
    waitForLumiManagedApproval(
      async () => ({
        ...base,
        decision: "require_per_use_approval",
        approvalExpiresAt: new Date(0).toISOString(),
      }),
      { now: () => 1 },
    ),
    /lumi_approval_wait_expired/,
  );
});
