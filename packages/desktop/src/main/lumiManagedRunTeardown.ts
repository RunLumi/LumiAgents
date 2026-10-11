/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { ManagedRunLeaseEntry } from "./lumiManagedRunAuthorization.js";

/**
 * Sign-out teardown for managed runs held by this session: cancel any live run, close its
 * managed session, and settle a P06 occurrence as failed. Every lease is attempted independently.
 */
export async function cancelAndCloseManagedRuns<
  S extends { state: string },
  D extends {
    getManagedRun(runId: string): Promise<S>;
    cancelManagedRun(run: S): Promise<unknown>;
  },
>(
  leases: Iterable<[string, ManagedRunLeaseEntry<D>]>,
  transport: { closeManagedSession(organizationId: string, agentSessionId: string): Promise<void> },
): Promise<void> {
  await Promise.allSettled(
    [...leases].map(async ([runId, lease]) => {
      try {
        const run = await lease.deviceOwner.getManagedRun(runId);
        if (run.state === "running" || run.state === "queued" || run.state === "dispatching")
          await lease.deviceOwner.cancelManagedRun(run);
        await transport.closeManagedSession(
          lease.context.organizationId,
          lease.context.agentSessionId,
        );
      } finally {
        // A P06 occurrence started by this session ends as a failed settlement, never as a
        // retry; the settle is idempotent in the runtime, so a lost lease stays ambiguous.
        await lease.automation
          ?.onTerminal({ outcome: "failed", reasonCode: "account_signed_out" })
          .catch(() => undefined);
      }
    }),
  );
}
