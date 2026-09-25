/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice. */
/* oxlint-disable max-lines -- Managed decision boundary keeps its validation and adapter contract together. */

import {
  CoreErrorType,
  createCoreError,
  isCoreError,
  type ManagedRunContext as ContractManagedRunContext,
  type ManagedToolDecision as ContractManagedToolDecision,
  type ManagedToolDecisionPort as ContractManagedToolDecisionPort,
  type ManagedToolDecisionRequest as ContractManagedToolDecisionRequest,
  type ManagedToolDecisionRequestOptions as ContractManagedToolDecisionRequestOptions,
  type ManagedToolDecisionResult as ContractManagedToolDecisionResult,
  type SessionId,
  type TraceContext,
  type TraceId,
  type TurnId,
} from "@zcode/contracts";
import type { ExecutableToolCall, ManagedToolIdentity, ToolEntry } from "../types.js";
import {
  canonicalizeManagedFingerprint,
  createManagedArgumentsHash,
  createManagedArgumentsSummary,
  createManagedToolCallId,
  isManagedIdentityValid,
  isPrivilegedManagedIdentity,
  resolveManagedToolIdentity,
} from "./managed-tool-identity.js";

export type LumiManagedExecutionMode = "managed" | "local";

export interface LumiManagedExecutionContext {
  /** Short local alias; P05 contract-shaped contexts use executionMode. */
  mode?: LumiManagedExecutionMode;
  executionMode?: "managed" | "local_only";
  organizationId?: string;
  /** Compatibility alias for organizationId. */
  orgId?: string;
  projectId?: string;
  deviceId?: string;
  agentSessionId?: string;
  runId?: string;
  agentDefinitionId?: string;
  agentDefinitionVersion?: number;
  requestId?: string;
  externalId?: string;
  policySnapshotId?: string;
  policyVersion?: string | number;
}

export type LumiManagedToolDecision = ContractManagedToolDecision;

export interface LumiManagedToolDecisionRequest {
  context: LumiManagedExecutionContext;
  /** P05 `tcl_` correlation id. The local id remains available in localToolCallId. */
  toolCallId: string;
  localToolCallId: string;
  trace: TraceContext;
  taskId?: string;
  tool: ManagedToolIdentity;
  argumentsSummary: string;
  argumentsHash: string;
  traceId: TraceId;
  sessionId: SessionId;
  turnId?: TurnId;
  signal?: AbortSignal;
}

export interface LumiManagedToolDecisionResponse {
  decision: LumiManagedToolDecision;
  approvalId?: string | null;
  approvalMode?: "session" | "per_use" | null;
  approvalExpiresAt?: string | null;
  policyVersion?: string | number;
  policyState?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
  toolId?: string;
  toolFingerprint?: string;
  riskClass?: string;
  toolCallId?: string;
  runId?: string;
  argumentsHash?: string;
  source?: string;
}

export interface LumiManagedPolicySnapshot {
  available?: boolean;
  state?: string;
  version?: string | number;
}

type MaybePromise<T> = T | PromiseLike<T>;
type DecisionHandler = (
  request: LumiManagedToolDecisionRequest,
  options?: { signal?: AbortSignal },
) => MaybePromise<LumiManagedToolDecisionResponse>;
type ContextProvider = () => MaybePromise<LumiManagedExecutionContext | undefined>;

/**
 * The public port is intentionally a little wider than the shared P05 request:
 * local embedders may use a small context while a contract-shaped host still
 * receives the exact shared shape. `createLumiManagedToolDecisionPortAdapter`
 * upgrades that boundary and performs the strict result checks.
 */
export interface LocalManagedToolDecisionPort {
  requestDecision: DecisionHandler;
  decide?: DecisionHandler;
}

export type LumiManagedToolDecisionPort =
  | LocalManagedToolDecisionPort
  | ContractManagedToolDecisionPort;

/**
 * Host/agent boundary for the P05 broker. The adapter is intentionally
 * transport-agnostic: the host owns the device token, policy refresh, approval
 * polling, and network I/O; core only supplies a bounded, redacted request and
 * accepts a terminal decision.
 */
