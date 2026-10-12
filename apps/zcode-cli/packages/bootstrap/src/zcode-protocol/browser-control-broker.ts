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
 * 一个 server context 的 broker 状态。同一 context 里 broker 被造两次——进程级 node_repl broker 用的
 * 那个（server.ts）与每个 app 的 runtime 端口（server-operations.ts）——状态必须共享。
 *
 * Bug 根因（2026-09-30）：连接记忆原来存在各自的闭包里。node_repl 的 execute 记在进程级实例，
 * runtime 的 turnEnded / closeSession 走 app 实例，那里只见过 app 实例自己发的命令（轮尾截图），
 * 于是生命周期只在恰好截过图的轮次才到达桌面（桌面日志 2026-09-30：会话 sess_fc6b0f61 用了
 * Browser，一条 turnEnded 都没有）。子会话登记同理：actor runtime 在 app 实例上登记，actor 的浏览器
 * 请求却经进程级实例到达。
 */
interface ProtocolBrowserBrokerState {
  connectionsBySession: Map<string, Map<string, { browserId: string; browserGeneration: number }>>;
  /** 客户端不认识的子会话（dwf / core Agent 子代理）→ 发起它的客户端会话。只由 forChildSession 写入。 */
  childSessionParents: Map<string, string>;
  /** 以父会话为 tab 归属的子会话（core Agent 子代理，tabOwner: "parent"）。 */
  parentTabOwnerChildren: Set<string>;
}

const brokerStateByContext = new WeakMap<
  ZCodeProtocolAgentServerContext,
  ProtocolBrowserBrokerState
>();

function brokerState(context: ZCodeProtocolAgentServerContext): ProtocolBrowserBrokerState {
  let state = brokerStateByContext.get(context);
  if (!state) {
    state = {
      connectionsBySession: new Map(),
      childSessionParents: new Map(),
      parentTabOwnerChildren: new Set(),
    };
    brokerStateByContext.set(context, state);
  }
  return state;
}

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

/**
 * P05-CR-005 step 1: a session (or the client session that started a child session) that received
 * Lumi managed input requires a managed decision for every browser command. Without one the command
 * is refused instead of degrading to local-personal, which let an approved Browser Use call bypass
 * the organization's browser policy.
 */
function isManagedBrowserSession(
  context: ZCodeProtocolAgentServerContext,
  state: ProtocolBrowserBrokerState,
  sessionId: string,
): boolean {
  const parentSessionId = state.childSessionParents.get(sessionId);
  return (
    context.sessions.get(sessionId)?.lumiManagedSession === true ||
    (parentSessionId !== undefined &&
      context.sessions.get(parentSessionId)?.lumiManagedSession === true)
  );
}

