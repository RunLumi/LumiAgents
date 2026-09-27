/**
 * P06 leased-automation wire contract (`p06-automation-lease-v1`).
 *
 * Frozen inputs: Contract Gate `p06-cg-v1` (commit `11341a5`), change request
 * `P06-CR-001`, and `docs/implementation/fixtures/p06-contracts-v1.json`.
 *
 * Authority rules encoded here:
 * - The server owns occurrence identity, lease authority, and the P05 run link.
 *   A host never mints an occurrence ID, a lease ID, a run ID, or a fence.
 * - All P06 IDs are opaque `<prefix>_<32 lowercase hex>`. The prefix is a wire
 *   namespace, never an authorization signal.
 * - The raw lease token exists exactly once, in the `claim` response body, and
 *   is only ever carried in a request body. It is never a path segment, never a
 *   header, never logged, and never persisted by the host.
 * - `off_peak` is a distinct execution class. It has no clock schedule and a
 *   ticket renewal never mints a second logical occurrence.
 *
 * This module is the wire vocabulary only: bounded schemas, inferred types,
 * stable error codes, and the pure narrowing rules. Runtime fencing lives in
 * `p06-automation-lease-guard.ts`; no state and no I/O belong here.
 */

import { z } from "zod";

export const P06_AUTOMATION_LEASE_CONTRACT_VERSION = "p06-automation-lease-v1" as const;

/** Contract Gate commit that froze this surface. Reported by the handoff, never trusted. */
export const P06_CONTRACT_GATE_VERSION = "p06-cg-v1" as const;

const MAX_REASON_CODE_LENGTH = 64;
const MIN_LEASE_TOKEN_LENGTH = 16;
const MAX_LEASE_TOKEN_LENGTH = 512;
/** `GET /devices/automations/due` is bounded by the Contract Gate. */
export const P06_DUE_WORK_MAX_ITEMS = 20;

/**
 * Opaque-ID prefixes this seam validates. Deliberately the subset the leased
 * automation protocol actually carries; a wider registry would invite a caller
 * to treat an unrelated P06 resource as automation authority.
 */
export const P06_AUTOMATION_ID_PREFIXES = [
  "aut",
  "sch",
  "occ",
  "lse",
  "org",
  "prj",
  "usr",
  "agd",
  "dvc",
  "rse",
  "run",
  "pol",
  "wsb",
  "req",
] as const;

export type P06AutomationIdPrefix = (typeof P06_AUTOMATION_ID_PREFIXES)[number];

const P06_OPAQUE_ID_PATTERN = /^[a-z][a-z0-9]*_[0-9a-f]{32}$/;
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STABLE_REASON_CODE_PATTERN = new RegExp(`^[a-z][a-z0-9_]{0,${MAX_REASON_CODE_LENGTH - 1}}$`);

/** Canonical UTC instant, millisecond precision, `Z` suffix. */
export const p06UtcInstantSchema = z
  .string()
  .regex(UTC_INSTANT_PATTERN, "expected an RFC 3339 UTC instant with milliseconds")
  .refine((value) => Number.isFinite(Date.parse(value)), "expected a real calendar instant");

/**
 * Bounded stable machine token. Used for `reason_code` and any other value that
 * reaches a durable event, so it can never carry prompt/response content.
 */
export const p06ReasonCodeSchema = z
  .string()
  .max(MAX_REASON_CODE_LENGTH)
  .regex(STABLE_REASON_CODE_PATTERN, "expected a lowercase snake_case reason code");

export type P06ReasonCode = z.infer<typeof p06ReasonCodeSchema>;

/** One-time raw lease credential: printable, bounded, never a control-character soup. */
export const p06LeaseTokenSchema = z
  .string()
  .min(MIN_LEASE_TOKEN_LENGTH)
  .max(MAX_LEASE_TOKEN_LENGTH)
  .regex(/^[\x21-\x7e]+$/, "lease token must be printable ASCII without whitespace");