export interface LumiManagedToolDecisionAdapter {
  mode?: LumiManagedExecutionMode;
  context?: LumiManagedExecutionContext | ContextProvider;
  getContext?: ContextProvider;
  isManaged?: () => MaybePromise<boolean>;
  requireBoundResult?: boolean;
  decide?: DecisionHandler;
  requestDecision?: DecisionHandler;
  evaluate?: DecisionHandler;
  getPolicy?: (
    context: LumiManagedExecutionContext,
    options?: { signal?: AbortSignal },
  ) => MaybePromise<LumiManagedPolicySnapshot | undefined>;
  waitForApproval?: (
    request: LumiManagedToolDecisionRequest,
    response: LumiManagedToolDecisionResponse,
    options?: { signal?: AbortSignal },
  ) => MaybePromise<LumiManagedToolDecisionResponse>;
}

export type ManagedToolDecisionAdapter = LumiManagedToolDecisionAdapter;
export type ManagedToolDecisionPort = LumiManagedToolDecisionPort;

export interface LumiManagedToolDecisionAdapterOptions {
  mode?: LumiManagedExecutionMode;
  context?: LumiManagedExecutionContext | ContextProvider;
  getContext?: ContextProvider;
  isManaged?: () => MaybePromise<boolean>;
  requireBoundResult?: boolean;
  decide?: DecisionHandler;
  requestDecision?: DecisionHandler;
  evaluate?: DecisionHandler;
  getPolicy?: LumiManagedToolDecisionAdapter["getPolicy"];
  waitForApproval?: LumiManagedToolDecisionAdapter["waitForApproval"];
}

export interface ManagedToolGateInput {
  adapter?: LumiManagedToolDecisionAdapter;
  context?: LumiManagedExecutionContext;
  entry: ToolEntry;
  toolCall: ExecutableToolCall;
  input: unknown;
  traceContext: TraceContext;
  sessionId: SessionId;
  turnId?: TurnId;
  signal?: AbortSignal;
}

export type ManagedToolGateResult =
  | { allowed: true; managed: false }
  | { allowed: true; managed: true; response: LumiManagedToolDecisionResponse }
  | { allowed: false; managed: true; reasonCode: string };

export function createLumiManagedToolDecisionAdapter(
  options: LumiManagedToolDecisionAdapterOptions,
): LumiManagedToolDecisionAdapter {
  return {
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.context ? { context: options.context } : {}),
    ...(options.getContext ? { getContext: options.getContext } : {}),
    ...(options.isManaged ? { isManaged: options.isManaged } : {}),
    ...(options.requireBoundResult ? { requireBoundResult: true } : {}),
    ...(options.decide ? { decide: options.decide } : {}),
    ...(options.requestDecision ? { requestDecision: options.requestDecision } : {}),
    ...(options.evaluate ? { evaluate: options.evaluate } : {}),
    ...(options.getPolicy ? { getPolicy: options.getPolicy } : {}),
    ...(options.waitForApproval ? { waitForApproval: options.waitForApproval } : {}),
  };
}

export const createManagedToolDecisionAdapter = createLumiManagedToolDecisionAdapter;
export const createHostManagedDecisionAdapter = createLumiManagedToolDecisionAdapter;

function toContractManagedRequest(
  request: LumiManagedToolDecisionRequest,
): ContractManagedToolDecisionRequest {
  if (!isContractManagedExecutionContext(request.context)) {
    throw new Error("managed_context_unavailable");
  }
  const { context } = request;
  return {
    ...request,
    context: {
      organizationId: context.organizationId,
      projectId: context.projectId,
      deviceId: context.deviceId,
      agentSessionId: context.agentSessionId,
      runId: context.runId,
      agentDefinitionId: context.agentDefinitionId,
      agentDefinitionVersion: context.agentDefinitionVersion,
      requestId: context.requestId,
      ...(context.externalId ? { externalId: context.externalId } : {}),
      executionMode: context.executionMode,
      ...(context.policySnapshotId ? { policySnapshotId: context.policySnapshotId } : {}),
      ...(context.policyVersion !== undefined ? { policyVersion: context.policyVersion } : {}),
    },
  };
}

