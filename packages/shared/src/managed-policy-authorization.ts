/**
 * P05-INT-04 — fail-closed managed policy authorization.
 *
 * Every browser and computer execution seam resolves its decision through
 * `authorizeBrowserComputerAction` so the refusal semantics cannot drift between
 * the agent-side broker, the desktop host bridge, and the computer-use broker.
 *
 * Refuse by default: a managed request with no gate, an unresolvable context, a
 * transport failure, a malformed response, an expired policy, or a pending
 * approval all deny. A caller with no managed context is allowed only as
 * `local_personal`, which never claims managed authorization.
 *
 * Contract: `p05-browser-computer-v1`, Contract Gate `p05-cg-v1`.
 */

import {
  isManagedPolicyContext,
  type BrowserComputerPolicyGate,
  type ManagedPolicyDecision,
  type ManagedPolicyFailureCode,
  type ManagedPolicyAuthorization,
  type ManagedPolicyRequest,
  type ManagedPolicyState,
  type ManagedPolicySurface,
} from "./p05-browser-computer-policy.js";

const MAX_ID_LENGTH = 256;
const MAX_FINGERPRINT_LENGTH = 256;
const MAX_SUMMARY_LENGTH = 1_024;
const MAX_REASON_LENGTH = 256;
const MAX_CAPABILITY_IDS = 64;

/** Reject C0 controls, DEL, and C1 controls so policy metadata stays printable. */
function isSafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return false;
  }
  return true;
}

function isBoundedText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max && isSafeText(value)
  );
}

/** Summaries are bounded metadata; PEM-shaped payloads are refused outright. */
function isSummaryText(value: unknown): value is string {
  return (
    isBoundedText(value, MAX_SUMMARY_LENGTH) &&
    !(value as string).includes("-----BEGIN") &&
    !(value as string).includes("-----END")
  );
}

function deny(code: ManagedPolicyFailureCode, message: string): ManagedPolicyAuthorization {
  return { allowed: false, code, message };
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readInteger(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  }
  return undefined;
}

function parseTimestamp(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function isCapabilityList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_CAPABILITY_IDS &&
    value.every((entry) => isBoundedText(entry, MAX_ID_LENGTH))
  );
}

function isDecision(value: string | undefined): value is ManagedPolicyDecision {
  return (
    value === "allow" ||
    value === "deny" ||
    value === "require_session_approval" ||
    value === "require_per_use_approval"
  );
}

function isPolicyState(value: string | undefined): value is ManagedPolicyState {
  return (
    value === "ok" ||
    value === "missing" ||
    value === "schema_unsupported" ||
    value === "expired" ||
    value === "unavailable"
  );
}

function isSurface(value: string | undefined): value is ManagedPolicySurface {
  return value === "browser" || value === "computer";
}

/**
 * Validate an untrusted gate response.
 *
 * Only an exact, current `allow` that is bound to this run, tool call, tool
 * identity, tool fingerprint, and invocation fingerprint is executable.
 * Approval requirements are returned as failures on purpose so a caller can
 * never mistake "needs approval" for authorization.
 */
