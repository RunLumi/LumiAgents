/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { LumiAccountProjection, LumiAccountResult, LumiSignInProjection } from "@zcode/shared";

/**
 * Renderer projection of the host-owned Lumi session (spec 04, "Lumi-first startup entry").
 * The host owns the session; this reducer only holds safe projections and drops stale results.
 */
export interface LumiAccountFlowState {
  /** Latest request sequence; results carrying another sequence are ignored. */
  seq: number;
  busy: boolean;
  /** False until the first request settles, so callers can avoid flashing a sign-in prompt. */
  restored: boolean;
  /** The in-flight request is taking longer than expected; local/BYOK entry stays available. */
  slow: boolean;
  account?: LumiAccountProjection;
  signIn?: LumiSignInProjection;
  error?: string;
  /** Command that produced `error`, so a failed restore is retried as a restore, not a sign-in. */
  errorCommand?: LumiFlowCommand;
}

export type LumiFlowCommand = "restore" | "begin" | "complete" | "cancel" | "logout";

export type LumiAccountFlowEvent =
  | { type: "start"; seq: number }
  | { type: "settled"; seq: number; command: LumiFlowCommand; result: LumiAccountResult }
  | { type: "failed"; seq: number; command: LumiFlowCommand; code: string }
  | { type: "slow"; seq: number }
  /**
   * The renderer gave up waiting. `nextSeq` supersedes `seq`, so the late host completion of the
   * abandoned request is dropped instead of replacing a newer result.
   */
  | { type: "timeout"; seq: number; nextSeq: number; command: LumiFlowCommand }
  | { type: "invalidate"; seq: number };

export const initialLumiAccountFlow: LumiAccountFlowState = {
  seq: 0,
  busy: false,
  restored: false,
  slow: false,
};

/** Soft notice: after this long a pending restore is reported as slow (matches the startup gate). */
export const LUMI_FLOW_SLOW_MS = 5000;
/** Hard bound, above the host's 30 s per-request limit so a host-reported error wins when present. */
export const LUMI_FLOW_TIMEOUT_MS = 35_000;
export const LUMI_FLOW_TIMEOUT_CODE = "lumi_request_timeout";

export function lumiAccountFlowReducer(
  state: LumiAccountFlowState,
  event: LumiAccountFlowEvent,
): LumiAccountFlowState {
  if (event.type === "start") {
    return {
      ...state,
      seq: event.seq,
      busy: true,
      slow: false,
      error: undefined,
      errorCommand: undefined,
    };
  }
  if (event.type === "invalidate") return { ...state, seq: event.seq, busy: false, slow: false };
  if (event.seq !== state.seq) return state;
  if (event.type === "slow") return state.busy ? { ...state, slow: true } : state;
  if (event.type === "timeout") {
    return {
      ...state,
      seq: event.nextSeq,
      busy: false,
      slow: false,
      restored: true,
      error: LUMI_FLOW_TIMEOUT_CODE,
      errorCommand: event.command,
    };
  }
  if (event.type === "failed") {
    return {
      ...state,
      busy: false,
      slow: false,
      restored: true,
      error: event.code,
      errorCommand: event.command,
    };
  }
  const { command, result } = event;
  if (!result.ok) {
    return {
      ...state,
      busy: false,
      slow: false,
      restored: true,
      error: result.code,
      errorCommand: command,
    };
  }
  const next = { ...state, busy: false, slow: false, restored: true };
  switch (command) {
    case "restore":
      return { ...next, account: result.account };
    case "begin":
      return { ...next, signIn: result.signIn };
    case "complete":
      return { ...next, account: result.account, signIn: undefined };
    case "cancel":
      return { ...next, signIn: undefined };
    case "logout":
      // Only the Lumi session projection is cleared; provider credentials are not touched here.
      return { ...next, account: undefined, signIn: undefined };
  }
}
