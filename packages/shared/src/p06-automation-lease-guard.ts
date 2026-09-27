/**
 * P06 leased-automation fence guard (`p06-automation-lease-v1`).
 *
 * One occurrence attempt, one server-authorized lease, one P05 run link. This
 * guard is the host-side enforcement of that sentence. It is deliberately the
 * ONLY place a host decides whether it may still act, so the rule cannot be
 * re-implemented with a looser comparison somewhere else.
 *
 * What it guarantees:
 * - A settle, a tool result, or a completion emission is REFUSED unless the
 *   presented `(lease_id, lease_version, lease_fence)` is exactly the fence the
 *   server most recently handed this host. A device that lost a renewal cannot
 *   overwrite newer server state, because its fence is strictly older and the
 *   guard compares before any effect is produced.
 * - NO side effect is authorized before a server `start` grant. The gate is
 *   `assertSideEffectAuthorized`, and it fails closed when the grant is missing,
 *   for a different occurrence/attempt, or bound to a different run.
 * - Once the occurrence is observed `ambiguous`, everything is refused. There is
 *   no local retry, no requeue, and no "try again" path, because a partition
 *   cannot prove a disconnected host produced no side effect.
 *
 * Explicitly NOT modelled here, and deliberately unusable as P06 authority:
 * - `AutomationRepo.claimDue` — a local boolean single-flight with no fence.
 * - `OffPeakTaskRepo.recoverInterrupted` — `running → queued` at process start.
 *   See `classifyInterruptedAutomationOccurrence` for the replacement.
 * - The local scheduler's 5-minute `MISFIRE_GRACE_MS` — the server's
 *   `schedule_cursor_at` is authoritative, so this guard never re-arms work from
 *   a local clock.
 * - `buildRunId`'s colon-delimited local IDs (`${automationId}:${scheduledAt}`).
 *   Wire identity is always an opaque `<prefix>_<32 hex>` value minted by the
 *   server; local run IDs are never compared against a lease or a run link.
 */

import {
  P06_AUTOMATION_LOCAL_REJECTION_CODES,
  type P06AutomationClaimResponse,
  type P06AutomationLease,
  type P06AutomationLocalRejectionCode,
  type P06AutomationOccurrenceRef,
  type P06AutomationRenewResponse,
  type P06AutomationStartGrant,
} from "./p06-automation-lease.js";

/** Host-side phase of one occurrence attempt. `idle` is the only pre-claim state. */
export type P06AutomationLeasePhase =
  | "idle"
  | "claimed"
  | "started"
  | "ambiguous"
  | "settled"
  | "released";

/** Thrown by every guard assertion. `code` is a stable local machine reason. */
export class P06AutomationLeaseError extends Error {
  readonly code: P06AutomationLocalRejectionCode;
  readonly occurrenceId: string | undefined;
  readonly attempt: number | undefined;

  constructor(
    code: P06AutomationLocalRejectionCode,
    message: string,
    context: { readonly occurrenceId?: string; readonly attempt?: number } = {},
  ) {
    super(message);
    this.name = "P06AutomationLeaseError";
    this.code = code;
    this.occurrenceId = context.occurrenceId;
    this.attempt = context.attempt;
  }
}

export function isP06AutomationLeaseError(error: unknown): error is P06AutomationLeaseError {
  if (error instanceof P06AutomationLeaseError) return true;
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name !== "P06AutomationLeaseError") return false;
  return (P06_AUTOMATION_LOCAL_REJECTION_CODES as readonly string[]).includes(
    candidate.code as string,
  );
}

/**
 * The immutable, non-secret view other layers receive. It intentionally cannot
 * carry the raw lease token, so a consumer cannot accidentally log it or place
 * it in a URL.
 */
export interface P06AutomationExecutionGrant {
  readonly occurrence: P06AutomationOccurrenceRef;
  readonly attempt: number;
  readonly leaseId: string;
  readonly leaseVersion: number;
  readonly leaseFence: number;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly phase: "started";
}

export interface P06AutomationFenceObservation {
  readonly leaseId: string;
  readonly leaseVersion: number;
  readonly leaseFence: number;
}

export interface P06AutomationFenceGuardOptions {
  /**
   * Current server policy version, normally from the P03 `/devices/policy`
   * response. A lease whose `policy_version` is behind this is refused before
   * any side effect, which is how a stale-policy occurrence is rejected without
   * trusting the device clock.
   */
  readonly currentPolicyVersion?: number;
  /** Injected clock. Only used for the local expiry hint, never as lease authority. */
  readonly now?: () => number;
}

const ACTIVE_PHASES = new Set<P06AutomationLeasePhase>(["claimed", "started"]);

