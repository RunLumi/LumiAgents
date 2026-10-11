/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LumiAccountProjection, LumiAutomationAdoptionProjection } from "@zcode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";

export interface LumiAutomationAdoptionsView {
  /** The Lumi bridge exists (desktop with account custody); otherwise the feature is invisible. */
  available: boolean;
  account?: LumiAccountProjection;
  /** Who runs each retained original, by local id. Empty when signed out (see spec 07). */
  markers: ReadonlyMap<string, LumiAutomationAdoptionProjection>;
  /** Which organization holds each marker; release is addressed to it. Never authority. */
  orgByAutomation: ReadonlyMap<string, string>;
  refresh(): Promise<void>;
}

const POLL_MS = 20_000;

/**
 * Read-only renderer projection: only `read` and `read-automation-adoptions` are ever sent from
 * here, so merely viewing the automation list can never create, change or release anything.
 * A stale response (sign-out, unmount, a newer refresh) is dropped by sequence.
 */
export function useLumiAutomationAdoptions(): LumiAutomationAdoptionsView {
  const { lumiAccount } = usePlatform();
  const [account, setAccount] = useState<LumiAccountProjection>();
  const [markers, setMarkers] = useState<ReadonlyMap<string, LumiAutomationAdoptionProjection>>(
    () => new Map(),
  );
  const [orgByAutomation, setOrgByAutomation] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!lumiAccount) return;
    const current = ++sequence.current;
    try {
      const read = await lumiAccount.request("read");
      if (current !== sequence.current) return;
      const next = read.ok ? read.account : undefined;
      setAccount(next);
      const merged = new Map<string, LumiAutomationAdoptionProjection>();
      const orgs = new Map<string, string>();
      for (const org of next?.organizations ?? []) {
        if (org.state !== "active" || org.status !== "active") continue;
        const result = await lumiAccount.request({
          action: "read-automation-adoptions",
          orgId: org.id,
        });
        if (current !== sequence.current) return;
        if (result.ok)
          for (const marker of result.automationAdoptions ?? []) {
            merged.set(marker.localAutomationId, marker);
            orgs.set(marker.localAutomationId, org.id);
          }
      }
      setMarkers(merged);
      setOrgByAutomation(orgs);
    } catch {
      // A failed read keeps the last projection; the card never invents a state.
    }
  }, [lumiAccount]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      sequence.current++;
      clearInterval(timer);
    };
  }, [refresh]);

  return { available: Boolean(lumiAccount), account, markers, orgByAutomation, refresh };
}
