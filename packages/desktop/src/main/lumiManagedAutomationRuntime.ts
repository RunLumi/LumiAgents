/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// Main 的托管 automation 运行时（spec 07「Managed scheduling」）：
//   scheduler 的 managed-poll-request → due/claim/start（驱动器 + 围栏守卫）→ 激活 P05 run →
//   把本地 prompt 与服务端 context 交给 Host → 续租 → 终态结算。
// 这里只编排顺序与失败归类；凭据、围栏与 P05 状态机都在被注入的端口里。
//   * Main 是唯一持有设备令牌/租约令牌的一方；本模块拿到的 ManagedOccurrence 句柄没有令牌。
//   * start 之后的任何失败都是「已开始」：结算为 failed，绝不 release、不重试、不重新派发。
//   * 续租被拒即失去权威：撤销本地授权让后续推理/工具请求 fail closed，不再向服务端结算。
import type { ManagedOccurrence, SkippedOccurrence } from "@zcode/services/node";
import type { ZCodeManagedRunContext } from "@zcode/shared";
import type { ManagedAutomationDispatchResult } from "./lumiManagedAutomationHostBridge.js";

export type AutomationTerminal =
  | { outcome: "succeeded" }
  | { outcome: "failed"; reasonCode: string };

/** 账号 owner 在运行终态时回调；P05 终态已上报之后才会调用（P05 先、P06 后）。 */
export interface AutomationRunHooks {
  onTerminal(result: AutomationTerminal): Promise<void>;
}

export interface ManagedAutomationOriginal {
  prompt: string;
  workspacePath: string;
  workspaceIdentity?: string;
  mode?: string;
}

export interface ManagedAutomationRuntimeDeps {
  /** 每个进程只能在第一次认领之前执行一次：把上个进程遗留的 starting/started 标为 ambiguous。 */
  recoverInterrupted(): Promise<void>;
  /** 本机有 managed 标记的组织。 */
  listOrgIds(): Promise<string[]>;
  driverFor(orgId: string): Promise<{
    poll(): Promise<{ started: ManagedOccurrence[]; skipped: SkippedOccurrence[] }>;
  }>;
  /** 读取保留的原任务；prompt 只在 Main 内存里经过，不进日志、不发往服务端。 */
  readOriginal(localAutomationId: string): Promise<ManagedAutomationOriginal | null>;
  /** P05 run 校验、启动（queued→running）并登记租约；失败时自行清理 P05 run 与登记。 */
  activate(input: {
    orgId: string;
    occurrence: ManagedOccurrence;
    original: ManagedAutomationOriginal;
    hooks: AutomationRunHooks;
  }): Promise<{
    context: ZCodeManagedRunContext;
    modelAlias: string;
    workspaceIdentity: string;
  }>;
  /** P05 fail + 移除授权；会经 hooks.onTerminal 触发 P06 结算。 */
  failRun(runId: string, reasonCode: string): Promise<void>;
  /**
   * 租约丢失：移除授权、让 owning Host 停掉该 run 的 task、尽力取消 P05 run；
   * 不触碰 P06（权威已不在我们这里）。返回 Host 工作是否已确认停止。
   */
  revokeRun(runId: string): Promise<"confirmed" | "unconfirmed" | void>;
  host: {
    available(): boolean;
    dispatch(input: {
      localAutomationId: string;
      workspacePath: string;
      workspaceIdentity?: string;
      prompt: string;
      mode?: string;
      modelAlias: string;
      managedContext: ZCodeManagedRunContext;
    }): Promise<ManagedAutomationDispatchResult>;
  };
  journal: {
    record(input: {
      occurrenceId: string;
      orgId: string;
      localAutomationId: string;
      managedAutomationId: string;
      state: "settled" | "ambiguous";
      runId?: string;
      reason?: string;
    }): Promise<unknown>;
  };
  /** 周期调用 fn；返回取消函数。可注入以便测试。 */
  every(ms: number, fn: () => void): () => void;
  log(level: "info" | "warn", message: string): void;
}

export type ManagedPollSummary =
  | { status: "ok"; started: number; skipped: number }
  | { status: "no_host" | "busy" | "recovery_failed" };