export function createLumiManagedToolDecisionPortAdapter(
  port: LumiManagedToolDecisionPort,
): LumiManagedToolDecisionAdapter {
  const requestDecision = async (
    request: LumiManagedToolDecisionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<LumiManagedToolDecisionResponse> => {
    // The shared port has a narrower request type than the local adapter. The
    // gate builds the canonical fields first; this cast is therefore a boundary
    // adaptation, not an authorization decision. Strict binding is enforced by
    // the response validator below.
    const handler = port.requestDecision as unknown as (
      input: ContractManagedToolDecisionRequest,
      handlerOptions?: ContractManagedToolDecisionRequestOptions,
    ) => MaybePromise<ContractManagedToolDecisionResult>;
    const result = await handler.call(
      port,
      toContractManagedRequest(request),
      options?.signal ? { signal: options.signal } : undefined,
    );
    return result as unknown as LumiManagedToolDecisionResponse;
  };

  return {
    requireBoundResult: true,
    requestDecision,
    ...(port.decide
      ? {
          decide: async (
            request: LumiManagedToolDecisionRequest,
            options?: { signal?: AbortSignal },
          ): Promise<LumiManagedToolDecisionResponse> => {
            const handler = port.decide as unknown as (
              input: ContractManagedToolDecisionRequest,
              handlerOptions?: ContractManagedToolDecisionRequestOptions,
            ) => MaybePromise<ContractManagedToolDecisionResult>;
            const result = await handler.call(
              port,
              toContractManagedRequest(request),
              options?.signal ? { signal: options.signal } : undefined,
            );
            return result as unknown as LumiManagedToolDecisionResponse;
          },
        }
      : {}),
  };
}

export function createManagedDecisionDeniedError(reasonCode: string): Error {
  return createCoreError(
    CoreErrorType.PermissionDenied,
    `Managed tool decision denied: ${safeReasonCode(reasonCode)}`,
    {
      context: {
        managedToolDecision: true,
        reasonCode: safeReasonCode(reasonCode),
      },
      recoverable: true,
    },
  );
}

export function isManagedToolDecisionDeniedError(error: unknown): boolean {
  return isCoreError(error) && error.context?.managedToolDecision === true;
}

export async function enforceManagedToolDecision(
  input: ManagedToolGateInput,
): Promise<ManagedToolGateResult> {
  const managedState = await resolveManagedState(input.adapter, input.context);
  if (!managedState.managed) return { allowed: true, managed: false };
  if (!managedState.context) return deny("managed_context_unavailable");

  const context = managedState.context;
  if (!isContextRecord(context)) return deny("managed_context_unavailable");
  if (hasConflictingManagedModes(context)) return deny("managed_context_invalid");
  if (input.adapter?.mode === "managed" && isLocalContext(context)) {
    return deny("managed_context_invalid");
  }
  if (typeof context.runId !== "string" || context.runId.trim().length === 0) {
    return deny("managed_context_unavailable");
  }

  // A context carrying the complete P05 identity is already a contract-shaped
  // request. Require the strict response binding even when a host forgot to
  // set the adapter flag; shorthand local contexts retain their compatibility
  // path for embedders that have not yet adopted the shared contract.
  const requireBoundResult =
    input.adapter?.requireBoundResult === true || isContractManagedExecutionContext(context);
  if (requireBoundResult && !isContractManagedExecutionContext(context)) {
    return deny("managed_context_unavailable");
  }

  const identity = resolveManagedToolIdentity(input.entry);
  if (!isManagedIdentityValid(identity)) return deny("tool_identity_invalid");
  if (identity.catalogued !== true && isPrivilegedManagedIdentity(identity)) {
    return deny(identity.source === "custom" ? "mcp_tool_requires_review" : "tool_not_found");
  }

  const decisionHandler = resolveDecisionHandler(input.adapter);
  if (!decisionHandler) return deny("managed_decision_unavailable");

  const policy = await resolvePolicy(input.adapter, context, input.signal, requireBoundResult);
  if (!policy.ok) return deny(policy.reasonCode);
  if (input.signal?.aborted) return deny("managed_decision_unavailable");

  const argumentsSummary = createManagedArgumentsSummary(input.input);
  const request: LumiManagedToolDecisionRequest = {
    context,
    toolCallId: createManagedToolCallId(input.toolCall.id),
    localToolCallId: input.toolCall.id,
    trace: input.traceContext,
    tool: identity,
    argumentsSummary,
    argumentsHash: createManagedArgumentsHash(argumentsSummary),
    traceId: input.traceContext.traceId,
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };

  let response: LumiManagedToolDecisionResponse;
  let approvalWasResolved = false;
  try {
    response = await decisionHandler(request, { signal: input.signal });
    if (response && isApprovalDecision(response.decision) && input.adapter?.waitForApproval) {
      approvalWasResolved = true;
      response = await input.adapter.waitForApproval(request, response, { signal: input.signal });
    }
  } catch {
    return deny("managed_decision_unavailable");
  }

  return validateManagedResponse(
    normalizeManagedResponse(response),
    request,
    requireBoundResult,
    approvalWasResolved,
  );
}

export async function resolveLumiManagedExecutionContext(
  adapter?: LumiManagedToolDecisionAdapter,
  explicitContext?: LumiManagedExecutionContext,
): Promise<{ managed: boolean; context?: LumiManagedExecutionContext }> {
  return resolveManagedState(adapter, explicitContext);
}

async function resolveManagedState(
  adapter?: LumiManagedToolDecisionAdapter,
  explicitContext?: LumiManagedExecutionContext,
): Promise<{ managed: boolean; context?: LumiManagedExecutionContext }> {
  if (explicitContext) {
    // `local_only` is an explicit host-owned compatibility state. A managed
    // adapter may reject that contradictory projection, but a port that is
    // merely present must not make an otherwise local run unusable.
    if (isLocalContext(explicitContext) && adapter?.mode !== "managed") {
      return { managed: false };
    }
    return { managed: true, context: explicitContext };
  }
  if (!adapter) return { managed: false };

  let context: LumiManagedExecutionContext | undefined;
  try {
    if (adapter.getContext) {
      context = await adapter.getContext();
    } else if (typeof adapter.context === "function") {
      context = await adapter.context();
    } else {
      context = adapter.context;
    }
  } catch {
    return { managed: adapter.mode !== "local" };
  }

  if (context) {
    if (isLocalContext(context) && adapter.mode === "managed") {
      return { managed: true, context };
    }
    return isLocalContext(context) ? { managed: false } : { managed: true, context };
  }

  let explicitlyManaged: boolean | undefined;
  try {
    explicitlyManaged = adapter.isManaged ? await adapter.isManaged() : undefined;
  } catch {
    return { managed: true };
  }
  if (adapter.mode === "local") return { managed: false };
  if (explicitlyManaged === false && adapter.mode !== "managed") return { managed: false };
  return { managed: true };
}

async function resolvePolicy(
  adapter: LumiManagedToolDecisionAdapter | undefined,
  context: LumiManagedExecutionContext,
  signal: AbortSignal | undefined,
  requireBoundResult: boolean,
): Promise<{ ok: true } | { ok: false; reasonCode: string }> {
  if (!adapter?.getPolicy) return { ok: true };
  try {
    const policy = await adapter.getPolicy(context, { signal });
    if (!policy || policy.available === false) {
      return { ok: false, reasonCode: "policy_state_unavailable" };
    }
    if (policy.state !== undefined && isUnavailablePolicyState(policy.state)) {
      return { ok: false, reasonCode: "policy_state_unavailable" };
    }
    if (requireBoundResult && policy.state !== "ok") {
      return { ok: false, reasonCode: "policy_state_unavailable" };
    }
    if (
      policy.version !== undefined &&
      (typeof policy.version !== "number" ||
        !Number.isSafeInteger(policy.version) ||
        policy.version < 0 ||
        (requireBoundResult && policy.version === 0))
    ) {
      return { ok: false, reasonCode: "policy_state_unavailable" };
    }
    if (policy.state === undefined && policy.version === undefined && policy.available !== true) {
      return { ok: false, reasonCode: "policy_state_unavailable" };
    }
    if (
      context.policyVersion !== undefined &&
      policy.version !== undefined &&
      policy.version !== context.policyVersion
    ) {
      return { ok: false, reasonCode: "policy_state_unavailable" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reasonCode: "policy_state_unavailable" };
  }
}

function resolveDecisionHandler(
  adapter: LumiManagedToolDecisionAdapter | undefined,
): DecisionHandler | undefined {
  if (!adapter) return undefined;
  return adapter.decide ?? adapter.requestDecision ?? adapter.evaluate;
}

function normalizeManagedResponse(
  response: LumiManagedToolDecisionResponse,
): LumiManagedToolDecisionResponse {
  if (!response || typeof response !== "object") return response;
  const raw = response as LumiManagedToolDecisionResponse & Record<string, unknown>;
  return {
    ...response,
    ...(typeof response.toolFingerprint === "string"
      ? { toolFingerprint: canonicalizeManagedFingerprint(response.toolFingerprint) }
      : {}),
    ...mapResponseField(raw, "tool_id", "toolId"),
    ...mapResponseField(raw, "tool_fingerprint", "toolFingerprint", (value) =>
      typeof value === "string" ? canonicalizeManagedFingerprint(value) : value,
    ),
    ...mapResponseField(raw, "tool_call_id", "toolCallId"),
    ...mapResponseField(raw, "run_id", "runId"),
    ...mapResponseField(raw, "arguments_hash", "argumentsHash"),
    ...mapResponseField(raw, "reason_code", "reasonCode"),
    ...mapResponseField(raw, "risk_class", "riskClass"),
    ...mapResponseField(raw, "source", "source"),
    ...mapResponseField(raw, "approval_id", "approvalId"),
    ...mapResponseField(raw, "approval_mode", "approvalMode"),
    ...mapResponseField(raw, "approval_expires_at", "approvalExpiresAt"),
    ...mapResponseField(raw, "policy_state", "policyState"),
    ...mapResponseField(raw, "policy_version", "policyVersion"),
  } as LumiManagedToolDecisionResponse;
}

function mapResponseField(
  raw: Record<string, unknown>,
  sourceKey: string,
  targetKey: string,
  transform?: (value: unknown) => unknown,
): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(raw, sourceKey)) return {};
  const value = raw[sourceKey];
  return { [targetKey]: transform ? transform(value) : value };
}

