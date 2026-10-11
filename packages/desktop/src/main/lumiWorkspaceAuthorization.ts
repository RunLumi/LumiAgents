import type { LumiAdoptionRecord, LumiWorkspaceBinding } from "@zcode/services/node";
import type { LumiDeviceStateProjection } from "@zcode/shared";
import type { LumiWorkspaceMapping } from "./lumiWorkspaceVault.js";

export interface ManagedWorkspaceServerState {
  device: LumiDeviceStateProjection;
  deviceBinding: LumiWorkspaceBinding | null;
  adoption: LumiAdoptionRecord | null;
}

export async function authorizeManagedWorkspaceScope(input: {
  orgId: string;
  current: LumiWorkspaceMapping;
  readServerState(): Promise<ManagedWorkspaceServerState>;
  readCurrentPolicy(): Promise<{ id: string; version: number; expiresAt: string }>;
}) {
  const server = await input.readServerState();
  const adoption = server.adoption;
  const binding = server.deviceBinding;
  if (
    !adoption ||
    adoption.stage !== "managed_policy" ||
    adoption.ownership !== "org_managed" ||
    !binding ||
    server.device.status !== "active" ||
    !server.device.device ||
    adoption.orgId !== input.orgId ||
    adoption.workspaceKey !== input.current.workspaceKey ||
    adoption.projectId !== binding.projectId ||
    adoption.deviceId !== binding.deviceId ||
    server.device.device.id !== binding.deviceId
  )
    throw new Error("lumi_managed_workspace_refused");

  const policy = await input.readCurrentPolicy();
  if (Date.parse(policy.expiresAt) <= Date.now()) throw new Error("lumi_managed_policy_stale");
  return {
    orgId: input.orgId,
    projectId: adoption.projectId,
    /** Server-side adoption record id; the import preview verifies it (P08). */
    adoptionStateId: adoption.adoptionStateId,
    deviceId: binding.deviceId,
    workspaceBindingId: binding.id,
    policySnapshotId: policy.id,
    policyVersion: policy.version,
    workspaceKey: input.current.workspaceKey,
  };
}
