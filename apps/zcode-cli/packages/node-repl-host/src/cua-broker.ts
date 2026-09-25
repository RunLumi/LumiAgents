import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComputerUseRuntime, ComputerUseRuntimeContext } from "@zcode/zcode-cua";
import type { Logger } from "@zcode/contracts";
import {
  authorizeBrowserComputerAction,
  isManagedPolicyContext,
  managedInvocationFingerprintInput,
  type BrowserComputerPolicyGate,
  type ManagedPolicyContext,
  type ManagedPolicyFailureCode,
  type ManagedPolicyRequest,
} from "@zcode/shared";
import type { NodeReplCuaBrokerConnection } from "./cua-bridge.js";

const MAX_REQUEST_BYTES = 1024 * 1024;

export interface NodeReplCuaPolicyOptions {
  /**
   * Host-owned managed policy gate. Owns the device token, the versioned policy
   * document, and the approval handshake; the broker never talks to the control
   * plane itself.
   */
  policyGate?: BrowserComputerPolicyGate;
  /**
   * P05-INT-04 fail-closed switch. A host that only ever executes managed
   * organization runs MUST set this, otherwise an unresolvable managed context
   * degrades into local-personal execution.
   */
  requireManagedPolicy?: boolean;
}

export interface NodeReplCuaBroker {
  connection: NodeReplCuaBrokerConnection;
  ready: Promise<void>;
  close(): Promise<void>;
}