export class P06AutomationFenceGuard {
  #token: string | undefined;
  readonly #options: P06AutomationFenceGuardOptions;
  #occurrence: P06AutomationOccurrenceRef | undefined;
  #attempt = 0;
  #leaseId = "";
  #leaseVersion = 0;
  #leaseFence = 0;
  #expiresAtMs = Number.POSITIVE_INFINITY;
  #grant: P06AutomationStartGrant | undefined;
  #phase: P06AutomationLeasePhase = "idle";

  constructor(options: P06AutomationFenceGuardOptions = {}) {
    this.#options = options;
  }

  get phase(): P06AutomationLeasePhase {
    return this.#phase;
  }

  get attempt(): number {
    return this.#attempt;
  }

  get occurrence(): P06AutomationOccurrenceRef | undefined {
    return this.#occurrence;
  }

  /** The fence the server most recently confirmed. Never a locally derived value. */
  get currentFence(): P06AutomationFenceObservation | undefined {
    if (this.#leaseId === "") return undefined;
    return Object.freeze({
      leaseId: this.#leaseId,
      leaseVersion: this.#leaseVersion,
      leaseFence: this.#leaseFence,
    });
  }

  get startGrant(): P06AutomationStartGrant | undefined {
    return this.#grant;
  }

  /**
   * True once the server has lost or relinquished authority. The host surfaces
   * the occurrence for operator reconciliation; it never re-dispatches it.
   */
  get requiresReconciliation(): boolean {
    return this.#phase === "ambiguous";
  }

  /**
   * Adopt a `claim` response.
   *
   * A second claim while one is live is a local programming error (or a
   * duplicate delivery of the same claim), never a new lease: the guard keeps
   * the fence it already trusts instead of downgrading to whichever response
   * happened to arrive last.
   */
  acceptClaim(response: P06AutomationClaimResponse): void {
    if (this.#phase === "ambiguous") {
      throw this.#refuse("automation_occurrence_ambiguous", "occurrence is ambiguous");
    }
    if (this.#phase === "settled" || this.#phase === "released") {
      // This attempt is over. A later attempt is a different occurrence attempt
      // with its own server lease and its own guard; re-adopting a lease here
      // would let one host vouch for two attempts of the same occurrence.
      throw this.#refuse(
        "automation_lease_not_claimed",
        "this occurrence attempt is already settled or released",
      );
    }
    if (ACTIVE_PHASES.has(this.#phase)) {
      if (response.lease.lease_id !== this.#leaseId) {
        throw this.#refuse(
          "automation_lease_fence_unknown",
          "a different lease is already held for this occurrence",
        );
      }
      this.#adoptFence(response.lease, "automation_lease_fence_stale");
      return;
    }
    this.#requireExecutablePrincipal(response.occurrence);
    this.#requireFreshPolicy(response.occurrence);
    this.#occurrence = response.occurrence;
    this.#attempt = response.attempt;
    this.#grant = undefined;
    this.#token = response.lease_token;
    this.#adoptFence(response.lease, "automation_lease_fence_stale");
    this.#phase = "claimed";
  }

  /**
   * Adopt a `renew` response. The fence is monotonic: a response that moves
   * `lease_version` or `lease_fence` backwards is refused, which is what stops a
   * delayed renewal from resurrecting a superseded fence.
   */
  acceptRenew(response: P06AutomationRenewResponse): void {
    if (this.#phase === "ambiguous") {
      throw this.#refuse("automation_occurrence_ambiguous", "occurrence is ambiguous");
    }
    if (!ACTIVE_PHASES.has(this.#phase)) {
      throw this.#refuse("automation_lease_not_claimed", "renew requires a live claim");
    }
    if (response.occurrence_id !== this.#occurrence?.occurrence_id) {
      throw this.#refuse("automation_lease_fence_unknown", "renew targets another occurrence");
    }
    if (response.attempt !== this.#attempt) {
      throw this.#refuse("automation_lease_fence_unknown", "renew targets another attempt");
    }
    this.#adoptFence(response.lease, "automation_lease_fence_stale");
  }

  /**
   * Adopt the server `start` grant. This is the only transition that unlocks
   * execution, and it may only be accepted for the exact occurrence/attempt/
   * lease this guard already holds.
   */
  acceptStart(grant: P06AutomationStartGrant): void {
    if (this.#phase === "ambiguous") {
      throw this.#refuse("automation_occurrence_ambiguous", "occurrence is ambiguous");
    }
    if (!ACTIVE_PHASES.has(this.#phase)) {
      throw this.#refuse("automation_lease_not_claimed", "start requires a live claim");
    }
    if (grant.occurrence_id !== this.#occurrence?.occurrence_id) {
      throw this.#refuse(
        "automation_start_grant_mismatch",
        "start grant is for another occurrence",
      );
    }
    if (grant.attempt !== this.#attempt) {
      throw this.#refuse("automation_start_grant_mismatch", "start grant is for another attempt");
    }
    if (grant.lease_id !== this.#leaseId) {
      throw this.#refuse("automation_lease_fence_unknown", "start grant is for another lease");
    }
    if (grant.lease_fence > this.#leaseFence) {
      throw this.#refuse(
        "automation_lease_fence_unknown",
        "start grant carries a fence this host never observed",
      );
    }
    this.#requireFreshPolicy(this.#occurrence);
    this.#grant = Object.freeze(grant);
    this.#phase = "started";
  }

