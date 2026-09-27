/**
 * P06 startup / recovery semantics (`p06-automation-lease-v1`).
 *
 * This module is the direct, safe replacement for
 * `OffPeakTaskRepo.recoverInterrupted`, which does `running → queued` on process
 * start. That transition is correct for a LOCAL task table and wrong for a
 * server-owned occurrence, for two independent reasons:
 *
 * 1. It cannot represent `ambiguous`. A host that restarts after a partition has
 *    no way to know whether the previous process already produced a tool call, a
 *    file write, or a network request. Resetting to `queued` asserts "nothing
 *    happened", which is exactly the claim a network partition cannot support.
 * 2. It is local authority. Re-dispatching from a local row creates a second
 *    logical run effect for one occurrence, because the server never issued a
 *    second lease.
 *
 * The replacement is a classification with exactly three outcomes, and none of
 * them is a local requeue:
 *
 * - `continue`         the host still holds a current, unexpired lease and the
 *                      turn can finish in place; the server is still the authority
 *                      and the guard's fence is used to settle.
 * - `releasable`       the host holds a claim but never obtained a server start
 *                      grant, so the server can still prove execution never
 *                      started. The host may call `release` and let the server
 *                      apply its own missed/retry policy. It may NOT re-dispatch.
 * - `needs_reconciliation` the occurrence is server-ambiguous, or authority was
 *                      lost, or the in-memory lease token is gone. The host
 *                      surfaces it and stops. Resolution is an audited
 *                      operator/support action, never an automatic retry.
 *
 * There is deliberately no `requeued` outcome. The type below is the assertion.
 *
 * Reconnect burst behaviour is likewise not a local decision: the server's
 * `schedule_cursor_at` bounds what becomes due, so recovery never walks a local
 * backlog. The local scheduler's `MISFIRE_GRACE_MS` window and `buildRunId`'s
 * colon-delimited local run IDs are therefore never consulted here.
 */

import type {
  P06AutomationLocalRejectionCode,
  P06AutomationOccurrenceRef,
} from "./p06-automation-lease.js";

export type P06InterruptedOccurrenceDisposition =
  | {
      readonly disposition: "continue";
      readonly occurrence: P06AutomationOccurrenceRef;
      readonly leaseId: string;
      readonly runId?: string;
    }
  | {
      readonly disposition: "releasable";
      readonly occurrence: P06AutomationOccurrenceRef;
      readonly leaseId: string;
      readonly reasonCode: "automation_start_not_granted";
    }
  | {
      readonly disposition: "needs_reconciliation";
      readonly occurrence: P06AutomationOccurrenceRef;
      readonly leaseId?: string;
      readonly reasonCode: Extract<
        P06AutomationLocalRejectionCode,
        "automation_occurrence_ambiguous" | "automation_occurrence_reconciliation_required"
      >;
    };

/**
 * What a restarting host knows about one locally interrupted occurrence. Every
 * field is an OBSERVATION about the server, never a decision the host may make
 * on the server's behalf.
 */
export interface P06InterruptedOccurrenceObservation {
  /** The occurrence exactly as the server last projected it. */
  readonly occurrence: P06AutomationOccurrenceRef;
  /** Server-reported occurrence state. `ambiguous` is terminal for the host. */
  readonly serverState:
    | "pending"
    | "dispatching"
    | "leased"
    | "started"
    | "ambiguous"
    | "succeeded"
    | "failed"
    | "skipped"
    | "missed"
    | "cancelled";
  /** Whether this host process still holds the lease token for the live fence. */
  readonly holdsLeaseToken: boolean;
  /** Opaque `lse_` ID of the lease this host last observed for the occurrence. */
  readonly leaseId: string;
  /** Whether the server durably created the P05 run link for this attempt. */
  readonly hasServerStartGrant: boolean;
  /** Server-minted `run_` ID of the P05 run link, when one exists. */
  readonly runId?: string;
  /** Local monotonic clock value for the held lease expiry, if a lease is held. */
  readonly leaseExpiresAtMs?: number;
  /** Injected local clock. Compared against the lease expiry only. */
  readonly nowMs: number;
}

