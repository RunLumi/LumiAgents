/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { ToolEntry, ToolExecutionContext } from "../types.js";
import { CoreErrorType, createCoreError } from "@zcode/contracts";
import { isToolHandlerFailure } from "./errors.js";
import {
  createManagedArgumentsSnapshot,
  createManagedArgumentsSummary,
} from "./managed-arguments.js";
import { createManagedArgumentsHash } from "./managed-tool-identity.js";
import {
  createManagedDecisionDeniedError,
  enforceManagedToolDecision,
  type ManagedToolGateInput,
  type ManagedToolGateResult,
} from "./managed-decision.js";
import type { ToolDeadline } from "./timeout.js";

/** Policy/approval and report delivery have their own deadlines, not handler compute time. */
export async function executeManagedToolHandler(
  admission: ManagedToolGateInput,
  handler: ToolEntry["handler"],
  input: unknown,
  context: ToolExecutionContext,
  deadline: ToolDeadline,
) {
  deadline.pause();
  let gate: ManagedToolGateResult;
  try {
    gate = await enforceManagedToolDecision(admission);
  } finally {
    deadline.resume();
  }
  if (gate.allowed && gate.managed && gate.reportResult) {
    const report = gate.reportResult;
    gate = {
      ...gate,
      reportResult: async (status) => {
        deadline.pause();
        try {
          await report(status);
        } finally {
          deadline.resume();
        }
      },
    };
  }
  return invokeManagedToolHandler(gate, handler, input, context);
}

/** Last synchronous binding check, then give the handler an isolated approved input. */
export function invokeManagedToolHandler(
  gate: ManagedToolGateResult,
  handler: ToolEntry["handler"],
  input: unknown,
  context: ToolExecutionContext,
): Promise<unknown> {
  if (!gate.allowed) throw createManagedDecisionDeniedError(gate.reasonCode);
  if (!gate.managed) return handler(input, context);
  let snapshot: unknown;
  try {
    snapshot = createManagedArgumentsSnapshot(input);
    if (createManagedArgumentsHash(createManagedArgumentsSummary(snapshot)) !== gate.argumentsHash)
      throw new Error("arguments_changed");
  } catch {
    return settle(
      Promise.reject(createManagedDecisionDeniedError("arguments_changed")),
      gate,
      context,
    );
  }
  if (context.abortSignal?.aborted)
    return settle(
      Promise.reject(createManagedDecisionDeniedError("managed_decision_unavailable")),
      gate,
      context,
    );
  // 最后一次检查后不再 await；handler 只收到独立副本，外部引用不能改变获批输入。
  try {
    return settle(handler(snapshot, context), gate, context);
  } catch (error) {
    return settle(Promise.reject(error), gate, context);
  }
}

async function settle(
  execution: Promise<unknown>,
  gate: Extract<ManagedToolGateResult, { allowed: true; managed: true }>,
  context: ToolExecutionContext,
) {
  let output: unknown;
  let failure: unknown;
  let failed = false;
  try {
    output = await execution;
  } catch (error) {
    failed = true;
    failure = error;
  }
  const status = context.abortSignal?.aborted
    ? "cancelled"
    : failed || isToolHandlerFailure(output)
      ? "failed"
      : "completed";
  try {
    // 执行取消信号不能取消清理报告；report port 自己拥有独立的有界时限。
    await gate.reportResult?.(status);
  } catch {
    throw createCoreError(
      CoreErrorType.PermissionDenied,
      "Managed tool result delivery failed; execution may have occurred. Reconcile the existing call without repeating the side effect.",
      {
        recoverable: false,
        context: { reasonCode: "managed_result_reporting_failed", managedToolResultUnknown: true },
      },
    );
  }
  if (failed) throw failure;
  return output;
}
