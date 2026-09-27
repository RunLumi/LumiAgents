import assert from "node:assert/strict";
import test from "node:test";

import { P06AutomationFenceGuard, P06AutomationLeaseError } from "./p06-automation-lease-guard.js";
import type {
  P06AutomationClaimResponse,
  P06AutomationStartGrant,
} from "./p06-automation-lease.js";

const HEX = "0123456789abcdef0123456789abcdef";
const LEASE_ID = `lse_${HEX}`;
const OCCURRENCE_ID = `occ_${HEX}`;
const RUN_ID = `run_${HEX}`;
const SESSION_ID = `rse_${HEX}`;
/**
 * Synthetic stand-in for the one-time raw lease token the server returns
 * once from `claim`. It is not a credential and is never transmitted: the
 * tests only prove the fence guard stamps the value it was given and never
 * leaks it through `Debug`, `JSON.stringify`, or an error.
 */
const SERVER_ISSUED_CLAIM_VALUE = "synthetic-issued-value-0123456789";
const FUTURE = "2099-01-01T00:00:00.000Z";

const occurrence = {
  occurrence_id: OCCURRENCE_ID,
  automation_id: `aut_${HEX}`,
  attempt: 1,
  scheduled_for: "2026-09-25T16:00:00.000Z",
  off_peak_mode: "normal" as const,
  policy_snapshot_id: `pol_${HEX}`,
  policy_version: 4,
  execution_principal: { kind: "user" as const, id: `usr_${HEX}` },
};

const grant: P06AutomationStartGrant = {
  occurrence_id: OCCURRENCE_ID,
  attempt: 1,
  run_id: RUN_ID,
  agent_session_id: SESSION_ID,
  lease_id: LEASE_ID,
  lease_version: 1,
  lease_fence: 1,
};

function claimResponse(
  overrides: Partial<P06AutomationClaimResponse> = {},
): P06AutomationClaimResponse {
  return {
    occurrence,
    attempt: 1,
    device_id: `dvc_${HEX}`,
    lease: { lease_id: LEASE_ID, lease_version: 1, lease_fence: 1, expires_at: FUTURE },
    lease_token: SERVER_ISSUED_CLAIM_VALUE,
    ...overrides,
  };
}

function startedGuard(
  options: { currentPolicyVersion?: number; now?: () => number } = {},
): P06AutomationFenceGuard {
  const guard = new P06AutomationFenceGuard(options);
  guard.acceptClaim(claimResponse());
  guard.acceptStart(grant);
  return guard;
}

function expectRefusal(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(
      error instanceof P06AutomationLeaseError,
      `expected a lease error, got ${String(error)}`,
    );
    assert.equal(error.code, code);
    return true;
  });
}

test("no side effect is authorized before the server start grant", () => {
  const guard = new P06AutomationFenceGuard();
  expectRefusal(() => guard.assertSideEffectAuthorized(), "automation_start_grant_required");
  expectRefusal(() => guard.toExecutionGrant(), "automation_start_grant_required");

  // Claimed but not started is still not executable: claim proves a lease, not a
  // run link, and the Contract Gate requires the durable link first.
  guard.acceptClaim(claimResponse());
  assert.equal(guard.phase, "claimed");
  assert.deepEqual(guard.currentFence, { leaseId: LEASE_ID, leaseVersion: 1, leaseFence: 1 });
  expectRefusal(() => guard.assertSideEffectAuthorized(), "automation_start_grant_required");
  expectRefusal(() => guard.toExecutionGrant(), "automation_start_grant_required");
});

test("after start, the grant is the only thing that carries the P05 run link", () => {
  const guard = startedGuard();
  const projection = guard.toExecutionGrant();
  assert.deepEqual(projection, {
    occurrence,
    attempt: 1,
    leaseId: LEASE_ID,
    leaseVersion: 1,
    leaseFence: 1,
    runId: RUN_ID,
    agentSessionId: SESSION_ID,
    phase: "started",
  });
  // The projection cannot carry the raw lease credential.
  assert.equal(JSON.stringify(projection).includes(SERVER_ISSUED_CLAIM_VALUE), false);
  assert.equal(JSON.stringify(guard).includes(SERVER_ISSUED_CLAIM_VALUE), false);
});

test("a start grant for another occurrence, attempt, or lease is refused", () => {
  const guard = new P06AutomationFenceGuard();
  guard.acceptClaim(claimResponse());
  expectRefusal(
    () => guard.acceptStart({ ...grant, occurrence_id: `occ_${"b".repeat(32)}` }),
    "automation_start_grant_mismatch",
  );
  expectRefusal(
    () => guard.acceptStart({ ...grant, attempt: 2 }),
    "automation_start_grant_mismatch",
  );
  expectRefusal(
    () => guard.acceptStart({ ...grant, lease_id: `lse_${"c".repeat(32)}` }),
    "automation_lease_fence_unknown",
  );
  // A fence this host never observed cannot be adopted from a start response.
  expectRefusal(
    () => guard.acceptStart({ ...grant, lease_fence: 7 }),
    "automation_lease_fence_unknown",
  );
});

