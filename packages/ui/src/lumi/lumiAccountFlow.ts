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
  account?: LumiAccountProjection;
  signIn?: LumiSignInProjection;
  error?: string;
}

export type LumiFlowCommand = "restore" | "begin" | "complete" | "cancel" | "logout";

export type LumiAccountFlowEvent =
  | { type: "start"; seq: number }
  | { type: "settled"; seq: number; command: LumiFlowCommand; result: LumiAccountResult }
  | { type: "failed"; seq: number; code: string }
  | { type: "invalidate"; seq: number };

export const initialLumiAccountFlow: LumiAccountFlowState = {
  seq: 0,
  busy: false,
  restored: false,
};

export function lumiAccountFlowReducer(
  state: LumiAccountFlowState,
  event: LumiAccountFlowEvent,
): LumiAccountFlowState {
  if (event.type === "start") return { ...state, seq: event.seq, busy: true, error: undefined };
  if (event.type === "invalidate") return { ...state, seq: event.seq, busy: false };
  if (event.seq !== state.seq) return state;
  if (event.type === "failed") {
    return { ...state, busy: false, restored: true, error: event.code };
  }
  const { command, result } = event;
  if (!result.ok) return { ...state, busy: false, restored: true, error: result.code };
  const next = { ...state, busy: false, restored: true };
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
