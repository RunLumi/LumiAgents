import { createHash } from "node:crypto";
import {
  authorizeBrowserComputerAction,
  managedInvocationFingerprintInput,
  summarizeBrowserPolicyCommand,
  type BrowserCommand,
  type BrowserCommandResult,
  type BrowserComputerPolicyGate,
  type ManagedPolicyContext,
  type ManagedPolicyFailureCode,
} from "@zcode/shared";

/**
 * P05-INT-04 — managed browser/computer policy guard for the desktop host.
 *
 * The desktop host is the only process that simultaneously holds the device
 * token, the run state, and the versioned policy cache, so it is the authority
 * for "may this browser action execute right now". This module is intentionally
 * transport-free: it builds a bounded, redacted request, binds it to an exact
 * invocation fingerprint, and refuses anything that is not a current allow.
 *
 * Contract: `p05-browser-computer-v1`, Contract Gate `p05-cg-v1`.
 */

export interface BrowserManagedPolicyGateOptions {
  /** Host-owned gate: owns the device token, policy refresh, and approval handshake. */
  policyGate?: BrowserComputerPolicyGate;
  /**
   * Fail-closed switch. A host that only ever executes managed organization runs
   * MUST set this: without it an unresolvable managed context degrades to
   * local-personal, which is correct for a personal machine and wrong for a
   * managed device.
   */
  requireManagedPolicy?: boolean;
}

export interface BrowserManagedPolicyRequestInput extends BrowserManagedPolicyGateOptions {
  requestId: string;
  sessionId: string;
  turnId?: string;
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  command: BrowserCommand;
  /** Managed run correlation. Owned by the run owner, never by model/tool arguments. */
  managed?: ManagedPolicyContext;
  signal?: AbortSignal;
}

export type BrowserManagedPolicyAuthorization =
  | { readonly allowed: true; readonly mode: "local_personal" | "managed_organization" }
  | {
      readonly allowed: false;
      readonly code: ManagedPolicyFailureCode;
      readonly result: BrowserCommandResult;
    };

/**
 * Resolve the policy outcome for one browser command.
 *
 * `cancelRequest` is exempt by design: it is host-originated cancellation of a
 * request that already passed this guard. Gating it would make a running
 * browser action uncancellable exactly when the policy gate is unavailable,
 * which is the opposite of fail-closed.
 */
export async function authorizeBrowserCommand(
  input: BrowserManagedPolicyRequestInput,
): Promise<BrowserManagedPolicyAuthorization> {
  if (input.command.method === "cancelRequest") {
    return { allowed: true, mode: "local_personal" };
  }

  const argumentsSummary = summarizeBrowserPolicyCommand(input.command);
  const invocationFingerprint = createBrowserInvocationFingerprint({
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    argumentsSummary,
    command: input.command,
  });

  const authorization = await authorizeBrowserComputerAction({
    ...(input.policyGate ? { gate: input.policyGate } : {}),
    ...(input.requireManagedPolicy ? { requireManagedPolicy: true } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    request: {
      surface: "browser",
      sessionId: input.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      workspaceKey: input.workspaceKey,
      workspacePath: input.workspacePath,
      ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
      ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
      requestId: input.requestId,
      toolName: "browser",
      invocationFingerprint,
      argumentsSummary,
      ...(input.managed ? { managed: input.managed } : {}),
    },
  });

  if (authorization.allowed) return { allowed: true, mode: authorization.mode };
  return {
    allowed: false,
    code: authorization.code,
    result: {
      ok: false,
      error: {
        code: "policy_denied",
        message: managedPolicyDenialMessage(authorization.code),
        // The refusal happens before any transport, so no browser side effect is possible.
        sideEffect: "none",
      },
      elapsedMs: 0,
    },
  };
}

/** SHA-256 over the canonical P05 invocation pre-image. */
export function createBrowserInvocationFingerprint(input: {
  sessionId: string;
  turnId?: string;
  argumentsSummary: string;
  command: BrowserCommand;
}): string {
  return createHash("sha256")
    .update(
      managedInvocationFingerprintInput({
        surface: "browser",
        sessionId: input.sessionId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        toolName: "browser",
        argumentsSummary: input.argumentsSummary,
        payload: input.command,
      }),
    )
    .digest("hex");
}

/**
 * Stable, non-sensitive, model-readable refusal text.
 *
 * The machine-readable contract is the `policy_denied` code plus the reason code
 * on the control-plane/audit side. This string must never echo organization
 * policy contents, approval bindings, or credential-bearing metadata.
 */
export function managedPolicyDenialMessage(code: ManagedPolicyFailureCode): string {
  switch (code) {
    case "tool_denied":
      return "Organization policy denied this browser action.";
    case "approval_required":
      return "This browser action requires an approval that has not been granted.";
    case "approval_expired":
      return "The approval for this browser action expired. Ask for a new one.";
    case "policy_expired":
    case "policy_unavailable":
    case "policy_version_mismatch":
    case "policy_fingerprint_mismatch":
    case "policy_invalid":
      return "Organization policy is not current for this browser action. Try again shortly.";
    case "tool_fingerprint_changed":
    case "tool_id_changed":
    case "tool_call_mismatch":
    case "run_mismatch":
    case "binding_mismatch":
      return "The browser tool changed while policy was being evaluated. Stop and re-plan.";
    case "managed_context_required":
    case "managed_context_invalid":
      return "This session is not authorized to run managed browser actions.";
    default:
      return "Organization policy denied this browser action.";
  }
}