export function isP06OpaqueId(value: unknown, prefix: P06AutomationIdPrefix): value is string {
  return (
    typeof value === "string" && P06_OPAQUE_ID_PATTERN.test(value) && value.startsWith(`${prefix}_`)
  );
}

export function p06OpaqueIdSchema(prefix: P06AutomationIdPrefix): z.ZodType<string> {
  return z
    .string()
    .refine((value) => isP06OpaqueId(value, prefix), { message: `expected a ${prefix}_ Lumi ID` });
}

// ---------------------------------------------------------------------------
// Execution principal
// ---------------------------------------------------------------------------

export const p06ExecutionPrincipalSchema = z
  .object({
    kind: z.enum(["user", "service_account"]),
    id: p06OpaqueIdSchema("usr"),
  })
  .strict();

export type P06ExecutionPrincipal = z.infer<typeof p06ExecutionPrincipalSchema>;

/**
 * The P06 MVP resolves a `user` principal only. A `service_account` occurrence
 * decodes fine but must fail closed until the F14 service identity exists, so
 * the host never executes under a principal it cannot verify.
 */
export const P06_EXECUTABLE_EXECUTION_PRINCIPAL_KINDS = ["user"] as const;

export function isP06ExecutableExecutionPrincipal(principal: P06ExecutionPrincipal): boolean {
  return (P06_EXECUTABLE_EXECUTION_PRINCIPAL_KINDS as readonly string[]).includes(principal.kind);
}

// ---------------------------------------------------------------------------
// Occurrence reference and lease
// ---------------------------------------------------------------------------

export const p06OffPeakModeSchema = z.enum(["normal", "off_peak"]);

export type P06OffPeakMode = z.infer<typeof p06OffPeakModeSchema>;

/**
 * The minimum redacted occurrence projection a device needs in order to decide
 * whether it can claim. Organization, project, workspace binding, and device are
 * derived by the server from the device token; they are absent by construction.
 */
export const p06AutomationOccurrenceRefSchema = z
  .object({
    occurrence_id: p06OpaqueIdSchema("occ"),
    automation_id: p06OpaqueIdSchema("aut"),
    attempt: z.number().int().nonnegative(),
    scheduled_for: p06UtcInstantSchema,
    off_peak_mode: p06OffPeakModeSchema,
    policy_snapshot_id: p06OpaqueIdSchema("pol"),
    policy_version: z.number().int().positive(),
    execution_principal: p06ExecutionPrincipalSchema,
  })
  .strict();

export type P06AutomationOccurrenceRef = z.infer<typeof p06AutomationOccurrenceRefSchema>;

/**
 * The fencing tuple. It is the only authority a host ever presents after
 * `claim`: there is no local lease, no local clock authority, and no local
 * retry counter that can stand in for these three fields.
 */
export const p06AutomationLeaseFenceSchema = z
  .object({
    lease_id: p06OpaqueIdSchema("lse"),
    lease_version: z.number().int().positive(),
    lease_fence: z.number().int().positive(),
  })
  .strict();

export type P06AutomationLeaseFence = z.infer<typeof p06AutomationLeaseFenceSchema>;

/** Server lease projection. Never carries the raw token. */
export const p06AutomationLeaseSchema = z
  .object({
    lease_id: p06OpaqueIdSchema("lse"),
    lease_version: z.number().int().positive(),
    lease_fence: z.number().int().positive(),
    expires_at: p06UtcInstantSchema,
  })
  .strict();

export type P06AutomationLease = z.infer<typeof p06AutomationLeaseSchema>;

/**
 * Proof that the server durably created or discovered the P05 run link for this
 * occurrence attempt BEFORE any host side effect. A host without this grant has
 * no authority to run a tool, touch a file, open a socket, or emit a result.
 */
