/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { usePlatform } from "@/hooks/usePlatform.js";
import {
  initialLumiAccountFlow,
  LUMI_FLOW_SLOW_MS,
  LUMI_FLOW_TIMEOUT_MS,
  lumiAccountFlowReducer,
  type LumiFlowCommand,
} from "./lumiAccountFlow.js";
import { requestStartupRestore } from "./lumiRestore.js";

/** Single renderer client of the host-owned `platform.lumiAccount` session; never a second owner. */
export function useLumiAccountFlow() {
  const { lumiAccount } = usePlatform();
  const [state, dispatch] = useReducer(lumiAccountFlowReducer, initialLumiAccountFlow);
  const sequence = useRef(0);
  const busy = useRef(false);

  const run = useCallback(
    async (command: LumiFlowCommand, options?: { startup?: boolean }) => {
      if (!lumiAccount || (busy.current && command !== "restore" && command !== "cancel")) return;
      const seq = ++sequence.current;
      busy.current = true;
      dispatch({ type: "start", seq });
      // Only a restore can be slow in a way the user cannot act on; both timers are fenced by seq.
      const slowTimer =
        command === "restore"
          ? setTimeout(() => dispatch({ type: "slow", seq }), LUMI_FLOW_SLOW_MS)
          : undefined;
      const giveUpTimer = setTimeout(() => {
        if (seq !== sequence.current) return;
        // Supersede the abandoned request so its late host completion cannot overwrite a newer one.
        const nextSeq = ++sequence.current;
        busy.current = false;
        dispatch({ type: "timeout", seq, nextSeq, command });
      }, LUMI_FLOW_TIMEOUT_MS);
      try {
        const result = await (command === "restore" && options?.startup
          ? requestStartupRestore(lumiAccount)
          : lumiAccount.request(command));
        dispatch({ type: "settled", seq, command, result });
      } catch {
        dispatch({ type: "failed", seq, command, code: "lumi_account_failed" });
      } finally {
        clearTimeout(slowTimer);
        clearTimeout(giveUpTimer);
        if (seq === sequence.current) busy.current = false;
      }
    },
    [lumiAccount],
  );

  useEffect(() => {
    void run("restore", { startup: true });
    return () => {
      // Unmount invalidates any in-flight result.
      busy.current = false;
      dispatch({ type: "invalidate", seq: ++sequence.current });
    };
  }, [run]);

  return { available: Boolean(lumiAccount), state, run };
}
