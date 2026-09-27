/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice. */

/**
 * P06 leased-automation managed-inference correlation.
 *
 * P05's `ManagedRunContext` answers "which run is this request for?". P06 needs
 * the stronger question: "which occurrence ATTEMPT, under which server lease
 * fence, is this request for?". An automation can be claimed, started, and
 * settled more than once over its lifetime, so a run ID alone is not enough to
 * make a model request and its tool decisions attributable to exactly one
 * occurrence attempt. `AutomationManagedRunContext` adds that axis.
 *
 * Invariants:
 * - The context is derived from a server-issued `AutomationStartGrant`, never
 *   from model output, a local automation ID, or a local run ID. In particular
 *   the local scheduler's colon-delimited `${automationId}:${scheduledAt}` run
 *   IDs are not wire identity and are refused here.
 * - The raw lease token is NEVER part of this context, its serialization, or its
 *   correlation headers. Only the non-secret fence travels with a request.
 * - Every P05 field keeps its existing validation and normalization. This module
 *   composes `createManagedRunContext`; it does not re-implement it, and it does
 *   not weaken the fail-closed approval behaviour that seam already provides.
 *
 * Contract: `p06-automation-lease-v1`, Contract Gate `p06-cg-v1`, `P06-CR-001`.
 */

import {
  LUMI_MANAGED_CORRELATION_HEADERS,
  createManagedRunContext,
  createManagedRunHeaders,
  isLumiOpaqueId,
  normalizeLumiOpaqueId,
  type LumiManagedRequestAuthSource,
  type LumiManagedRequestAuthSourceInput,
  type LumiManagedRequestAuthSourceInputWithContext,
  type LumiOpaqueIdPrefix,
  type ManagedRunContext,
  type ManagedRunContextInput,
} from "./lumi-managed-inference.js";

/**
 * Structural view of the P06 `AutomationStartGrant` wire shape.
 *
 * Declared structurally rather than imported from the wire-schema package so
 * this provider seam keeps its existing standalone build boundary: `@zcode/shared`
 * exposes zod-derived types, and pulling those sources into the provider program
 * would widen its compiler options. The shared decoder output satisfies this
 * shape, and `createAutomationManagedRunContextFromGrant` re-validates every
 * field through the P05/P06 opaque-ID validator, so structural typing cannot
 * weaken validation.
 */
export interface LumiAutomationStartGrantRef {
  readonly occurrence_id: string;
  readonly attempt: number;
  readonly run_id: string;
  readonly agent_session_id: string;
  readonly lease_id: string;
  readonly lease_version: number;
  readonly lease_fence: number;
}

/** Structural view of the P06 `AutomationOccurrenceRef` wire shape. */
export interface LumiAutomationOccurrenceRefLike {
  readonly occurrence_id: string;
  readonly automation_id: string;
  readonly attempt: number;
  readonly off_peak_mode: LumiAutomationOffPeakMode;
  readonly policy_snapshot_id: string;
  readonly policy_version: number;
}

/**
 * P06 automation correlation headers. Same caveat as the P05 set: they are
 * diagnostic/routing inputs only. The control plane re-derives the principal,
 * device, policy, entitlement, and lease authority from its authenticated device
 * token, so a spoofed header can never grant authority.
 */
export const LUMI_AUTOMATION_CORRELATION_HEADERS = Object.freeze({
  occurrenceId: "X-Lumi-Automation-Occurrence-ID",
  automationId: "X-Lumi-Automation-ID",
  occurrenceAttempt: "X-Lumi-Automation-Attempt",
  leaseVersion: "X-Lumi-Automation-Lease-Version",
  leaseFence: "X-Lumi-Automation-Lease-Fence",
  offPeakMode: "X-Lumi-Automation-Off-Peak-Mode",
  policySnapshotId: "X-Lumi-Policy-Snapshot-ID",
  policyVersion: "X-Lumi-Policy-Version",
});

export type LumiAutomationCorrelationHeader =
  (typeof LUMI_AUTOMATION_CORRELATION_HEADERS)[keyof typeof LUMI_AUTOMATION_CORRELATION_HEADERS];

/** Off-peak is a distinct execution class, never a cron-shaped mode flag. */
export type LumiAutomationOffPeakMode = "normal" | "off_peak";

/**
 * The P05 run context plus the leased-automation axes. `runId` and
 * `agentSessionId` are the server-created P05 values from the start grant, so
 * this type cannot be constructed for an occurrence the server has not linked.
 */