function validateManagedResponse(
  response: LumiManagedToolDecisionResponse,
  request: LumiManagedToolDecisionRequest,
  requireBoundResult = false,
  approvalWasResolved = false,
): ManagedToolGateResult {
  if (!response || typeof response.decision !== "string" || !isManagedDecision(response.decision)) {
    return deny("managed_decision_malformed");
  }
  if (response.decision !== "allow") {
    return deny(
      isApprovalDecision(response.decision)
        ? "approval_required"
        : (response.reasonCode ?? response.reason ?? "tool_denied"),
    );
  }

  if (response.policyState !== undefined && isUnavailablePolicyState(response.policyState)) {
    return deny("policy_state_unavailable");
  }
  if (requireBoundResult && response.policyState !== "ok") {
    return deny("policy_state_unavailable");
  }
  if (
    requireBoundResult &&
    (typeof response.runId !== "string" ||
      typeof response.toolCallId !== "string" ||
      typeof response.toolId !== "string" ||
      typeof response.toolFingerprint !== "string" ||
      typeof response.riskClass !== "string" ||
      typeof response.policyVersion !== "number" ||
      !Number.isSafeInteger(response.policyVersion) ||
      response.policyVersion <= 0 ||
      response.policyState === undefined)
  ) {
    return deny("managed_decision_malformed");
  }
  if (hasInvalidOptionalResponseField(response)) {
    return deny("managed_decision_malformed");
  }
  if (response.policyVersion !== undefined && !isValidPolicyVersion(response.policyVersion)) {
    return deny("managed_decision_malformed");
  }
  if (
    request.context.policyVersion !== undefined &&
    response.policyVersion !== undefined &&
    response.policyVersion !== request.context.policyVersion
  ) {
    return deny("policy_state_unavailable");
  }
  if (response.approvalMode !== undefined && !isApprovalMode(response.approvalMode)) {
    return deny("managed_decision_malformed");
  }
  if (
    approvalWasResolved &&
    (typeof response.approvalId !== "string" || !response.approvalId.trim())
  ) {
    return deny("managed_decision_malformed");
  }
  if (
    response.approvalExpiresAt !== undefined &&
    response.approvalExpiresAt !== null &&
    isExpiredTimestamp(response.approvalExpiresAt)
  ) {
    return deny("approval_expired");
  }

  if (
    response.toolFingerprint !== undefined &&
    response.toolFingerprint !== request.tool.fingerprint
  ) {
    return deny("tool_fingerprint_changed");
  }
  if (response.toolId !== undefined && response.toolId !== request.tool.toolId) {
    return deny("tool_identity_mismatch");
  }
  if (
    response.toolCallId !== undefined &&
    response.toolCallId !== request.toolCallId &&
    !(!requireBoundResult && response.toolCallId === request.localToolCallId)
  ) {
    return deny("tool_call_mismatch");
  }
  if (response.runId !== undefined && response.runId !== request.context.runId) {
    return deny("run_mismatch");
  }
  if (response.argumentsHash !== undefined && response.argumentsHash !== request.argumentsHash) {
    return deny("arguments_changed");
  }
  if (response.riskClass !== undefined && response.riskClass !== request.tool.riskClass) {
    return deny("tool_risk_class_mismatch");
  }
  if (response.source !== undefined && response.source !== request.tool.source) {
    return deny("tool_identity_mismatch");
  }
  return { allowed: true, managed: true, response };
}

