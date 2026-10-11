/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { createHash, randomUUID } from "node:crypto";
import {
  zcodeManagedToolDecisionRequestParamsSchema,
  zcodeManagedToolDecisionResultSchema,
  zcodeManagedToolResultRequestParamsSchema,
  type ZCodeManagedToolResultRequestParams,
  type ZCodeManagedToolDecisionRequestParams,
} from "@zcode/shared";
import type { LumiDeviceCredential } from "./deviceTransport.js";
import { LumiAccountError } from "./errors.js";

/** Fixed-route, device-only adapter. Never accept a caller URL or authorization. */
export class LumiManagedToolHostTransport {
  constructor(
    private readonly request: (
      path: string,
      body: Record<string, unknown>,
      headers?: Record<string, string>,
    ) => Promise<Record<string, unknown> | undefined>,
    private readonly credential: () => LumiDeviceCredential | undefined,
  ) {}

  async decide(input: ZCodeManagedToolDecisionRequestParams) {
    const params = zcodeManagedToolDecisionRequestParamsSchema.parse(input);
    const credential = this.credential();
    if (
      !credential ||
      params.context.organizationId !== credential.orgId ||
      params.context.deviceId !== credential.id
    )
      throw new LumiAccountError("lumi_managed_tool_refused");
    const hash = createHash("sha256").update(params.argumentsSummary).digest("hex");
    if (params.argumentsHash !== hash) throw new LumiAccountError("lumi_managed_tool_refused");
    const preflight = {
      tool_call_id: params.toolCallId,
      tool_id: params.tool.toolId,
      tool_fingerprint: params.tool.fingerprint,
      capability_ids: params.tool.capabilityIds,
      risk_class: params.tool.riskClass,
      arguments_summary: params.argumentsSummary,
    };
    const row = await this.request(
      `/api/v1/runs/${params.context.runId}/tool-decisions`,
      preflight,
    );
    const result = this.parseDecision(row, params, hash);
    if (result.decision !== "allow") return result;
    // policy allow 不是执行许可；所有真实 handler 都必须先赢得后端的单次 claim。
    const admitted = await this.request(
      `/api/v1/devices/runs/${params.context.runId}/tool-calls/${params.toolCallId}/result`,
      { status: "allowed", preflight, arguments_hash: hash, policy_version: result.policyVersion },
      { "Idempotency-Key": randomUUID() },
    );
    if (
      admitted?.status !== "allowed" ||
      typeof admitted.execution_started_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(admitted.execution_started_at) ||
      !Number.isFinite(Date.parse(admitted.execution_started_at))
    )
      throw new LumiAccountError("lumi_device_response_invalid");
    const permit = this.parseDecision(admitted, params, hash);
    if (
      permit.decision !== "allow" ||
      permit.policyVersion !== result.policyVersion ||
      (permit.approvalId ?? null) !== (result.approvalId ?? null) ||
      (permit.approvalMode ?? null) !== (result.approvalMode ?? null) ||
      (permit.approvalExpiresAt ?? null) !== (result.approvalExpiresAt ?? null)
    )
      throw new LumiAccountError("lumi_device_response_invalid");
    return permit;
  }

  async reportResult(
    input: ZCodeManagedToolDecisionRequestParams | ZCodeManagedToolResultRequestParams,
    status: "completed" | "failed" | "cancelled",
  ): Promise<void> {
    const params =
      "tool" in input
        ? zcodeManagedToolDecisionRequestParamsSchema.parse(input)
        : zcodeManagedToolResultRequestParamsSchema.parse(input);
    const credential = this.credential();
    if (
      !credential ||
      params.context.organizationId !== credential.orgId ||
      params.context.deviceId !== credential.id ||
      !["completed", "failed", "cancelled"].includes(status) ||
      ("argumentsHash" in params &&
        params.argumentsHash !==
          createHash("sha256").update(params.argumentsSummary).digest("hex")) ||
      ("status" in params && params.status !== status)
    )
      throw new LumiAccountError("lumi_managed_tool_refused");
    // 只报告状态；工具输出、异常内容和本地路径不能进入普通审计/远端返回值。
    const row = await this.request(
      `/api/v1/devices/runs/${params.context.runId}/tool-calls/${params.toolCallId}/result`,
      { status },
      { "Idempotency-Key": randomUUID() },
    );
    if (
      !row ||
      row.run_id !== params.context.runId ||
      row.tool_call_id !== params.toolCallId ||
      row.status !== status ||
      (row.org_id !== undefined && row.org_id !== params.context.organizationId) ||
      typeof row.updated_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.updated_at) ||
      !Number.isFinite(Date.parse(row.updated_at))
    )
      throw new LumiAccountError("lumi_device_response_invalid");
  }

  private parseDecision(
    row: Record<string, unknown> | undefined,
    params: ZCodeManagedToolDecisionRequestParams,
    hash: string,
  ) {
    if (!row) throw new LumiAccountError("lumi_device_response_invalid");
    const result = zcodeManagedToolDecisionResultSchema.parse({
      decision: row.decision,
      runId: row.run_id,
      toolCallId: row.tool_call_id,
      toolId: row.tool_id,
      toolFingerprint: row.tool_fingerprint,
      riskClass: row.risk_class,
      approvalMode: row.approval_mode,
      approvalId: row.approval_id,
      approvalExpiresAt: row.approval_expires_at,
      reason: row.reason,
      policyVersion: row.policy_version,
      policyState: row.policy_state,
      ...(row.arguments_hash !== undefined ? { argumentsHash: row.arguments_hash } : {}),
    });
    if (
      result.runId !== params.context.runId ||
      result.toolCallId !== params.toolCallId ||
      result.toolId !== params.tool.toolId ||
      result.toolFingerprint !== params.tool.fingerprint ||
      result.riskClass !== params.tool.riskClass ||
      (result.decision === "allow" &&
        (result.argumentsHash !== hash || result.policyVersion !== params.context.policyVersion))
    )
      throw new LumiAccountError("lumi_device_response_invalid");
    return result;
  }
}