  /**
   * Mark the occurrence `ambiguous`. After this, no transition is accepted and
   * no side effect is authorized: the server cannot prove the interrupted run
   * produced nothing, and neither can the host.
   */
  markAmbiguous(): void {
    if (this.#phase === "settled" || this.#phase === "released") return;
    this.#phase = "ambiguous";
    this.#grant = undefined;
    this.#token = undefined;
  }

  /** Record a server-confirmed settlement. Any later action is refused. */
  markSettled(): void {
    this.#phase = "settled";
    this.#grant = undefined;
    this.#token = undefined;
  }

  /** Record a server-confirmed pre-start release. */
  markReleased(): void {
    this.#phase = "released";
    this.#grant = undefined;
    this.#token = undefined;
  }

  /**
   * Assert that `presented` is the fence this host currently trusts.
   *
   * This is the stale-device refusal. An older fence is `stale`; a fence from a
   * lease or version this host never observed is `unknown`. Neither is allowed
   * to settle, report a tool result, or emit a completion.
   */
  assertFenceCurrent(presented: P06AutomationFenceObservation): void {
    if (this.#phase === "ambiguous") {
      throw this.#refuse("automation_occurrence_ambiguous", "occurrence is ambiguous");
    }
    if (this.#leaseId === "" || this.#token === undefined) {
      throw this.#refuse("automation_lease_not_claimed", "no live lease is held");
    }
    if (presented.leaseId !== this.#leaseId) {
      throw this.#refuse("automation_lease_fence_unknown", "presented lease is not the held lease");
    }
    if (presented.leaseVersion < this.#leaseVersion || presented.leaseFence < this.#leaseFence) {
      throw this.#refuse("automation_lease_fence_stale", "presented lease fence is behind current");
    }
    if (presented.leaseVersion > this.#leaseVersion || presented.leaseFence > this.#leaseFence) {
      // A fence ahead of anything this host observed belongs to a different
      // holder. It is not "newer is better"; this host cannot vouch for it.
      throw this.#refuse(
        "automation_lease_fence_unknown",
        "presented lease fence was never observed",
      );
    }
    this.#assertNotLocallyExpired();
  }

  /**
   * Assert that a tool result / completion may be reported for `runId`.
   * Requires a live claim, a current fence, and a server start grant for the
   * same run — so a tool result can never be attributed to a run the server has
   * not durably linked to this occurrence attempt.
   */
  assertToolResultAllowed(presented: P06AutomationFenceObservation, runId: string): void {
    this.assertFenceCurrent(presented);
    const grant = this.#requireGrant();
    if (grant.run_id !== runId) {
      throw this.#refuse("automation_run_mismatch", "run is not the granted P05 run");
    }
  }

