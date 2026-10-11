/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { ManagedToolDecisionPort } from "@zcode/contracts";
import {
  zcodeManagedToolDecisionRequestParamsSchema,
  zcodeManagedToolDecisionResultSchema,
  zcodeManagedToolResultRequestParamsSchema,
  zcodeManagedToolResultAckSchema,
  zcodeManagedRuntimeCapabilitiesRequestSchema,
  zcodeManagedRuntimeCapabilitiesAckSchema,
  zcodeManagedToolIdentityRequestSchema,
  zcodeManagedToolIdentityResolutionSchema,
  zcodeProtocolMethods,
} from "@zcode/shared";
import {
  protocolTraceFromTraceContext,
  type ZCodeProtocolAgentServerContext,
} from "./server-types.js";

/** Main owns credentials; this port sends only the strict per-turn metadata. */
export function createManagedToolDecisionPort(
  context: Pick<ZCodeProtocolAgentServerContext, "requestClient">,
): ManagedToolDecisionPort {
  return {
    async resolveIdentity(request, options) {
      if (request.traceId !== request.trace.traceId) throw new Error("managed_trace_mismatch");
      const params = zcodeManagedToolIdentityRequestSchema.parse({
        context: request.context,
        traceId: request.traceId,
        sessionId: request.sessionId,
        tool: request.tool,
      });
      const reply = await context.requestClient(
        zcodeProtocolMethods.interactionResolveManagedToolIdentity,
        params,
        zcodeManagedToolIdentityResolutionSchema,
        {
          signal: options?.signal,
          trace: protocolTraceFromTraceContext(request.trace),
          timeoutMs: 45_000,
        },
      );
      if (reply.runId !== request.context.runId) throw new Error("managed_identity_scope_mismatch");
      return reply.identity ?? undefined;
    },
    async reportRuntimeCapabilities(request, options) {
      if (request.traceId !== request.trace.traceId) throw new Error("managed_trace_mismatch");
      const params = zcodeManagedRuntimeCapabilitiesRequestSchema.parse({
        context: request.context,
        traceId: request.traceId,
        sessionId: request.sessionId,
        capabilities: request.capabilities,
      });
      const ack = await context.requestClient(
        zcodeProtocolMethods.interactionReportRuntimeCapabilities,
        params,
        zcodeManagedRuntimeCapabilitiesAckSchema,
        {
          signal: options?.signal,
          trace: protocolTraceFromTraceContext(request.trace),
          timeoutMs: 45_000,
        },
      );
      if (ack.runId !== request.context.runId) throw new Error("managed_capabilities_scope_mismatch");
    },
    async reportResult(request, status) {
      if (request.traceId !== request.trace.traceId) throw new Error("managed_trace_mismatch");
      const params = zcodeManagedToolResultRequestParamsSchema.parse({
        context: request.context,
        traceId: request.traceId,
        sessionId: request.sessionId,
        toolCallId: request.toolCallId,
        status,
      });
      const ack = await context.requestClient(
        zcodeProtocolMethods.interactionReportManagedToolResult,
        params,
        zcodeManagedToolResultAckSchema,
        { trace: protocolTraceFromTraceContext(request.trace), timeoutMs: 45_000 },
      );
      if (
        ack.runId !== request.context.runId ||
        ack.toolCallId !== request.toolCallId ||
        ack.status !== status
      )
        throw new Error("managed_result_ack_mismatch");
    },
    async requestDecision(request, options) {
      if (request.traceId !== request.trace.traceId) throw new Error("managed_trace_mismatch");
      const params = zcodeManagedToolDecisionRequestParamsSchema.parse({
        context: request.context,
        traceId: request.traceId,
        sessionId: request.sessionId,
        ...(request.taskId ? { taskId: request.taskId } : {}),
        toolCallId: request.toolCallId,
        localToolCallId: request.localToolCallId,
        ...(request.turnId ? { turnId: request.turnId } : {}),
        tool: request.tool,
        argumentsSummary: request.argumentsSummary,
        argumentsHash: request.argumentsHash,
      });
      return context.requestClient(
        zcodeProtocolMethods.interactionRequestManagedToolDecision,
        params,
        zcodeManagedToolDecisionResultSchema,
        {
          signal: options?.signal ?? request.signal,
          trace: protocolTraceFromTraceContext(request.trace),
          timeoutMs: 940_000,
        },
      );
    },
  };
}