export function createProtocolBrowserControlBroker(
  context: ZCodeProtocolAgentServerContext,
  options: ProtocolBrowserPolicyOptions = {},
): BrowserControlPort {
  const state = brokerState(context);
  const { connectionsBySession, childSessionParents } = state;

  const rememberConnection = (sessionId: string, browserId: string, browserGeneration: number) => {
    const connections = connectionsBySession.get(sessionId) ?? new Map();
    connections.set(`${browserId}\u0000${browserGeneration}`, { browserId, browserGeneration });
    connectionsBySession.set(sessionId, connections);
  };

  const sendLifecycle = async (
    sessionId: string,
    turnId: string | undefined,
    command:
      | { method: "turnEnded"; turnId?: string }
      | { method: "closeSession"; closeTabs?: boolean },
  ): Promise<void> => {
    const connections = [...(connectionsBySession.get(sessionId)?.values() ?? [])];
    await Promise.allSettled(
      connections.map(({ browserId, browserGeneration }) =>
        context.requestClient(
          zcodeProtocolMethods.interactionBrowserExecute,
          {
            ...buildBrowserRequestContext(context, state, { sessionId, turnId }),
            browserId,
            browserGeneration,
            command,
          },
          zcodeBrowserExecuteResultSchema,
        ),
      ),
    );
  };

  const port: BrowserControlPort = {
    async list({ sessionId, turnId, traceContext, signal }) {
      const result = await context.requestClient(
        zcodeProtocolMethods.interactionBrowserList,
        buildBrowserRequestContext(context, state, { sessionId, turnId, traceContext }),
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
      const requestContext = buildBrowserRequestContext(context, state, {
        sessionId,
        turnId,
        traceContext,
      });
      // P05-INT-04：policy 判定必须早于 requestClient。放到 transport 之后，被 deny
      // 或过期的 browser 动作已经进了 host 队列，与 "checked before use" 冲突。
      // cancelRequest 是对已通过校验的请求的取消，不重复要求 policy。
      if (command.method !== "cancelRequest") {
        // 子会话（dwf / core Agent 子代理）不是登记的会话：workspace 沿用 buildBrowserRequestContext
        // 已按父会话解析并校验过的结果，不再按子会话 id 重查（否则子代理的浏览器请求被误拒）。
        const workspaceIdentity = requestContext.workspaceIdentity;
        // `@zcode/contracts` mirrors the browser command shape to avoid a zod v3/v4
        // cross-package coupling; round-trip tests keep it in sync with @zcode/shared.
        const argumentsSummary = summarizeBrowserPolicyCommand(command as BrowserCommand);
        const authorization = await authorizeBrowserComputerAction({
          ...(options.policyGate ? { gate: options.policyGate } : {}),
          ...(options.requireManagedPolicy || isManagedBrowserSession(context, state, sessionId)
            ? { requireManagedPolicy: true }
            : {}),
          ...(signal ? { signal } : {}),
          request: {
            surface: "browser",
            sessionId,
            ...(requestContext.turnId ? { turnId: requestContext.turnId } : {}),
            workspaceKey: requestContext.workspaceKey,
            workspacePath: requestContext.workspacePath,
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
      // 先过会话校验再记连接：被拒的请求（未登记 / 已关闭的子会话）不得在共享状态里留下条目。
      // 连接记在实际下发的 tab 归属下：共用父会话 tab 的子代理，其连接要由父会话的生命周期收尾。
      rememberConnection(requestContext.sessionId, browserId, browserGeneration);
      const cancelBackendRequest = () => {
        // 只取消 agent 侧 requestClient 会让 host/main 的 CDP 动作继续执行。
        // 这里用同一 backend/generation 发送内部 cancelRequest，main 再按原 requestId 中断 waiter；
        // 已下发动作无法证明无副作用时由 manager 返回 uncertain 标记。
        void context
          .requestClient(
            zcodeProtocolMethods.interactionBrowserExecute,
            {
              ...buildBrowserRequestContext(context, state, { sessionId, turnId, traceContext }),
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

    forChildSession({ childSessionId, parentSessionId, tabOwner = "child" }) {
      childSessionParents.set(childSessionId, parentSessionId);
      if (tabOwner === "parent") {
        state.parentTabOwnerChildren.add(childSessionId);
        const release = () => {
          if (childSessionParents.get(childSessionId) !== parentSessionId) return;
          childSessionParents.delete(childSessionId);
          state.parentTabOwnerChildren.delete(childSessionId);
        };
        // tab 属于当前对话：子代理的轮次结束或运行结束都不能替父会话结束 / 关闭 tab，
        // 那会把用户正在看的 tab 释放掉。收尾由父会话自己的 turnEnded / closeSession 负责。
        return {
          list: port.list,
          execute: port.execute,
          async turnEnded() {},
          async closeSession() {
            release();
          },
        };
      }
      return {
        list: port.list,
        execute: port.execute,
        turnEnded: port.turnEnded,
        async closeSession({ sessionId, turnId }) {
          try {
            // 子会话永远不会作为对话回来认领 tab：保留的 view 无人可见，只会挂着 guest。
            await sendLifecycle(sessionId, turnId, { method: "closeSession", closeTabs: true });
          } finally {
            connectionsBySession.delete(sessionId);
            if (childSessionParents.get(childSessionId) === parentSessionId) {
              childSessionParents.delete(childSessionId);
            }
          }
        },
      };
    },
  };
  return port;
}

function buildBrowserRequestContext(
  context: ZCodeProtocolAgentServerContext,
  state: ProtocolBrowserBrokerState,
  input: {
    sessionId: string;
    turnId?: string;
    traceContext?: TraceContext;
  },
) {
  // 子会话的 workspace / clientMode 取发起它的客户端会话；下发的 sessionId 是桌面 browser scope 的
  // tab 归属，不是路由身份（docs/zcode-protocol-model-backed-control-requests.md 契约 4）：dwf 子代理用
  // 子会话自己的，core Agent 子代理用父会话的。没有登记就按原 id 找，找不到即拒。
  const parentSessionId = state.childSessionParents.get(input.sessionId);
  const record = requireSession(context, parentSessionId ?? input.sessionId);
  const workspaceIdentity = record.workspace.workspaceIdentity?.trim() || undefined;
  const remoteSessionId = record.workspace.remoteSessionId?.trim() || undefined;
  const workspacePath = record.workspace.workspacePath;

  return {
    requestId: randomUUID(),
    // core Agent 子代理共用父会话的 tab：桌面按 sessionId 判断 tab 归属与面板展开，
    // 子会话 id 桌面不认识，用它开的 tab 既不展开面板、也不出现在任何对话里。
    sessionId:
      parentSessionId !== undefined && state.parentTabOwnerChildren.has(input.sessionId)
        ? parentSessionId
        : input.sessionId,
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