export const p06AutomationStartGrantSchema = z
  .object({
    occurrence_id: p06OpaqueIdSchema("occ"),
    attempt: z.number().int().positive(),
    run_id: p06OpaqueIdSchema("run"),
    agent_session_id: p06OpaqueIdSchema("rse"),
    lease_id: p06OpaqueIdSchema("lse"),
    lease_version: z.number().int().positive(),
    lease_fence: z.number().int().positive(),
  })
  .strict();

export type P06AutomationStartGrant = z.infer<typeof p06AutomationStartGrantSchema>;

export function isP06StartGrantFenceCurrent(
  lease: P06AutomationLeaseFence,
  grant: P06AutomationStartGrant,
): boolean {
  return (
    lease.lease_id === grant.lease_id &&
    lease.lease_version === grant.lease_version &&
    lease.lease_fence === grant.lease_fence
  );
}

// ---------------------------------------------------------------------------
// Device request/response shapes
// ---------------------------------------------------------------------------

/** Body of `claim`. Device/tenant scope is derived from the device token. */
export const p06AutomationClaimRequestSchema = z
  .object({ occurrence_id: p06OpaqueIdSchema("occ") })
  .strict();

export type P06AutomationClaimRequest = z.infer<typeof p06AutomationClaimRequestSchema>;

export const p06AutomationClaimResponseSchema = z
  .object({
    occurrence: p06AutomationOccurrenceRefSchema,
    attempt: z.number().int().positive(),
    device_id: p06OpaqueIdSchema("dvc"),
    lease: p06AutomationLeaseSchema,
    /** One-time raw credential. In-memory only; never persisted, logged, or URL-encoded. */
    lease_token: p06LeaseTokenSchema,
  })
  .strict();

export type P06AutomationClaimResponse = z.infer<typeof p06AutomationClaimResponseSchema>;

/**
 * Body of `renew`, `start`, `settle`, and `release`. The Contract Gate requires
 * every one of those transitions to present the current lease ID plus the token,
 * version, and fence. The token travels in the body; the URL only ever carries
 * the opaque `occurrence_id` / `lease_id` namespace token.
 */
export const p06AutomationLeaseFenceRequestSchema = z
  .object({
    lease_id: p06OpaqueIdSchema("lse"),
    lease_version: z.number().int().positive(),
    lease_fence: z.number().int().positive(),
    lease_token: p06LeaseTokenSchema,
  })
  .strict();

export type P06AutomationLeaseFenceRequest = z.infer<typeof p06AutomationLeaseFenceRequestSchema>;

export const p06AutomationRenewResponseSchema = z
  .object({
    occurrence_id: p06OpaqueIdSchema("occ"),
    attempt: z.number().int().positive(),
    lease: p06AutomationLeaseSchema,
  })
  .strict();

export type P06AutomationRenewResponse = z.infer<typeof p06AutomationRenewResponseSchema>;

export const p06AutomationStartResponseSchema = p06AutomationStartGrantSchema.strict();

export type P06AutomationStartResponse = P06AutomationStartGrant;

/**
 * Settlement outcome. The host may only report success or failure. `skip`,
 * `missed`, `cancelled`, and `ambiguous` are server-owned decisions: a device
 * must never claim to have skipped or cancelled work it did not resolve.
 */
export const p06AutomationSettleOutcomeSchema = z.enum(["succeeded", "failed"]);

export type P06AutomationSettleOutcome = z.infer<typeof p06AutomationSettleOutcomeSchema>;

export const p06AutomationSettleRequestSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("succeeded"),
      run_id: p06OpaqueIdSchema("run"),
      ...p06AutomationLeaseFenceRequestSchema.shape,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("failed"),
      reason_code: p06ReasonCodeSchema,
      run_id: p06OpaqueIdSchema("run"),
      ...p06AutomationLeaseFenceRequestSchema.shape,
    })
    .strict(),
]);

export type P06AutomationSettleRequest = z.infer<typeof p06AutomationSettleRequestSchema>;

