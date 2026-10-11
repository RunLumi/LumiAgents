/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 托管 occurrence 的 P05 run 激活与终态结算（spec 07「Managed run activation」）。
// P06 start 之后 P05 run 是 queued：这里逐项核对授予的 run/会话/设备/绑定/策略快照，才执行
// P05 start（queued→running）并把租约登记给 Main 的请求鉴权；之后每次推理/工具请求仍由
// 既有的 authorizeManagedRequest 重新校验。终态顺序固定：P05 终态 → 授权结束 → P06 结算。
// 纯逻辑 + 端口（与 lumiManagedRunAuthorization 同构），不持有令牌、不读 Electron。
import type { ManagedOccurrence } from "@zcode/services/node";
import type { ZCodeManagedRunContext } from "@zcode/shared";
import type { AutomationRunHooks } from "./lumiManagedAutomationRuntime.js";
import type { ManagedRunLeaseIdentity } from "./lumiManagedRunAuthorization.js";

export interface ActivationRunProjection {
  runId: string;
  state: string;
  orgId: string;
  projectId: string;
  deviceId: string;
  agentSessionId: string;
  agentDefinitionId: string;
  agentDefinitionVersion: number;
  modelAlias: string | null;
  policySnapshotId: string | null;
  policyVersion: number | null;
  requestId: string | null;
  workspaceBindingId: string | null;
  version: number;
}

/** 设备令牌下的 P05 run 生命周期（method 语法：与真实 device owner 的更窄签名双向兼容）。 */
export interface ActivationDevicePort {
  getManagedRun(runId: string): Promise<ActivationRunProjection>;
  startManagedRun(run: ActivationRunProjection): Promise<ActivationRunProjection>;
  completeManagedRun(run: ActivationRunProjection): Promise<unknown>;
  failManagedRun(run: ActivationRunProjection, failureCode: string): Promise<unknown>;
  cancelManagedRun(run: ActivationRunProjection): Promise<unknown>;
}

export interface ActivationWorkspaceFacts {
  projectId: string;
  deviceId: string;
  workspaceBindingId: string;
  policySnapshotId: string;
  policyVersion: number;
}

/** 登记到 managedRuns 的条目：与交互式运行同形，外加 automation 终态回调。 */
export interface AutomationLeaseEntry<D> extends ManagedRunLeaseIdentity {
  deviceOwner: D;
  automation: AutomationRunHooks;
}

export interface ManagedAutomationActivationPorts<D extends ActivationDevicePort> {
  deviceFor(orgId: string): Promise<D>;
  authorizeWorkspace(orgId: string, workspaceIdentity: string): Promise<ActivationWorkspaceFacts>;
  lease(runId: string): AutomationLeaseEntry<D> | undefined;
  register(runId: string, entry: AutomationLeaseEntry<D>): void;
  unregister(runId: string): void;
  closeSession(orgId: string, agentSessionId: string): Promise<void>;
  /** 授权已结束之后的尽力清理（例如撤回运行时能力声明）。 */
  onEnded(entry: AutomationLeaseEntry<D>): void;
  /** 让该 run 的 owning Host 停掉它的 task（不抛出：失败即 {ok:false}）。 */
  cancelHostRun(runId: string): Promise<{ ok: boolean }>;
  /**
   * Host 已报告该 run 的 task 终态：释放 Main 记录的 run → Host 停止权限（spec 07）。
   * 只在 Host 终态中继之后调用；dispatch 失败、超时、revoke 都不是终态证明。尽力而为、不抛出。
   */
  retireHostRun?(runId: string): void;
}

/** 租约丢失后 Host 工作是否已确认停止；unconfirmed 时授权仍已撤销，后续请求照常 fail closed。 */
export type HostStopOutcome = "confirmed" | "unconfirmed";

const REASON = {
  complete: undefined,
  fail: "agent_failed",
  cancel: "user_cancelled",
} as const;