const TERMINAL_OCCURRENCE_STATES = new Set<P06InterruptedOccurrenceObservation["serverState"]>([
  "succeeded",
  "failed",
  "skipped",
  "missed",
  "cancelled",
]);

/**
 * Classify one interrupted occurrence.
 *
 * The ordering is deliberate and fail-closed:
 * 1. an `ambiguous` or already-terminal server state is stopped first;
 * 2. lost authority (no in-memory token, or the server no longer considers the
 *    occurrence leased/started) is next;
 * 3. a still-live lease continues in place, because `start` is idempotent by
 *    `(occurrence_id, attempt)` and the server re-decides;
 * 4. only an expired lease splits: releasable WITHOUT a start grant, and
 *    `needs_reconciliation` WITH one. A lease that expired after the server
 *    created the run link is the `ambiguous` boundary and is exactly why this
 *    function exists.
 */
export function classifyInterruptedAutomationOccurrence(
  observation: P06InterruptedOccurrenceObservation,
): P06InterruptedOccurrenceDisposition {
  const { occurrence, leaseId } = observation;

  if (observation.serverState === "ambiguous") {
    return Object.freeze({
      disposition: "needs_reconciliation",
      occurrence,
      leaseId,
      reasonCode: "automation_occurrence_ambiguous",
    });
  }

  if (TERMINAL_OCCURRENCE_STATES.has(observation.serverState)) {
    return Object.freeze({
      disposition: "needs_reconciliation",
      occurrence,
      leaseId,
      reasonCode: "automation_occurrence_reconciliation_required",
    });
  }

  if (!observation.holdsLeaseToken) {
    return Object.freeze({
      disposition: "needs_reconciliation",
      occurrence,
      leaseId,
      reasonCode: "automation_occurrence_reconciliation_required",
    });
  }

  // The server owns the occurrence attempt; a locally held lease ID without a
  // same-process fence is a stale projection, not authority.
  if (observation.serverState !== "leased" && observation.serverState !== "started") {
    return Object.freeze({
      disposition: "needs_reconciliation",
      occurrence,
      leaseId,
      reasonCode: "automation_occurrence_reconciliation_required",
    });
  }

  const expiresAtMs = observation.leaseExpiresAtMs;
  const leaseExpired =
    expiresAtMs !== undefined && Number.isFinite(expiresAtMs) && observation.nowMs >= expiresAtMs;

  if (!leaseExpired) {
    return Object.freeze({
      disposition: "continue",
      occurrence,
      leaseId,
      ...(observation.runId === undefined ? {} : { runId: observation.runId }),
    });
  }

  if (observation.hasServerStartGrant) {
    // Execution may have begun before the lease lapsed. A partition cannot prove
    // otherwise, so the host must not re-dispatch, re-claim, or settle.
    return Object.freeze({
      disposition: "needs_reconciliation",
      occurrence,
      leaseId,
      reasonCode: "automation_occurrence_reconciliation_required",
    });
  }

  // Releasable means "the server can still prove nothing started". It is NOT
  // permission to run the work again: the host calls `release` and the server
  // applies its own missed/retry policy.
  return Object.freeze({
    disposition: "releasable",
    occurrence,
    leaseId,
    reasonCode: "automation_start_not_granted",
  });
}

/** Aggregate outcome of a recovery sweep. Exposed so the UI can be honest about it. */
export interface P06AutomationRecoverySummary {
  readonly continued: number;
  readonly releasable: number;
  readonly needsReconciliation: number;
}

export function summarizeAutomationRecovery(
  dispositions: readonly P06InterruptedOccurrenceDisposition[],
): P06AutomationRecoverySummary {
  let continued = 0;
  let releasable = 0;
  let needsReconciliation = 0;
  for (const entry of dispositions) {
    if (entry.disposition === "continue") continued += 1;
    else if (entry.disposition === "releasable") releasable += 1;
    else needsReconciliation += 1;
  }
  return Object.freeze({ continued, releasable, needsReconciliation });
}
