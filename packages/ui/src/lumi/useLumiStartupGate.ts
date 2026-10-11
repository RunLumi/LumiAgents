/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { useEffect, useState } from "react";
import type { LumiAccountBridge } from "@zcode/shared";

/** A hung host restore must not hold the app on the startup screen forever. */
export const LUMI_STARTUP_RESTORE_TIMEOUT_MS = 5000;

export type LumiStartupGate = "pending" | "signed-in" | "entry-required";

/**
 * One-shot read of the host-owned Lumi session at launch. Decides only whether the entry screen
 * opens; it never starts sign-in. Without a bridge (web/test hosts) startup is not gated.
 */
export function useLumiStartupGate(lumiAccount: LumiAccountBridge | undefined): LumiStartupGate {
  const [gate, setGate] = useState<LumiStartupGate>(lumiAccount ? "pending" : "signed-in");
  useEffect(() => {
    if (!lumiAccount) return;
    let live = true;
    const settle = (next: LumiStartupGate) => {
      if (live) setGate((current) => (current === "pending" ? next : current));
    };
    const timeout = setTimeout(() => settle("entry-required"), LUMI_STARTUP_RESTORE_TIMEOUT_MS);
    lumiAccount.request("restore").then(
      (result) => settle(result.ok && result.account ? "signed-in" : "entry-required"),
      () => settle("entry-required"),
    );
    return () => {
      live = false;
      clearTimeout(timeout);
    };
  }, [lumiAccount]);
  return gate;
}
