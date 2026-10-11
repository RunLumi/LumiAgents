/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 托管 occurrence 的一次尝试：due → claim → start → (renew)* → settle | release。
// 顺序与围栏判定全部委托给 P06AutomationFenceGuard；这里没有重试、重排或本地计数器。
// 设备令牌与租约令牌只在 Main 的这个对象里；返回给调用方的句柄不含任何凭据。
import {
  P06AutomationFenceGuard,
  P06AutomationLeaseError,
  isP06ExecutableExecutionPrincipal,
  p06ReasonCodeSchema,
  resolveAutomationExecutionClass,
  type P06AutomationExecutionGrant,
  type P06ExecutionPrincipal,
  type P06ReasonCode,
} from "@zcode/shared";
import type { AutomationManagedAdoption } from "../session/automationManagedAdoption.js";
import {
  LumiAutomationLeaseError,
  LumiAutomationWireError,
  type LumiAutomationLeaseHostTransport,
  type LumiDueOccurrence,
} from "./automationLeaseTransport.js";

type LeasePort = Pick<
  LumiAutomationLeaseHostTransport,
  "listDue" | "claim" | "renew" | "start" | "settle" | "release"
>;

export interface OccurrenceDriverPorts {
  orgId: string;
  leases: LeasePort;
  /** 只有本地已确认接管(managed)的任务才允许被这台设备认领。 */
  findMarkerByManagedId(
    orgId: string,
    managedAutomationId: string,
  ): Promise<AutomationManagedAdoption | null>;
  /** 服务端对该托管任务的权威 principal（会话读取）。 */
  principalFor(managedAutomationId: string): Promise<P06ExecutionPrincipal>;
  /** P03 当前策略版本；落后于 occurrence 快照的认领被守卫拒绝。 */
  currentPolicyVersion(): Promise<number | undefined>;
  now?: () => number;
}

/** 稳定的跳过/终止原因；全部来自服务端 reason 或守卫本地码，不含任何自由文本。 */
export type OccurrenceOutcomeCode =
  | "not_adopted_here"
  | "lost_race"
  | "needs_reconciliation"
  | "refused"
  | "wire_invalid";

export interface SkippedOccurrence {
  occurrenceId: string;
  code: OccurrenceOutcomeCode;
  /** 服务端稳定 reason 或守卫本地码（若有）。 */
  reason?: string;
}

/** 调用方可持有的句柄：只有授予的运行标识，没有令牌，也没有原始围栏。 */
export interface ManagedOccurrence {
  readonly localAutomationId: string;
  readonly grant: P06AutomationExecutionGrant;
  readonly heartbeatIntervalMs: number;
  readonly phase: () => string;
  /** 续租失败即失去权威：调用方必须停止本次运行，驱动器不会重试。 */
  renew(): Promise<void>;
  settle(
    outcome: { outcome: "succeeded" } | { outcome: "failed"; reasonCode: P06ReasonCode },
  ): Promise<void>;
}

const MS_PER_SECOND = 1000;

/**
 * The one list of `start` refusals that prove the Worker created no run for this attempt, so a
 * best-effort pre-start release is allowed (spec 07: "Only explicit known pre-start eligibility
 * refusals permit best-effort release"). Each is returned before the Worker writes anything:
 * - `device_token_expired`: token lookup, which also refuses a revoked device (`require_device`);
 * - `device_revoked` / `device_not_approved` / `organization_not_active`: `authorize_device`;
 * - `device_not_eligible`: P06-CG frozen eligibility reason;
 * - the rest: `dispatch_block`, re-read by `start_occurrence` immediately before the run exists.
 * Anything else after `start` was sent (lost response, 5xx, stale fence, invalid state, unknown
 * reason, unreadable grant) cannot prove "not started" and is ambiguous.
 */
const START_REFUSED_BEFORE_START: ReadonlySet<string> = new Set([
  "device_token_expired",
  "device_revoked",
  "device_not_approved",
  "organization_not_active",
  "device_not_eligible",
  "organization_suspended",
  "organization_not_found",
  "organization_pending_deletion",
  "execution_principal_unavailable",
  "policy_snapshot_stale",
  "entitlement_not_granted",
  "entitlement_grace_expired",
  "entitlement_limit_exceeded",
]);

/** No off-peak policy is enforceable by the Host turn path yet; see the classifier call below. */
const HOST_ENFORCEABLE_OFF_PEAK_POLICY = undefined;

/** Whether a failed `start` is a server refusal that proves no run was created. */
export function isStartRefusedBeforeStart(error: unknown): error is LumiAutomationLeaseError {
  return (
    error instanceof LumiAutomationLeaseError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.reason !== undefined &&
    START_REFUSED_BEFORE_START.has(error.reason)
  );
}

function refusalReason(error: unknown): string | undefined {
  if (error instanceof LumiAutomationLeaseError) return error.reason;
  if (error && typeof error === "object" && "code" in error) {
    const parsed = p06ReasonCodeSchema.safeParse(error.code);
    return parsed.success ? parsed.data : undefined;
  }
  return undefined;
}

