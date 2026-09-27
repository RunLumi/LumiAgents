import assert from "node:assert/strict";
import test from "node:test";

import {
  P06_AUTOMATION_API_BASE_PATH,
  P06AutomationOccurrenceRunner,
  applyP06ServerRejection,
  assertP06FailureReasonCode,
  buildP06AutomationDevicePath,
  isP06AutomationLeaseError,
  type P06AutomationClaimResponse,
  type P06AutomationLeaseTransport,
  type P06AutomationOccurrenceRef,
  type P06AutomationSettleRequest,
  type P06AutomationStartResponse,
} from "./p06-automation-lease.js";

const HEX = "0123456789abcdef0123456789abcdef";
const OCCURRENCE_ID = `occ_${HEX}`;
const LEASE_ID = `lse_${HEX}`;
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

const occurrence: P06AutomationOccurrenceRef = {
  occurrence_id: OCCURRENCE_ID,
  automation_id: `aut_${HEX}`,
  attempt: 1,
  scheduled_for: "2026-09-25T16:00:00.000Z",
  off_peak_mode: "normal",
  policy_snapshot_id: `pol_${HEX}`,
  policy_version: 4,
  execution_principal: { kind: "user", id: `usr_${HEX}` },
};

const startGrant: P06AutomationStartResponse = {
  occurrence_id: OCCURRENCE_ID,
  attempt: 1,
  run_id: RUN_ID,
  agent_session_id: SESSION_ID,
  lease_id: LEASE_ID,
  lease_version: 1,
  lease_fence: 1,
};

interface Recorder {
  readonly calls: string[];
  readonly settleBodies: P06AutomationSettleRequest[];
}

function createTransport(
  recorder: Recorder,
  overrides: Partial<P06AutomationLeaseTransport> = {},
): P06AutomationLeaseTransport {
  return {
    listDueWork: async () => ({ items: [occurrence] }),
    claim: async (): Promise<P06AutomationClaimResponse> => {
      recorder.calls.push("claim");
      return {
        occurrence,
        attempt: 1,
        device_id: `dvc_${HEX}`,
        lease: { lease_id: LEASE_ID, lease_version: 1, lease_fence: 1, expires_at: FUTURE },
        lease_token: SERVER_ISSUED_CLAIM_VALUE,
      };
    },
    renew: async () => {
      recorder.calls.push("renew");
      return {
        occurrence_id: OCCURRENCE_ID,
        attempt: 1,
        lease: { lease_id: LEASE_ID, lease_version: 2, lease_fence: 2, expires_at: FUTURE },
      };
    },
    start: async () => {
      recorder.calls.push("start");
      return startGrant;
    },
    settle: async (input) => {
      recorder.calls.push("settle");
      recorder.settleBodies.push(input.body);
      return {
        occurrence_id: OCCURRENCE_ID,
        attempt: 1,
        settled_state: "succeeded",
        lease_version: input.body.lease_version,
        lease_fence: input.body.lease_fence,
        idempotent: false,
      };
    },
    release: async () => {
      recorder.calls.push("release");
      return {
        occurrence_id: OCCURRENCE_ID,
        attempt: 1,
        released: true,
        lease_version: 1,
        lease_fence: 1,
      };
    },
    ...overrides,
  };
}

function newRecorder(): Recorder {
  return { calls: [], settleBodies: [] };
}

