/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { ToolCall, ToolSchedule } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { ExecuteToolsOptions, ExecuteToolsResult } from "../types.js";
import type { RegularTurnLoopState } from "./turn-loop-state.js";

/** Both streaming and completed model steps cross the same per-turn tool boundary. */
export function executeTurnToolSchedule(
  runtime: Pick<AgentRuntimeInternal, "executeTools">,
  state: Pick<RegularTurnLoopState, "model" | "managedContext">,
  calls: ToolCall[],
  schedule: ToolSchedule,
  options: Omit<ExecuteToolsOptions, "managedContext">,
): Promise<ExecuteToolsResult> {
  if (
    String(state.model.providerId) === "lumi-managed" &&
    state.managedContext?.executionMode !== "managed" &&
    state.managedContext?.mode !== "managed"
  ) {
    throw new Error("lumi_managed_tool_context_missing");
  }
  return runtime.executeTools(calls, schedule, {
    ...options,
    ...(state.managedContext ? { managedContext: state.managedContext } : {}),
  });
}
