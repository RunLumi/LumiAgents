/**
 * P05 managed browser/computer policy contract.
 *
 * The control plane stays the policy, approval, and audit authority. The
 * desktop/runtime host stays the execution owner. This module is the frozen
 * wire contract only: bounded types, schemas, and the host-owned gate port.
 * Fail-closed enforcement lives in `managed-policy-authorization.ts`; exact
 * invocation binding lives in `managed-policy-fingerprint.ts`.
 *
 * Contract: `p05-browser-computer-v1`, Contract Gate `p05-cg-v1`.
 */

import { z } from "zod";

export const P05_BROWSER_COMPUTER_POLICY_CONTRACT_VERSION = "p05-browser-computer-v1" as const;
/** P03 policy snapshot `tools.schema_version` required for managed tool execution. */
export const P05_TOOL_POLICY_SCHEMA_VERSION = 1 as const;

const MAX_ID_LENGTH = 256;
const MAX_FINGERPRINT_LENGTH = 256;
const MAX_SUMMARY_LENGTH = 1_024;
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

/** Argument summaries are bounded metadata; PEM-shaped or control-heavy payloads are refused. */
function isSummaryText(value: unknown): value is string {
  return (
    isBoundedText(value, MAX_SUMMARY_LENGTH) &&
    !(value as string).includes("-----BEGIN") &&
    !(value as string).includes("-----END")
  );
}

export const managedPolicySurfaceSchema = z.enum(["browser", "computer"]);
export type ManagedPolicySurface = z.infer<typeof managedPolicySurfaceSchema>;

export const managedPolicyDecisionSchema = z.enum([
  "allow",
  "require_session_approval",
  "require_per_use_approval",
  "deny",
]);
export type ManagedPolicyDecision = z.infer<typeof managedPolicyDecisionSchema>;

export const managedPolicyStateSchema = z.enum([
  "ok",
  "missing",
  "schema_unsupported",
  "expired",
  "unavailable",
]);
export type ManagedPolicyState = z.infer<typeof managedPolicyStateSchema>;

export const managedPolicyRiskClassSchema = z.enum([
  "read_only",
  "filesystem_write",
  "process_execution",
  "network",
  "mcp",
  "browser",
  "computer",
  "credential_bearing",
  "external_side_effect",
  "destructive",
]);
export type ManagedPolicyRiskClass = z.infer<typeof managedPolicyRiskClassSchema>;

const boundedIdSchema = z.string().trim().min(1).max(MAX_ID_LENGTH).refine(isSafeText, {
  message: "identifier contains control characters",
});
const boundedFingerprintSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FINGERPRINT_LENGTH)
  .refine(isSafeText, { message: "fingerprint contains control characters" });
const boundedSummarySchema = z.string().min(1).max(MAX_SUMMARY_LENGTH).refine(isSummaryText, {
  message: "summary is not bounded printable metadata",
});

/**
 * Trusted runtime correlation for one managed action.
 *
 * This is populated by the managed run owner, never by model output, browser
 * command arguments, or an untrusted client header. The control plane remains
 * authoritative for organization, project, device, policy, and approval.
 */
export const managedPolicyContextSchema = z
  .object({
    mode: z.literal("managed_organization"),
    orgId: boundedIdSchema,
    projectId: boundedIdSchema,
    deviceId: boundedIdSchema,
    agentSessionId: boundedIdSchema,
    runId: boundedIdSchema,
    toolCallId: boundedIdSchema,
    toolId: boundedIdSchema,
    toolFingerprint: boundedFingerprintSchema,
    capabilityIds: z.array(boundedIdSchema).max(MAX_CAPABILITY_IDS),
    riskClass: managedPolicyRiskClassSchema,
    action: managedPolicySurfaceSchema,
    argumentsSummary: boundedSummarySchema,
    expectedPolicyVersion: z.number().int().positive().optional(),
    expectedPolicyFingerprint: boundedFingerprintSchema.optional(),
  })
  .strict();

export type ManagedPolicyContext = z.infer<typeof managedPolicyContextSchema>;

/** Redacted, non-secret request handed to a local policy gate. */
export interface ManagedPolicyRequest {
  readonly surface: ManagedPolicySurface;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly workspaceKey: string;
  readonly workspacePath?: string;
  readonly workspaceIdentity?: string;
  readonly remoteSessionId?: string;
  readonly requestId: string;
  readonly toolName: string;
  readonly invocationFingerprint: string;
  readonly argumentsSummary: string;
  readonly managed?: ManagedPolicyContext;
  readonly expectedPolicyVersion?: number;
  readonly expectedPolicyFingerprint?: string;
}

/**
 * Host-owned port for the control-plane policy document.
 *
 * The host owns the device token, policy refresh, approval handshake, and
 * network I/O. Implementations return the bounded evaluation shape produced by
 * `POST /runs/{run_id}/tool-decisions`; they never return a local verdict.
 */
export interface BrowserComputerPolicyGate {
  /**
   * Resolve the managed run context for this action. Returning `undefined`
   * means the caller is explicitly local-personal and claims no managed
   * authorization. Throwing is treated as a fail-closed denial.
   */
  resolveManagedContext?(
    request: ManagedPolicyRequest,
  ): ManagedPolicyContext | undefined | Promise<ManagedPolicyContext | undefined>;
  evaluate(
    request: ManagedPolicyRequest,
    options?: { readonly signal?: AbortSignal },
  ): unknown | Promise<unknown>;
}

export type ManagedPolicyFailureCode =
  | "managed_context_required"
  | "managed_context_invalid"
  | "policy_unavailable"
  | "policy_invalid"
  | "policy_version_mismatch"
  | "policy_fingerprint_mismatch"
  | "tool_fingerprint_changed"
  | "tool_id_changed"
  | "tool_call_mismatch"
  | "run_mismatch"
  | "binding_mismatch"
  | "policy_expired"
  | "approval_required"
  | "approval_expired"
  | "tool_denied";

export type ManagedPolicyAuthorization =
  | {
      readonly allowed: true;
      /** `local_personal` never claims managed authorization. */
      readonly mode: "local_personal";
    }
  | {
      readonly allowed: true;
      readonly mode: "managed_organization";
      readonly evaluation: ManagedPolicyEvaluation;
    }
  | {
      readonly allowed: false;
      readonly code: ManagedPolicyFailureCode;
      readonly message: string;
    };

/** Bounded, normalized view of a control-plane tool decision. */
export interface ManagedPolicyEvaluation {
  readonly decision: ManagedPolicyDecision;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolId: string;
  readonly toolFingerprint: string;
  readonly invocationFingerprint: string;
  readonly policyVersion: number;
  readonly policyState: ManagedPolicyState;
  readonly policyFingerprint?: string;
  readonly policyExpiresAt?: string;
  readonly approvalId?: string;
  readonly approvalExpiresAt?: string;
  readonly argumentsSummary?: string;
  readonly capabilityIds?: readonly string[];
  readonly action?: ManagedPolicySurface;
  readonly reason?: string;
}

export function isManagedPolicyContext(value: unknown): value is ManagedPolicyContext {
  return managedPolicyContextSchema.safeParse(value).success;
}