export function validateManagedPolicyEvaluation(
  request: ManagedPolicyRequest,
  value: unknown,
  now: Date = new Date(),
): ManagedPolicyAuthorization {
  if (
    !isBoundedText(request.sessionId, MAX_ID_LENGTH) ||
    !isBoundedText(request.workspaceKey, MAX_ID_LENGTH) ||
    !isBoundedText(request.requestId, MAX_ID_LENGTH) ||
    !isBoundedText(request.toolName, MAX_ID_LENGTH) ||
    !isBoundedText(request.invocationFingerprint, MAX_FINGERPRINT_LENGTH) ||
    !isSummaryText(request.argumentsSummary)
  ) {
    return deny("managed_context_invalid", "Managed policy request metadata is invalid.");
  }
  if (request.managed !== undefined && !isManagedPolicyContext(request.managed)) {
    return deny("managed_context_invalid", "Managed policy context is invalid.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return deny("policy_invalid", "Managed policy response is malformed.");
  }
  const record = value as Record<string, unknown>;
  if (record.mode === "local_personal") {
    if (request.managed) {
      return deny(
        "managed_context_required",
        "Managed execution cannot be authorized by a local policy decision.",
      );
    }
    return { allowed: true, mode: "local_personal" };
  }
  if (record.mode !== "managed_organization") {
    return deny("policy_invalid", "Managed policy response has an unknown mode.");
  }

  const decision = readString(record, "decision");
  if (!isDecision(decision)) {
    return deny("policy_invalid", "Managed policy decision is invalid.");
  }
  const runId = readString(record, "runId", "run_id");
  const toolCallId = readString(record, "toolCallId", "tool_call_id");
  const toolId = readString(record, "toolId", "tool_id");
  const toolFingerprint = readString(record, "toolFingerprint", "tool_fingerprint");
  const invocationFingerprint = readString(
    record,
    "invocationFingerprint",
    "invocation_fingerprint",
  );
  const policyState = readString(record, "policyState", "policy_state");
  const policyVersion = readInteger(record, "policyVersion", "policy_version");
  if (
    !isBoundedText(runId, MAX_ID_LENGTH) ||
    !isBoundedText(toolCallId, MAX_ID_LENGTH) ||
    !isBoundedText(toolId, MAX_ID_LENGTH) ||
    !isBoundedText(toolFingerprint, MAX_FINGERPRINT_LENGTH) ||
    !isBoundedText(invocationFingerprint, MAX_FINGERPRINT_LENGTH) ||
    !isPolicyState(policyState) ||
    policyVersion === undefined ||
    policyVersion <= 0
  ) {
    return deny("policy_invalid", "Managed policy response is incomplete.");
  }

  // Binding checks run before the decision is interpreted: a decision that
  // authorizes some other invocation must never be readable as a denial or an
  // approval request for this one.
  if (invocationFingerprint !== request.invocationFingerprint) {
    return deny("binding_mismatch", "Managed policy response is bound to another invocation.");
  }
  const context = request.managed;
  if (context && context.toolFingerprint !== toolFingerprint) {
    return deny("tool_fingerprint_changed", "Managed tool fingerprint changed.");
  }
  if (context && context.toolId !== toolId) {
    return deny("tool_id_changed", "Managed tool identity changed.");
  }
  if (context && context.toolCallId !== toolCallId) {
    return deny("tool_call_mismatch", "Managed policy response targets another tool call.");
  }
  if (context && context.runId !== runId) {
    return deny("run_mismatch", "Managed policy response targets another run.");
  }
  if (context && context.action !== request.surface) {
    return deny("binding_mismatch", "Managed policy action does not match this execution surface.");
  }

  const expectedVersion = request.expectedPolicyVersion ?? context?.expectedPolicyVersion;
  if (expectedVersion !== undefined && expectedVersion !== policyVersion) {
    return deny(
      "policy_version_mismatch",
      "Managed policy version changed; re-evaluate the action.",
    );
  }
  const policyFingerprint = readString(record, "policyFingerprint", "policy_fingerprint");
  const expectedFingerprint =
    request.expectedPolicyFingerprint ?? context?.expectedPolicyFingerprint;
  if (expectedFingerprint !== undefined && expectedFingerprint !== policyFingerprint) {
    return deny(
      "policy_fingerprint_mismatch",
      "Managed policy fingerprint changed; re-evaluate the action.",
    );
  }

  const responseSummary = readString(record, "argumentsSummary", "arguments_summary");
  if (responseSummary !== undefined && !isSummaryText(responseSummary)) {
    return deny("policy_invalid", "Managed policy argument summary is invalid.");
  }
  if (context && responseSummary !== undefined && responseSummary !== context.argumentsSummary) {
    return deny("binding_mismatch", "Managed policy response no longer matches this action.");
  }
  const responseCapabilities = record.capabilityIds ?? record.capability_ids;
  if (responseCapabilities !== undefined && !isCapabilityList(responseCapabilities)) {
    return deny("policy_invalid", "Managed policy capability metadata is invalid.");
  }
  if (
    context &&
    responseCapabilities !== undefined &&
    !sameStringSet(context.capabilityIds, responseCapabilities as readonly string[])
  ) {
    return deny("binding_mismatch", "Managed policy capability scope changed.");
  }
  const responseAction = readString(record, "action");
  if (responseAction !== undefined && !isSurface(responseAction)) {
    return deny("policy_invalid", "Managed policy action is invalid.");
  }
  if (responseAction !== undefined && responseAction !== request.surface) {
    return deny("binding_mismatch", "Managed policy action does not match this execution surface.");
  }

  const nowMs = now.getTime();
  const policyExpiresAt = parseTimestamp(
    readString(record, "policyExpiresAt", "policy_expires_at"),
  );
  if (policyExpiresAt === null) {
    return deny("policy_invalid", "Managed policy expiry is malformed.");
  }
  if (policyExpiresAt !== undefined && policyExpiresAt <= nowMs) {
    return deny("policy_expired", "Managed policy has expired; re-evaluate the action.");
  }
  const approvalId = readString(record, "approvalId", "approval_id");
  const approvalExpiresAt = parseTimestamp(
    readString(record, "approvalExpiresAt", "approval_expires_at"),
  );
  if (approvalExpiresAt === null) {
    return deny("policy_invalid", "Managed approval expiry is malformed.");
  }
  if (approvalExpiresAt !== undefined && approvalExpiresAt <= nowMs) {
    return deny("approval_expired", "Managed approval has expired.");
  }

  if (policyState !== "ok") {
    return deny("policy_unavailable", "Managed policy is unavailable or not current.");
  }
  if (decision === "deny") {
    return deny("tool_denied", "Managed policy denied the action.");
  }
  if (decision !== "allow") {
    return deny("approval_required", "Managed policy requires approval before execution.");
  }

  const reason = readString(record, "reason");
  return {
    allowed: true,
    mode: "managed_organization",
    evaluation: {
      decision,
      runId,
      toolCallId,
      toolId,
      toolFingerprint,
      invocationFingerprint,
      policyVersion,
      policyState,
      ...(policyFingerprint ? { policyFingerprint } : {}),
      ...(policyExpiresAt !== undefined
        ? { policyExpiresAt: new Date(policyExpiresAt).toISOString() }
        : {}),
      ...(approvalId ? { approvalId } : {}),
      ...(approvalExpiresAt !== undefined
        ? { approvalExpiresAt: new Date(approvalExpiresAt).toISOString() }
        : {}),
      ...(responseSummary ? { argumentsSummary: responseSummary } : {}),
      ...(responseCapabilities !== undefined
        ? { capabilityIds: [...(responseCapabilities as readonly string[])] }
        : {}),
      ...(responseAction ? { action: responseAction as ManagedPolicySurface } : {}),
      ...(reason && reason.length <= MAX_REASON_LENGTH ? { reason } : {}),
    },
  };
}

export interface ManagedPolicyAuthorizationInput {
  readonly gate?: BrowserComputerPolicyGate;
  readonly request: ManagedPolicyRequest;
  /**
   * Fail-closed switch for hosts that only ever execute managed runs. When
   * true and no managed context can be resolved, the action is denied instead
   * of being treated as local-personal.
   */
  readonly requireManagedPolicy?: boolean;
  readonly now?: Date;
  readonly signal?: AbortSignal;
}

/**
 * Single fail-closed authorization entry point shared by every browser and
 * computer execution seam.
 *
 * A managed request with no gate, an unresolvable context, a transport
 * failure, a malformed response, an expired policy, or a pending approval all
 * deny. A caller without managed context is allowed only as `local_personal`,
 * which never claims managed authorization.
 */
export async function authorizeBrowserComputerAction(
  input: ManagedPolicyAuthorizationInput,
): Promise<ManagedPolicyAuthorization> {
  const { request } = input;
  if (request.managed !== undefined && !isManagedPolicyContext(request.managed)) {
    return deny("managed_context_invalid", "Managed policy context is invalid.");
  }

  let managed = request.managed;
  if (!managed && input.gate?.resolveManagedContext) {
    try {
      managed = (await input.gate.resolveManagedContext(request)) ?? undefined;
    } catch {
      return deny("policy_unavailable", "Managed policy context could not be resolved.");
    }
  }
  if (managed !== undefined && !isManagedPolicyContext(managed)) {
    return deny("managed_context_invalid", "Managed policy context is invalid.");
  }
  if (!managed) {
    if (input.requireManagedPolicy) {
      return deny(
        "managed_context_required",
        "Managed policy is required for this execution and no managed run context was resolved.",
      );
    }
    return { allowed: true, mode: "local_personal" };
  }

  const gate = input.gate;
  if (!gate) {
    return deny("policy_unavailable", "Managed policy is required for this execution.");
  }
  if (input.signal?.aborted) {
    return deny("policy_unavailable", "Managed policy evaluation was aborted.");
  }

  let response: unknown;
  try {
    response = await gate.evaluate(
      { ...request, managed },
      input.signal ? { signal: input.signal } : undefined,
    );
  } catch {
    return deny("policy_unavailable", "Managed policy evaluation is unavailable.");
  }
  return validateManagedPolicyEvaluation(
    { ...request, managed },
    response,
    input.now ?? new Date(),
  );
}
