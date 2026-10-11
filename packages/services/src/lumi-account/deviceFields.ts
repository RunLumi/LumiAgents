/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { LumiAccountError } from "./errors.js";

/** Pure device-response field validators shared by the device transport adapters. */
export function id(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(value))
    throw new LumiAccountError("lumi_device_response_invalid");
  return value;
}
export function instant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    Date.parse(value) <= Date.now()
  )
    throw new LumiAccountError("lumi_device_response_invalid");
  return value;
}
