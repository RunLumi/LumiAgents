/**
 * P06 leased-automation execution seam for zcode-cli (`p06-automation-lease-v1`).
 *
 * Contract Gate `p06-cg-v1` commit `11341a5`; normative clarification
 * `P06-CR-001`; wire shapes from
 * `docs/implementation/fixtures/p06-contracts-v1.json`.
 *
 * This module is the CLI-side view of the seam. It owns:
 * - the device route builders for the five frozen lease transitions plus `due`;
 * - a host-owned transport port, so the CLI never speaks HTTP or holds a device
 *   token itself;
 * - the claim → start → execute → settle/release ordering rule, expressed as one
 *   `P06AutomationOccurrenceRunner` that cannot be driven out of order.
 *
 * It owns NO authority. Occurrence identity, lease authority, and the P05 run
 * link are server-owned; `P06AutomationFenceGuard` is what refuses a stale
 * device. Three local mechanisms are deliberately absent here and must not be
 * reintroduced as substitutes:
 * - `AutomationRepo.claimDue` (local boolean single-flight) — no fence, no
 *   `ambiguous`, no server authority.
 * - `OffPeakTaskRepo.recoverInterrupted` (`running → queued`) — asserts that a
 *   partitioned host produced no side effect, which a partition cannot prove.
 *   Use `classifyInterruptedAutomationOccurrence` instead.
 * - the scheduler's 5-minute `MISFIRE_GRACE_MS` and `buildRunId`'s
 *   colon-delimited local run IDs — the server's `schedule_cursor_at` bounds due
 *   work, and wire identity is always opaque `<prefix>_<32 hex>`.
 *
 * The existing V4 transport recovery (`conversation-topic-publisher.ts`) is a
 * conversation-stream concern and is deliberately not reused: P06 recovery is
 * server-side and durable, not an in-memory delta log that a restart resets.
 */

import {
  P06AutomationFenceGuard,
  P06AutomationLeaseError,
  isP06OpaqueId,
  p06ReasonCodeSchema,
  type P06AutomationClaimResponse,
  type P06AutomationDueWorkResponse,
  type P06AutomationExecutionGrant,
  type P06AutomationFenceGuardOptions,
  type P06AutomationFenceObservation,
  type P06AutomationLocalRejectionCode,
  type P06AutomationReleaseResponse,
  type P06AutomationRenewResponse,
  type P06AutomationSettleRequest,
  type P06AutomationSettleResponse,
  type P06AutomationStartResponse,
  type P06ReasonCode,
} from "@zcode/shared";

export {
  P06_AUTOMATION_LEASE_CONTRACT_VERSION,
  P06_AUTOMATION_LOCAL_REJECTION_CODES,
  P06_AUTOMATION_MUTATION_TOOL_NAMES,
  P06_AUTOMATION_RESTRICTED_TOOL_NAMES,
  P06_AUTOMATION_SERVER_ERROR_CODES,
  P06_CONTRACT_GATE_VERSION,
  P06_DUE_WORK_MAX_ITEMS,
  P06_EXECUTABLE_EXECUTION_PRINCIPAL_KINDS,
  P06_OFF_PEAK_FAIL_CLOSED_CONSTRAINTS,
  P06_OFF_PEAK_POLICY_SCHEMA_VERSION,
  P06AutomationFenceGuard,
  P06AutomationLeaseError,
  acceptOffPeakTicketRenewal,
  buildAutomationOccurrenceToolDenylist,
  classifyInterruptedAutomationOccurrence,
  decodeAutomationWire,
  isP06AutomationLeaseError,
  isP06AutomationServerErrorCode,
  isP06ExecutableExecutionPrincipal,
  isP06OpaqueId,
  isP06StartGrantFenceCurrent,
  isOffPeakPolicyUsable,
  narrowOffPeakToolConstraints,
  p06AutomationClaimRequestSchema,
  p06AutomationClaimResponseSchema,
  p06AutomationDueWorkResponseSchema,
  p06AutomationLeaseFenceRequestSchema,
  p06AutomationOccurrenceRefSchema,
  p06AutomationReleaseResponseSchema,
  p06AutomationRenewResponseSchema,
  p06AutomationSettleRequestSchema,
  p06AutomationSettleResponseSchema,
  p06AutomationStartResponseSchema,
  p06OffPeakPolicySchema,
  p06ReasonCodeSchema,
  resolveAutomationExecutionClass,
  summarizeAutomationRecovery,
} from "@zcode/shared";