function deny(reasonCode: unknown): ManagedToolGateResult {
  return { allowed: false, managed: true, reasonCode: safeReasonCode(reasonCode) };
}

function isApprovalDecision(value: string): boolean {
  return value === "require_session_approval" || value === "require_per_use_approval";
}

function isManagedDecision(value: string): value is LumiManagedToolDecision {
  return (
    value === "allow" ||
    value === "deny" ||
    value === "require_session_approval" ||
    value === "require_per_use_approval"
  );
}

function hasInvalidOptionalResponseField(response: LumiManagedToolDecisionResponse): boolean {
  return (
    (response.runId !== undefined && typeof response.runId !== "string") ||
    (response.toolCallId !== undefined && typeof response.toolCallId !== "string") ||
    (response.toolId !== undefined && typeof response.toolId !== "string") ||
    (response.toolFingerprint !== undefined && typeof response.toolFingerprint !== "string") ||
    (response.riskClass !== undefined && typeof response.riskClass !== "string") ||
    (response.source !== undefined && typeof response.source !== "string") ||
    (response.argumentsHash !== undefined && typeof response.argumentsHash !== "string") ||
    (response.policyState !== undefined &&
      typeof response.policyState !== "string" &&
      response.policyState !== null) ||
    (response.approvalId !== undefined &&
      typeof response.approvalId !== "string" &&
      response.approvalId !== null) ||
    (response.approvalExpiresAt !== undefined &&
      typeof response.approvalExpiresAt !== "string" &&
      response.approvalExpiresAt !== null) ||
    (response.reason !== undefined &&
      typeof response.reason !== "string" &&
      response.reason !== null) ||
    (response.reasonCode !== undefined &&
      typeof response.reasonCode !== "string" &&
      response.reasonCode !== null)
  );
}

