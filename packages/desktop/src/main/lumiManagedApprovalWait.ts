/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { ZCodeManagedToolDecisionResult } from "@zcode/shared";

/** Main owns the wait; each callback revalidates live lease/policy before device I/O. */
export async function waitForLumiManagedApproval(
  decide: () => Promise<ZCodeManagedToolDecisionResult>,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<ZCodeManagedToolDecisionResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 900_000);
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let approvalId: string | undefined;
  for (;;) {
    if (now() >= deadline) throw new Error("lumi_approval_wait_expired");
    const decision = await decide();
    if (approvalId && decision.decision === "allow" && decision.approvalId !== approvalId)
      throw new Error("lumi_approval_binding_changed");
    if (
      decision.decision !== "require_session_approval" &&
      decision.decision !== "require_per_use_approval"
    )
      return decision;
    if (!decision.approvalId || (approvalId && decision.approvalId !== approvalId))
      throw new Error("lumi_approval_binding_changed");
    approvalId = decision.approvalId;
    const expires =
      typeof decision.approvalExpiresAt === "string" ? Date.parse(decision.approvalExpiresAt) : NaN;
    if (!Number.isFinite(expires) || expires <= now())
      throw new Error("lumi_approval_wait_expired");
    await wait(Math.max(1, Math.min(options.pollMs ?? 1500, deadline - now(), expires - now())));
  }
}
