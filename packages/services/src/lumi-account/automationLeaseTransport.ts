/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// P06 设备租约路由（due/claim/renew/start/settle/release）的服务端投影 → 守卫类型适配。
// 部署的 Worker 投影与 packages/shared/src/p06-automation-lease.ts 的严格 schema 不同形
// （spec 07「Wire facts」），这里是唯一的适配点：只做字段改名/嵌套，缺失的事实一律拒绝，
// 绝不伪造 principal、policy 或 fence。令牌只在请求体中出现，错误里永远不带令牌。
import {
  decodeAutomationWire,
  isP06OpaqueId,
  p06AutomationClaimResponseSchema,
  p06AutomationReleaseResponseSchema,
  p06AutomationRenewResponseSchema,
  p06AutomationSettleResponseSchema,
  p06AutomationStartResponseSchema,
  type P06AutomationClaimResponse,
  type P06AutomationLeaseFenceRequest,
  type P06AutomationReleaseResponse,
  type P06AutomationRenewResponse,
  type P06AutomationSettleResponse,
  type P06AutomationStartResponse,
  type P06ExecutionPrincipal,
  type P06ReasonCode,
} from "@zcode/shared";
import { LumiAccountError } from "./errors.js";

/** 设备令牌端口：非 2xx 也返回，供适配器读取稳定 reason；令牌与 TLS 由 Main 持有。 */
export type LumiDeviceEnvelopeRequest = (
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
) => Promise<{ status: number; body: unknown }>;

/**
 * 设备令牌 + 信封读取：非 2xx 也返回而不抛出，让调用方看到稳定 reason。
 * 令牌只在 Authorization 头里；过期令牌在发请求前就拒绝（不发送已知无效的凭据）。
 */