test("a device that lost a renewal cannot settle, report a tool result, or complete", () => {
  const guard = startedGuard();
  const staleFence = { leaseId: LEASE_ID, leaseVersion: 1, leaseFence: 1 };

  // The server renews: the fence advances and the held token stays with this host.
  guard.acceptRenew({
    occurrence_id: OCCURRENCE_ID,
    attempt: 1,
    lease: { lease_id: LEASE_ID, lease_version: 2, lease_fence: 2, expires_at: FUTURE },
  });
  assert.deepEqual(guard.currentFence, {
    leaseId: LEASE_ID,
    leaseVersion: 2,
    leaseFence: 2,
  });

  // A settle carrying the pre-renewal fence is stale and must not overwrite the
  // newer server state.
  expectRefusal(() => guard.assertFenceCurrent(staleFence), "automation_lease_fence_stale");
  expectRefusal(
    () => guard.assertToolResultAllowed(staleFence, RUN_ID),
    "automation_lease_fence_stale",
  );
  expectRefusal(() => guard.assertSideEffectAuthorized(staleFence), "automation_lease_fence_stale");
  // A stale device cannot even CONSTRUCT a stale request: `buildFenceRequest`
  // always stamps the fence the server most recently confirmed, so the body it
  // emits is the new one and the stale caller's intent cannot be expressed.
  const body = guard.buildFenceRequest({ outcome: "succeeded", run_id: RUN_ID });
  assert.deepEqual(body, {
    outcome: "succeeded",
    run_id: RUN_ID,
    lease_id: LEASE_ID,
    lease_version: 2,
    lease_fence: 2,
    lease_token: SERVER_ISSUED_CLAIM_VALUE,
  });
});

test("a settle cannot present a run the server did not grant for the current fence", () => {
  const guard = startedGuard();
  guard.acceptRenew({
    occurrence_id: OCCURRENCE_ID,
    attempt: 1,
    lease: { lease_id: LEASE_ID, lease_version: 2, lease_fence: 2, expires_at: FUTURE },
  });
  const current = guard.currentFence!;
  expectRefusal(
    () => guard.assertToolResultAllowed(current, `run_${"2".repeat(32)}`),
    "automation_run_mismatch",
  );
  expectRefusal(
    () =>
      guard.assertToolResultAllowed({ leaseId: LEASE_ID, leaseVersion: 1, leaseFence: 1 }, RUN_ID),
    "automation_lease_fence_stale",
  );
  guard.assertToolResultAllowed(current, RUN_ID);
});

test("a fence from a lease this host never held is unknown, not merely stale", () => {
  const guard = startedGuard();
  expectRefusal(
    () =>
      guard.assertFenceCurrent({
        leaseId: `lse_${"d".repeat(32)}`,
        leaseVersion: 1,
        leaseFence: 1,
      }),
    "automation_lease_fence_unknown",
  );
  // A future fence also counts as unknown: this host never observed it.
  expectRefusal(
    () => guard.assertFenceCurrent({ leaseId: LEASE_ID, leaseVersion: 9, leaseFence: 9 }),
    "automation_lease_fence_unknown",
  );
});

test("a renewal that moves the fence backwards is refused", () => {
  const guard = startedGuard();
  guard.acceptRenew({
    occurrence_id: OCCURRENCE_ID,
    attempt: 1,
    lease: { lease_id: LEASE_ID, lease_version: 3, lease_fence: 5, expires_at: FUTURE },
  });
  expectRefusal(
    () =>
      guard.acceptRenew({
        occurrence_id: OCCURRENCE_ID,
        attempt: 1,
        lease: { lease_id: LEASE_ID, lease_version: 2, lease_fence: 4, expires_at: FUTURE },
      }),
    "automation_lease_fence_stale",
  );
  expectRefusal(
    () =>
      guard.acceptRenew({
        occurrence_id: `occ_${"e".repeat(32)}`,
        attempt: 1,
        lease: { lease_id: LEASE_ID, lease_version: 3, lease_fence: 5, expires_at: FUTURE },
      }),
    "automation_lease_fence_unknown",
  );
  expectRefusal(
    () =>
      guard.acceptRenew({
        occurrence_id: OCCURRENCE_ID,
        attempt: 2,
        lease: { lease_id: LEASE_ID, lease_version: 3, lease_fence: 5, expires_at: FUTURE },
      }),
    "automation_lease_fence_unknown",
  );
});

