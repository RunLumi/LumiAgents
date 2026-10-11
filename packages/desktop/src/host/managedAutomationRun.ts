/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// Host 侧的托管 automation 派发（spec 07「Managed run activation」）。
// 只做「注册别名 → 建 task → 发 prompt」，复用交互式托管运行已有的同一条路径：
// prepareManagedProviderAlias / createTask / sendPrompt(modelExecution.managedContext)。
// 终态由既有的 managed terminal relay 经 Main 结算，这里不重复结算，也不持有任何凭据。
// Main 丢失租约时通过 cancel(runId) 停掉这一个 run 的 task（spec 07「Lease loss stops the owning Host's work」）。
import { isRemoteWorkspaceIdentity, type HostLumiManagedAutomationRunMessage } from "@zcode/shared";
import type { ModelSelection, TraceId, ZCodeManagedRunContext, ZCodeTaskMode } from "@zcode/shared";

export type ManagedAutomationRunRequest = HostLumiManagedAutomationRunMessage;

export type ManagedAutomationRunResult =
  | { ok: true; taskId: string }
  | {
      ok: false;
      errorCode:
        | "lumi_managed_automation_remote_unsupported"
        | "lumi_managed_automation_duplicate"
        | "lumi_managed_automation_services_unavailable"
        | "lumi_managed_automation_alias_unavailable"
        | "lumi_managed_automation_task_failed"
        | "lumi_managed_automation_prompt_failed"
        | "lumi_managed_automation_cancelled";
    };

export type ManagedAutomationCancelResult =
  | { ok: true; outcome: "stopped" | "prevented" | "already_cancelled" }
  | {
      ok: false;
      errorCode: "lumi_managed_automation_run_unknown" | "lumi_managed_automation_stop_failed";
    };

export interface ManagedAutomationRunServices {
  agent: {
    prepareManagedProviderAlias(params: {
      modelAlias: string;
      managedContext: ZCodeManagedRunContext;
      workspace: { workspacePath: string; workspaceIdentity?: string };
    }): Promise<ModelSelection>;
  };
  tasks: {
    createTask(params: {
      workspacePath: string;
      workspaceIdentity?: string;
      mode?: ZCodeTaskMode;
      modelSelection: ModelSelection;
      deferPersistenceUntilFirstPrompt: true;
      automationId: string;
    }): Promise<{ taskId: string }>;
    sendPrompt(params: {
      taskId: string;
      traceId: TraceId;
      content: string;
      clientMode: "desktop-continuous";
      automationId: string;
      modelSelection: ModelSelection;
      modelExecution: { selectionScope: "execution"; managedContext: ZCodeManagedRunContext };
    }): Promise<void>;
    /** 既有的任务中断服务（v4 stop → turn abort）；只作用于这一个 task。 */
    stopGeneration(params: {
      taskId: string;
      workspacePath: string;
      workspaceIdentity?: string;
    }): Promise<void>;
  };
}

export interface ManagedAutomationRunnerDeps {
  /** 本地 Host 的服务；远程 workspace 在此之前已被拒绝，缺服务时抛出即可。 */
  resolve(request: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): ManagedAutomationRunServices;
  traceId(taskId: string): TraceId;
}

/** 同一进程内已派发过的 run；有界，防止异常重放造成第二个 task。 */
const MAX_REMEMBERED_RUNS = 256;

/**
 * Host 持有的「run → services/task」映射（Main 的 bridge 只持有 run → 本 Host）。
 * cancelled 在每个 await 之后、每个有副作用的调用之前同步检查，所以被取消的 run 不会进入下一步。
 */
interface RunRecord {
  workspace: { workspacePath: string; workspaceIdentity?: string };
  services?: ManagedAutomationRunServices;
  taskId?: string;
  cancelled: boolean;
  /** sendPrompt 已经被调用（此后停止必须经 stopGeneration，不能只靠 cancelled 标志）。 */
  promptSent: boolean;
  /** sendPrompt 未落定时存在；落定（成功或失败）后才算 Agent 已接纳或拒绝该输入。 */
  promptPending?: Promise<void>;
  stopConfirmed: boolean;
  cancelling?: Promise<ManagedAutomationCancelResult>;
}

const CANCELLED = { ok: false, errorCode: "lumi_managed_automation_cancelled" } as const;