export interface AutomationManagedRunContext extends ManagedRunContext {
  readonly occurrenceId: string;
  readonly automationId: string;
  readonly occurrenceAttempt: number;
  readonly leaseId: string;
  readonly leaseVersion: number;
  readonly leaseFence: number;
  readonly offPeakMode: LumiAutomationOffPeakMode;
  readonly policySnapshotId: string;
  readonly policyVersion: number;
}

export interface AutomationManagedRunContextInput extends ManagedRunContextInput {
  readonly occurrenceId: string;
  readonly automationId: string;
  readonly occurrenceAttempt: number;
  readonly leaseId: string;
  readonly leaseVersion: number;
  readonly leaseFence: number;
  readonly offPeakMode: LumiAutomationOffPeakMode;
  readonly policySnapshotId: string;
  readonly policyVersion: number;
}

/** Protocol-shaped, snake_case projection. Never includes any lease credential. */
export interface SerializedAutomationManagedRunContext {
  readonly org_id: string;
  readonly project_id: string;
  readonly device_id: string;
  readonly agent_session_id: string;
  readonly run_id: string;
  readonly agent_definition_id: string;
  readonly agent_definition_version: number;
  readonly request_id: string;
  readonly external_id?: string;
  readonly execution_mode: "managed" | "local_only";
  readonly occurrence_id: string;
  readonly automation_id: string;
  readonly occurrence_attempt: number;
  readonly lease_id: string;
  readonly lease_version: number;
  readonly lease_fence: number;
  readonly off_peak_mode: LumiAutomationOffPeakMode;
  readonly policy_snapshot_id: string;
  readonly policy_version: number;
}

const P06_PREFIX: Record<"occ" | "aut" | "lse" | "pol", LumiOpaqueIdPrefix> = {
  occ: "occ",
  aut: "aut",
  lse: "lse",
  pol: "pol",
};

const P06_SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;

/**
 * Build the automation-augmented run context.
 *
 * `runId` / `agentSessionId` are validated with the SAME P05 validator as any
 * other managed run, so a locally generated run ID such as
 * `aut_...:1784000000000` is rejected at the boundary instead of reaching the
 * control plane as fake wire identity.
 */
export function createAutomationManagedRunContext(
  input: AutomationManagedRunContextInput,
): AutomationManagedRunContext {
  const base = createManagedRunContext(input);
  return Object.freeze({
    ...base,
    occurrenceId: normalizeP06Id(input.occurrenceId, "occ"),
    automationId: normalizeP06Id(input.automationId, "aut"),
    occurrenceAttempt: normalizeCounter(input.occurrenceAttempt, "occurrence attempt"),
    leaseId: normalizeP06Id(input.leaseId, "lse"),
    leaseVersion: normalizeCounter(input.leaseVersion, "lease version"),
    leaseFence: normalizeCounter(input.leaseFence, "lease fence"),
    offPeakMode: normalizeOffPeakMode(input.offPeakMode),
    policySnapshotId: normalizeP06Id(input.policySnapshotId, "pol"),
    policyVersion: normalizeCounter(input.policyVersion, "policy version"),
  });
}

/**
 * Derive the automation context from a server start grant plus the P05
 * correlation axes the host already resolved.
 *
 * `runId` and `agentSessionId` are NOT accepted from the caller: the grant is
 * the only accepted source of the P05 run link, so a host cannot invent one (or
 * substitute a colon-delimited local run ID) before the server has created it.
 */
export function createAutomationManagedRunContextFromGrant(input: {
  readonly grant: LumiAutomationStartGrantRef;
  readonly occurrence: LumiAutomationOccurrenceRefLike;
  readonly managed: Omit<ManagedRunContextInput, "runId" | "agentSessionId">;
  readonly deviceId: string;
}): AutomationManagedRunContext {
  const { grant, occurrence, managed, deviceId } = input;
  if (grant.occurrence_id !== occurrence.occurrence_id) {
    throw new Error("Lumi automation start grant is for another occurrence.");
  }
  if (grant.attempt !== occurrence.attempt) {
    throw new Error("Lumi automation start grant is for another attempt.");
  }
  if (grant.lease_fence < 1 || grant.lease_version < 1) {
    throw new Error("Lumi automation start grant fence is invalid.");
  }
  return createAutomationManagedRunContext({
    ...managed,
    runId: grant.run_id,
    agentSessionId: grant.agent_session_id,
    deviceId,
    occurrenceId: grant.occurrence_id,
    automationId: occurrence.automation_id,
    occurrenceAttempt: grant.attempt,
    leaseId: grant.lease_id,
    leaseVersion: grant.lease_version,
    leaseFence: grant.lease_fence,
    offPeakMode: occurrence.off_peak_mode,
    policySnapshotId: occurrence.policy_snapshot_id,
    policyVersion: occurrence.policy_version,
  });
}