export type {
  P06AutomationClaimRequest,
  P06AutomationClaimResponse,
  P06AutomationDueWorkResponse,
  P06AutomationExecutionClass,
  P06AutomationExecutionGrant,
  P06AutomationFenceGuardOptions,
  P06AutomationFenceObservation,
  P06AutomationLease,
  P06AutomationLeaseFence,
  P06AutomationLeaseFenceRequest,
  P06AutomationLeasePhase,
  P06AutomationLocalRejectionCode,
  P06AutomationOccurrenceRef,
  P06AutomationRenewResponse,
  P06AutomationReleaseResponse,
  P06AutomationServerErrorCode,
  P06AutomationSettleOutcome,
  P06AutomationSettleRequest,
  P06AutomationSettleResponse,
  P06AutomationStartGrant,
  P06AutomationStartResponse,
  P06InterruptedOccurrenceDisposition,
  P06InterruptedOccurrenceObservation,
  P06OffPeakMode,
  P06OffPeakPolicy,
  P06OffPeakToolConstraints,
  P06ReasonCode,
} from "@zcode/shared";

/** All P06 device routes live under the versioned `/api/v1` prefix. */
export const P06_AUTOMATION_API_BASE_PATH = "/api/v1" as const;

export type P06AutomationDeviceRoute =
  | "due"
  | "claim"
  | "renew"
  | "start"
  | "settle"
  | "release";

/**
 * Build a device route path from a validated opaque ID.
 *
 * Validating the ID before interpolation is the security property: a path segment
 * is only ever a `[a-z][a-z0-9]*_[0-9a-f]{32}` value, so no caller can traverse a
 * path, inject a query, or smuggle a credential into a URL. The raw lease token
 * NEVER appears in any of these paths — it belongs in a JSON body, which the
 * transport owns.
 */
export function buildP06AutomationDevicePath(
  route: P06AutomationDeviceRoute,
  ids: { readonly occurrenceId?: string; readonly leaseId?: string } = {},
): string {
  const base = P06_AUTOMATION_API_BASE_PATH;
  switch (route) {
    case "due":
      return `${base}/devices/automations/due`;
    case "renew":
      return `${base}/devices/automation-leases/${requireOpaqueId(
        ids.leaseId,
        "lse",
        route,
      )}/renew`;
    case "claim":
    case "start":
    case "settle":
    case "release":
      return `${base}/devices/automation-occurrences/${requireOpaqueId(
        ids.occurrenceId,
        "occ",
        route,
      )}/${route}`;
  }
}

/** The fenced body shared by renew/start/release. Built by the guard, never by hand. */
export interface P06AutomationLeaseFenceBody {
  readonly lease_id: string;
  readonly lease_version: number;
  readonly lease_fence: number;
  readonly lease_token: string;
}

/**
 * Host-owned transport for the six device routes.
 *
 * The host owns the device token, TLS, retry, and reconnection. Implementations
 * decode with the exported schemas and surface a `P06AutomationLeaseError` for a
 * local refusal; they never synthesize a lease, a fence, or a run link locally.
 */
export interface P06AutomationLeaseTransport {
  /** `GET /devices/automations/due` — bounded eligible unleased work. */
  listDueWork(options?: { readonly signal?: AbortSignal }): Promise<P06AutomationDueWorkResponse>;
  claim(input: {
    readonly occurrenceId: string;
    readonly signal?: AbortSignal;
  }): Promise<P06AutomationClaimResponse>;
  renew(input: {
    readonly leaseId: string;
    readonly body: P06AutomationLeaseFenceBody;
    readonly signal?: AbortSignal;
  }): Promise<P06AutomationRenewResponse>;
  start(input: {
    readonly occurrenceId: string;
    readonly body: P06AutomationLeaseFenceBody;
    readonly signal?: AbortSignal;
  }): Promise<P06AutomationStartResponse>;
  settle(input: {
    readonly occurrenceId: string;
    readonly body: P06AutomationSettleRequest;
    readonly signal?: AbortSignal;
  }): Promise<P06AutomationSettleResponse>;
  release(input: {
    readonly occurrenceId: string;
    readonly body: P06AutomationLeaseFenceBody;
    readonly signal?: AbortSignal;
  }): Promise<P06AutomationReleaseResponse>;
}