export function createDeviceEnvelopeRequest(
  origin: string,
  fetchImpl: typeof fetch,
  credential: () => { token: string; tokenExpiresAt: string } | undefined,
): LumiDeviceEnvelopeRequest {
  return async (path, method, body) => {
    const held = credential();
    if (!held || Date.parse(held.tokenExpiresAt) <= Date.now())
      throw new LumiAccountError("lumi_device_token_expired");
    const response = await fetchImpl(new URL(path, origin), {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `DeviceToken ${held.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // 响应体可能含错误信封；解析失败按无体处理，调用方只看状态与 reason。
    const parsed: unknown = await response.json().catch(() => undefined);
    return { status: response.status, body: parsed };
  };
}

export function createLumiAutomationLeaseTransport(
  origin: string,
  fetchImpl: typeof fetch,
  credential: () => { id: string; token: string; tokenExpiresAt: string } | undefined,
): LumiAutomationLeaseHostTransport {
  return new LumiAutomationLeaseHostTransport(
    createDeviceEnvelopeRequest(origin, fetchImpl, credential),
    () => credential()?.id,
  );
}

/** 服务端稳定 reason（error.details.reason）。不是文本匹配：未知值只保留为 undefined。 */
export class LumiAutomationLeaseError extends Error {
  readonly code = "lumi_automation_lease_refused";
  constructor(
    readonly status: number,
    readonly reason: string | undefined,
  ) {
    super("lumi_automation_lease_refused");
    this.name = "LumiAutomationLeaseError";
  }
}

export class LumiAutomationWireError extends Error {
  readonly code = "automation_wire_invalid";
  constructor() {
    super("automation_wire_invalid");
    this.name = "LumiAutomationWireError";
  }
}

/** `GET /devices/automations/due` 的单项投影（只取本适配器需要的字段）。 */
export interface LumiDueOccurrence {
  occurrenceId: string;
  automationId: string;
  attempt: number;
  scheduledFor: string;
  offPeakMode: "normal" | "off_peak";
  policySnapshotId: string;
  policyVersion: number;
  state: string;
  /** 服务端给出的心跳间隔，驱动器据此续租；缺失则拒绝，不使用本地默认值。 */
  heartbeatIntervalSeconds: number;
}

const REASON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function reasonOf(body: unknown): string | undefined {
  const reason = (body as { error?: { details?: { reason?: unknown } } } | null)?.error?.details
    ?.reason;
  return typeof reason === "string" && REASON_PATTERN.test(reason) ? reason : undefined;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LumiAutomationWireError();
  return value as Record<string, unknown>;
}

function instant(value: unknown): string {
  if (typeof value !== "string") throw new LumiAutomationWireError();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new LumiAutomationWireError();
  return new Date(parsed).toISOString();
}

function decode<T>(schema: Parameters<typeof decodeAutomationWire>[0], value: unknown): T {
  const result = decodeAutomationWire(schema, value);
  if (!result.ok) throw new LumiAutomationWireError();
  return result.value as T;
}

export class LumiAutomationLeaseHostTransport {
  readonly #request: LumiDeviceEnvelopeRequest;
  readonly #deviceId: () => string | undefined;

  constructor(request: LumiDeviceEnvelopeRequest, deviceId: () => string | undefined) {
    this.#request = request;
    this.#deviceId = deviceId;
  }

  async #send(path: string, method: "GET" | "POST", body?: Record<string, unknown>) {
    const response = await this.#request(path, method, body);
    if (response.status < 200 || response.status >= 300)
      throw new LumiAutomationLeaseError(response.status, reasonOf(response.body));
    return response.body;
  }

  async listDue(): Promise<LumiDueOccurrence[]> {
    const row = object(await this.#send("/api/v1/devices/automations/due?limit=20", "GET"));
    if (!Array.isArray(row.items) || row.items.length > 20) throw new LumiAutomationWireError();
    return row.items.map((raw) => {
      const item = object(raw);
      // 修复依据（P06-CR-007 / spec 07「Due policy」）：此前只校验 typeof string 与安全整数，
      // 形如 "x" 的 snapshot id 或 policy_version=0 会通过，随后 claim 先向 Worker 发出请求（租约已授予、
      // 尝试次数已消耗），再在严格 schema 解码处失败。这里在 claim 之前就套用与解码相同的规则。
      // 不放宽：缺失/null 的 policy 仍然拒绝，也不从设备自己的策略快照补默认值。
      if (
        !isP06OpaqueId(item.occurrence_id, "occ") ||
        !isP06OpaqueId(item.automation_id, "aut") ||
        !Number.isSafeInteger(item.attempt) ||
        (item.attempt as number) < 0 ||
        (item.off_peak_mode !== "normal" && item.off_peak_mode !== "off_peak") ||
        !isP06OpaqueId(item.policy_snapshot_id, "pol") ||
        !Number.isSafeInteger(item.policy_version) ||
        (item.policy_version as number) < 1 ||
        typeof item.state !== "string" ||
        !Number.isSafeInteger(item.heartbeat_interval_seconds) ||
        (item.heartbeat_interval_seconds as number) < 10 ||
        (item.heartbeat_interval_seconds as number) > 60
      )
        throw new LumiAutomationWireError();
      return {
        occurrenceId: item.occurrence_id,
        automationId: item.automation_id,
        attempt: item.attempt as number,
        scheduledFor: instant(item.scheduled_for_utc),
        offPeakMode: item.off_peak_mode,
        policySnapshotId: item.policy_snapshot_id,
        policyVersion: item.policy_version as number,
        state: item.state,
        heartbeatIntervalSeconds: item.heartbeat_interval_seconds as number,
      };
    });
  }

  /** principal 来自服务端对该任务的权威读取，不是客户端推断。 */
  async claim(
    due: LumiDueOccurrence,
    principal: P06ExecutionPrincipal,
  ): Promise<P06AutomationClaimResponse> {
    const deviceId = this.#deviceId();
    if (!deviceId) throw new LumiAutomationWireError();
    const row = object(
      await this.#send(
        `/api/v1/devices/automation-occurrences/${due.occurrenceId}/claim`,
        "POST",
        {},
      ),
    );
    if (row.occurrence_id !== due.occurrenceId || !Number.isSafeInteger(row.attempt))
      throw new LumiAutomationWireError();
    return decode<P06AutomationClaimResponse>(p06AutomationClaimResponseSchema, {
      occurrence: {
        occurrence_id: due.occurrenceId,
        automation_id: due.automationId,
        attempt: row.attempt,
        scheduled_for: due.scheduledFor,
        off_peak_mode: due.offPeakMode,
        policy_snapshot_id: due.policySnapshotId,
        policy_version: due.policyVersion,
        execution_principal: principal,
      },
      attempt: row.attempt,
      device_id: deviceId,
      lease: {
        lease_id: row.lease_id,
        lease_version: row.lease_version,
        lease_fence: row.lease_fence,
        expires_at: instant(row.expires_at),
      },
      lease_token: row.lease_token,
    });
  }

  async renew(
    leaseId: string,
    attempt: number,
    body: P06AutomationLeaseFenceRequest,
  ): Promise<P06AutomationRenewResponse> {
    const row = object(
      await this.#send(`/api/v1/devices/automation-leases/${leaseId}/renew`, "POST", { ...body }),
    );
    return decode<P06AutomationRenewResponse>(p06AutomationRenewResponseSchema, {
      occurrence_id: row.occurrence_id,
      attempt,
      lease: {
        lease_id: row.lease_id,
        lease_version: row.lease_version,
        lease_fence: row.lease_fence,
        expires_at: instant(row.expires_at),
      },
    });
  }

  async start(
    occurrenceId: string,
    body: P06AutomationLeaseFenceRequest,
  ): Promise<P06AutomationStartResponse> {
    const row = object(
      await this.#send(`/api/v1/devices/automation-occurrences/${occurrenceId}/start`, "POST", {
        ...body,
      }),
    );
    // Worker 的 grant 额外带 expires_at（权威过期在 renew 的响应里推进），严格 schema 不接受，故剔除。
    const { expires_at: _expiresAt, ...grant } = row;
    return decode<P06AutomationStartResponse>(p06AutomationStartResponseSchema, grant);
  }

  /**
   * 请求体不含 run_id：Worker 以 deny_unknown_fields 拒绝它，并从自己的 run link 取 run_id。
   * 因此用响应里回显的 run_id 与已授予的 run 比对，不一致即拒绝（防止结算到别的 run）。
   */
  async settle(
    occurrenceId: string,
    attempt: number,
    expectedRunId: string,
    body: P06AutomationLeaseFenceRequest,
    outcome: { outcome: "succeeded" } | { outcome: "failed"; reasonCode: P06ReasonCode },
  ): Promise<P06AutomationSettleResponse> {
    const payload: Record<string, unknown> = { ...body, outcome: outcome.outcome };
    if (outcome.outcome === "failed") payload.reason_code = outcome.reasonCode;
    const row = object(
      await this.#send(
        `/api/v1/devices/automation-occurrences/${occurrenceId}/settle`,
        "POST",
        payload,
      ),
    );
    if (row.run_id !== expectedRunId || row.state !== outcome.outcome)
      throw new LumiAutomationWireError();
    return decode<P06AutomationSettleResponse>(p06AutomationSettleResponseSchema, {
      occurrence_id: row.occurrence_id,
      attempt,
      settled_state: outcome.outcome,
      lease_version: body.lease_version,
      lease_fence: body.lease_fence,
      idempotent: false,
    });
  }

  async release(
    occurrenceId: string,
    attempt: number,
    body: P06AutomationLeaseFenceRequest,
  ): Promise<P06AutomationReleaseResponse> {
    const row = object(
      await this.#send(`/api/v1/devices/automation-occurrences/${occurrenceId}/release`, "POST", {
        ...body,
      }),
    );
    if (row.lease_id !== body.lease_id) throw new LumiAutomationWireError();
    return decode<P06AutomationReleaseResponse>(p06AutomationReleaseResponseSchema, {
      occurrence_id: row.occurrence_id,
      attempt,
      released: true,
      lease_version: body.lease_version,
      lease_fence: body.lease_fence,
    });
  }
}
