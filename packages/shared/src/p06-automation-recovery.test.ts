import assert from "node:assert/strict";
import test from "node:test";

import type { P06AutomationOccurrenceRef } from "./p06-automation-lease.js";
import {
  classifyInterruptedAutomationOccurrence,
  summarizeAutomationRecovery,
  type P06InterruptedOccurrenceDisposition,
  type P06InterruptedOccurrenceObservation,
} from "./p06-automation-recovery.js";

const HEX = "0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-09-25T16:02:00.000Z");
const FUTURE = Date.parse("2026-09-25T16:05:00.000Z");
const PAST = Date.parse("2026-09-25T16:00:00.000Z");

const occurrence: P06AutomationOccurrenceRef = {
  occurrence_id: `occ_${HEX}`,
  automation_id: `aut_${HEX}`,
  attempt: 1,
  scheduled_for: "2026-09-25T16:00:00.000Z",
  off_peak_mode: "normal",
  policy_snapshot_id: `pol_${HEX}`,
  policy_version: 4,
  execution_principal: { kind: "user", id: `usr_${HEX}` },
};

function observation(
  overrides: Partial<P06InterruptedOccurrenceObservation> = {},
): P06InterruptedOccurrenceObservation {
  return {
    occurrence,
    serverState: "leased",
    holdsLeaseToken: true,
    leaseId: `lse_${HEX}`,
    hasServerStartGrant: false,
    leaseExpiresAtMs: FUTURE,
    nowMs: NOW,
    ...overrides,
  };
}

test("there is no requeue outcome: the union cannot express a local retry", () => {
  // The type is the assertion. A `requeued` member would let a restarting host
  // recreate the unsafe `recoverInterrupted` running→queued transition, so the
  // exhaustive switch below is the compile-time guard.
  const dispositions: readonly P06InterruptedOccurrenceDisposition[] = [];
  for (const entry of dispositions) {
    switch (entry.disposition) {
      case "continue":
      case "releasable":
      case "needs_reconciliation":
        break;
      default: {
        const exhaustive: never = entry;
        assert.fail(`unexpected disposition ${JSON.stringify(exhaustive)}`);
      }
    }
  }
});

test("a post-start interrupted occurrence becomes ambiguous, never a local requeue", () => {
  const started = classifyInterruptedAutomationOccurrence(
    observation({ serverState: "started", hasServerStartGrant: true, runId: `run_${HEX}` }),
  );
  assert.deepEqual(started, {
    disposition: "continue",
    occurrence,
    leaseId: `lse_${HEX}`,
    runId: `run_${HEX}`,
  });

  // The partition case: the lease lapsed AFTER the server created the run link.
  // A host cannot prove it produced no side effect, so it stops here.
  const partitioned = classifyInterruptedAutomationOccurrence(
    observation({
      serverState: "started",
      hasServerStartGrant: true,
      runId: `run_${HEX}`,
      leaseExpiresAtMs: PAST,
    }),
  );
  assert.equal(partitioned.disposition, "needs_reconciliation");
  assert.equal(
    partitioned.disposition === "needs_reconciliation" && partitioned.reasonCode,
    "automation_occurrence_reconciliation_required",
  );
});

test("a pre-start lease expiry is releasable, and the server owns the retry", () => {
  const releasable = classifyInterruptedAutomationOccurrence(
    observation({ serverState: "leased", hasServerStartGrant: false, leaseExpiresAtMs: PAST }),
  );
  assert.deepEqual(releasable, {
    disposition: "releasable",
    occurrence,
    leaseId: `lse_${HEX}`,
    reasonCode: "automation_start_not_granted",
  });
  // Releasable means "the server can still prove nothing started", never "run it
  // again locally". The reason code names the missing start grant.
  assert.notEqual(releasable.disposition, "continue");
});

test("a server-reported ambiguous occurrence is terminal for the host", () => {
  const ambiguous = classifyInterruptedAutomationOccurrence(
    observation({ serverState: "ambiguous", hasServerStartGrant: true, leaseExpiresAtMs: FUTURE }),
  );
  assert.deepEqual(ambiguous, {
    disposition: "needs_reconciliation",
    occurrence,
    leaseId: `lse_${HEX}`,
    reasonCode: "automation_occurrence_ambiguous",
  });
});

test("lost authority or a lost in-memory token always needs reconciliation", () => {
  assert.equal(
    classifyInterruptedAutomationOccurrence(
      observation({ serverState: "leased", hasServerStartGrant: false, holdsLeaseToken: false }),
    ).disposition,
    "needs_reconciliation",
  );
  // A locally known lease that the server no longer considers leased is a stale
  // projection, not authority.
  for (const serverState of ["pending", "dispatching"] as const) {
    assert.equal(
      classifyInterruptedAutomationOccurrence(observation({ serverState })).disposition,
      "needs_reconciliation",
    );
  }
  for (const serverState of ["succeeded", "failed", "skipped", "missed", "cancelled"] as const) {
    assert.equal(
      classifyInterruptedAutomationOccurrence(observation({ serverState })).disposition,
      "needs_reconciliation",
    );
  }
});

test("recovery never depends on a local misfire window or a local run ID", () => {
  // The observation carries no misfire-grace value and no local run ID, only
  // server facts and the lease expiry. A local clock skew can therefore only
  // produce a `continue` or a `releasable`; it cannot fabricate authority.
  const skewedLate = classifyInterruptedAutomationOccurrence(
    observation({ leaseExpiresAtMs: PAST, nowMs: NOW - 3_600_000 }),
  );
  assert.equal(skewedLate.disposition, "continue");
  const skewedEarly = classifyInterruptedAutomationOccurrence(
    observation({ leaseExpiresAtMs: FUTURE, nowMs: NOW + 3_600_000 }),
  );
  assert.equal(skewedEarly.disposition, "releasable");
});

test("a recovery sweep reports reconciliation work instead of hiding it", () => {
  const summary = summarizeAutomationRecovery([
    classifyInterruptedAutomationOccurrence(
      observation({ serverState: "started", hasServerStartGrant: true }),
    ),
    classifyInterruptedAutomationOccurrence(observation({ leaseExpiresAtMs: PAST })),
    classifyInterruptedAutomationOccurrence(observation({ serverState: "ambiguous" })),
    classifyInterruptedAutomationOccurrence(observation({ holdsLeaseToken: false })),
  ]);
  assert.deepEqual(summary, { continued: 1, releasable: 1, needsReconciliation: 2 });
});