export interface P06AutomationRunnerOptions extends P06AutomationFenceGuardOptions {
  readonly transport: P06AutomationLeaseTransport;
  readonly guard?: P06AutomationFenceGuard;
}

/** The occurrence outcome a host may report. `skip`/`missed`/`cancelled` are server-owned. */
export type P06AutomationWorkOutcome =
  | { readonly outcome: "succeeded" }
  | { readonly outcome: "failed"; readonly reasonCode: P06ReasonCode };

/**
 * Ordered claim → start → execute → settle/release for one occurrence attempt.
 *
 * The ordering is the enforcement mechanism, not a convention:
 * - `execute` is reachable only after `start` returned a durable run link, and it
 *   re-asserts the fence on entry and again before reporting the result.
 * - `settle` sends the same `run_id` the server granted.
 * - `release` is refused once `start` has been called, matching the Contract Gate
 *   rule that release is allowed only before the occurrence is marked started.
 * - There is no `retry` and no `requeue` method. A refused execution surfaces as
 *   a `P06AutomationLeaseError` and the occurrence stops.
 */
export class P06AutomationOccurrenceRunner {
  readonly #transport: P06AutomationLeaseTransport;
  readonly #guard: P06AutomationFenceGuard;
  #finished = false;

  constructor(options: P06AutomationRunnerOptions) {
    this.#transport = options.transport;
    this.#guard = options.guard ?? new P06AutomationFenceGuard(options);
  }

  get guard(): P06AutomationFenceGuard {
    return this.#guard;
  }

  /** Atomically claim the occurrence lease and adopt the server fence. */
  async claim(occurrenceId: string, options?: { readonly signal?: AbortSignal }): Promise<void> {
    if (this.#finished) {
      throw new P06AutomationLeaseError(
        "automation_lease_not_claimed",
        "this occurrence attempt is already settled or released",
      );
    }
    const response = await this.#transport.claim({
      occurrenceId: requireOpaqueId(occurrenceId, "occ", "claim"),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    this.#guard.acceptClaim(response);
  }

  /**
   * Obtain the server's durable P05 run link. The returned grant is the only
   * thing that unlocks `execute`; without it the host performs no side effect.
   */
  async start(options?: { readonly signal?: AbortSignal }): Promise<P06AutomationExecutionGrant> {
    const fence = this.#requireHeldFence();
    const response = await this.#transport.start({
      occurrenceId: requireOpaqueId(fence.occurrenceId, "occ", "start"),
      body: this.#guard.buildFenceRequest({}),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    this.#guard.acceptStart(response);
    return this.#guard.toExecutionGrant();
  }

