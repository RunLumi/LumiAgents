/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { LumiAccountBridge, LumiAccountResult } from "@zcode/shared";

/** An in-flight startup restore older than this is not joined; a fresh request is issued instead. */
export const LUMI_RESTORE_SHARE_WINDOW_MS = 35_000;

interface InflightRestore {
  startedAt: number;
  promise: Promise<LumiAccountResult>;
}

const inflight = new WeakMap<LumiAccountBridge, InflightRestore>();

/**
 * Launch-time restore shared by the startup gate and the entry panel, so the host sees one
 * `restore` instead of two concurrent ones. It carries no state of its own: the host still owns the
 * session and the entry is dropped as soon as the request settles. An explicit user retry must call
 * `bridge.request("restore")` directly so it is never glued to a hung attempt.
 */
export function requestStartupRestore(
  bridge: LumiAccountBridge,
  now: () => number = Date.now,
): Promise<LumiAccountResult> {
  const existing = inflight.get(bridge);
  if (existing && now() - existing.startedAt < LUMI_RESTORE_SHARE_WINDOW_MS) {
    return existing.promise;
  }
  // `clear` only runs after the request settles, so it may reference `entry` before assignment ends.
  const clear = () => {
    if (inflight.get(bridge) === entry) inflight.delete(bridge);
  };
  const entry: InflightRestore = {
    startedAt: now(),
    promise: bridge.request("restore").then(
      (result) => {
        clear();
        return result;
      },
      (error: unknown) => {
        clear();
        throw error;
      },
    ),
  };
  inflight.set(bridge, entry);
  return entry.promise;
}