test("a second claim for a different lease cannot replace the held lease", () => {
  const guard = new P06AutomationFenceGuard();
  guard.acceptClaim(claimResponse());
  expectRefusal(
    () =>
      guard.acceptClaim(
        claimResponse({
          lease: {
            lease_id: `lse_${"9".repeat(32)}`,
            lease_version: 1,
            lease_fence: 1,
            expires_at: FUTURE,
          },
        }),
      ),
    "automation_lease_fence_unknown",
  );
  // A duplicate delivery of the SAME claim is idempotent, not a new authority.
  guard.acceptClaim(claimResponse());
  assert.equal(guard.attempt, 1);
});

test("ambiguous is terminal: no renew, no start, no side effect, no settle", () => {
  const guard = startedGuard();
  guard.markAmbiguous();
  assert.equal(guard.requiresReconciliation, true);
  const fence = { leaseId: LEASE_ID, leaseVersion: 1, leaseFence: 1 };
  expectRefusal(() => guard.assertSideEffectAuthorized(), "automation_occurrence_ambiguous");
  expectRefusal(() => guard.assertFenceCurrent(fence), "automation_occurrence_ambiguous");
  expectRefusal(
    () => guard.assertToolResultAllowed(fence, RUN_ID),
    "automation_occurrence_ambiguous",
  );
  expectRefusal(() => guard.buildFenceRequest({}), "automation_occurrence_ambiguous");
  expectRefusal(
    () =>
      guard.acceptRenew({
        occurrence_id: OCCURRENCE_ID,
        attempt: 1,
        lease: { lease_id: LEASE_ID, lease_version: 2, lease_fence: 2, expires_at: FUTURE },
      }),
    "automation_occurrence_ambiguous",
  );
  expectRefusal(() => guard.acceptStart(grant), "automation_occurrence_ambiguous");
  expectRefusal(() => guard.acceptClaim(claimResponse()), "automation_occurrence_ambiguous");
});

test("a locally expired lease cannot start or settle; it is never requeued", () => {
  const guard = new P06AutomationFenceGuard({ now: () => Date.parse(FUTURE) + 1 });
  guard.acceptClaim(claimResponse());
  guard.acceptStart(grant);
  expectRefusal(() => guard.assertSideEffectAuthorized(), "automation_lease_expired_locally");
  assert.equal(guard.phase, "started", "expiry is a refusal, not a state transition");
});

test("a stale policy snapshot is refused at claim time", () => {
  const guard = new P06AutomationFenceGuard({ currentPolicyVersion: 9 });
  expectRefusal(() => guard.acceptClaim(claimResponse()), "automation_policy_stale");

  const fresh = new P06AutomationFenceGuard({ currentPolicyVersion: 4 });
  fresh.acceptClaim(claimResponse());
  fresh.acceptStart(grant);
  assert.equal(fresh.phase, "started");
});

test("a service-account occurrence is refused rather than run under a fabricated identity", () => {
  const guard = new P06AutomationFenceGuard();
  expectRefusal(
    () =>
      guard.acceptClaim(
        claimResponse({
          occurrence: {
            ...occurrence,
            execution_principal: { kind: "service_account", id: `usr_${HEX}` },
          },
        }),
      ),
    "automation_execution_principal_unavailable",
  );
});

test("a tool result for a run the server never granted is refused", () => {
  const guard = startedGuard();
  const fence = { leaseId: LEASE_ID, leaseVersion: 1, leaseFence: 1 };
  expectRefusal(
    () => guard.assertToolResultAllowed(fence, `run_${"1".repeat(32)}`),
    "automation_run_mismatch",
  );
  guard.assertToolResultAllowed(fence, RUN_ID);
});

test("after settlement the credential is dropped and further transitions are refused", () => {
  const guard = startedGuard();
  guard.markSettled();
  assert.equal(guard.phase, "settled");
  expectRefusal(() => guard.buildFenceRequest({}), "automation_lease_not_claimed");
  expectRefusal(() => guard.assertSideEffectAuthorized(), "automation_start_grant_required");
  // A settled attempt cannot be re-claimed on the same guard: a later attempt is
  // a different occurrence attempt with its own server lease and its own guard.
  expectRefusal(() => guard.acceptClaim(claimResponse()), "automation_lease_not_claimed");

  const released = new P06AutomationFenceGuard();
  released.acceptClaim(claimResponse());
  released.markReleased();
  expectRefusal(() => released.acceptClaim(claimResponse()), "automation_lease_not_claimed");
  expectRefusal(() => released.assertReleaseAllowed(), "automation_release_after_start");
});