export const p06AutomationSettleResponseSchema = z
  .object({
    occurrence_id: p06OpaqueIdSchema("occ"),
    attempt: z.number().int().positive(),
    settled_state: p06AutomationSettleOutcomeSchema,
    lease_version: z.number().int().positive(),
    lease_fence: z.number().int().positive(),
    /** True when the server replayed an already-recorded identical settlement. */
    idempotent: z.boolean(),
  })
  .strict();

export type P06AutomationSettleResponse = z.infer<typeof p06AutomationSettleResponseSchema>;

export const p06AutomationReleaseResponseSchema = z
  .object({
    occurrence_id: p06OpaqueIdSchema("occ"),
    attempt: z.number().int().positive(),
    released: z.literal(true),
    lease_version: z.number().int().positive(),
    lease_fence: z.number().int().positive(),
  })
  .strict();

export type P06AutomationReleaseResponse = z.infer<typeof p06AutomationReleaseResponseSchema>;

export const p06AutomationDueWorkResponseSchema = z
  .object({ items: z.array(p06AutomationOccurrenceRefSchema).max(P06_DUE_WORK_MAX_ITEMS) })
  .strict();

export type P06AutomationDueWorkResponse = z.infer<typeof p06AutomationDueWorkResponseSchema>;

// ---------------------------------------------------------------------------
// Stable reasons
// ---------------------------------------------------------------------------

/**
 * Server-side reasons specific to the leased-automation device routes, frozen by
 * `p06-cg-v1`. The P01 envelope codes (`permission_denied`,
 * `resource_not_found`, `version_conflict`, `idempotency_conflict`,
 * `organization_pending_deletion`, ...) stay in force through the P01 envelope
 * and are deliberately not duplicated here.
 */
export const P06_AUTOMATION_SERVER_ERROR_CODES = [
  "occurrence_not_found",
  "occurrence_already_claimed",
  "occurrence_lease_expired",
  "occurrence_ambiguous",
  "lease_fence_invalid",
  "device_not_eligible",
  "execution_principal_unavailable",
  "off_peak_not_allowed",
  "automation_invalid_state",
] as const;

export type P06AutomationServerErrorCode = (typeof P06_AUTOMATION_SERVER_ERROR_CODES)[number];

export function isP06AutomationServerErrorCode(
  value: unknown,
): value is P06AutomationServerErrorCode {
  return (
    typeof value === "string" &&
    (P06_AUTOMATION_SERVER_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Reasons this host refuses locally, before or instead of a server call.
 *
 * These are NOT server codes and must never be reported as one. A local refusal
 * means the host cannot prove it still holds authority; the correct response is
 * to stop, surface the occurrence for reconciliation, and never re-dispatch.
 */
export const P06_AUTOMATION_LOCAL_REJECTION_CODES = [
  "automation_lease_not_claimed",
  "automation_lease_token_missing",
  "automation_lease_expired_locally",
  "automation_lease_fence_stale",
  "automation_lease_fence_unknown",
  "automation_start_grant_required",
  "automation_start_grant_mismatch",
  "automation_release_after_start",
  "automation_run_mismatch",
  "automation_occurrence_ambiguous",
  "automation_occurrence_reconciliation_required",
  "automation_policy_stale",
  "automation_execution_principal_unavailable",
  "automation_wire_invalid",
] as const;

export type P06AutomationLocalRejectionCode = (typeof P06_AUTOMATION_LOCAL_REJECTION_CODES)[number];

export const AUTOMATION_WIRE_INVALID_CODE = "automation_wire_invalid" as const;

export type AutomationWireDecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: typeof AUTOMATION_WIRE_INVALID_CODE };

/**
 * Decode an untrusted wire payload into a frozen value or a stable refusal.
 *
 * Every P06 device payload arrives from the network, so a decode failure must be
 * a machine reason rather than a `ZodError` message a caller has to parse.
 */
export function decodeAutomationWire<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): AutomationWireDecodeResult<z.output<TSchema>> {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, value: Object.freeze(parsed.data) as z.output<TSchema> }
    : { ok: false, code: AUTOMATION_WIRE_INVALID_CODE };
}