  /**
   * The single side-effect gate. Call it before any tool execution, file write,
   * shell command, socket, or subprocess. Fails closed in `idle`, `claimed`,
   * `ambiguous`, `settled`, and `released`.
   */
  assertSideEffectAuthorized(presented?: P06AutomationFenceObservation): void {
    if (this.#phase === "ambiguous") {
      throw this.#refuse("automation_occurrence_ambiguous", "occurrence is ambiguous");
    }
    if (this.#phase !== "started") {
      throw this.#refuse(
        "automation_start_grant_required",
        "the server must create the P05 run link before any host side effect",
      );
    }
    if (presented !== undefined) this.assertFenceCurrent(presented);
    this.#requireGrant();
    this.#assertNotLocallyExpired();
  }

  /** Build the non-secret projection other layers may read. Throws unless started. */
  toExecutionGrant(): P06AutomationExecutionGrant {
    this.assertSideEffectAuthorized();
    const grant = this.#requireGrant();
    const occurrence = this.#occurrence;
    if (occurrence === undefined) {
      throw this.#refuse("automation_start_grant_mismatch", "start grant has no occurrence");
    }
    return Object.freeze({
      occurrence,
      attempt: this.#attempt,
      leaseId: this.#leaseId,
      leaseVersion: this.#leaseVersion,
      leaseFence: this.#leaseFence,
      runId: grant.run_id,
      agentSessionId: grant.agent_session_id,
      phase: "started" as const,
    });
  }

  /**
   * Assert that a pre-start `release` is still legal. The Contract Gate allows
   * release only before the occurrence is marked started, and the host refuses
   * locally rather than spending a round trip to learn it lost.
   */
  assertReleaseAllowed(): void {
    if (this.#phase === "ambiguous") {
      throw this.#refuse("automation_occurrence_ambiguous", "occurrence is ambiguous");
    }
    if (this.#phase !== "claimed") {
      throw this.#refuse(
        "automation_release_after_start",
        "release is only allowed before the occurrence is started",
      );
    }
    this.assertFenceCurrent({
      leaseId: this.#leaseId,
      leaseVersion: this.#leaseVersion,
      leaseFence: this.#leaseFence,
    });
  }

  /**
   * Build the fenced request body. The raw token is read from a private
   * `#token` field and only ever lands in this body; it is not exposed as a
   * property, so `JSON.stringify(guard)`, structured logging, and error
   * serialization cannot leak it.
   */
  buildFenceRequest<TBody extends object>(
    body: TBody,
  ): TBody & {
    readonly lease_id: string;
    readonly lease_version: number;
    readonly lease_fence: number;
    readonly lease_token: string;
  } {
    this.assertFenceCurrent({
      leaseId: this.#leaseId,
      leaseVersion: this.#leaseVersion,
      leaseFence: this.#leaseFence,
    });
    if (this.#token === undefined) {
      throw this.#refuse("automation_lease_token_missing", "the in-memory lease token is gone");
    }
    return Object.freeze({
      ...body,
      lease_id: this.#leaseId,
      lease_version: this.#leaseVersion,
      lease_fence: this.#leaseFence,
      lease_token: this.#token,
    });
  }

  #adoptFence(lease: P06AutomationLease, backwardsCode: P06AutomationLocalRejectionCode): void {
    if (this.#leaseId !== "" && lease.lease_id !== this.#leaseId) {
      throw this.#refuse("automation_lease_fence_unknown", "lease identity changed mid-attempt");
    }
    if (
      this.#leaseId !== "" &&
      (lease.lease_version < this.#leaseVersion || lease.lease_fence < this.#leaseFence)
    ) {
      throw this.#refuse(backwardsCode, "server lease fence moved backwards");
    }
    this.#leaseId = lease.lease_id;
    this.#leaseVersion = lease.lease_version;
    this.#leaseFence = lease.lease_fence;
    this.#expiresAtMs = Date.parse(lease.expires_at);
    // A grant survives renewal: the start grant is a lower bound, and the held
    // fence only ever moves forward past it.
    if (this.#grant !== undefined && this.#grant.lease_fence > this.#leaseFence) {
      throw this.#refuse("automation_start_grant_mismatch", "granted fence exceeds held fence");
    }
  }

  #requireGrant(): P06AutomationStartGrant {
    const grant = this.#grant;
    if (grant === undefined || this.#phase !== "started") {
      throw this.#refuse(
        "automation_start_grant_required",
        "no server start grant proves the P05 run link",
      );
    }
    return grant;
  }

  #requireFreshPolicy(occurrence: P06AutomationOccurrenceRef | undefined): void {
    if (occurrence === undefined) return;
    const current = this.#options.currentPolicyVersion;
    if (current !== undefined && occurrence.policy_version < current) {
      throw this.#refuse("automation_policy_stale", "occurrence policy snapshot is behind current");
    }
  }

  #requireExecutablePrincipal(occurrence: P06AutomationOccurrenceRef): void {
    if (occurrence.execution_principal.kind !== "user") {
      throw this.#refuse(
        "automation_execution_principal_unavailable",
        "the resolved execution principal is not executable in the P06 MVP",
      );
    }
  }

  /**
   * Local expiry hint only. The server remains the authority: this refuses early
   * rather than letting a known-expired lease start side effects, and it never
   * re-queues or retries anything.
   */
  #assertNotLocallyExpired(): void {
    const now = this.#options.now?.() ?? Date.now();
    if (now >= this.#expiresAtMs) {
      throw this.#refuse("automation_lease_expired_locally", "the held lease has expired");
    }
  }

  #refuse(code: P06AutomationLocalRejectionCode, message: string): P06AutomationLeaseError {
    return new P06AutomationLeaseError(code, message, {
      occurrenceId: this.#occurrence?.occurrence_id,
      attempt: this.#attempt > 0 ? this.#attempt : undefined,
    });
  }
}
