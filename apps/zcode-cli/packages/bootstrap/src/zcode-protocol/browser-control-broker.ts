import { createHash, randomUUID } from "node:crypto";
import type { BrowserControlPort, TraceContext } from "@zcode/contracts";
import {
  authorizeBrowserComputerAction,
  managedInvocationFingerprintInput,
  summarizeBrowserPolicyCommand,
  zcodeBrowserExecuteResultSchema,
  zcodeBrowserListResultSchema,
  zcodeProtocolMethods,
  type BrowserCommand,
  type BrowserComputerPolicyGate,
} from "@zcode/shared";
import {
  protocolTraceFromTraceContext,
  requireSession,
  type ZCodeProtocolAgentServerContext,
  type ZCodeProtocolClientRequestOptions,
} from "./server-types.js";

/**
 * ProtocolBrowserControlBroker —— agent 侧 BrowserControlPort 实现。
 *
 * browser-client 的 agent.browsers.* 每个调用经此把一条 BrowserCommand 变成
 * ZCode Protocol 的 interaction/browserExecute 反向请求，由 app（host→main WebContentsView/CDP）
 * 执行并返回结果。与 permission broker 并列注入（server-operations 的 createWorkspaceZCodeApp options）。
 *
 * P05-INT-04：这是 agent 侧第一个能拦住 browser 动作的位置，deny 之后命令根本不会
 * 进入 protocol transport。桌面 host 侧仍会独立再校验一次（defense in depth）：
 * 只有一端校验等于没有校验。
 */

export interface ProtocolBrowserPolicyOptions {
  /** Host/injector-owned managed policy gate. */
  policyGate?: BrowserComputerPolicyGate;
  /**
   * P05-INT-04 fail-closed switch. Managed organization hosts MUST set this so a
   * missing managed run context denies instead of degrading to local-personal.
   */
  requireManagedPolicy?: boolean;
}

function policyDeniedResult(code: string): {
  ok: false;
  error: { code: "policy_denied"; message: string; sideEffect: "none" };
  elapsedMs: number;
} {
  return {
    ok: false,
    error: { code: "policy_denied", message: browserPolicyDenialMessage(code), sideEffect: "none" },
    elapsedMs: 0,
  };
}

