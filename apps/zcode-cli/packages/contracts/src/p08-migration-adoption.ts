/**
 * P08 migration / adoption execution seam for zcode-cli (`p08-cg-v1`).
 *
 * Contract Gate `p08-cg-v1` (control-plane commit `8352a7a`, PR #27); wire
 * shapes from `docs/implementation/fixtures/p08-contracts-v1.json`.
 *
 * This module is the CLI-side view. It owns:
 * - the ten frozen route builders, one of which is outside the organization tree
 *   and unauthenticated by design;
 * - a host-owned transport port, so the CLI never speaks HTTP or holds a session
 *   token itself;
 * - the resumable wizard, which walks the stage ladder one explicit step at a
 *   time and can complete stage 0 with no network at all.
 *
 * It owns NO authority. The control plane derives ownership, owns the version,
 * and is the only thing that can say a workspace is org-managed. The rules in
 * `p08-migration-adoption.ts` are mirrors, present so the client can refuse an
 * illegal transition offline and never spend a round trip learning something it
 * already knows.
 *
 * Three mechanisms carry the load:
 *
 * 1. **No stage is skipped by uploading existing state.** There is no method that
 *    advances more than one stage, and no method that takes a stage argument
 *    other than the one the user just chose in this call. There is no code path
 *    from "the user signed in" to "the workspace is org-managed".
 * 2. **Every step is reversible.** `rollback()` is the only way back, and it
 *    takes no stage argument at all — a client cannot roll back "one step"
 *    because that is not a thing the contract has.
 * 3. **Nothing local is ever uploaded.** Every request body in this module is
 *    built from `P08StageRequest`, `P08AutomationImportCandidate`, or
 *    `P08TelemetryReport`, all three of which are `.strict()` closed shapes with
 *    no content field. The transport port takes those types, so there is no
 *    signature through which a prompt or a file body could be passed.
 */

import {
  buildP08StageTransition,
  evaluateP08Compatibility,
  isP08OpaqueId,
  localOnlyAvailable,
  p08NextStage,
  type P08AdoptionStage,
  type P08AdoptionState,
  type P08AutomationImportCandidate,
  type P08ClientFingerprint,
  type P08CompatibilityPolicy,
  type P08CompatibilityVerdict,
  type P08CredentialMode,
  type P08ExternalWorkspaceRef,
  type P08LocalRefusalCode,
  type P08StageRequest,
  type P08TelemetryReport,
} from "@zcode/shared";

export {
  P08_ADOPTION_CONTRACT_VERSION,
  P08_ADOPTION_ID_PREFIXES,
  P08_ADOPTION_STAGES,
  P08_COMPATIBILITY_VERDICTS,
  P08_CREDENTIAL_MODES,
  P08_FORBIDDEN_CANDIDATE_FIELDS,
  P08_HISTORY_SYNC_STAGE_INDEX,
  P08_IMPORT_CONFLICT_CODES,
  P08_IMPORT_MAX_CANDIDATES,
  P08_IMPORT_MODEL_CAPABILITY_CHECK,
  P08_IMPORT_SCHEDULE_KINDS,
  P08_LOCAL_REFUSAL_CODES,
  P08_NEVER_UPLOADED_LOCAL_CONTENT,
  P08_OWNERSHIP_VALUES,
  P08_TELEMETRY_KEYS,
  P08_TELEMETRY_RESULTS,
  buildP08ImportCandidates,
  buildP08StageTransition,
  compareP08AppVersions,
  credentialModeIsManaged,
  credentialModeRequiresManaged,
  evaluateP08Compatibility,
  historySyncRequestable,
  indexP08ImportConflicts,
  isP08OpaqueId,
  localOnlyAvailable,
  managedAllowed,
  ownershipForStage,
  p08AdoptionStateSchema,
  p08AutomationImportCandidateSchema,
  p08AutomationImportConflictSchema,
  p08AutomationImportPreviewSchema,
  p08ClientFingerprintSchema,
  p08CompatibilityPolicySchema,
  p08CredentialModeSchema,
  p08ExternalWorkspaceRefSchema,
  p08ImportCredentialModeMismatch,
  p08ImportPreviewIsActionable,
  p08NextStage,
  p08StageIndex,
  p08TelemetryReportSchema,
  p08TelemetryUnknownKeys,
  type P08AdoptionIdPrefix,
  type P08AdoptionStage,
  type P08AdoptionState,
  type P08AutomationImportCandidate,
  type P08AutomationImportConflict,
  type P08AutomationImportPreview,
  type P08ClientFingerprint,
  type P08CompatibilityPolicy,
  type P08CompatibilityVerdict,
  type P08CredentialMode,
  type P08ExternalWorkspaceRef,
  type P08ImportScheduleKind,
  type P08LocalRefusalCode,
  type P08NeverUploadedLocalContent,
  type P08Ownership,
  type P08ReasonCode,
  type P08StageRequest,
  type P08TelemetryKey,
  type P08TelemetryReport,
  type P08TelemetryResult,
} from "@zcode/shared";