function isKnownApprovalMode(value: unknown): value is "session" | "per_use" {
  return value === "session" || value === "per_use";
}

function isApprovalMode(value: unknown): boolean {
  return value === undefined || value === null || isKnownApprovalMode(value);
}

function isValidPolicyVersion(value: unknown): boolean {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0;
}

function isExpiredTimestamp(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function isContextRecord(value: unknown): value is LumiManagedExecutionContext {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalContext(context: LumiManagedExecutionContext): boolean {
  const hasLocalMode = context.mode === "local";
  const hasManagedMode = context.mode === "managed" || context.executionMode === "managed";
  const hasLocalExecutionMode = context.executionMode === "local_only";
  // A contradictory client/host projection is not local. It is an invalid
  // managed context and is rejected by the caller.
  return (hasLocalMode || hasLocalExecutionMode) && !hasManagedMode;
}

function hasConflictingManagedModes(context: LumiManagedExecutionContext): boolean {
  const local = context.mode === "local" || context.executionMode === "local_only";
  const managed = context.mode === "managed" || context.executionMode === "managed";
  return local && managed;
}

function isContractManagedExecutionContext(
  context: LumiManagedExecutionContext,
): context is LumiManagedExecutionContext & ContractManagedRunContext {
  return (
    isOpaqueId(context.organizationId, "org") &&
    isOpaqueId(context.projectId, "prj") &&
    isOpaqueId(context.deviceId, "dvc") &&
    isOpaqueId(context.agentSessionId, "rse") &&
    isOpaqueId(context.runId, "run") &&
    isOpaqueId(context.agentDefinitionId, "agd") &&
    Number.isSafeInteger(context.agentDefinitionVersion) &&
    (context.agentDefinitionVersion as number) > 0 &&
    isOpaqueId(context.requestId, "req") &&
    (context.executionMode === "managed" || context.executionMode === "local_only") &&
    (context.externalId === undefined || isSafeVisibleId(context.externalId)) &&
    (context.policySnapshotId === undefined || isOpaqueId(context.policySnapshotId, "pol")) &&
    (context.policyVersion === undefined ||
      (Number.isSafeInteger(context.policyVersion) && (context.policyVersion as number) >= 0))
  );
}

function isOpaqueId(value: unknown, prefix: string): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(value);
}

function isSafeVisibleId(value: string): boolean {
  return value.length > 0 && value.length <= 256 && /^[\x21-\x7e]+$/.test(value);
}

function isUnavailablePolicyState(value: unknown): boolean {
  if (value === undefined) return false;
  if (value === null) return true;
  if (typeof value !== "string") return true;
  const normalized = value.trim().toLowerCase();
  return !["ok", "available", "valid", "ready"].includes(normalized);
}

function safeReasonCode(value: unknown): string {
  if (typeof value !== "string") return "tool_denied";
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(normalized)) return "tool_denied";
  return normalized;
}
