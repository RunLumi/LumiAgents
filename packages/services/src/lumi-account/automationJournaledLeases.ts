/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 在不改动 occurrence 驱动器的前提下，为租约端口加一个本地安全属性（spec 07）：
// start 请求发出之前，「可能已开始」的证据先落盘（崩溃/断连后才能诚实地标 needs reconciliation）。
// 本模块不判断授权、不分类服务端 reason（含 off-peak 拒绝），也不重试；这些全在驱动器与守卫里。
import type { AutomationManagedOccurrenceState } from "../session/automationManagedOccurrence.js";
import type {
  LumiAutomationLeaseHostTransport,
  LumiDueOccurrence,
} from "./automationLeaseTransport.js";
import { LumiAutomationWireError } from "./automationLeaseTransport.js";

type LeasePort = Pick<
  LumiAutomationLeaseHostTransport,
  "listDue" | "claim" | "renew" | "start" | "settle" | "release"
>;

export interface OccurrenceJournalPort {
  record(input: {
    occurrenceId: string;
    orgId: string;
    localAutomationId: string;
    managedAutomationId: string;
    state: AutomationManagedOccurrenceState;
    runId?: string;
    reason?: string;
  }): Promise<unknown>;
}

export interface JournaledLeasePortInput {
  leases: LeasePort;
  orgId: string;
  journal: OccurrenceJournalPort;
  /** 托管任务 ID → 本地原任务 ID（来自本地标记，不是服务端）。 */
  localIdFor(managedAutomationId: string): Promise<string | null>;
}

export type JournaledLeasePort = LeasePort & {
  /** 一轮结束后：仍停在 starting 的行不能证明「未开始」，一律标为 ambiguous。 */
  sweepUnconfirmed(): Promise<void>;
};

export function createJournaledLeasePort(input: JournaledLeasePortInput): JournaledLeasePort {
  const known = new Map<string, LumiDueOccurrence>();
  const open = new Map<string, { localAutomationId: string; managedAutomationId: string }>();

  return {
    async listDue() {
      const items = await input.leases.listDue();
      for (const item of items) known.set(item.occurrenceId, item);
      return items;
    },

    claim(due, principal) {
      known.set(due.occurrenceId, due);
      return input.leases.claim(due, principal);
    },

    async start(occurrenceId, fence) {
      const due = known.get(occurrenceId);
      const localAutomationId = due ? await input.localIdFor(due.automationId) : null;
      // 不认识的 occurrence 或没有本地标记：不发 start（驱动器本就不会走到这里，这里是纵深）。
      if (!due || !localAutomationId) throw new LumiAutomationWireError();
      const identity = { localAutomationId, managedAutomationId: due.automationId };
      // 先落盘再请求：写不进就不开始，绝不「已开始但无痕迹」。
      await input.journal.record({
        occurrenceId,
        orgId: input.orgId,
        ...identity,
        state: "starting",
      });
      open.set(occurrenceId, identity);
      const grant = await input.leases.start(occurrenceId, fence);
      try {
        await input.journal.record({
          occurrenceId,
          orgId: input.orgId,
          ...identity,
          state: "started",
          runId: grant.run_id,
        });
        open.delete(occurrenceId);
      } catch {
        // 已开始但记不下来：留在 starting，轮末被标 ambiguous（保守），不影响本次运行继续。
      }
      return grant;
    },

    renew: (leaseId, attempt, body) => input.leases.renew(leaseId, attempt, body),
    settle: (...args) => input.leases.settle(...args),

    async release(occurrenceId, attempt, body) {
      const response = await input.leases.release(occurrenceId, attempt, body);
      const identity = open.get(occurrenceId);
      if (identity) {
        // release 只在 start 之前合法；服务端确认后才记录，失败的 release 保持 starting。
        await input.journal
          .record({ occurrenceId, orgId: input.orgId, ...identity, state: "released" })
          .catch(() => undefined);
        open.delete(occurrenceId);
      }
      return response;
    },

    async sweepUnconfirmed() {
      for (const [occurrenceId, identity] of open) {
        await input.journal
          .record({
            occurrenceId,
            orgId: input.orgId,
            ...identity,
            state: "ambiguous",
            reason: "start_unconfirmed",
          })
          .catch(() => undefined);
        open.delete(occurrenceId);
      }
    },
  };
}
