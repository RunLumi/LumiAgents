// ============================================================
// Managed tool decision boundary - P05 control-loop contract
// ============================================================

import type { ZCodeManagedRunContext } from "@zcode/shared";
import type { TraceContext } from "../tracing/tracer.js";
import type { SessionId, ToolCallId, TraceId, TurnId } from "./shared.js";

/**
 * Execution mode is deliberately separate from the local ZCode permission
 * mode. `local_only` is a visible compatibility state; it must never be
 * upgraded to managed authorization by a client flag.
 */
export type ManagedRunExecutionMode = "managed" | "local_only";

export type ManagedToolSource = "built_in" | "plugin" | "custom";

export type ManagedToolRiskClass =
  | "read_only"
  | "filesystem_write"
  | "process_execution"
  | "network"
  | "mcp"
  | "browser"
  | "computer"
  | "credential_bearing"
  | "external_side_effect"
  | "destructive";

export type ManagedToolDecision =
  | "allow"
  | "require_session_approval"
  | "require_per_use_approval"
  | "deny";

export type ManagedToolApprovalMode = "session" | "per_use";

/** A non-ok policy projection can explain a denial, but can never authorize it. */
export type ManagedToolPolicyState =
  | "ok"
  | "missing"
  | "schema_unsupported"
  | "stale"
  | "unavailable";

/**
 * Correlation and authority context for one managed execution attempt.
 *
 * This is intentionally not an extension of TraceContext. TraceContext owns
 * observability identity (including its stable traceId); this value owns P05
 * resource correlation. Every ID here is supplied for correlation only. The
 * control plane still resolves the device, membership, project and policy
 * from its authenticated runtime credential.
 */
export type ManagedRunContext = Readonly<ZCodeManagedRunContext>;

/** Host-issued tool identity. The control-plane catalog remains authoritative. */
export interface ManagedToolIdentity {
  readonly toolId: string;
  readonly name: string;
  readonly fingerprint: string;
  readonly source: ManagedToolSource;
  readonly riskClass: ManagedToolRiskClass;
  readonly capabilityIds: readonly string[];
  readonly mcpRegistrationId?: string;
  /** False means the identity still needs catalog review. */
  readonly catalogued?: boolean;
}

/**
 * One exact preflight request for a privileged tool call.
 *
 * `sessionId`/`taskId` preserve the existing local ZCode correlation vocabulary
 * and are not control-plane IDs. `trace` preserves TraceContext.traceId and
 * the span relationship; `traceId` is the required flat compatibility
 * projection and must equal `trace.traceId`.
 */
export interface ManagedToolDecisionRequest {
  readonly context: ManagedRunContext;
  readonly trace: TraceContext;
  /** Must equal trace.traceId; retained for adapters that expose it flat. */
  readonly traceId: TraceId;
  /** Existing ZCode agent-session ID used to route the reverse protocol call. */
  readonly sessionId: SessionId;
  /** Existing ZCode UI task ID, when available; never a P05 authority ID. */
  readonly taskId?: string;
  /** Canonical P05 ToolCallRef ID. */
  readonly toolCallId: ToolCallId | string;
  /** Local tool-call ID retained for diagnostics and replay matching. */
  readonly localToolCallId: string;
  readonly turnId?: TurnId;
  readonly tool: ManagedToolIdentity;
  /** Bounded, redacted summary; raw arguments and secrets stay local. */
  readonly argumentsSummary: string;
  /** Hash of the bounded summary used to bind approval to this exact call. */
  readonly argumentsHash: string;
  /** Runtime cancellation only; never serialize this into the ZCode request. */
  readonly signal?: AbortSignal;
}

export interface ManagedToolDecisionRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/**
 * Terminal result for one exact tool call. A result without a matching binding
 * is malformed and must be treated as deny by the caller.
 */
export interface ManagedToolDecisionResult {
  readonly decision: ManagedToolDecision;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolId: string;
  readonly toolFingerprint: string;
  readonly riskClass: ManagedToolRiskClass;
  readonly policyVersion: number;
  readonly policyState: ManagedToolPolicyState;
  readonly approvalMode?: ManagedToolApprovalMode | null;
  readonly approvalId?: string | null;
  readonly approvalExpiresAt?: string | null;
  readonly reason?: string | null;
  readonly reasonCode?: string | null;
  /** Echoed when the broker has the exact catalog source binding available. */
  readonly source?: ManagedToolSource | null;
  /** Echoed when the broker has the exact argument binding available. */
  readonly argumentsHash?: string | null;
}

export type ManagedToolDecisionHandler = (
  request: ManagedToolDecisionRequest,
  options?: ManagedToolDecisionRequestOptions,
) => Promise<ManagedToolDecisionResult>;

/**
 * Host-owned policy/approval boundary. The implementation owns the runtime
 * device credential and network retry policy; the caller never supplies a
 * token or an authorization decision.
 */
export interface ManagedToolDecisionPort {
  requestDecision: ManagedToolDecisionHandler;
  /** Compatibility alias for adapters that call the operation `decide`. */
  decide?: ManagedToolDecisionHandler;
}

/** A resolver-only shape for local adapters that do not own a transport port. */
export interface ManagedToolDecisionResolver {
  decide: ManagedToolDecisionHandler;
}

export type ManagedToolDecisionPortRequest = ManagedToolDecisionRequest;
export type ManagedToolDecisionPortResult = ManagedToolDecisionResult;
