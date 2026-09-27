/**
 * P08 migration / adoption wire contract (`p08-cg-v1`).
 *
 * Frozen inputs: Contract Gate `p08-cg-v1` (control-plane commit `8352a7a`,
 * PR #27) and `docs/implementation/fixtures/p08-contracts-v1.json`.
 *
 * This module is the client's view of the adoption contract. It exists so a
 * local-only client can render the stage ladder, refuse an illegal transition,
 * and explain itself with no network at all.
 *
 * The client is NOT the authority. The control plane owns the stage, the
 * binding, and the credential label; every rule here is a *mirror* of a server
 * rule so the client can fail early and offline, never so the client can decide.
 * Two consequences are load-bearing:
 *
 * - The stage ladder is a total order and a request may only name the immediate
 *   successor. `POST .../bindings` accepts stage 0 and nothing else, so a client
 *   cannot fast-forward a workspace it never bound.
 * - Ownership is derived from the stage, never from the fact that someone signed
 *   in. That is the whole of F26-002: signing in, enrolling a device, or
 *   refreshing a token must not convert a local workspace, and the only way to
 *   guarantee that is for the client to have no code path that does it
 *   implicitly.
 *
 * No schema in this module has a field capable of carrying local content. There
 * is no prompt, no command, no file body, and no path — see
 * `P08_NEVER_UPLOADED_LOCAL_CONTENT` for the list this pins, and
 * `p08-automation-import.ts` for the import candidate shape, which is a
 * *description* of a local automation rather than its body.
 */

import { z } from "zod";

export const P08_ADOPTION_CONTRACT_VERSION = "p08-cg-v1" as const;

const MAX_REASON_CODE_LENGTH = 64;
const MAX_EXTERNAL_ID_LENGTH = 128;
const MAX_WORKSPACE_KEY_LENGTH = 256;
const MAX_APP_VERSION_LENGTH = 32;

const STABLE_REASON_CODE_PATTERN = new RegExp(`^[a-z][a-z0-9_]{0,${MAX_REASON_CODE_LENGTH - 1}}$`);

/**
 * Opaque-ID prefixes the adoption contract mints. The prefix is a wire namespace
 * and never an authorization signal.
 */
export const P08_ADOPTION_ID_PREFIXES = ["cmp", "wst", "ase", "rem", "org", "prj", "dvc"] as const;

export type P08AdoptionIdPrefix = (typeof P08_ADOPTION_ID_PREFIXES)[number];

const P08_OPAQUE_ID_PATTERN = /^[a-z][a-z0-9]*_[0-9a-f]{32}$/;

export function isP08OpaqueId(value: unknown, prefix: P08AdoptionIdPrefix): value is string {
  return (
    typeof value === "string" && P08_OPAQUE_ID_PATTERN.test(value) && value.startsWith(`${prefix}_`)
  );
}

export function p08OpaqueIdSchema(prefix: P08AdoptionIdPrefix): z.ZodType<string> {
  return z
    .string()
    .refine((value) => isP08OpaqueId(value, prefix), { message: `expected a ${prefix}_ Lumi ID` });
}

/** Bounded stable machine token. Reaches a durable event, so it can never carry content. */
export const p08ReasonCodeSchema = z
  .string()
  .max(MAX_REASON_CODE_LENGTH)
  .regex(STABLE_REASON_CODE_PATTERN, "expected a lowercase snake_case reason code");

export type P08ReasonCode = z.infer<typeof p08ReasonCodeSchema>;

// ---------------------------------------------------------------------------
// External workspace reference
// ---------------------------------------------------------------------------

/**
 * The whole of what the cloud learns about a local workspace: an opaque
 * installation identifier and an opaque workspace key.
 *
 * Neither may contain a path separator. That is not hygiene, it is the reason a
 * filesystem path, a directory listing, and a session body have no representation
 * at all — there is nothing to sanitize later because nothing was ever shaped to
 * hold one.
 */
export const p08ExternalWorkspaceRefSchema = z
  .object({
    installation_id: z
      .string()
      .min(16)
      .max(MAX_EXTERNAL_ID_LENGTH)
      .regex(/^[A-Za-z0-9._~-]+$/, "expected an opaque installation identifier")
      .refine(
        (value) => !value.includes("/") && !value.includes("\\"),
        "must not contain a path separator",
      ),
    workspace_key: z
      .string()
      .min(1)
      .max(MAX_WORKSPACE_KEY_LENGTH)
      .regex(/^[A-Za-z0-9._~-]+$/, "expected an opaque workspace key")
      .refine(
        (value) => !value.includes("/") && !value.includes("\\"),
        "must not contain a path separator",
      ),
  })
  .strict();

