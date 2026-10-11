/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { LumiDeviceCredential, LumiRuntimeCapabilityReport } from "./deviceTransport.js";
import { id, instant } from "./deviceFields.js";
import { LumiAccountError } from "./errors.js";

const CAPABILITY_KEYS = new Set([
  "browser_use",
  "computer_use",
  "remote_environment",
  "automation_eligible",
  "filesystem_write",
  "process_execution",
  "network_access",
  "mcp_execution",
]);

/**
 * Device-authenticated heartbeat/policy IO. The device transport remains the only credential
 * owner; this adapter reads it through a private callback and never caches or exposes it.
 */
export class LumiDevicePolicyHostTransport {
  constructor(
    private readonly request: (
      path: string,
      method: "GET" | "POST",
      body?: unknown,
    ) => Promise<Record<string, unknown> | undefined>,
    private readonly credential: () => LumiDeviceCredential | undefined,
  ) {}

  async policy() {
    const row = await this.request("/api/v1/devices/policy", "GET");
    if (
      !row ||
      row.org_id !== this.credential()?.orgId ||
      !Number.isSafeInteger(row.policy_version)
    )
      throw new LumiAccountError("lumi_policy_invalid");
    // API 使用 policy_id；Main 的当前 snapshot 投影使用 id，不能从缺失的 row.id 取值。
    return {
      ...row,
      id: id(row.policy_id, "pol"),
      policy_version: row.policy_version as number,
      expires_at: instant(row.expires_at),
    };
  }

  async acknowledge(policyVersion: number): Promise<void> {
    if (!Number.isSafeInteger(policyVersion) || policyVersion < 1)
      throw new LumiAccountError("lumi_policy_invalid");
    await this.request("/api/v1/devices/policy/ack", "POST", { policy_version: policyVersion });
  }

  async heartbeat(appVersion: string, capabilities: LumiRuntimeCapabilityReport) {
    if (
      !/^[A-Za-z0-9.]{1,32}$/.test(appVersion) ||
      !capabilities ||
      typeof capabilities !== "object" ||
      Array.isArray(capabilities) ||
      Object.entries(capabilities).some(
        ([key, value]) => !CAPABILITY_KEYS.has(key) || typeof value !== "boolean",
      )
    )
      throw new LumiAccountError("lumi_capability_report_invalid");
    const credential = this.credential();
    if (!credential) throw new LumiAccountError("lumi_device_missing");
    const row = await this.request("/api/v1/devices/heartbeat", "POST", {
      app_version: appVersion,
      capabilities: { ...capabilities },
    });
    // 响应到达前凭据被轮换/清除时，旧凭据的响应不能再发布。
    if (this.credential() !== credential) throw new LumiAccountError("lumi_device_response_stale");
    if (
      !row ||
      typeof row.server_time !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.server_time) ||
      !Number.isFinite(Date.parse(row.server_time)) ||
      !(
        row.policy_version === null ||
        (Number.isSafeInteger(row.policy_version) && (row.policy_version as number) > 0)
      ) ||
      !(
        row.min_client_version === null ||
        (typeof row.min_client_version === "string" &&
          /^\d+(\.\d+){0,3}$/.test(row.min_client_version))
      )
    )
      throw new LumiAccountError("lumi_device_response_invalid");
    return {
      serverTime: row.server_time,
      policyVersion: row.policy_version as number | null,
      minClientVersion: row.min_client_version as string | null,
    };
  }
}
