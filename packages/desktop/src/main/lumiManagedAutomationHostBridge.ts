/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// Main → Host 的托管 automation 派发通道：一次请求一条已校验消息，按 requestId 配对回复。
// 消息里只有 prompt + 服务端签发的非密 context；没有 token、fence、cookie 的字段（schema 为 strict）。
// 迟到/伪造/重复的回复不能满足任何其他请求。
// 派发时记录「run → 接收它的那个 Host」；租约丢失后的 cancel 只发给这个 Host（spec 07
// 「Lease loss stops the owning Host's work」），不猜别的 Host，也没有全局「停止全部」。
import { randomUUID } from "node:crypto";
import {
  HostMessageTypes,
  hostLumiManagedAutomationCancelMessageSchema,
  hostLumiManagedAutomationRunMessageSchema,
  type HostLumiManagedAutomationRunMessage,
} from "@zcode/shared";

export type ManagedAutomationDispatchInput = Omit<
  HostLumiManagedAutomationRunMessage,
  "type" | "requestId"
>;

export type ManagedAutomationDispatchResult =
  | { ok: true; taskId: string }
  | { ok: false; errorCode: string };

export interface ManagedAutomationHostResult {
  type: "lumi-managed-automation-run-result";
  requestId: string;
  ok: boolean;
  taskId?: string;
  errorCode?: string;
}

export interface ManagedAutomationHostCancelResult {
  type: "lumi-managed-automation-cancel-result";
  requestId: string;
  runId: string;
  ok: boolean;
  outcome?: "stopped" | "prevented" | "already_cancelled";
  errorCode?: string;
}

export type ManagedAutomationCancelResult =
  | { ok: true; outcome: "stopped" | "prevented" | "already_cancelled" }
  | { ok: false; errorCode: string };

export interface ManagedAutomationHostTarget {
  postMessage(message: unknown): void;
}

