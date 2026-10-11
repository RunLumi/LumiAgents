/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type {
  ZCodeManagedToolDecisionRequestParams,
  ZCodeManagedToolIdentityRequest,
  ZCodeManagedToolResultRequestParams,
} from "@zcode/shared";
import type { LumiAccountHostTransport } from "@zcode/services/node";
import type { createLumiDeviceOwner } from "./lumiDeviceOwner.js";
import { waitForLumiManagedApproval } from "./lumiManagedApprovalWait.js";
import {
  assertManagedRunLeaseCurrent,
  type ManagedRunAuthRequestIdentity,
  type ManagedRunLeaseIdentity,
} from "./lumiManagedRunAuthorization.js";

/** The part of the Main-owned lease this admission path needs; the lease itself stays in Main. */
export interface ManagedToolLease extends ManagedRunLeaseIdentity {
  deviceOwner: Pick<
    ReturnType<typeof createLumiDeviceOwner>,
    "requestManagedToolDecision" | "reportManagedToolResult"
  >;
}

/**
 * Callbacks into the account owner. Admission never holds a lease map or credential: every
 * decision re-reads the live lease through `lease` and re-authorizes through `authorize`.
 */
export interface ManagedToolAdmissionPorts<L extends ManagedToolLease> {
  lease(runId: string): L | undefined;
  authorize(request: ManagedRunAuthRequestIdentity): Promise<unknown>;
  resolveIdentity: LumiAccountHostTransport["resolveReviewedToolIdentity"];
}

export function createLumiManagedToolAdmission<L extends ManagedToolLease>(
  ports: ManagedToolAdmissionPorts<L>,
) {
  /** 工具不能自行绑定本地会话；必须复用已经通过推理请求验证的 Main lease。 */
  const boundLease = (
    context: ZCodeManagedToolDecisionRequestParams["context"],
    sessionId: string,
    refusal: string,
  ): L => {
    const lease = ports.lease(context.runId);
    if (!lease?.hostSessionId || lease.hostSessionId !== sessionId) throw new Error(refusal);
    return lease;
  };
  const authorize = (
    lease: L,
    workspaceIdentity: string,
    sessionId: string,
    managedContext: ZCodeManagedToolDecisionRequestParams["context"],
  ) =>
    ports.authorize({
      sessionId,
      workspaceIdentity,
      providerId: "lumi-managed",
      modelId: lease.modelAlias,
      managedContext,
    });
  const decideOnce = async (input: {
    workspaceIdentity: string;
    params: ZCodeManagedToolDecisionRequestParams;
  }) => {
    const { params } = input;
    const lease = boundLease(params.context, params.sessionId, "lumi_managed_tool_refused");
    await authorize(lease, input.workspaceIdentity, params.sessionId, params.context);
    const result = await lease.deviceOwner.requestManagedToolDecision(params);
    assertManagedRunLeaseCurrent(lease, ports.lease(params.context.runId));
    return result;
  };
  return {
    requestManagedToolDecision: (input: Parameters<typeof decideOnce>[0]) =>
      waitForLumiManagedApproval(() => decideOnce(input)),
    async resolveManagedToolIdentity(input: {
      workspaceIdentity: string;
      params: ZCodeManagedToolIdentityRequest;
    }) {
      const { params } = input;
      const lease = boundLease(params.context, params.sessionId, "lumi_identity_refused");
      await authorize(lease, input.workspaceIdentity, params.sessionId, params.context);
      const identity = await ports.resolveIdentity(params.context.organizationId, params.tool);
      assertManagedRunLeaseCurrent(lease, ports.lease(params.context.runId));
      return { runId: params.context.runId, identity: identity ?? null };
    },
    async reportManagedToolResult(input: {
      workspaceIdentity: string;
      params: ZCodeManagedToolResultRequestParams;
    }) {
      const { params } = input;
      const lease = boundLease(params.context, params.sessionId, "lumi_managed_result_refused");
      await authorize(lease, input.workspaceIdentity, params.sessionId, params.context);
      await lease.deviceOwner.reportManagedToolResult(params);
      assertManagedRunLeaseCurrent(lease, ports.lease(params.context.runId));
      return {
        recorded: true as const,
        runId: params.context.runId,
        toolCallId: params.toolCallId,
        status: params.status,
      };
    },
  };
}
