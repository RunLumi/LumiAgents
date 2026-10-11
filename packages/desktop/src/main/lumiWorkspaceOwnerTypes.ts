import type {
  LumiDeviceStateProjection,
  LumiWorkspaceEnvironment,
  LumiWorkspaceProjection,
  LumiWorkspaceStage,
} from "@zcode/shared";
import type { LumiAdoptionRecord, LumiWorkspaceBinding } from "@zcode/services/node";
import type { CredentialModeChange } from "./lumiWorkspaceCredentialMode.js";
import type { LumiWorkspaceMapping, LumiWorkspaceVaultRecord } from "./lumiWorkspaceVault.js";

export interface WorkspaceVault {
  load(): Promise<LumiWorkspaceVaultRecord | null>;
  save(value: LumiWorkspaceVaultRecord): Promise<void>;
  createEmpty(): Promise<LumiWorkspaceVaultRecord>;
}
export interface DeviceOwner {
  read(): Promise<LumiDeviceStateProjection>;
  syncPolicy(): Promise<{
    device: LumiDeviceStateProjection;
    policy: { id: string; version: number; expiresAt: string };
  }>;
  readCurrentPolicy(): Promise<{ id: string; version: number; expiresAt: string }>;
  listWorkspaceBindings(): Promise<LumiWorkspaceBinding[]>;
  createWorkspaceBinding(input: {
    projectId: string;
    workspaceIdentity: string;
    displayName: string;
    environmentType: LumiWorkspaceEnvironment;
  }): Promise<LumiWorkspaceBinding>;
  deleteWorkspaceBinding(bindingId: string): Promise<void>;
}
export interface WorkspaceInput {
  workspacePath: string;
  workspaceIdentity?: string;
  environmentType: LumiWorkspaceEnvironment;
}
export interface WorkspaceRead extends WorkspaceInput {
  orgId: string;
}
export interface WorkspaceBind extends WorkspaceRead {
  projectId: string;
  displayName: string;
}
export interface WorkspaceAdvance extends WorkspaceRead {
  projectId: string;
  stage: Exclude<LumiWorkspaceStage, "local_unmanaged" | "history_sync">;
}
export interface WorkspaceCredentialMode extends WorkspaceRead, CredentialModeChange {}
export interface WorkspaceRollback extends WorkspaceRead {}

/** Renderer projection of the server rows; the label and version come only from the adoption row. */
export function projectWorkspace(
  origin: string,
  orgId: string,
  current: LumiWorkspaceMapping,
  device: LumiDeviceStateProjection,
  binding: LumiWorkspaceBinding | null,
  adoption: LumiAdoptionRecord | null,
): LumiWorkspaceProjection {
  const stage = adoption?.stage ?? "local_unmanaged";
  const ownership = adoption?.ownership ?? "local_unmanaged";
  return {
    status: ownership,
    orgId,
    workspaceKey: current.workspaceKey,
    stage,
    ownership,
    // 标签只来自服务端行；没有行时才是默认的本地凭据，绝不从本地状态推断。
    credentialMode: adoption?.credentialMode ?? "local_credential",
    adoptionVersion: adoption?.version ?? null,
    credentialConsoleUrl: new URL(origin).origin,
    deviceUsable: device.status === "active",
    projectId: adoption?.projectId ?? binding?.projectId ?? current.projectId,
    deviceId: adoption?.deviceId ?? device.device?.id ?? null,
    adoptionStateId: adoption?.adoptionStateId ?? current.adoptionStateId,
    workspaceBindingId: binding?.id ?? current.deviceBindingId,
    displayName: adoption?.displayName ?? binding?.displayName ?? current.displayName,
  };
}