export type P08ExternalWorkspaceRef = z.infer<typeof p08ExternalWorkspaceRefSchema>;

// ---------------------------------------------------------------------------
// Stage ladder
// ---------------------------------------------------------------------------

/**
 * The ladder, in order. `local_unmanaged` is stage 0 and the only state that
 * needs no account, no device, and no network.
 */
export const P08_ADOPTION_STAGES = [
  "local_unmanaged",
  "account_optional",
  "device_enrolled",
  "workspace_bound",
  "managed_policy",
  "history_sync",
] as const;

export type P08AdoptionStage = (typeof P08_ADOPTION_STAGES)[number];

/** `history_sync` is stage 5. The switch is off; the client must not request it. */
export const P08_HISTORY_SYNC_STAGE_INDEX = 5;

export function p08AdoptionStageSchema(): z.ZodType<P08AdoptionStage> {
  return z.enum(P08_ADOPTION_STAGES);
}

/** Position of `stage` in the ladder, or `-1`. The ladder is a total order. */
export function p08StageIndex(stage: P08AdoptionStage): number {
  return P08_ADOPTION_STAGES.indexOf(stage);
}

/** The only legal forward move from `stage`, or `null` at the top of the ladder. */
export function p08NextStage(stage: P08AdoptionStage): P08AdoptionStage | null {
  return P08_ADOPTION_STAGES[p08StageIndex(stage) + 1] ?? null;
}

/**
 * Ownership. `OrgManaged` begins at `workspace_bound` and never precedes it.
 *
 * `Ownership::for_stage` on the server is called only from `apply_stage`, and
 * only for a stage the user explicitly requested. The client mirrors that
 * exactly: `ownershipForStage` takes the stage, not a session, not a token, and
 * not a device enrolment. There is deliberately no other way to obtain
 * `org_managed` here.
 */
export const P08_OWNERSHIP_VALUES = ["local_unmanaged", "org_managed"] as const;

export type P08Ownership = (typeof P08_OWNERSHIP_VALUES)[number];

export function ownershipForStage(stage: P08AdoptionStage): P08Ownership {
  return p08StageIndex(stage) >= p08StageIndex("workspace_bound")
    ? "org_managed"
    : "local_unmanaged";
}

// ---------------------------------------------------------------------------
// Credential mode
// ---------------------------------------------------------------------------

/**
 * Declared in escalation order, and rendered in that order, with the copying mode
 * carrying a warning tone. `local_credential` is both the default and the only
 * mode available without an explicit choice.
 */
export const P08_CREDENTIAL_MODES = [
  "local_credential",
  "metadata_only",
  "org_managed_credential",
] as const;

export type P08CredentialMode = (typeof P08_CREDENTIAL_MODES)[number];

export function p08CredentialModeSchema(): z.ZodType<P08CredentialMode> {
  return z.enum(P08_CREDENTIAL_MODES);
}

/** `org_managed_credential` is only meaningful once something org governs the workspace. */
export function credentialModeRequiresManaged(mode: P08CredentialMode): boolean {
  return mode === "org_managed_credential";
}

/** True when the mode runs inference on the control plane's behalf (i.e. stage 5 could run). */
export function credentialModeIsManaged(mode: P08CredentialMode): boolean {
  return mode !== "local_credential";
}

// ---------------------------------------------------------------------------
// Client compatibility
// ---------------------------------------------------------------------------

/**
 * A closed vocabulary of four. `Blocked` does not exist: a client is never
 * refused outright, and the worst answer still leaves local-only operation
 * available. Encoding that as a closed enum means a new failure mode has to be
 * added deliberately rather than appearing as an unhandled case.
 */
export const P08_COMPATIBILITY_VERDICTS = [
  "supported",
  "upgrade_required",
  "protocol_unsupported",
  "policy_schema_unsupported",
] as const;

export type P08CompatibilityVerdict = (typeof P08_COMPATIBILITY_VERDICTS)[number];