export interface ManagedAutomationHostBridgeDeps {
  resolveHost(): ManagedAutomationHostTarget | null;
  /** Host 创建 task 并接受 prompt 的上限；超时即未确认，调用方按「启动后失败」处理。 */
  timeoutMs?: number;
  /** Host 确认停止的上限；超时即未确认（授权早已撤销，请求仍 fail closed）。 */
  cancelTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CANCEL_TIMEOUT_MS = 15_000;
/**
 * 仍可能在运行的 run 数量上限。停止权限（run → owning Host）在 run 被证明结束之前绝不淘汰：
 * 满额时 `available()` 为 false（轮询不再 claim），`dispatch` 拒绝，而不是挤掉最早的 owner。
 */
const MAX_ACTIVE_RUNS = 256;
/** Host 已确认停止的 run 只为重复 cancel 回答 already_cancelled；停止已证明，可按先进先出淘汰。 */
const MAX_CONFIRMED_RUNS = 256;

interface RunOwner {
  host: ManagedAutomationHostTarget;
  cancelConfirmed: boolean;
}

export function createManagedAutomationHostBridge(deps: ManagedAutomationHostBridgeDeps) {
  const pending = new Map<
    string,
    { resolve(result: ManagedAutomationDispatchResult): void; timer: NodeJS.Timeout }
  >();
  const owners = new Map<string, RunOwner>();
  const cancelling = new Map<string, Promise<ManagedAutomationCancelResult>>();
  const pendingCancels = new Map<
    string,
    { runId: string; resolve(result: ManagedAutomationCancelResult): void; timer: NodeJS.Timeout }
  >();

  // 两个计数各自维护，避免每次 dispatch 扫描整张表。active 之外的 confirmed 才可能被淘汰。
  let activeCount = 0;
  const confirmedOrder: string[] = [];

  function rememberOwner(runId: string, host: ManagedAutomationHostTarget): void {
    owners.set(runId, { host, cancelConfirmed: false });
    activeCount += 1;
  }

  /** 只在 Host 确认停止后调用：释放 active 名额，并把该 run 转入有界的 confirmed 记忆。 */
  function markConfirmed(runId: string, owner: RunOwner): void {
    if (owner.cancelConfirmed || owners.get(runId) !== owner) return;
    owner.cancelConfirmed = true;
    activeCount -= 1;
    confirmedOrder.push(runId);
    while (confirmedOrder.length > MAX_CONFIRMED_RUNS) {
      const oldest = confirmedOrder.shift();
      if (oldest !== undefined) owners.delete(oldest);
    }
  }

  function forget(runId: string): void {
    const owner = owners.get(runId);
    if (!owner) return;
    owners.delete(runId);
    if (owner.cancelConfirmed) {
      const index = confirmedOrder.indexOf(runId);
      if (index >= 0) confirmedOrder.splice(index, 1);
    } else {
      activeCount -= 1;
    }
  }

  function postCancel(runId: string, owner: RunOwner): Promise<ManagedAutomationCancelResult> {
    const requestId = randomUUID();
    const message = { type: HostMessageTypes.LumiManagedAutomationCancel, requestId, runId };
    // 与 Host 入口同一个 schema：不合法的消息不离开 Main。
    if (!hostLumiManagedAutomationCancelMessageSchema.safeParse(message).success)
      return Promise.resolve({ ok: false, errorCode: "lumi_managed_automation_request_invalid" });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingCancels.delete(requestId);
        resolve({ ok: false, errorCode: "lumi_managed_automation_host_timeout" });
      }, deps.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS);
      pendingCancels.set(requestId, { runId, resolve, timer });
      try {
        owner.host.postMessage(message);
      } catch {
        clearTimeout(timer);
        pendingCancels.delete(requestId);
        resolve({ ok: false, errorCode: "lumi_managed_automation_host_unavailable" });
      }
    });
  }

  return {
    /** 无可用本地 Host 时不应开始轮询：claim 之后才发现无 Host 就只能按启动后失败处理。 */
    available(): boolean {
      return activeCount < MAX_ACTIVE_RUNS && deps.resolveHost() !== null;
    },

    /**
     * 运行时在「证明已终态」之后调用（Host 终态经 settle，或租约丢失后的 revoke）。只释放该 run 的
     * 停止权限；未知 run 是 no-op。仅 dispatch 被接受、超时或被 Host 拒绝都不是终态证明。
     */
    retire(runId: string): void {
      forget(runId);
    },

    dispatch(input: ManagedAutomationDispatchInput): Promise<ManagedAutomationDispatchResult> {
      const host = deps.resolveHost();
      if (!host)
        return Promise.resolve({
          ok: false,
          errorCode: "lumi_managed_automation_host_unavailable",
        });
      const requestId = randomUUID();
      const message = { type: HostMessageTypes.LumiManagedAutomationRun, requestId, ...input };
      // 与 Host 入口同一个 schema：不合法的消息不离开 Main（也不会在 Host 侧被静默丢弃而悬挂）。
      if (!hostLumiManagedAutomationRunMessageSchema.safeParse(message).success)
        return Promise.resolve({ ok: false, errorCode: "lumi_managed_automation_request_invalid" });
      const runId = input.managedContext.runId;
      // 已记住的 run id（active 或已确认停止）不能被覆盖：否则会丢掉原来的 owning Host。
      if (owners.has(runId))
        return Promise.resolve({ ok: false, errorCode: "lumi_managed_automation_run_duplicate" });
      // 满额拒绝而不是淘汰：被淘汰的 run 仍在运行时将再也无法停止。
      if (activeCount >= MAX_ACTIVE_RUNS)
        return Promise.resolve({ ok: false, errorCode: "lumi_managed_automation_host_busy" });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve({ ok: false, errorCode: "lumi_managed_automation_host_timeout" });
        }, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        pending.set(requestId, { resolve, timer });
        // 先记 owner 再 post：post 之后的任何时刻（含回复前）租约丢失都能找到该 Host。
        rememberOwner(runId, host);
        try {
          host.postMessage(message);
        } catch {
          clearTimeout(timer);
          pending.delete(requestId);
          forget(runId); // run 消息未离开 Main：没有可停止的工作
          resolve({ ok: false, errorCode: "lumi_managed_automation_host_unavailable" });
        }
      });
    },

    handleResult(result: ManagedAutomationHostResult): void {
      const entry = pending.get(result.requestId);
      if (!entry) return;
      pending.delete(result.requestId);
      clearTimeout(entry.timer);
      entry.resolve(
        result.ok && result.taskId
          ? { ok: true, taskId: result.taskId }
          : { ok: false, errorCode: result.errorCode ?? "lumi_managed_automation_refused" },
      );
    },

    /**
     * 租约丢失后停掉该 run 在其 owning Host 上的工作。幂等：并发调用共享一次请求，已确认的
     * run 直接回答 already_cancelled；未知 run 拒绝（不猜 Host）。失败不记忆，重试会重新发。
     */
    cancel(runId: string): Promise<ManagedAutomationCancelResult> {
      const owner = owners.get(runId);
      if (!owner)
        return Promise.resolve({ ok: false, errorCode: "lumi_managed_automation_run_unknown" });
      if (owner.cancelConfirmed) return Promise.resolve({ ok: true, outcome: "already_cancelled" });
      const inflight = cancelling.get(runId);
      if (inflight) return inflight;
      const attempt = postCancel(runId, owner).then((result) => {
        if (result.ok) markConfirmed(runId, owner);
        return result;
      });
      const tracked = attempt.finally(() => {
        if (cancelling.get(runId) === tracked) cancelling.delete(runId);
      });
      cancelling.set(runId, tracked);
      return tracked;
    },

    /** 只有 requestId 与 runId 都配得上的 ACK 才算数：伪造/迟到/串线的回复不能确认别的取消。 */
    handleCancelResult(result: ManagedAutomationHostCancelResult): void {
      const entry = pendingCancels.get(result.requestId);
      if (!entry || entry.runId !== result.runId) return;
      pendingCancels.delete(result.requestId);
      clearTimeout(entry.timer);
      entry.resolve(
        result.ok && result.outcome
          ? { ok: true, outcome: result.outcome }
          : { ok: false, errorCode: result.errorCode ?? "lumi_managed_automation_refused" },
      );
    },

    dispose(): void {
      for (const [requestId, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve({ ok: false, errorCode: "lumi_managed_automation_host_unavailable" });
        pending.delete(requestId);
      }
      for (const [requestId, entry] of pendingCancels) {
        clearTimeout(entry.timer);
        entry.resolve({ ok: false, errorCode: "lumi_managed_automation_host_unavailable" });
        pendingCancels.delete(requestId);
      }
    },
  };
}

export type ManagedAutomationHostBridge = ReturnType<typeof createManagedAutomationHostBridge>;