  /**
   * Run the occurrence's work under the current fence. `work` is invoked only
   * after the guard authorizes the side effect, and it must return a bounded
   * stable reason code rather than prompt/response content.
   */
  async execute(
    work: (grant: P06AutomationExecutionGrant) => Promise<P06AutomationWorkOutcome>,
  ): Promise<void> {
    const grant = this.#guard.toExecutionGrant();
    const fence: P06AutomationFenceObservation = {
      leaseId: grant.leaseId,
      leaseVersion: grant.leaseVersion,
      leaseFence: grant.leaseFence,
    };
    const result = await work(grant);
    this.#guard.assertToolResultAllowed(fence, grant.runId);
    // The fence we present is the fence the server most recently confirmed, which
    // may be ahead of the one in the start grant after a renewal.
    const presented = this.#guard.currentFence;
    if (presented === undefined) {
      throw new P06AutomationLeaseError(
        "automation_lease_not_claimed",
        "the held lease disappeared before settlement",
      );
    }
    const settled =
      result.outcome === "failed"
        ? await this.#transport.settle({
            occurrenceId: grant.occurrence.occurrence_id,
            body: this.#guard.buildFenceRequest({
              outcome: "failed",
              reason_code: result.reasonCode,
              run_id: grant.runId,
            }),
          })
        : await this.#transport.settle({
            occurrenceId: grant.occurrence.occurrence_id,
            body: this.#guard.buildFenceRequest({ outcome: "succeeded", run_id: grant.runId }),
          });
    // An idempotent replay echoes the originally recorded settlement, so only a
    // fresh settlement must not report a fence behind the one we presented.
    if (
      !settled.idempotent &&
      (settled.lease_version < presented.leaseVersion ||
        settled.lease_fence < presented.leaseFence)
    ) {
      throw new P06AutomationLeaseError(
        "automation_lease_fence_stale",
        "the settlement response reports a fence behind the presented one",
      );
    }
    this.#guard.markSettled();
    this.#finished = true;
  }

  /** Renew a current, pre-ambiguous lease. The fence stays monotonic. */
  async renew(options?: { readonly signal?: AbortSignal }): Promise<void> {
    const held = this.#requireHeldFence();
    const response = await this.#transport.renew({
      leaseId: requireOpaqueId(held.leaseId, "lse", "renew"),
      body: this.#guard.buildFenceRequest({}),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    this.#guard.acceptRenew(response);
  }

  /** Release the lease. Refused once the occurrence has been started. */
  async release(options?: { readonly signal?: AbortSignal }): Promise<void> {
    const held = this.#requireHeldFence();
    // Local refusal first: the Contract Gate allows release only before the
    // occurrence is marked started, so the host does not spend a round trip
    // learning what it already knows.
    this.#guard.assertReleaseAllowed();
    await this.#transport.release({
      occurrenceId: requireOpaqueId(held.occurrenceId, "occ", "release"),
      body: this.#guard.buildFenceRequest({}),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    this.#guard.markReleased();
    this.#finished = true;
  }

  /**
   * A second occurrence attempt for the same automation. Each attempt gets its
   * OWN runner and its own guard: reusing a guard across attempts is exactly the
   * bug the fence exists to prevent.
   */
  createAttemptRunner(options: Omit<P06AutomationRunnerOptions, "guard">): P06AutomationOccurrenceRunner {
    return new P06AutomationOccurrenceRunner({ ...options, guard: new P06AutomationFenceGuard(options) });
  }

  #requireHeldFence(): P06AutomationFenceObservation & { readonly occurrenceId: string } {
    const occurrence = this.#guard.occurrence;
    const fence = this.#guard.currentFence;
    if (occurrence === undefined || fence === undefined) {
      throw new P06AutomationLeaseError(
        "automation_lease_not_claimed",
        "claim must succeed before any lease transition",
      );
    }
    return { ...fence, occurrenceId: occurrence.occurrence_id };
  }
}

/**
 * Map a transport failure onto a local refusal without inventing a server code.
 *
 * `ambiguous` is terminal: a partition cannot prove a stopped host, so the
 * occurrence is marked ambiguous, surfaced for reconciliation, and never
 * re-dispatched locally.
 */
export function applyP06ServerRejection(
  guard: P06AutomationFenceGuard,
  code: string,
): P06AutomationLeaseError {
  const localCode: P06AutomationLocalRejectionCode =
    code === "occurrence_ambiguous"
      ? "automation_occurrence_ambiguous"
      : code === "occurrence_lease_expired"
        ? "automation_lease_expired_locally"
        : code === "lease_fence_invalid"
          ? "automation_lease_fence_stale"
          : "automation_lease_fence_unknown";
  if (localCode === "automation_occurrence_ambiguous") guard.markAmbiguous();
  return new P06AutomationLeaseError(localCode, `P06 occurrence transition refused: ${code}`, {
    occurrenceId: guard.occurrence?.occurrence_id,
    attempt: guard.attempt > 0 ? guard.attempt : undefined,
  });
}

/** Validate a host-produced failure reason before it reaches the wire. */
export function assertP06FailureReasonCode(value: unknown): P06ReasonCode {
  const parsed = p06ReasonCodeSchema.safeParse(value);
  if (!parsed.success) {
    throw new P06AutomationLeaseError(
      "automation_wire_invalid",
      "automation failure reason code is invalid",
    );
  }
  return parsed.data;
}

function requireOpaqueId(
  value: string | undefined,
  prefix: "occ" | "lse",
  route: P06AutomationDeviceRoute,
): string {
  if (isP06OpaqueId(value, prefix)) return value;
  throw new P06AutomationLeaseError(
    "automation_wire_invalid",
    `P06 device route ${route} requires a ${prefix}_ opaque ID`,
  );
}