/** Verdict for the absence of an answer. Never a failure, never a block. */
export const P08_UNEVALUATED_VERDICT = "supported" as const;

export const p08CompatibilityPolicySchema = z
  .object({
    protocol_major: z.number().int().positive(),
    protocol_min: z.number().int().positive(),
    protocol_max: z.number().int().positive(),
    policy_schema_min: z.number().int().positive(),
    policy_schema_max: z.number().int().positive(),
    min_client_app_version: z.string().min(1).max(MAX_APP_VERSION_LENGTH),
    local_only_eligible: z.boolean(),
    history_sync_eligible: z.boolean(),
  })
  .strict();

export type P08CompatibilityPolicy = z.infer<typeof p08CompatibilityPolicySchema>;

/** What the client knows about itself, and is happy to echo. Contains no content. */
export const p08ClientFingerprintSchema = z
  .object({
    protocol_major: z.number().int().positive(),
    policy_schema_version: z.number().int().nonnegative(),
    app_version: z.string().min(1).max(MAX_APP_VERSION_LENGTH),
  })
  .strict();

export type P08ClientFingerprint = z.infer<typeof p08ClientFingerprintSchema>;

/**
 * Order matters, and it is the order of "can this be fixed at all": a client that
 * is both too new and carrying an unhonoured policy is reported as
 * `protocol_unsupported`, because no amount of re-issuing its policy fixes a
 * client this control plane cannot talk to, and a remediation that cannot work is
 * worse than none.
 *
 * Mirrors `CompatibilityVerdict::evaluate` on the server.
 */
export function evaluateP08Compatibility(
  policy: P08CompatibilityPolicy,
  fingerprint: P08ClientFingerprint,
): P08CompatibilityVerdict {
  if (
    fingerprint.protocol_major < policy.protocol_min ||
    fingerprint.protocol_major > policy.protocol_max
  ) {
    return "protocol_unsupported";
  }
  if (
    fingerprint.policy_schema_version < policy.policy_schema_min ||
    fingerprint.policy_schema_version > policy.policy_schema_max
  ) {
    return "policy_schema_unsupported";
  }
  if (compareP08AppVersions(fingerprint.app_version, policy.min_client_app_version) < 0) {
    return "upgrade_required";
  }
  return "supported";
}

/**
 * The degraded-mode guarantee.
 *
 * Local-only availability is `true` for EVERY verdict, including
 * `protocol_unsupported`, and it is deliberately NOT derived from the verdict.
 * Stage 0 is a first-class product state: an existing local user's agent keeps
 * running whether or not this control plane can evaluate it. The only thing a
 * degraded client loses is org policy, org credentials, and org budgets.
 */
export function localOnlyAvailable(
  _verdict: P08CompatibilityVerdict,
  policy: P08CompatibilityPolicy | undefined,
): boolean {
  // With no policy at all there is no platform statement to honour, and the
  // absence of an answer must not be read as a revocation.
  if (policy === undefined) return true;
  return policy.local_only_eligible;
}

/** Whether this client may hold a managed workspace at all. */
export function managedAllowed(verdict: P08CompatibilityVerdict): boolean {
  return verdict === "supported";
}

/** Stage 5 is requestable only when the platform says so AND the mode is managed. */
export function historySyncRequestable(
  policy: P08CompatibilityPolicy | undefined,
  mode: P08CredentialMode,
): boolean {
  if (policy === undefined) return false;
  if (!policy.history_sync_eligible) return false;
  return credentialModeIsManaged(mode);
}

// ---------------------------------------------------------------------------
// Adoption state
// ---------------------------------------------------------------------------

export const p08AdoptionStateSchema = z
  .object({
    adoption_state_id: p08OpaqueIdSchema("wst"),
    org_id: p08OpaqueIdSchema("org"),
    project_id: p08OpaqueIdSchema("prj").nullable(),
    device_id: p08OpaqueIdSchema("dvc").nullable(),
    external: p08ExternalWorkspaceRefSchema,
    stage: p08AdoptionStageSchema(),
    ownership: z.enum(P08_OWNERSHIP_VALUES),
    credential_mode: p08CredentialModeSchema(),
    version: z.number().int().positive(),
    reversion_count: z.number().int().nonnegative(),
  })
  .strict();

export type P08AdoptionState = z.infer<typeof p08AdoptionStateSchema>;