export function createManagedAutomationActivation<D extends ActivationDevicePort>(
  ports: ManagedAutomationActivationPorts<D>,
) {
  async function activate(input: {
    orgId: string;
    occurrence: ManagedOccurrence;
    original: { workspacePath: string; workspaceIdentity?: string };
    hooks: AutomationRunHooks;
  }): Promise<{
    context: ZCodeManagedRunContext;
    modelAlias: string;
    workspaceIdentity: string;
  }> {
    const { grant } = input.occurrence;
    const device = await ports.deviceFor(input.orgId);
    const run = await device.getManagedRun(grant.runId);
    // 本函数之后的任何失败都要把 queued 的 run 收回：它是服务端为本设备创建的，不能悬挂。
    // 但不是我们启动的 running run 不归我们取消（只可能是别处已推进，取消会误杀合法运行）。
    let startedByUs = false;
    try {
      const workspaceIdentity =
        input.original.workspaceIdentity?.trim() || input.original.workspacePath;
      const authorized = await ports.authorizeWorkspace(input.orgId, workspaceIdentity);
      if (
        run.state !== "queued" ||
        run.runId !== grant.runId ||
        run.agentSessionId !== grant.agentSessionId ||
        run.orgId !== input.orgId ||
        run.deviceId !== authorized.deviceId ||
        run.projectId !== authorized.projectId ||
        !run.workspaceBindingId ||
        run.workspaceBindingId !== authorized.workspaceBindingId ||
        !run.modelAlias ||
        // 快照必须与 occurrence 一致且仍是设备当前策略；落后即 stale，绝不静默换成新策略。
        run.policySnapshotId === null ||
        run.policyVersion === null ||
        run.policySnapshotId !== authorized.policySnapshotId ||
        run.policyVersion !== authorized.policyVersion
      )
        throw new Error("lumi_managed_run_refused");
      const started = await device.startManagedRun(run);
      startedByUs = true;
      if (started.state !== "running" || started.runId !== run.runId || started.requestId === null)
        throw new Error("lumi_managed_run_start_refused");
      const context: ZCodeManagedRunContext = {
        organizationId: input.orgId,
        projectId: run.projectId,
        deviceId: run.deviceId,
        agentSessionId: run.agentSessionId,
        runId: run.runId,
        agentDefinitionId: run.agentDefinitionId,
        agentDefinitionVersion: run.agentDefinitionVersion,
        requestId: started.requestId,
        externalId: grant.occurrence.occurrence_id,
        executionMode: "managed",
        policySnapshotId: run.policySnapshotId,
        policyVersion: run.policyVersion,
      };
      ports.register(run.runId, {
        context,
        workspaceIdentity,
        modelAlias: run.modelAlias,
        deviceOwner: device,
        automation: input.hooks,
      });
      return { context, modelAlias: run.modelAlias, workspaceIdentity };
    } catch (error) {
      // 一律以服务端授予的 run 为准，绝不用被怀疑的投影里的 id 去取消别的 run。
      ports.unregister(grant.runId);
      const latest = await device.getManagedRun(grant.runId).catch(() => undefined);
      const cancellable = startedByUs
        ? ["queued", "dispatching", "running"]
        : ["queued", "dispatching"];
      if (latest && latest.runId === grant.runId && cancellable.includes(latest.state))
        await device.cancelManagedRun(latest).catch(() => undefined);
      throw error;
    }
  }

  /**
   * 终态结算。`hostTerminal` 表示这是 Host 的 task 终态中继（task 已结束）；dispatch 失败的结算
   * 不是（Host 可能仍持有 task），那时不能释放停止权限。
   */
  async function finish(
    runId: string,
    outcome: "complete" | "fail" | "cancel",
    failureCode: string,
    hostTerminal: boolean,
  ): Promise<void> {
    const entry = ports.lease(runId);
    if (!entry) throw new Error("lumi_managed_run_missing");
    let reported = true;
    try {
      const run = await entry.deviceOwner.getManagedRun(runId);
      if (run.state !== "running") throw new Error("lumi_managed_run_refused");
      if (outcome === "complete") await entry.deviceOwner.completeManagedRun(run);
      else if (outcome === "fail") await entry.deviceOwner.failManagedRun(run, failureCode);
      else await entry.deviceOwner.cancelManagedRun(run);
    } catch {
      reported = false;
    }
    // 授权在 P06 结算之前结束：此后迟到的推理/工具请求一律 fail closed。
    ports.unregister(runId);
    // 租约已找到才会走到这里，所以每个 run 至多退役一次；迟到/未知的终态在上面就被拒绝。
    // P05 上报是否成功只影响服务端记录，Host 的 task 终态已是事实。
    if (hostTerminal) {
      try {
        ports.retireHostRun?.(runId);
      } catch {
        // 退役是内存清理：失败只会让该 run 多占一个名额，不能影响结算。
      }
    }
    await ports
      .closeSession(entry.context.organizationId, entry.context.agentSessionId)
      .catch(() => undefined);
    if (!reported) {
      await entry.automation.onTerminal({ outcome: "failed", reasonCode: "run_report_failed" });
    } else if (outcome === "complete") {
      await entry.automation.onTerminal({ outcome: "succeeded" });
    } else {
      await entry.automation.onTerminal({
        outcome: "failed",
        reasonCode: outcome === "fail" ? failureCodeToReason(failureCode) : REASON.cancel,
      });
    }
    ports.onEnded(entry);
    if (!reported) throw new Error("lumi_managed_run_refused");
  }

  /** Host 报告的终态 → P05 终态 → 授权结束 → P06 结算。非 automation 租约不走这里。 */
  function settle(
    runId: string,
    outcome: "complete" | "fail" | "cancel",
    failureCode = "agent_failed",
  ): Promise<void> {
    return finish(runId, outcome, failureCode, true);
  }

  /**
   * dispatch 被拒绝或超时之后的结算：Host 可能已建了 task，所以不退役停止权限，而是在结算后
   * 让 owning Host 停掉这一个 run；只有 Host 确认的停止才会在桥里释放名额。
   */
  async function failDispatch(runId: string, failureCode: string): Promise<void> {
    try {
      await finish(runId, "fail", failureCode, false);
    } finally {
      await (async () => ports.cancelHostRun(runId))().catch(() => undefined);
    }
  }

  /**
   * 租约丢失：先撤销授权，再让 owning Host 停掉这个 run 的 task（与较慢的 P05 取消并发），
   * 最后尽力取消 P05 run；不触碰 P06（权威已不在本设备）。
   * 授权不在了（例如已被登出清掉）也要停 Host：只靠请求 fail closed 拦不住正在运行的工具。
   * Host 对未知 run 会拒绝，所以对不属于它的 run 调用是安全的。
   */
  async function revoke(runId: string): Promise<HostStopOutcome> {
    const entry = ports.lease(runId);
    if (entry) ports.unregister(runId);
    // async IIFE：端口同步抛出也只是 unconfirmed，且调用紧跟在 unregister 之后。
    const hostStop = (async () => ports.cancelHostRun(runId))().then(
      (result): HostStopOutcome => (result.ok ? "confirmed" : "unconfirmed"),
      (): HostStopOutcome => "unconfirmed",
    );
    if (entry) {
      const run = await entry.deviceOwner.getManagedRun(runId).catch(() => undefined);
      if (run && ["queued", "dispatching", "running"].includes(run.state))
        await entry.deviceOwner.cancelManagedRun(run).catch(() => undefined);
    }
    const outcome = await hostStop;
    if (entry) ports.onEnded(entry);
    return outcome;
  }

  return { activate, settle, failDispatch, revoke };
}

/** failureCode 是封闭的本地码；不符合稳定码形状时退回通用码，不外泄文本。 */
function failureCodeToReason(code: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : REASON.fail;
}

export type ManagedAutomationActivation = ReturnType<typeof createManagedAutomationActivation>;
