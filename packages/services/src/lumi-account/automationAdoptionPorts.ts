/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 本地任务接管编排的端口与稳定错误（spec: docs/specs/lumi-agents/07-automation-adoption-scheduling.md）。
// 从 automationAdoptionOwner 抽出，使 adopt/release 与 attach 两条编排共享同一组端口，不复制类型。
import type { AutomationManagedAdoption } from "../session/automationManagedAdoption.js";
import type {
  AdoptableLocalAutomation,
  AutomationAdoptionUnsupportedReason,
  buildImportCandidate,
  buildManagedAutomationCreateBody,
} from "./automationAdoptionMapping.js";
import type {
  AutomationImportPreview,
  ManagedAutomationProjection,
} from "./automationAdoptionTransport.js";

/** 本地端口只暴露元数据；读取实现负责丢弃 prompt，编排层从类型上拿不到它。 */
export interface LocalAutomationMetadata extends AdoptableLocalAutomation {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  /** 原任务版本（automations.updated_at）：预览、确认与写标记必须是同一个值。 */
  readonly revision?: number;
}

export interface AdoptionLocalPort {
  readMetadata(localAutomationId: string): Promise<LocalAutomationMetadata | null>;
  getMarker(localAutomationId: string): Promise<AutomationManagedAdoption | null>;
  beginAdoption(input: {
    localAutomationId: string;
    orgId: string;
    idempotencyKey: string;
    /** 与写标记在同一事务内比较；不一致即 automation_adoption_changed。 */
    expectedRevision?: number;
  }): Promise<AutomationManagedAdoption>;
  recordCreated(input: {
    localAutomationId: string;
    managedAutomationId: string;
  }): Promise<AutomationManagedAdoption>;
  getMarkerByManagedId(
    orgId: string,
    managedAutomationId: string,
  ): Promise<AutomationManagedAdoption | null>;
  /** One local transaction; the caller has already validated the managed definition on the server. */
  beginAttach(input: {
    localAutomationId: string;
    orgId: string;
    managedAutomationId: string;
    idempotencyKey: string;
    expectedRevision?: number;
  }): Promise<AutomationManagedAdoption>;
  beginRelease(localAutomationId: string): Promise<AutomationManagedAdoption>;
  completeRelease(localAutomationId: string): Promise<boolean>;
}

export interface AdoptionServerPort {
  previewImport(
    orgId: string,
    input: {
      candidates: ReturnType<typeof buildImportCandidate>[];
      adoptionStateIds: string[];
    },
  ): Promise<AutomationImportPreview>;
  createManaged(
    orgId: string,
    body: ReturnType<typeof buildManagedAutomationCreateBody>,
    idempotencyKey: string,
  ): Promise<ManagedAutomationProjection>;
  findManagedByCorrelation(
    orgId: string,
    projectId: string,
    correlation: string,
  ): Promise<ManagedAutomationProjection | null>;
  getManaged(orgId: string, automationId: string): Promise<ManagedAutomationProjection>;
  listManagedForProject(orgId: string, projectId: string): Promise<ManagedAutomationProjection[]>;
  pauseManaged(
    orgId: string,
    automationId: string,
    version: number,
  ): Promise<ManagedAutomationProjection>;
  deleteManaged(orgId: string, automationId: string, version: number): Promise<void>;
}

/** 已授权的托管工作区事实（来自 Main 的 workspace owner，不来自渲染进程）。 */
export interface AdoptionWorkspaceContext {
  projectId: string;
  workspaceBindingId: string;
  adoptionStateId: string;
}

export interface AdoptionContextPort {
  userId(): Promise<string>;
  /** 本地工作区必须已处于 managed_policy 且设备有效，否则抛出稳定 lumi_* 错误。 */
  resolveWorkspace(workspaceIdentity: string): Promise<AdoptionWorkspaceContext>;
  timezone(): string;
  now(): number;
}

/** Stable reasons a managed definition cannot be attached; every one is evaluated from server facts. */
export type AutomationAttachRefusal =
  | "automation_attach_inactive"
  | "automation_attach_project_mismatch"
  | "automation_attach_principal_mismatch"
  | "automation_attach_binding_mismatch"
  | "automation_attach_device_pinned"
  | "automation_attach_off_peak"
  | "automation_attach_already_attached";

export type AutomationAdoptionErrorCode =
  | "automation_adoption_not_found"
  | "automation_adoption_confirm_required"
  | "automation_adoption_not_adoptable"
  | "automation_adoption_blocked"
  | "automation_adoption_changed"
  | "automation_adoption_pending_recovery"
  | "automation_adoption_release_pending"
  | AutomationAttachRefusal
  | "automation_attach_changed";

export class AutomationAdoptionError extends Error {
  constructor(
    readonly code: AutomationAdoptionErrorCode,
    readonly detail?: { reason?: AutomationAdoptionUnsupportedReason; conflicts?: string[] },
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "AutomationAdoptionError";
  }
}

export interface AutomationAdoptionOwnerPorts {
  local: AdoptionLocalPort;
  server: AdoptionServerPort;
  context: AdoptionContextPort;
}