/** Stable, non-sensitive refusal text. Must not echo policy or approval contents. */
function browserPolicyDenialMessage(code: string): string {
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

export function createProtocolBrowserControlBroker(
  context: ZCodeProtocolAgentServerContext,
  options: ProtocolBrowserPolicyOptions = {},
): BrowserControlPort {
  const connectionsBySession = new Map<
    string,
    Map<string, { browserId: string; browserGeneration: number }>
  >();

  const rememberConnection = (sessionId: string, browserId: string, browserGeneration: number) => {
    const connections = connectionsBySession.get(sessionId) ?? new Map();
    connections.set(`${browserId}\u0000${browserGeneration}`, { browserId, browserGeneration });
    connectionsBySession.set(sessionId, connections);
  };

  const sendLifecycle = async (
    sessionId: string,
    turnId: string | undefined,
    command: { method: "turnEnded"; turnId?: string } | { method: "closeSession" },
  ): Promise<void> => {
    const connections = [...(connectionsBySession.get(sessionId)?.values() ?? [])];
    await Promise.allSettled(
      connections.map(({ browserId, browserGeneration }) =>
        context.requestClient(
          zcodeProtocolMethods.interactionBrowserExecute,
          {
            ...buildBrowserRequestContext(context, { sessionId, turnId }),
            browserId,
            browserGeneration,
            command,
          },
          zcodeBrowserExecuteResultSchema,
        ),
      ),
    );
  };

  return {
    async list({ sessionId, turnId, traceContext, signal }) {
      const result = await context.requestClient(
        zcodeProtocolMethods.interactionBrowserList,
        buildBrowserRequestContext(context, { sessionId, turnId, traceContext }),
        zcodeBrowserListResultSchema,
        buildRequestOptions(traceContext, signal),
      );
      return result.browsers;
    },

    async execute({
      browserId,
      browserGeneration,
      sessionId,
      turnId,
      command,
      traceContext,
      signal,
      managed,
    }) {
      rememberConnection(sessionId, browserId, browserGeneration);
      const requestContext = buildBrowserRequestContext(context, {
        sessionId,
        turnId,
        traceContext,
      });
      // P05-INT-04：policy 判定必须早于 requestClient。放到 transport 之后，被 deny
      // 或过期的 browser 动作已经进了 host 队列，与 "checked before use" 冲突。
      // cancelRequest 是对已通过校验的请求的取消，不重复要求 policy。
      if (command.method !== "cancelRequest") {
        const record = requireSession(context, sessionId);
        const workspaceIdentity = record.workspace.workspaceIdentity?.trim() || undefined;
        // `@zcode/contracts` mirrors the browser command shape to avoid a zod v3/v4
        // cross-package coupling; round-trip tests keep it in sync with @zcode/shared.
        const argumentsSummary = summarizeBrowserPolicyCommand(command as BrowserCommand);
        const authorization = await authorizeBrowserComputerAction({
          ...(options.policyGate ? { gate: options.policyGate } : {}),
          ...(options.requireManagedPolicy ? { requireManagedPolicy: true } : {}),
          ...(signal ? { signal } : {}),
          request: {
            surface: "browser",
            sessionId,
            ...(requestContext.turnId ? { turnId: requestContext.turnId } : {}),
            workspaceKey: requestContext.workspaceKey,
            workspacePath: record.workspace.workspacePath,
            ...(workspaceIdentity ? { workspaceIdentity } : {}),
            ...(requestContext.remoteSessionId
              ? { remoteSessionId: requestContext.remoteSessionId }
              : {}),
            requestId: requestContext.requestId,
            toolName: "browser",
            invocationFingerprint: createHash("sha256")
              .update(
                managedInvocationFingerprintInput({
                  surface: "browser",
                  sessionId,
                  ...(requestContext.turnId ? { turnId: requestContext.turnId } : {}),
                  toolName: "browser",
                  argumentsSummary,
                  payload: command,
                }),
              )
              .digest("hex"),
            argumentsSummary,
            // The contracts mirror keeps capabilityIds readonly; the shared zod
            // contract infers a mutable array, so copy it at this boundary.
            ...(managed
              ? { managed: { ...managed, capabilityIds: [...managed.capabilityIds] } }
              : {}),
          },
        });
        if (!authorization.allowed) return policyDeniedResult(authorization.code);
      }
      const cancelBackendRequest = () => {
        // 只取消 agent 侧 requestClient 会让 host/main 的 CDP 动作继续执行。
        // 这里用同一 backend/generation 发送内部 cancelRequest，main 再按原 requestId 中断 waiter；
        // 已下发动作无法证明无副作用时由 manager 返回 uncertain 标记。
        void context
          .requestClient(
            zcodeProtocolMethods.interactionBrowserExecute,
            {
              ...buildBrowserRequestContext(context, { sessionId, turnId, traceContext }),
              browserId,
              browserGeneration,
              command: { method: "cancelRequest", requestId: requestContext.requestId },
            },
            zcodeBrowserExecuteResultSchema,
            buildRequestOptions(traceContext, undefined),
          )
          .catch(() => undefined);
      };
      if (signal?.aborted) cancelBackendRequest();
      else signal?.addEventListener("abort", cancelBackendRequest, { once: true });
      try {
        return await context.requestClient(
          zcodeProtocolMethods.interactionBrowserExecute,
          {
            ...requestContext,
            browserId,
            browserGeneration,
            command,
          },
          zcodeBrowserExecuteResultSchema,
          buildRequestOptions(traceContext, signal),
        );
      } finally {
        signal?.removeEventListener("abort", cancelBackendRequest);
      }
    },

    async turnEnded({ sessionId, turnId }) {
      await sendLifecycle(sessionId, turnId, { method: "turnEnded", turnId });
    },

    async closeSession({ sessionId, turnId }) {
      await sendLifecycle(sessionId, turnId, { method: "closeSession" });
      connectionsBySession.delete(sessionId);
    },
  };
}

function buildBrowserRequestContext(
  context: ZCodeProtocolAgentServerContext,
  input: {
    sessionId: string;
    turnId?: string;
    traceContext?: TraceContext;
  },
) {
  const record = requireSession(context, input.sessionId);
  const workspaceIdentity = record.workspace.workspaceIdentity?.trim() || undefined;
  const remoteSessionId = record.workspace.remoteSessionId?.trim() || undefined;
  const workspacePath = record.workspace.workspacePath;

  return {
    requestId: randomUUID(),
    sessionId: input.sessionId,
    ...((input.turnId ?? input.traceContext?.turnId)
      ? { turnId: String(input.turnId ?? input.traceContext?.turnId) }
      : {}),
    // workspacePath 可能在不同 remote workspace 中相同，隔离 key 必须优先使用
    // workspaceIdentity，避免 browser backend/tab ownership 跨工作区串线。
    workspaceKey: workspaceIdentity ?? workspacePath,
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(remoteSessionId ? { remoteSessionId } : {}),
    clientMode: record.deliveryKind ?? "desktop-continuous",
    sessionContext: "live" as const,
  };
}

function buildRequestOptions(
  traceContext: TraceContext | undefined,
  signal: AbortSignal | undefined,
): ZCodeProtocolClientRequestOptions {
  return {
    ...(signal ? { signal } : {}),
    ...(traceContext ? { trace: protocolTraceFromTraceContext(traceContext) } : {}),
  };
}
