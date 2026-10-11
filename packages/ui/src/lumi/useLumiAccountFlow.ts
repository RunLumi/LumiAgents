/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { usePlatform } from "@/hooks/usePlatform.js";
import {
  initialLumiAccountFlow,
  lumiAccountFlowReducer,
  type LumiFlowCommand,
} from "./lumiAccountFlow.js";

/** Single renderer client of the host-owned `platform.lumiAccount` session; never a second owner. */
export function useLumiAccountFlow() {
  const { lumiAccount } = usePlatform();
  const [state, dispatch] = useReducer(lumiAccountFlowReducer, initialLumiAccountFlow);
  const sequence = useRef(0);
  const busy = useRef(false);

  const run = useCallback(
    async (command: LumiFlowCommand) => {
      if (!lumiAccount || (busy.current && command !== "restore" && command !== "cancel")) return;
      const seq = ++sequence.current;
      busy.current = true;
      dispatch({ type: "start", seq });
      try {
        const result = await lumiAccount.request(command);
        dispatch({ type: "settled", seq, command, result });
      } catch {
        dispatch({ type: "failed", seq, code: "lumi_account_failed" });
      } finally {
        if (seq === sequence.current) busy.current = false;
      }
    },
    [lumiAccount],
  );

  useEffect(() => {
    void run("restore");
    return () => {
      // Unmount invalidates any in-flight result.
      busy.current = false;
      dispatch({ type: "invalidate", seq: ++sequence.current });
    };
  }, [run]);

  return { available: Boolean(lumiAccount), state, run };
}