/**
 * What the client may put in an adoption request. Deliberately narrower than
 * `P08AdoptionState`: the client names the stage it wants and the reference it
 * holds, never `ownership`, `version`, or `org_id`. The server derives ownership
 * and owns the version, so a client that could set them would be a client that
 * could grant itself org ownership.
 */
export const p08StageRequestSchema = z
  .object({
    stage: p08AdoptionStageSchema(),
    external: p08ExternalWorkspaceRefSchema,
    credential_mode: p08CredentialModeSchema().optional(),
    expected_version: z.number().int().positive().optional(),
  })
  .strict();

export type P08StageRequest = z.infer<typeof p08StageRequestSchema>;

// ---------------------------------------------------------------------------
// Local transition validation
// ---------------------------------------------------------------------------

/**
 * Reasons the client refuses a stage change locally, before spending a round
 * trip. These are not server error codes and must never be reported as one: a
 * local refusal means the client could not construct a legal request.
 */
export const P08_LOCAL_REFUSAL_CODES = [
  "adoption_stage_not_successor",
  "adoption_stage_at_top",
  "adoption_rollback_is_the_only_way_back",
  "adoption_history_sync_not_available",
  "adoption_history_sync_requires_managed_credential",
  "adoption_binding_incomplete",
  "adoption_credential_mode_requires_managed",
  "adoption_local_only_available",
] as const;

export type P08LocalRefusalCode = (typeof P08_LOCAL_REFUSAL_CODES)[number];

export type P08StageTransition =
  | { readonly ok: true; readonly request: P08StageRequest }
  | { readonly ok: false; readonly code: P08LocalRefusalCode };

export interface P08StageTransitionInput {
  /** The stage the client currently believes it holds. */
  readonly current: P08AdoptionState;
  /** The stage the user explicitly asked for. */
  readonly requested: P08AdoptionStage;
  readonly mode: P08CredentialMode;
  readonly policy: P08CompatibilityPolicy | undefined;
  readonly verdict: P08CompatibilityVerdict;
  /** True when the project and device a managed stage needs are both present. */
  readonly bindingComplete: boolean;
}

/**
 * Build the request for one stage change, or explain why the client will not.
 *
 * This mirrors `AdoptionState::apply_stage` rule for rule:
 *
 * 1. Backwards is a rollback, not a step. A `requested` stage below `current` is
 *    refused with `adoption_rollback_is_the_only_way_back` rather than quietly
 *    walking down the ladder, because a decrementing wizard is how a workspace
 *    ends up reporting a stage the server never agreed to.
 * 2. One step at a time. Only the immediate successor is constructible.
 * 3. Stage 5 needs the platform switch and a managed credential mode.
 * 4. Managed stages need a complete binding, or the organization would be
 *    governing something it cannot address.
 * 5. The credential mode must fit the stage, on an unchanged-stage request too.
 *
 * Re-requesting the current stage with the same mode is `Unchanged` on the
 * server, so a resumed wizard is safe to replay; the client mirrors that by
 * returning a legal request rather than refusing.
 */