/** Assert a stable local rejection code rather than a message string. */
async function rejectsWithCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    assert.ok(isP06AutomationLeaseError(error), `expected a lease error, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

/** Assert a stable local rejection code from a synchronous call. */
function throwsWithCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(isP06AutomationLeaseError(error), `expected a lease error, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

test("device routes are built from validated opaque IDs only", () => {
  assert.equal(P06_AUTOMATION_API_BASE_PATH, "/api/v1");
  assert.equal(
    buildP06AutomationDevicePath("due"),
    "/api/v1/devices/automations/due",
  );
  for (const route of ["claim", "start", "settle", "release"] as const) {
    assert.equal(
      buildP06AutomationDevicePath(route, { occurrenceId: OCCURRENCE_ID }),
      `/api/v1/devices/automation-occurrences/${OCCURRENCE_ID}/${route}`,
    );
  }
  assert.equal(
    buildP06AutomationDevicePath("renew", { leaseId: LEASE_ID }),
    `/api/v1/devices/automation-leases/${LEASE_ID}/renew`,
  );
});

test("a malformed path segment is refused instead of being interpolated", () => {
  for (const bad of [
    `occ_${HEX}/claim?token=${SERVER_ISSUED_CLAIM_VALUE}`,
    `occ_${HEX}#${SERVER_ISSUED_CLAIM_VALUE}`,
    `../../devices/automation-occurrences/${OCCURRENCE_ID}/claim`,
    `aut_${HEX}`,
    OCCURRENCE_ID.toUpperCase(),
    undefined,
  ]) {
    assert.throws(
      () => buildP06AutomationDevicePath("claim", { occurrenceId: bad as string | undefined }),
      (error: unknown) => {
        assert.ok(isP06AutomationLeaseError(error));
        assert.equal(error.code, "automation_wire_invalid");
        return true;
      },
      `expected ${String(bad)} to be refused`,
    );
  }
  // A renew path can only be built from an `lse_` ID, never an occurrence ID.
  assert.throws(() => buildP06AutomationDevicePath("renew", { leaseId: OCCURRENCE_ID }));
});

test("the lease token never appears in any device route", () => {
  const paths = [
    buildP06AutomationDevicePath("due"),
    buildP06AutomationDevicePath("claim", { occurrenceId: OCCURRENCE_ID }),
    buildP06AutomationDevicePath("renew", { leaseId: LEASE_ID }),
    buildP06AutomationDevicePath("settle", { occurrenceId: OCCURRENCE_ID }),
  ];
  for (const path of paths) {
    assert.equal(path.includes(SERVER_ISSUED_CLAIM_VALUE), false, path);
    assert.equal(path.includes("token"), false, path);
    assert.equal(path.includes("?"), false, path);
  }
});

test("execute is unreachable before the server start grant", async () => {
  const recorder = newRecorder();
  const runner = new P06AutomationOccurrenceRunner({ transport: createTransport(recorder) });

  await rejectsWithCode(
    () => runner.execute(async () => ({ outcome: "succeeded" })),
    "automation_start_grant_required",
  );
  // start/settle are refused before claim too: the ordering is enforced.
  await rejectsWithCode(() => runner.start(), "automation_lease_not_claimed");
  await rejectsWithCode(() => runner.renew(), "automation_lease_not_claimed");
  assert.deepEqual(recorder.calls, []);
});

test("claim → start → execute → settle is the only successful ordering", async () => {
  const recorder = newRecorder();
  const runner = new P06AutomationOccurrenceRunner({ transport: createTransport(recorder) });

  await runner.claim(OCCURRENCE_ID);
  const grant = await runner.start();
  assert.equal(grant.runId, RUN_ID);
  assert.equal(grant.agentSessionId, SESSION_ID);

  let workRan = false;
  await runner.execute(async (received) => {
    workRan = true;
    assert.equal(received.runId, RUN_ID);
    assert.equal(received.occurrence.occurrence_id, OCCURRENCE_ID);
    return { outcome: "succeeded" };
  });

  assert.equal(workRan, true);
  assert.deepEqual(recorder.calls, ["claim", "start", "settle"]);
  assert.deepEqual(recorder.settleBodies, [
    {
      outcome: "succeeded",
      run_id: RUN_ID,
      lease_id: LEASE_ID,
      lease_version: 1,
      lease_fence: 1,
      lease_token: SERVER_ISSUED_CLAIM_VALUE,
    },
  ]);
  // Once settled, the credential is dropped and a second attempt is refused.
  assert.equal(runner.guard.phase, "settled");
  await rejectsWithCode(() => runner.claim(OCCURRENCE_ID), "automation_lease_not_claimed");
});

test("a failed run settles with a bounded stable reason code", async () => {
  const recorder = newRecorder();
  const runner = new P06AutomationOccurrenceRunner({ transport: createTransport(recorder) });
  await runner.claim(OCCURRENCE_ID);
  await runner.start();
  await runner.execute(async () => ({
    outcome: "failed",
    reasonCode: assertP06FailureReasonCode("automation_run_tool_failed"),
  }));
  const body = recorder.settleBodies[0];
  assert.equal(body?.outcome, "failed");
  assert.equal(
    body?.outcome === "failed" ? body.reason_code : undefined,
    "automation_run_tool_failed",
  );
  throwsWithCode(
    () => assertP06FailureReasonCode("the agent crashed while reading the user's private key"),
    "automation_wire_invalid",
  );
});

test("a renewal advances the fence and the settle carries the new fence", async () => {
  const recorder = newRecorder();
  const runner = new P06AutomationOccurrenceRunner({ transport: createTransport(recorder) });
  await runner.claim(OCCURRENCE_ID);
  await runner.start();
  await runner.renew();
  await runner.execute(async () => ({ outcome: "succeeded" }));

  assert.deepEqual(recorder.calls, ["claim", "start", "renew", "settle"]);
  const body = recorder.settleBodies[0];
  assert.equal(body?.lease_version, 2);
  assert.equal(body?.lease_fence, 2);
  assert.equal(body?.lease_token, SERVER_ISSUED_CLAIM_VALUE);
});

test("release is only reachable before the occurrence started", async () => {
  const recorder = newRecorder();
  const runner = new P06AutomationOccurrenceRunner({ transport: createTransport(recorder) });
  await runner.claim(OCCURRENCE_ID);
  await runner.release();
  assert.deepEqual(recorder.calls, ["claim", "release"]);

  const afterStart = new P06AutomationOccurrenceRunner({ transport: createTransport(newRecorder()) });
  await afterStart.claim(OCCURRENCE_ID);
  await afterStart.start();
  // The Contract Gate allows release only before the occurrence is started, and
  // the host refuses locally rather than relying on the server to reject it.
  await rejectsWithCode(() => afterStart.release(), "automation_release_after_start");
});

test("an ambiguous server response is terminal: no second claim, no second run", async () => {
  const recorder = newRecorder();
  const inner = new P06AutomationOccurrenceRunner({ transport: createTransport(newRecorder()) });
  const transport = createTransport(recorder, {
    claim: async () => {
      throw applyP06ServerRejection(inner.guard, "occurrence_ambiguous");
    },
  });
  const runner = new P06AutomationOccurrenceRunner({ transport });
  await rejectsWithCode(() => runner.claim(OCCURRENCE_ID), "automation_occurrence_ambiguous");
  await rejectsWithCode(() => runner.start(), "automation_lease_not_claimed");
  assert.deepEqual(recorder.calls, []);
  // The rejected attempt is flagged for reconciliation, never for a local retry.
  assert.equal(inner.guard.requiresReconciliation, true);
});

test("applyP06ServerRejection maps frozen server reasons onto local refusals", () => {
  const guard = new P06AutomationOccurrenceRunner({
    transport: createTransport(newRecorder()),
  }).guard;
  assert.equal(applyP06ServerRejection(guard, "lease_fence_invalid").code, "automation_lease_fence_stale");
  assert.equal(
    applyP06ServerRejection(guard, "occurrence_lease_expired").code,
    "automation_lease_expired_locally",
  );
  assert.equal(
    applyP06ServerRejection(guard, "occurrence_already_claimed").code,
    "automation_lease_fence_unknown",
  );

  const ambiguous = applyP06ServerRejection(guard, "occurrence_ambiguous");
  assert.equal(ambiguous.code, "automation_occurrence_ambiguous");
  assert.equal(guard.requiresReconciliation, true);
});

test("a second attempt gets its own guard, so a first attempt cannot vouch for it", async () => {
  const recorder = newRecorder();
  const runner = new P06AutomationOccurrenceRunner({ transport: createTransport(recorder) });
  await runner.claim(OCCURRENCE_ID);
  await runner.start();
  await runner.execute(async () => ({ outcome: "succeeded" }));

  const second = runner.createAttemptRunner({ transport: createTransport(newRecorder()) });
  assert.notEqual(second.guard, runner.guard);
  assert.equal(second.guard.phase, "idle");
  await rejectsWithCode(
    () => second.execute(async () => ({ outcome: "succeeded" })),
    "automation_start_grant_required",
  );
});