/** Every P08 route lives under the versioned `/api/v1` prefix. */
export const P08_ADOPTION_API_BASE_PATH = "/api/v1" as const;

export type P08AdoptionRoute =
  | "compatibility"
  | "adoption"
  | "bindings"
  | "binding"
  | "rollback"
  | "remediations"
  | "resolve"
  | "telemetry"
  | "import-preview";

/** Thrown by every local refusal. `code` is a stable machine reason. */
export class P08AdoptionError extends Error {
  readonly code: P08LocalRefusalCode;
  readonly stage: P08AdoptionStage | undefined;

  constructor(code: P08LocalRefusalCode, message: string, stage?: P08AdoptionStage) {
    super(message);
    this.name = "P08AdoptionError";
    this.code = code;
    this.stage = stage;
  }
}

export function isP08AdoptionError(error: unknown): error is P08AdoptionError {
  if (error instanceof P08AdoptionError) return true;
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "P08AdoptionError" && typeof candidate.code === "string";
}

/**
 * Build a P08 route path.
 *
 * Each identifier is validated inside the branch that uses it, so a route never
 * demands an ID it does not carry — `compatibility` takes none at all, and
 * requiring one would make the one unauthenticated route the only awkward one to
 * call. Every segment that IS an identifier is validated before interpolation, so
 * no caller can traverse a path, inject a query, or smuggle a credential into a
 * URL.
 *
 * The workspace reference is NEVER a path segment — it travels in a request
 * body, because it is opaque caller data rather than an identifier, and a body
 * is the only place it belongs.
 */
export function buildP08AdoptionPath(
  route: P08AdoptionRoute,
  ids: { readonly orgId?: string; readonly stateId?: string; readonly remediationId?: string } = {},
): string {
  const base = P08_ADOPTION_API_BASE_PATH;
  switch (route) {
    case "compatibility":
      // Deliberately outside the organization tree and unauthenticated: a local
      // client that has never signed in must be able to ask what this control
      // plane supports *before* deciding whether to create an account at all.
      return `${base}/compatibility`;
    case "adoption":
      return `${base}/orgs/${requireOpaqueId(ids.orgId, "org", route)}/adoption`;
    case "bindings":
      return `${base}/orgs/${requireOpaqueId(ids.orgId, "org", route)}/adoption/bindings`;
    case "binding":
      return `${base}/orgs/${requireOpaqueId(ids.orgId, "org", route)}/adoption/bindings/${requireOpaqueId(ids.stateId, "wst", route)}`;
    case "rollback":
      return `${base}/orgs/${requireOpaqueId(ids.orgId, "org", route)}/adoption/bindings/${requireOpaqueId(ids.stateId, "wst", route)}/rollback`;
    case "remediations":
      return `${base}/orgs/${requireOpaqueId(ids.orgId, "org", route)}/adoption/remediations`;
    case "resolve":
      return `${base}/orgs/${requireOpaqueId(ids.orgId, "org", route)}/adoption/remediations/${requireOpaqueId(ids.remediationId, "rem", route)}/resolve`;
    case "telemetry":
      return `${base}/orgs/${requireOpaqueId(ids.orgId, "org", route)}/adoption/telemetry`;
    case "import-preview":
      return `${base}/orgs/${requireOpaqueId(ids.orgId, "org", route)}/adoption/automation-imports/preview`;
  }
}

