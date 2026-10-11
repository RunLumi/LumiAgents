import type { ZCodeManagedRunContext } from "@zcode/shared";

export interface ManagedRunLeaseIdentity {
  context: ZCodeManagedRunContext;
  workspaceIdentity: string;
  modelAlias: string;
  hostSessionId?: string;
}

/** One Main-memory lease table entry; never persisted, never sent to renderer/Host/agent. */
export interface ManagedRunLeaseEntry<D> extends ManagedRunLeaseIdentity {
  deviceOwner: D;
  /** Last Main-validated registry snapshot from this lease's Host session. */
  runtimeCapabilities?: import("@zcode/shared").ZCodeManagedRuntimeCapabilities;
  runtimeCapabilityQueue?: Promise<void>;
  /** Present only for a P06 occurrence run: ends the P06 lease after the P05 terminal call. */
  automation?: import("./lumiManagedAutomationRuntime.js").AutomationRunHooks;
}

export interface ManagedRunAuthRequestIdentity {
  sessionId: string;
  workspaceIdentity: string;
  providerId: string;
  modelId: string;
  managedContext: ZCodeManagedRunContext;
}

/** Reject a late reply after logout/settlement removed or replaced its exact lease. */
export function assertManagedRunLeaseCurrent(
  expected: ManagedRunLeaseIdentity,
  current: ManagedRunLeaseIdentity | undefined,
) {
  if (expected !== current) throw new Error("lumi_managed_auth_refused");
}

export function assertManagedRunLeaseMatch(
  lease: ManagedRunLeaseIdentity | undefined,
  request: ManagedRunAuthRequestIdentity,
): asserts lease is ManagedRunLeaseIdentity {
  if (!lease) throw new Error("lumi_managed_auth_refused");
  const expected = lease.context;
  const actual = request.managedContext;
  if (
    request.providerId !== "lumi-managed" ||
    actual.executionMode !== "managed" ||
    request.workspaceIdentity !== lease.workspaceIdentity ||
    request.modelId !== lease.modelAlias ||
    (lease.hostSessionId !== undefined && lease.hostSessionId !== request.sessionId) ||
    actual.organizationId !== expected.organizationId ||
    actual.projectId !== expected.projectId ||
    actual.deviceId !== expected.deviceId ||
    actual.agentSessionId !== expected.agentSessionId ||
    actual.runId !== expected.runId ||
    actual.agentDefinitionId !== expected.agentDefinitionId ||
    actual.agentDefinitionVersion !== expected.agentDefinitionVersion ||
    actual.requestId !== expected.requestId ||
    actual.externalId !== expected.externalId ||
    actual.executionMode !== expected.executionMode ||
    actual.policySnapshotId !== expected.policySnapshotId ||
    actual.policyVersion !== expected.policyVersion
  )
    throw new Error("lumi_managed_auth_refused");
}
