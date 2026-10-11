/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// scheduler 进程对托管工作的唯一职责：告诉 Main「现在可以轮询一次」。
// 不持有任何凭据，不认识 occurrence/租约，不写 automation_runs（那会改写原任务的计数与历史）。
// spec 07「Managed scheduling」：scheduler 只是触发器，due/claim/start 全部在 Main。
export interface ManagedPollRequestMessage {
  type: "managed-poll-request";
}

/** 与服务端 due 轮询的合理下限：20s 定时 tick 与 manual wake 叠加时不会放大对 Worker 的请求。 */
export const MANAGED_POLL_MIN_INTERVAL_MS = 10_000;

export interface ManagedPollDeps {
  /** 本地是否存在 state=managed 的接管标记；没有则完全不打扰 Main。 */
  hasManagedAdoption(): Promise<boolean>;
  post(message: ManagedPollRequestMessage): void;
  now(): number;
  logWarn(message: string): void;
}

export function createManagedPollTrigger(
  deps: ManagedPollDeps,
): () => Promise<"requested" | "none" | "throttled"> {
  let lastRequestedAt = Number.NEGATIVE_INFINITY;
  return async () => {
    try {
      if (!(await deps.hasManagedAdoption())) return "none";
    } catch {
      // 只记录失败类别：错误文本可能含本地路径，不进入日志。
      deps.logWarn("managed poll skipped: adoption marker read failed");
      return "none";
    }
    const now = deps.now();
    if (now - lastRequestedAt < MANAGED_POLL_MIN_INTERVAL_MS) return "throttled";
    lastRequestedAt = now;
    deps.post({ type: "managed-poll-request" });
    return "requested";
  };
}