export function buildP08StageTransition(input: P08StageTransitionInput): P08StageTransition {
  const { current, requested, mode, policy, verdict, bindingComplete } = input;
  const currentIndex = p08StageIndex(current.stage);
  const requestedIndex = p08StageIndex(requested);

  if (requestedIndex > currentIndex + 1) {
    return { ok: false, code: "adoption_stage_not_successor" };
  }
  if (requestedIndex < currentIndex) {
    return { ok: false, code: "adoption_rollback_is_the_only_way_back" };
  }
  if (requestedIndex === currentIndex && mode === current.credential_mode) {
    // Replay of an unchanged stage. The server answers `Unchanged`; the client
    // must be able to send it, because a wizard resumed after a dropped response
    // has no other way to discover that it already applied.
    return {
      ok: true,
      request: Object.freeze({
        stage: requested,
        external: current.external,
        credential_mode: mode,
        expected_version: current.version,
      }),
    };
  }

  if (requested === "history_sync") {
    if (policy === undefined || !policy.history_sync_eligible) {
      return { ok: false, code: "adoption_history_sync_not_available" };
    }
    if (!credentialModeIsManaged(mode)) {
      return { ok: false, code: "adoption_history_sync_requires_managed_credential" };
    }
  }
  if (ownershipForStage(requested) === "org_managed" && !bindingComplete) {
    return { ok: false, code: "adoption_binding_incomplete" };
  }
  if (credentialModeRequiresManaged(mode) && ownershipForStage(requested) !== "org_managed") {
    return { ok: false, code: "adoption_credential_mode_requires_managed" };
  }
  if (!managedAllowed(verdict) && ownershipForStage(requested) === "org_managed") {
    return { ok: false, code: "adoption_local_only_available" };
  }

  return {
    ok: true,
    request: Object.freeze({
      stage: requested,
      external: current.external,
      credential_mode: mode,
      expected_version: current.version,
    }),
  };
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/**
 * A closed list of six keys. Unknown keys are rejected, not dropped: silently
 * dropping them would make the client look safe while it sent a prompt, and
 * rejecting them means a client that tries is visibly broken, which is the
 * outcome wanted during rollout.
 */
export const P08_TELEMETRY_KEYS = [
  "stage",
  "result",
  "reason_code",
  "protocol_major",
  "policy_schema_version",
  "app_version",
] as const;

export type P08TelemetryKey = (typeof P08_TELEMETRY_KEYS)[number];

/** `declined` is separate from `skipped`: a user who said no is a different signal. */
export const P08_TELEMETRY_RESULTS = [
  "started",
  "completed",
  "skipped",
  "failed",
  "declined",
  "rolled_back",
] as const;

export type P08TelemetryResult = (typeof P08_TELEMETRY_RESULTS)[number];

export const p08TelemetryReportSchema = z
  .object({
    stage: p08AdoptionStageSchema(),
    result: z.enum(P08_TELEMETRY_RESULTS),
    reason_code: p08ReasonCodeSchema.optional(),
    protocol_major: z.number().int().positive(),
    policy_schema_version: z.number().int().nonnegative(),
    app_version: z.string().min(1).max(MAX_APP_VERSION_LENGTH),
  })
  .strict();

export type P08TelemetryReport = z.infer<typeof p08TelemetryReportSchema>;

/**
 * A client-side probe for the closed key list. `p08-invariants.sh` asserts the
 * equivalent on the server table; this asserts it on the object a client builds,
 * so a future field cannot be added without failing a test here first.
 */
export function p08TelemetryUnknownKeys(report: Record<string, unknown>): readonly string[] {
  const allowed = new Set<string>(P08_TELEMETRY_KEYS);
  return Object.freeze(
    Object.keys(report)
      .filter((key) => !allowed.has(key))
      .sort(),
  );
}

// ---------------------------------------------------------------------------
// The privacy list
// ---------------------------------------------------------------------------

/**
 * What is never uploaded, in any stage, by any code path in this client.
 *
 * This is the structural form of FR-F26-003: the capability does not exist, so it
 * cannot be exercised by accident. The server's `p08-invariants.sh` asserts the
 * matching property on `adoption_stage_events`; this list is the client-side half
 * and is pinned by a test so a later phase that wants to add a field has to edit
 * it and defend the change.
 */
export const P08_NEVER_UPLOADED_LOCAL_CONTENT = Object.freeze([
  "api_keys",
  "provider_secrets",
  "historical_prompts",
  "historical_responses",
  "file_contents",
  "file_paths",
  "workspace_directory_listings",
  "automation_bodies",
  "mcp_credentials",
  "mcp_server_configuration",
] as const);

export type P08NeverUploadedLocalContent = (typeof P08_NEVER_UPLOADED_LOCAL_CONTENT)[number];

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/**
 * Compare two dotted app versions. Returns a negative number when `a` is older
 * than `b`, zero when equal, positive when newer.
 *
 * A hand-rolled comparison rather than a dependency: the shape is three numeric
 * components, and pulling a semver library in for it would add a transitive tree
 * to satisfy one comparison in one module. Non-numeric or missing components
 * compare as `0`, so a malformed version sorts as old rather than throwing —
 * failing toward "upgrade required" is the safe direction.
 */
export function compareP08AppVersions(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const l = Number.parseInt(left[index] ?? "0", 10);
    const r = Number.parseInt(right[index] ?? "0", 10);
    const lv = Number.isFinite(l) ? l : 0;
    const rv = Number.isFinite(r) ? r : 0;
    if (lv !== rv) return lv - rv;
  }
  return 0;
}