export function createManagedAutomationRunner(deps: ManagedAutomationRunnerDeps) {
  const runs = new Map<string, RunRecord>();

  function begin(runId: string, workspace: RunRecord["workspace"]): RunRecord | undefined {
    if (runs.has(runId)) return undefined;
    const record: RunRecord = {
      workspace,
      cancelled: false,
      promptSent: false,
      stopConfirmed: false,
    };
    runs.set(runId, record);
    if (runs.size > MAX_REMEMBERED_RUNS) {
      const oldest = runs.keys().next().value;
      if (oldest !== undefined) runs.delete(oldest);
    }
    return record;
  }

  async function run(request: ManagedAutomationRunRequest): Promise<ManagedAutomationRunResult> {
    const workspace = {
      workspacePath: request.workspacePath,
      ...(request.workspaceIdentity ? { workspaceIdentity: request.workspaceIdentity } : {}),
    };
    // 远程 workspace 不能静默落到本地 Host：本地模型/Registry 与远程 Environment 是两套权威。
    if (request.workspaceIdentity && isRemoteWorkspaceIdentity(request.workspaceIdentity))
      return { ok: false, errorCode: "lumi_managed_automation_remote_unsupported" };
    // 失败的尝试同样占用 run：Main 在 start 之后只会派发一次，重放不得产生第二个 task。
    // 记录在同步前缀里建立：同一端口按序投递，随后的 cancel 一定能找到这个 run。
    const record = begin(request.managedContext.runId, workspace);
    if (!record) return { ok: false, errorCode: "lumi_managed_automation_duplicate" };

    let services: ManagedAutomationRunServices;
    try {
      services = deps.resolve(workspace);
    } catch {
      return { ok: false, errorCode: "lumi_managed_automation_services_unavailable" };
    }
    record.services = services;

    let modelSelection: ModelSelection;
    try {
      // 别名必须在 task 选中它之前登记进该 workspace 自己持有的 Agent 进程（spec 06）。
      modelSelection = await services.agent.prepareManagedProviderAlias({
        modelAlias: request.modelAlias,
        managedContext: request.managedContext,
        workspace,
      });
    } catch {
      return record.cancelled
        ? CANCELLED
        : { ok: false, errorCode: "lumi_managed_automation_alias_unavailable" };
    }
    if (record.cancelled) return CANCELLED;

    let taskId: string;
    try {
      ({ taskId } = await services.tasks.createTask({
        ...workspace,
        // 与 dispatchCronRun 一致：模式在消息边界是宽松 string，这里按既有约定收窄。
        ...(request.mode ? { mode: request.mode as ZCodeTaskMode } : {}),
        modelSelection,
        deferPersistenceUntilFirstPrompt: true,
        // 归到保留原任务名下（分组/溯源）；同时让协议信封合并 automation 变更类工具的本轮禁用。
        automationId: request.localAutomationId,
      }));
    } catch {
      return record.cancelled
        ? CANCELLED
        : { ok: false, errorCode: "lumi_managed_automation_task_failed" };
    }
    record.taskId = taskId;
    // 与下面的 sendPrompt 之间没有 await：检查通过的那一刻起，取消只能走 stopGeneration。
    if (record.cancelled) return CANCELLED;

    record.promptSent = true;
    // 用 async IIFE 调用：同步抛出的 sendPrompt 也变成 rejection，且调用仍发生在上面的检查之后。
    const prompt = (async () =>
      services.tasks.sendPrompt({
        taskId,
        traceId: deps.traceId(taskId),
        content: request.prompt,
        clientMode: "desktop-continuous",
        automationId: request.localAutomationId,
        modelSelection,
        modelExecution: { selectionScope: "execution", managedContext: request.managedContext },
      }))();
    const settled = prompt.then(
      () => true,
      () => false,
    );
    record.promptPending = settled.then(() => undefined);
    const accepted = await settled;
    record.promptPending = undefined;
    // 取消在 prompt 悬而未决时到达：cancel() 已等待落定并在 Agent 接纳之后再停一次。
    if (record.cancelled) return CANCELLED;
    // task 适配层已经把失败经 terminal relay 报给 Main；这里只返回稳定码，不回显错误文本。
    if (!accepted) return { ok: false, errorCode: "lumi_managed_automation_prompt_failed" };
    return { ok: true, taskId };
  }

  async function stopRun(record: RunRecord): Promise<ManagedAutomationCancelResult> {
    const { services, taskId } = record;
    // 还没有任何输入交给 Agent：标志位已经保证 run() 不会再发，没有东西可停。
    if (!record.promptSent || !services || !taskId) {
      record.stopConfirmed = true;
      return { ok: true, outcome: "prevented" };
    }
    const stop = (): Promise<boolean> =>
      services.tasks.stopGeneration({ taskId, ...record.workspace }).then(
        () => true,
        () => false,
      );
    let stopped = await stop();
    if (record.promptPending) {
      // 在 Agent 接纳 prompt 之前到达的 stop 是空操作；等它落定后必须再停一次。
      await record.promptPending;
      stopped = await stop();
    }
    if (!stopped) return { ok: false, errorCode: "lumi_managed_automation_stop_failed" };
    record.stopConfirmed = true;
    return { ok: true, outcome: "stopped" };
  }

  /** Main 丢失租约后停掉这一个 run 的工作：幂等；未知 run 拒绝；失败不记忆，重试真的会重试。 */
  function cancel(runId: string): Promise<ManagedAutomationCancelResult> {
    const record = runs.get(runId);
    if (!record)
      return Promise.resolve({ ok: false, errorCode: "lumi_managed_automation_run_unknown" });
    record.cancelled = true;
    if (record.stopConfirmed) return Promise.resolve({ ok: true, outcome: "already_cancelled" });
    if (record.cancelling) return record.cancelling;
    const attempt = stopRun(record).finally(() => {
      if (record.cancelling === attempt) record.cancelling = undefined;
    });
    record.cancelling = attempt;
    return attempt;
  }

  return { run, cancel };
}

export type ManagedAutomationRunner = ReturnType<typeof createManagedAutomationRunner>;