export function createManagedOccurrenceDriver(ports: OccurrenceDriverPorts) {
  async function startOne(
    due: LumiDueOccurrence,
    marker: AutomationManagedAdoption,
    policyVersion: number | undefined,
  ): Promise<ManagedOccurrence> {
    const guard = new P06AutomationFenceGuard({
      ...(policyVersion === undefined ? {} : { currentPolicyVersion: policyVersion }),
      ...(ports.now ? { now: ports.now } : {}),
    });
    const principal = await ports.principalFor(due.automationId);
    // claim 会消耗服务端的 start 尝试预算：不可执行的 principal 在这之前就拒绝，而不是认领后再被守卫拒绝。
    if (!isP06ExecutableExecutionPrincipal(principal))
      throw new P06AutomationLeaseError(
        "automation_execution_principal_unavailable",
        "the resolved execution principal is not executable in the P06 MVP",
        { occurrenceId: due.occurrenceId },
      );
    // Off-peak is decided by the shared P06 classifier, never by a second local rule. The Host does
    // not apply `narrowOffPeakToolConstraints` yet (spec 07 "Off-peak and ineligible work"), so this
    // device has no off-peak policy it can enforce and presents none: every off_peak occurrence is
    // then refused with the frozen `off_peak_not_allowed`, before the claim spends an attempt.
    const executionClass = resolveAutomationExecutionClass(
      {
        occurrence_id: due.occurrenceId,
        automation_id: due.automationId,
        attempt: due.attempt,
        scheduled_for: due.scheduledFor,
        off_peak_mode: due.offPeakMode,
        policy_snapshot_id: due.policySnapshotId,
        policy_version: due.policyVersion,
        execution_principal: principal,
      },
      HOST_ENFORCEABLE_OFF_PEAK_POLICY,
      // The principal already passed the executable check above.
      { isExecutablePrincipal: (kind) => kind === principal.kind },
    );
    if (!executionClass.ok)
      throw Object.assign(new Error(executionClass.code), { code: executionClass.code });
    const claim = await ports.leases.claim(due, principal);
    try {
      guard.acceptClaim(claim);
    } catch (error) {
      // 守卫拒绝一个服务端已授予的租约：在任何副作用之前归还，归还不了交给服务端到期判定。
      await ports.leases
        .release(due.occurrenceId, claim.attempt, {
          lease_id: claim.lease.lease_id,
          lease_version: claim.lease.lease_version,
          lease_fence: claim.lease.lease_fence,
          lease_token: claim.lease_token,
        })
        .catch(() => undefined);
      throw error;
    }
    const attempt = guard.attempt;
    const occurrenceId = due.occurrenceId;
    try {
      guard.acceptStart(await ports.leases.start(occurrenceId, guard.buildFenceRequest({})));
    } catch (error) {
      if (!isStartRefusedBeforeStart(error)) {
        // A lost response or invalid grant does not prove the server never started.
        guard.markAmbiguous();
        throw new LumiAutomationLeaseError(409, "occurrence_ambiguous");
      }
      await ports.leases
        .release(occurrenceId, attempt, guard.buildFenceRequest({}))
        .then(() => guard.markReleased())
        .catch(() => undefined);
      throw error;
    }
    const grant = guard.toExecutionGrant();

    const lose = (error: unknown): never => {
      if (refusalReason(error) === "occurrence_ambiguous") guard.markAmbiguous();
      throw error;
    };
    return {
      localAutomationId: marker.localAutomationId,
      grant,
      heartbeatIntervalMs: due.heartbeatIntervalSeconds * MS_PER_SECOND,
      phase: () => guard.phase,
      async renew() {
        try {
          const fence = guard.buildFenceRequest({});
          guard.acceptRenew(await ports.leases.renew(fence.lease_id, attempt, fence));
        } catch (error) {
          lose(error);
        }
      },
      async settle(outcome) {
        try {
          const current = guard.currentFence;
          // 结算前再确认围栏：丢失围栏的设备不能覆盖更新的服务端状态。
          if (current) guard.assertToolResultAllowed(current, grant.runId);
          await ports.leases.settle(
            occurrenceId,
            attempt,
            grant.runId,
            guard.buildFenceRequest({}),
            outcome,
          );
          guard.markSettled();
        } catch (error) {
          lose(error);
        }
      },
    };
  }

  /**
   * 一次轮询：返回已 start 的句柄与被跳过项。每个 occurrence 独立失败，互不影响；
   * 服务端拒绝（资格、权益、吊销、off-peak、已被他人认领）一律不重试。
   */
  async function poll(): Promise<{ started: ManagedOccurrence[]; skipped: SkippedOccurrence[] }> {
    const started: ManagedOccurrence[] = [];
    const skipped: SkippedOccurrence[] = [];
    const due = await ports.leases.listDue();
    const policyVersion = due.length > 0 ? await ports.currentPolicyVersion() : undefined;
    for (const item of due) {
      const marker = await ports.findMarkerByManagedId(ports.orgId, item.automationId);
      if (!marker || marker.state !== "managed") {
        // 不认领：它属于其他客户端/网页创建的任务，claim 会白白消耗服务端重试预算。
        skipped.push({ occurrenceId: item.occurrenceId, code: "not_adopted_here" });
        continue;
      }
      if (policyVersion !== undefined && item.policyVersion < policyVersion) {
        // 在 claim 之前拒绝：守卫在 claim 之后才能发现，那时已消耗服务端的 start 尝试预算。
        skipped.push({
          occurrenceId: item.occurrenceId,
          code: "refused",
          reason: "automation_policy_stale",
        });
        continue;
      }
      try {
        started.push(await startOne(item, marker, policyVersion));
      } catch (error) {
        const reason = refusalReason(error);
        const code: OccurrenceOutcomeCode =
          reason === "occurrence_already_claimed"
            ? "lost_race"
            : reason === "occurrence_ambiguous" || reason === "automation_occurrence_ambiguous"
              ? "needs_reconciliation"
              : error instanceof LumiAutomationWireError
                ? "wire_invalid"
                : "refused";
        skipped.push({ occurrenceId: item.occurrenceId, code, ...(reason ? { reason } : {}) });
      }
    }
    return { started, skipped };
  }

  return { poll };
}

export type ManagedOccurrenceDriver = ReturnType<typeof createManagedOccurrenceDriver>;