export function createNodeReplCuaBroker(
  input: {
    runtime: ComputerUseRuntime;
    logger?: Logger;
    platform?: NodeJS.Platform | string;
  } & NodeReplCuaPolicyOptions,
): NodeReplCuaBroker {
  const socketPath =
    input.platform === "win32"
      ? `\\\\.\\pipe\\zcode-node-repl-cua-${randomUUID()}`
      : join(tmpdir(), `znrc-${randomUUID()}.sock`);
  const token = randomBytes(32).toString("hex");
  const server = createServer((socket) => {
    void handleSocket(socket, input, token).catch((error) => {
      input.logger?.warn("Node REPL CUA broker request failed", {
        event: "node_repl.cua_broker.request.failed",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  server.on("error", (error) => {
    input.logger?.error("Node REPL CUA broker failed", error, {
      event: "node_repl.cua_broker.failed",
    });
  });
  server.listen(socketPath);
  server.unref();
  const ready = new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return {
    connection: { socketPath, token },
    ready,
    close: async () => {
      await ready.catch(() => undefined);
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
      if (input.platform !== "win32") await rm(socketPath, { force: true });
    },
  };
}

/**
 * P05-INT-04: this socket handler is the last boundary before
 * `ComputerUseRuntime.execute` reaches the real screen, keyboard, and mouse, so
 * managed organization policy is resolved here, immediately before dispatch.
 *
 * The guard does not make computer use executable. `@zcode/zcode-cua` is still a
 * staging placeholder in this build, and an allowed call still returns whatever
 * the runtime returns, including the placeholder's "Computer Use is not
 * available in this build" error. The guard only decides whether a call may be
 * dispatched at all.
 */
async function handleSocket(
  socket: Socket,
  input: { runtime: ComputerUseRuntime } & NodeReplCuaPolicyOptions,
  token: string,
): Promise<void> {
  const abortController = new AbortController();
  let completed = false;
  let requestId: string | undefined;
  socket.on("error", () => {
    if (!completed) abortController.abort();
  });
  socket.once("close", () => {
    if (!completed) abortController.abort();
  });
  try {
    const raw = await readLine(socket, abortController.signal);
    const payload = JSON.parse(raw) as {
      id?: unknown;
      token?: unknown;
      method?: unknown;
      input?: unknown;
      context?: unknown;
    };
    assertToken(payload.token, token);
    if (typeof payload.id !== "string" || typeof payload.method !== "string") {
      throw new Error("Computer Use broker request is invalid");
    }
    requestId = payload.id;
    const { context, managed } = parseContext(payload.context);
    const authorization = await authorizeComputerUseAction({
      ...(input.policyGate ? { policyGate: input.policyGate } : {}),
      ...(input.requireManagedPolicy ? { requireManagedPolicy: true } : {}),
      requestId: payload.id,
      toolName: payload.method,
      sessionId: context.sessionId,
      runtimeScope: context.runtimeScope,
      workspaceKey: context.workspaceKey,
      ...(context.workspacePath ? { workspacePath: context.workspacePath } : {}),
      ...(context.workspaceIdentity ? { workspaceIdentity: context.workspaceIdentity } : {}),
      ...(context.remoteSessionId ? { remoteSessionId: context.remoteSessionId } : {}),
      ...(context.turnId ? { turnId: context.turnId } : {}),
      ...(managed ? { managed } : {}),
      signal: abortController.signal,
    });
    if (!authorization.allowed) {
      completed = true;
      if (socket.writable) {
        socket.end(
          `${JSON.stringify({
            id: payload.id,
            ok: false,
            error: authorization.message,
            reasonCode: authorization.code,
            sideEffect: "none",
          })}\n`,
        );
      }
      return;
    }
    const result = await input.runtime.execute({
      // 这里把 capability method 适配到 staging runtime 的内部 handler；
      // 外层 SDK/bridge 不再构造或调用 MCP tool envelope。
      toolName: payload.method as never,
      arguments: payload.input,
      context,
      signal: abortController.signal,
    });
    completed = true;
    if (socket.writable) socket.end(`${JSON.stringify({ id: payload.id, ok: true, result })}\n`);
  } catch (error) {
    completed = true;
    if (socket.writable) {
      socket.end(
        `${JSON.stringify({ id: requestId ?? null, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
      );
    }
  }
}

function assertToken(actualValue: unknown, expectedValue: string): void {
  if (typeof actualValue !== "string")
    throw new Error("Computer Use broker request is not authorized");
  const actual = Buffer.from(actualValue);
  const expected = Buffer.from(expectedValue);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Computer Use broker request is not authorized");
  }
}

function parseContext(value: unknown): {
  context: ComputerUseRuntimeContext;
  managed?: ManagedPolicyContext;
} {
  if (!value || typeof value !== "object")
    throw new Error("Computer Use request context is missing");
  const context = value as Record<string, unknown>;
  if (typeof context.sessionId !== "string" || !context.sessionId.trim()) {
    throw new Error("Computer Use request context is missing sessionId");
  }
  const workspacePath =
    typeof context.workspacePath === "string" ? context.workspacePath.trim() : "";
  const workspaceIdentity =
    typeof context.workspaceIdentity === "string" ? context.workspaceIdentity.trim() : "";
  const workspaceKey =
    (typeof context.workspaceKey === "string" ? context.workspaceKey.trim() : "") ||
    workspaceIdentity ||
    workspacePath;
  if (!workspaceKey) throw new Error("Computer Use request context is missing workspaceKey");
  // A client-declared managed context can only raise enforcement, never lower it:
  // it is validated strictly below and still needs a current allow from the gate.
  // An absent field simply leaves the host-owned gate in charge of the mode.
  const managed = isManagedPolicyContext(context.managed) ? context.managed : undefined;
  return {
    managed,
    context: {
      sessionId: context.sessionId,
      runtimeScope: context.runtimeScope === "subagent" ? "subagent" : "main",
      workspaceKey,
      ...(workspacePath ? { workspacePath } : {}),
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(typeof context.remoteSessionId === "string"
        ? { remoteSessionId: context.remoteSessionId }
        : {}),
      ...(typeof context.turnId === "string" ? { turnId: context.turnId } : {}),
      ...(context.clientMode === "web-remote-replayable" ||
      context.clientMode === "desktop-continuous"
        ? { clientMode: context.clientMode }
        : {}),
      ...(context.deliveryKind === "web-remote-replayable" ||
      context.deliveryKind === "desktop-continuous"
        ? { deliveryKind: context.deliveryKind }
        : {}),
      ...(context.trace && typeof context.trace === "object"
        ? { trace: context.trace as ComputerUseRuntimeContext["trace"] }
        : {}),
    },
  };
}

interface ComputerUsePolicyRequest {
  requestId: string;
  toolName: string;
  sessionId: string;
  runtimeScope: "main" | "subagent";
  workspaceKey: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  turnId?: string;
  managed?: ManagedPolicyContext;
  signal?: AbortSignal;
}

/**
 * Resolve managed policy for one computer-use call.
 *
 * The summary carries only the capability method and the runtime scope.
 * Computer-use arguments can hold typed text, coordinates, and target
 * application detail, so they are deliberately not summarized; the control
 * plane classifies risk from the catalogued tool identity instead.
 */
async function authorizeComputerUseAction(
  input: ComputerUsePolicyRequest & NodeReplCuaPolicyOptions,
): Promise<
  | { allowed: true; mode: "local_personal" | "managed_organization" }
  | {
      allowed: false;
      code: ManagedPolicyFailureCode;
      message: string;
    }
> {
  const argumentsSummary = `method=${input.toolName}; scope=${input.runtimeScope}`;
  const request: ManagedPolicyRequest = {
    surface: "computer",
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    workspaceKey: input.workspaceKey,
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
    ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
    requestId: input.requestId,
    toolName: input.toolName,
    invocationFingerprint: createHash("sha256")
      .update(
        managedInvocationFingerprintInput({
          surface: "computer",
          sessionId: input.sessionId,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          toolName: input.toolName,
          argumentsSummary,
          payload: { toolName: input.toolName, runtimeScope: input.runtimeScope },
        }),
      )
      .digest("hex"),
    argumentsSummary,
    ...(input.managed ? { managed: input.managed } : {}),
  };

  const authorization = await authorizeBrowserComputerAction({
    ...(input.policyGate ? { gate: input.policyGate } : {}),
    ...(input.requireManagedPolicy ? { requireManagedPolicy: true } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    request,
  });
  if (authorization.allowed) return { allowed: true, mode: authorization.mode };
  return {
    allowed: false,
    code: authorization.code,
    message: computerUsePolicyDenialMessage(authorization.code),
  };
}

/**
 * Stable, non-sensitive refusal text for the computer-use socket response.
 * Must not echo policy contents, approval bindings, or screen content.
 */
function computerUsePolicyDenialMessage(code: ManagedPolicyFailureCode): string {
  switch (code) {
    case "tool_denied":
      return "Organization policy denied this computer-use action.";
    case "approval_required":
      return "This computer-use action requires an approval that has not been granted.";
    case "approval_expired":
      return "The approval for this computer-use action expired. Ask for a new one.";
    case "policy_expired":
    case "policy_unavailable":
    case "policy_version_mismatch":
    case "policy_fingerprint_mismatch":
    case "policy_invalid":
      return "Organization policy is not current for this computer-use action. Try again shortly.";
    case "tool_fingerprint_changed":
    case "tool_id_changed":
    case "tool_call_mismatch":
    case "run_mismatch":
    case "binding_mismatch":
      return "The computer-use tool changed while policy was being evaluated. Stop and re-plan.";
    case "managed_context_required":
    case "managed_context_invalid":
      return "This session is not authorized to run managed computer-use actions.";
    default:
      return "Organization policy denied this computer-use action.";
  }
}

async function readLine(socket: Socket, signal: AbortSignal): Promise<string> {
  return await new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES) {
        cleanup();
        reject(new Error("Computer Use broker request exceeded 1 MiB"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      cleanup();
      resolve(buffer.slice(0, newline));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("aborted", "AbortError"));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    socket.on("data", onData);
    socket.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