export function createManagedAutomationRuntime(deps: ManagedAutomationRuntimeDeps) {
  let recovery: Promise<void> | undefined;
  let polling = false;

  async function recovered(): Promise<boolean> {
    recovery ??= deps.recoverInterrupted();
    try {
      await recovery;
      return true;
    } catch {
      // 失败后允许下次重试；错误文本可能含本地路径，不记录。
      recovery = undefined;
      deps.log("warn", "managed automation recovery failed");
      return false;
    }
  }

  async function begin(orgId: string, occurrence: ManagedOccurrence): Promise<void> {
    const occurrenceId = occurrence.grant.occurrence.occurrence_id;
    const managedAutomationId = occurrence.grant.occurrence.automation_id;
    const runId = occurrence.grant.runId;
    let ended = false;
    let stopHeartbeat: () => void = () => undefined;

    const record = (state: "settled" | "ambiguous", reason?: string) =>
      deps.journal
        .record({
          occurrenceId,
          orgId,
          localAutomationId: occurrence.localAutomationId,
          managedAutomationId,
          state,
          runId,
          ...(reason ? { reason } : {}),
        })
        .catch(() => undefined);

    /** P06 结算只发生一次；失败不重试（服务端会在租约到期时把 started 判为 ambiguous）。 */
    const settle = async (result: AutomationTerminal): Promise<void> => {
      if (ended) return;
      ended = true;
      stopHeartbeat();
      try {
        await occurrence.settle(result);
        await record("settled");
      } catch {
        deps.log("warn", `managed occurrence settle unconfirmed occurrence=${occurrenceId}`);
        await record("ambiguous", "settle_unconfirmed");
      }
    };

    const original = await deps.readOriginal(occurrence.localAutomationId).catch(() => null);
    if (!original) {
      await settle({ outcome: "failed", reasonCode: "automation_original_missing" });
      return;
    }

    let activation: Awaited<ReturnType<ManagedAutomationRuntimeDeps["activate"]>>;
    try {
      activation = await deps.activate({
        orgId,
        occurrence,
        original,
        hooks: { onTerminal: settle },
      });
    } catch {
      // activate 已自行撤销 P05 run 与授权登记；start 已授予，只能结算为 failed。
      await settle({ outcome: "failed", reasonCode: "run_activation_failed" });
      return;
    }

    let renewing = false;
    const leaseLost = async (): Promise<void> => {
      if (ended) return;
      ended = true;
      stopHeartbeat();
      deps.log("warn", `managed occurrence lease lost occurrence=${occurrenceId}`);
      // 授权先撤销，再停 Host 上的实际工作（revokeRun 内部按此顺序）；之后才写日志。
      // 不 settle、不 failRun、不 release：权威已不在本设备，迟到的终态也会被缺失的租约拒绝。
      const hostStop = await deps.revokeRun(runId).catch(() => "unconfirmed" as const);
      if (hostStop === "unconfirmed")
        deps.log("warn", `managed occurrence host stop unconfirmed occurrence=${occurrenceId}`);
      await record("ambiguous", "lease_lost");
    };
    stopHeartbeat = deps.every(occurrence.heartbeatIntervalMs, () => {
      if (ended || renewing) return;
      renewing = true;
      void occurrence
        .renew()
        .catch(() => leaseLost())
        .finally(() => {
          renewing = false;
        });
    });

    const dispatched = await deps.host.dispatch({
      localAutomationId: occurrence.localAutomationId,
      workspacePath: original.workspacePath,
      ...(original.workspaceIdentity ? { workspaceIdentity: original.workspaceIdentity } : {}),
      prompt: original.prompt,
      ...(original.mode ? { mode: original.mode } : {}),
      modelAlias: activation.modelAlias,
      managedContext: activation.context,
    });
    if (!dispatched.ok) {
      deps.log("warn", `managed occurrence dispatch refused code=${dispatched.errorCode}`);
      await deps.failRun(runId, "host_dispatch_failed").catch(() => undefined);
      // failRun 正常会经 hooks 结算；这里兜底，settle 自身保证只发生一次。
      await settle({ outcome: "failed", reasonCode: "host_dispatch_failed" });
    }
  }

  async function poll(): Promise<ManagedPollSummary> {
    // 没有本地 Host 就不认领：claim 之后才发现无处执行，只能走启动后失败。
    if (!deps.host.available()) return { status: "no_host" };
    if (polling) return { status: "busy" };
    polling = true;
    try {
      if (!(await recovered())) return { status: "recovery_failed" };
      let started = 0;
      let skipped = 0;
      for (const orgId of await deps.listOrgIds()) {
        try {
          const driver = await deps.driverFor(orgId);
          const result = await driver.poll();
          skipped += result.skipped.length;
          for (const item of result.skipped)
            deps.log(
              "info",
              `managed occurrence skipped code=${item.code}${item.reason ? ` reason=${item.reason}` : ""}`,
            );
          for (const occurrence of result.started) {
            started++;
            await begin(orgId, occurrence);
          }
        } catch {
          // 一个组织的失败（令牌过期、网络、吊销）不影响其他组织，也不影响本地任务。
          deps.log("warn", "managed automation poll failed for one organization");
        }
      }
      return { status: "ok", started, skipped };
    } finally {
      polling = false;
    }
  }

  return { poll };
}

export type ManagedAutomationRuntime = ReturnType<typeof createManagedAutomationRuntime>;