export function serializeAutomationManagedRunContext(
  input: AutomationManagedRunContextInput,
): SerializedAutomationManagedRunContext {
  const context = createAutomationManagedRunContext(input);
  return Object.freeze({
    org_id: context.organizationId,
    project_id: context.projectId,
    device_id: context.deviceId,
    agent_session_id: context.agentSessionId,
    run_id: context.runId,
    agent_definition_id: context.agentDefinitionId,
    agent_definition_version: context.agentDefinitionVersion,
    request_id: context.requestId,
    ...(context.externalId === undefined ? {} : { external_id: context.externalId }),
    execution_mode: context.executionMode,
    occurrence_id: context.occurrenceId,
    automation_id: context.automationId,
    occurrence_attempt: context.occurrenceAttempt,
    lease_id: context.leaseId,
    lease_version: context.leaseVersion,
    lease_fence: context.leaseFence,
    off_peak_mode: context.offPeakMode,
    policy_snapshot_id: context.policySnapshotId,
    policy_version: context.policyVersion,
  });
}

/** P05 correlation headers plus the P06 occurrence/lease/policy axes. */
export function createAutomationManagedRunHeaders(
  input: AutomationManagedRunContextInput,
): Readonly<Record<string, string>> {
  const context = createAutomationManagedRunContext(input);
  return Object.freeze({
    ...createManagedRunHeaders(input),
    [LUMI_AUTOMATION_CORRELATION_HEADERS.occurrenceId]: context.occurrenceId,
    [LUMI_AUTOMATION_CORRELATION_HEADERS.automationId]: context.automationId,
    [LUMI_AUTOMATION_CORRELATION_HEADERS.occurrenceAttempt]: String(context.occurrenceAttempt),
    [LUMI_AUTOMATION_CORRELATION_HEADERS.leaseVersion]: String(context.leaseVersion),
    [LUMI_AUTOMATION_CORRELATION_HEADERS.leaseFence]: String(context.leaseFence),
    [LUMI_AUTOMATION_CORRELATION_HEADERS.offPeakMode]: context.offPeakMode,
    [LUMI_AUTOMATION_CORRELATION_HEADERS.policySnapshotId]: context.policySnapshotId,
    [LUMI_AUTOMATION_CORRELATION_HEADERS.policyVersion]: String(context.policyVersion),
  });
}

/**
 * Per-run auth source for an automation run.
 *
 * The session credential is captured in a closure exactly as the P05 seam does,
 * so the returned source exposes no enumerable credential and the occurrence
 * fence cannot smuggle one into a header. The request credential is resolved
 * only while a physical model request is prepared.
 */
export function createAutomationManagedRequestAuthSource(
  input: LumiManagedRequestAuthSourceInputWithContext & {
    readonly context: AutomationManagedRunContextInput;
  },
): LumiManagedRequestAuthSource {
  const context = createAutomationManagedRunContext(input.context);
  if (context.executionMode !== "managed") {
    throw new Error("Automation managed inference auth requires a managed run context.");
  }
  const tokenSource = input.sessionToken;
  const headers = createAutomationManagedRunHeaders(input.context);
  return Object.freeze({
    resolve: async (_resolveInput?: LumiManagedRequestAuthSourceInput) => {
      const sessionToken = (
        typeof tokenSource === "function" ? await tokenSource() : tokenSource
      ).trim();
      if (sessionToken.length === 0) {
        throw new Error("Lumi session credential is invalid.");
      }
      return Object.freeze({ apiKey: sessionToken, headers: { ...headers } });
    },
  });
}

/**
 * Refuse a correlation value that could only have come from a local scheduler.
 * Exported so the host can assert this explicitly at its own boundary rather
 * than discovering the problem as a control-plane rejection.
 */
export function isServerMintedLumiRunId(value: unknown): value is string {
  return isLumiOpaqueId(value, "run");
}

export { LUMI_MANAGED_CORRELATION_HEADERS };

function normalizeP06Id(value: string, prefix: keyof typeof P06_PREFIX): string {
  return normalizeLumiOpaqueId(value, P06_PREFIX[prefix]);
}

function normalizeCounter(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > P06_SAFE_INTEGER_MAX) {
    throw new Error(`Lumi automation ${label} is invalid.`);
  }
  return value;
}

function normalizeOffPeakMode(value: LumiAutomationOffPeakMode): LumiAutomationOffPeakMode {
  if (value === "normal" || value === "off_peak") return value;
  throw new Error("Lumi automation off-peak mode is invalid.");
}