/** `GET /api/v1/compatibility` — the only unauthenticated route P08 adds. */
export const P08_COMPATIBILITY_ROUTE = buildP08AdoptionPath("compatibility");

export interface P08AdoptionCompatibilityResponse {
  readonly policy: P08CompatibilityPolicy;
  /** Absent when the caller sent no fingerprint. The endpoint may omit it. */
  readonly verdict?: P08CompatibilityVerdict;
  readonly stages: readonly P08AdoptionStage[];
}

/**
 * Host-owned transport for the ten P08 routes.
 *
 * The host owns the session token, CSRF, TLS, retry, and reconnection.
 * Implementations decode with the exported schemas and surface a
 * `P08AdoptionError` for a local refusal; they never synthesize an adoption
 * state, a stage, or an ownership label locally.
 *
 * Every mutating input is a closed `P08*` type. That is the structural reason a
 * local secret cannot be uploaded through this port: there is no parameter
 * through which one could be passed.
 */
export interface P08AdoptionTransport {
  /** `GET /api/v1/compatibility`. The one route that works with no session. */
  getCompatibility(input: {
    readonly fingerprint?: P08ClientFingerprint;
    readonly signal?: AbortSignal;
  }): Promise<P08AdoptionCompatibilityResponse>;
  /** `GET .../adoption` — the whole answer in one call. */
  getAdoption(input: { readonly orgId: string; readonly signal?: AbortSignal }): Promise<unknown>;
  /** `POST .../adoption/bindings` — stage 0 only, or a resume of stage 0. */
  createBinding(input: {
    readonly orgId: string;
    readonly body: P08StageRequest;
    readonly idempotencyKey: string;
    readonly signal?: AbortSignal;
  }): Promise<P08AdoptionState>;
  /**
   * `PATCH .../adoption/bindings/{id}` — advance exactly one stage, or change
   * only the credential mode.
   *
   * This is the one P08 route that is not a POST, which is why
   * `HttpClientMethod` in the HTTP client port grew a `PATCH` member.
   */
  advanceBinding(input: {
    readonly orgId: string;
    readonly stateId: string;
    readonly body: P08StageRequest;
    readonly idempotencyKey: string;
    readonly signal?: AbortSignal;
  }): Promise<P08AdoptionState>;
  /** `POST .../adoption/bindings/{id}/rollback` — back to `local_unmanaged`. */
  rollbackBinding(input: {
    readonly orgId: string;
    readonly stateId: string;
    readonly idempotencyKey: string;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly state: P08AdoptionState; readonly local_data_modified: false }>;
  reportTelemetry(input: {
    readonly orgId: string;
    readonly body: P08TelemetryReport;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
  /** `POST .../adoption/automation-imports/preview`. Creates nothing. */
  previewAutomationImport(input: {
    readonly orgId: string;
    readonly candidates: readonly P08AutomationImportCandidate[];
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
}

/**
 * The client's own compatibility answer, computed with no network.
 *
 * Stage 0 must work offline, so this never throws and treats a missing policy or
 * a missing fingerprint as the permissive verdict. The absence of an answer is
 * not a revocation: a client that cannot reach a control plane must still open
 * its old local sessions.
 *
 * `localOnlyAvailable` is deliberately not derived from the verdict. It is
 * `true` for every verdict including `protocol_unsupported`, because stage 0 is a
 * first-class product state and the only thing a degraded client loses is org
 * policy, org credentials, and org budgets.
 */
export function resolveOfflineCompatibility(
  policy: P08CompatibilityPolicy | undefined,
  fingerprint: P08ClientFingerprint | undefined,
): {
  readonly verdict: P08CompatibilityVerdict;
  readonly localOnlyAvailable: boolean;
  readonly managedAllowed: boolean;
} {
  const verdict: P08CompatibilityVerdict =
    policy === undefined || fingerprint === undefined
      ? "supported"
      : evaluateP08Compatibility(policy, fingerprint);
  return Object.freeze({
    verdict,
    localOnlyAvailable: localOnlyAvailable(verdict, policy),
    managedAllowed: verdict === "supported",
  });
}

export interface P08AdoptionWizardOptions {
  readonly transport: P08AdoptionTransport;
  /** Stable local alias for this workspace. Never a path. */
  readonly workspaceKey: string;
  /** Opaque installation identifier. */
  readonly installationId: string;
  /** Monotonic counter for `Idempotency-Key`. Injected so tests are deterministic. */
  readonly nextIdempotencyKey: () => string;
  readonly fingerprint?: P08ClientFingerprint;
}

/**
 * The resumable wizard for one local workspace.
 *
 * It holds no authority: every method builds a closed request, hands it to the
 * transport, and adopts whatever the server answers. If the server and the client
 * ever disagree about a rule, the server wins, because the client's copy of the
 * rule only decides whether to spend a round trip.
 *
 * Resumability comes from two things: every mutating call is idempotent on the
 * server against a client-supplied key, and `advance` reads the stage from the
 * state the server last reported rather than from a local counter. A wizard
 * resumed after a dropped response re-sends the same stage and learns `Unchanged`
 * instead of double-applying.
 */
export class P08AdoptionWizard {
  readonly #transport: P08AdoptionTransport;
  readonly #external: P08ExternalWorkspaceRef;
  readonly #nextIdempotencyKey: () => string;
  readonly #fingerprint: P08ClientFingerprint | undefined;
  #state: P08AdoptionState | undefined;

  constructor(options: P08AdoptionWizardOptions) {
    this.#transport = options.transport;
    this.#external = Object.freeze({
      installation_id: options.installationId,
      workspace_key: options.workspaceKey,
    });
    this.#nextIdempotencyKey = options.nextIdempotencyKey;
    this.#fingerprint = options.fingerprint;
  }

  get state(): P08AdoptionState | undefined {
    return this.#state;
  }

  get external(): P08ExternalWorkspaceRef {
    return this.#external;
  }

  /**
   * Stage 0 needs no account, no device, and no network. This returns the local
   * answer without touching the transport, which is what makes "the client starts
   * normally with no account and no network" a structural property rather than a
   * promise.
   */
  localStage0(): { readonly stage: P08AdoptionStage; readonly ownership: "local_unmanaged" } {
    return Object.freeze({ stage: "local_unmanaged", ownership: "local_unmanaged" });
  }

  /**
   * Ask the control plane what it supports. Optional by construction: a failure
   * here returns `undefined` rather than throwing, so a wizard racing a cold
   * network can still proceed locally. Compatibility is a disclosure, not a gate.
   */
  async checkCompatibility(
    options?: { readonly signal?: AbortSignal },
  ): Promise<P08AdoptionCompatibilityResponse | undefined> {
    try {
      return await this.#transport.getCompatibility({
        ...(this.#fingerprint === undefined ? {} : { fingerprint: this.#fingerprint }),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch {
      return undefined;
    }
  }

  /**
   * Adopt the workspace at stage 0, or resume a stage-0 binding whose previous
   * response was lost. `POST .../bindings` accepts stage 0 and nothing else, so a
   * client that tried to fast-forward would be refused by the server; refusing it
   * here costs no round trip.
   */
  async begin(input: {
    readonly orgId: string;
    readonly mode?: P08CredentialMode;
    readonly signal?: AbortSignal;
  }): Promise<P08AdoptionState> {
    const mode = input.mode ?? "local_credential";
    if (mode !== "local_credential" && mode !== "metadata_only") {
      throw new P08AdoptionError(
        "adoption_credential_mode_requires_managed",
        "stage 0 has no organization to hold a managed credential",
        "local_unmanaged",
      );
    }
    const state = await this.#transport.createBinding({
      orgId: input.orgId,
      body: Object.freeze({
        stage: "local_unmanaged" as const,
        external: this.#external,
        credential_mode: mode,
      }),
      idempotencyKey: this.#nextIdempotencyKey(),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    this.#state = state;
    return state;
  }

  /**
   * Advance exactly one stage. `stage` is what the user just chose; this method
   * never picks a stage on the user's behalf and never walks more than one step.
   */
  async advance(input: {
    readonly orgId: string;
    readonly stage: P08AdoptionStage;
    readonly mode?: P08CredentialMode;
    readonly policy?: P08CompatibilityPolicy;
    readonly bindingComplete?: boolean;
    readonly signal?: AbortSignal;
  }): Promise<P08AdoptionState> {
    const current = this.#state;
    if (current === undefined) {
      throw new P08AdoptionError(
        "adoption_stage_not_successor",
        "begin must succeed before any stage can advance",
        "local_unmanaged",
      );
    }
    const mode = input.mode ?? current.credential_mode;
    const compatibility = resolveOfflineCompatibility(input.policy, this.#fingerprint);
    const transition = buildP08StageTransition({
      current,
      requested: input.stage,
      mode,
      policy: input.policy,
      verdict: compatibility.verdict,
      bindingComplete: input.bindingComplete ?? false,
    });
    if (!transition.ok) {
      throw new P08AdoptionError(
        transition.code,
        `stage ${input.stage} is not reachable from ${current.stage}`,
        current.stage,
      );
    }
    const state = await this.#transport.advanceBinding({
      orgId: input.orgId,
      stateId: current.adoption_state_id,
      body: transition.request,
      idempotencyKey: this.#nextIdempotencyKey(),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    this.#state = state;
    return state;
  }

  /**
   * Return to `local_unmanaged`.
   *
   * This is the only way back, it takes no stage argument, and the response's
   * `local_data_modified: false` is a structural claim rather than a promise: the
   * control plane has no path to the user's machine, so nothing could have
   * modified local data.
   */
  async rollback(input: {
    readonly orgId: string;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly state: P08AdoptionState; readonly local_data_modified: false }> {
    const current = this.#state;
    if (current === undefined) {
      throw new P08AdoptionError(
        "adoption_rollback_is_the_only_way_back",
        "there is no binding to roll back",
        "local_unmanaged",
      );
    }
    if (current.stage === "local_unmanaged") {
      throw new P08AdoptionError(
        "adoption_rollback_is_the_only_way_back",
        "the workspace is already local and unmanaged",
        "local_unmanaged",
      );
    }
    const result = await this.#transport.rollbackBinding({
      orgId: input.orgId,
      stateId: current.adoption_state_id,
      idempotencyKey: this.#nextIdempotencyKey(),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    this.#state = result.state;
    return result;
  }

  /**
   * The stage one explicit step ahead, or `null` at the top of the ladder. Before
   * `begin` this is `account_optional`, because that is the first step a user can
   * choose once a binding exists.
   */
  nextStage(): P08AdoptionStage | null {
    return this.#state === undefined ? "account_optional" : p08NextStage(this.#state.stage);
  }
}

/**
 * Stage 5 is refused locally while the platform says the switch is off, so the
 * wizard never constructs the request and the UI never offers an affordance that
 * cannot work. `p08-cg-v1` refuses it on the server too.
 */
export function assertP08StageRequestable(
  stage: P08AdoptionStage,
  policy: P08CompatibilityPolicy | undefined,
  mode: P08CredentialMode,
): void {
  if (stage !== "history_sync") return;
  if (policy === undefined || !policy.history_sync_eligible) {
    throw new P08AdoptionError(
      "adoption_history_sync_not_available",
      "history sync is switched off",
      stage,
    );
  }
  if (mode === "local_credential") {
    throw new P08AdoptionError(
      "adoption_history_sync_requires_managed_credential",
      "history sync runs on managed inference",
      stage,
    );
  }
}

function requireOpaqueId(
  value: string | undefined,
  prefix: "org" | "wst" | "rem",
  route: P08AdoptionRoute,
): string {
  if (isP08OpaqueId(value, prefix)) return value;
  throw new P08AdoptionError(
    "adoption_stage_not_successor",
    `P08 route ${route} requires a ${prefix}_ opaque ID`,
  );
}
