/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { P08CredentialMode } from "./p08-migration-adoption.js";
import type { ZCodeManagedRunContext } from "./zcode-protocol/managed-run-context.js";

export const LUMI_ACCOUNT_CHANNEL = "lumi-account";

export type LumiWorkspaceEnvironment = "local" | "ssh" | "wsl" | "docker" | "remote";
export type LumiWorkspaceStage =
  | "local_unmanaged"
  | "account_optional"
  | "device_enrolled"
  | "workspace_bound"
  | "managed_policy"
  | "history_sync";

export type LumiAccountCommand =
  | "begin"
  | "complete"
  | "cancel"
  | "read"
  | "restore"
  | "logout"
  | {
      action: "enroll-device" | "read-device" | "sync-device" | "refresh-device" | "recover-device";
      orgId: string;
      confirm?: true;
    }
  | {
      action: "list-projects";
      orgId: string;
    }
  | {
      action: "begin-managed-run";
      orgId: string;
      workspaceIdentity: string;
      agentDefinitionId: string;
      modelAlias: string;
      confirm: true;
    }
  | {
      action: "list-managed-options";
      orgId: string;
      projectId: string;
    }
  | {
      action: "abort-managed-run";
      runId: string;
      confirm: true;
    }
  | {
      action: "read-workspace";
      orgId: string;
      workspacePath: string;
      workspaceIdentity?: string;
      environmentType: LumiWorkspaceEnvironment;
    }
  | {
      action: "bind-workspace";
      orgId: string;
      projectId: string;
      workspacePath: string;
      workspaceIdentity?: string;
      environmentType: LumiWorkspaceEnvironment;
      displayName: string;
      confirm: true;
    }
  | {
      action: "advance-workspace";
      orgId: string;
      projectId: string;
      workspacePath: string;
      workspaceIdentity?: string;
      environmentType: LumiWorkspaceEnvironment;
      stage: Exclude<LumiWorkspaceStage, "local_unmanaged" | "history_sync">;
      confirm: true;
    }
  /**
   * Label-only credential choice (P08 `credential_mode`); nothing is provisioned or uploaded.
   * `expectedStage`/`expectedVersion` are fences against the row the user was looking at, not
   * authority: Main compares them with a fresh server read and refuses on any difference.
   */
  | {
      action: "set-workspace-credential-mode";
      orgId: string;
      projectId: string;
      workspacePath: string;
      workspaceIdentity?: string;
      environmentType: LumiWorkspaceEnvironment;
      credentialMode: P08CredentialMode;
      expectedStage: Exclude<LumiWorkspaceStage, "history_sync">;
      expectedVersion: number;
      confirm: true;
    }
  | {
      action: "rollback-workspace";
      orgId: string;
      workspacePath: string;
      workspaceIdentity?: string;
      environmentType: LumiWorkspaceEnvironment;
      confirm: true;
    }
  /** Read-only: bounded local metadata + server verdict; nothing is created or changed. */
  | {
      action: "preview-automation-adoption";
      orgId: string;
      localAutomationIds: string[];
    }
  | {
      action: "adopt-automation";
      orgId: string;
      localAutomationId: string;
      agentDefinitionId: string;
      modelAlias: string;
      /** The preview row's `revision`; Main refuses if the original changed since the user looked. */
      expectedRevision: number;
      confirm: true;
    }
  /** Read-only: the project's existing managed definitions with a per-row attachability verdict. */
  | {
      action: "preview-automation-attach";
      orgId: string;
      localAutomationId: string;
    }
  /**
   * Attach the local original to an EXISTING managed definition. Creates, edits and uploads
   * nothing on the server; only the local original's dispatch is suppressed after Main re-validates.
   */
  | {
      action: "attach-automation";
      orgId: string;
      localAutomationId: string;
      managedAutomationId: string;
      /** The preview row's `revision` of the local original. */
      expectedRevision: number;
      /** The candidate's `version` the user confirmed; Main refuses if the definition moved. */
      expectedVersion: number;
      confirm: true;
      /**
       * The user acknowledged that THIS device's own instructions run the shared schedule. The
       * prompt is never uploaded; this is a consent flag, not content.
       */
      acknowledgeLocalInstructions: true;
    }
  | {
      action: "release-automation";
      orgId: string;
      localAutomationId: string;
      confirm: true;
    }
  | {
      action: "read-automation-adoptions";
      orgId: string;
    };

/** Reasons a local automation stays local; stable machine codes, never prose. */
export type LumiAutomationUnsupportedReason =
  | "unsupported_schedule_rule"
  | "unsupported_schedule_expression"
  | "unsupported_bounded_runs"
  | "unsupported_session_binding"
  | "unsupported_external_delivery"
  | "unsupported_remote_workspace"
  | "unsupported_not_active"
  | "unsupported_one_time_elapsed"
  | "automation_adoption_not_found";

export type LumiAutomationPreviewRow =
  | {
      localAutomationId: string;
      title: string;
      adoptable: false;
      reason: LumiAutomationUnsupportedReason;
    }
  | {
      localAutomationId: string;
      title: string;
      adoptable: true;
      importable: boolean;
      conflicts: { code: string; subject: string }[];
      /** Version of the local original the user is looking at; echoed back on confirm. */
      revision: number;
    };

export interface LumiAutomationPreviewProjection {
  rows: LumiAutomationPreviewRow[];
  commitReady: boolean;
  modelCapabilityCheck: string | null;
}

export type LumiAutomationAttachRefusal =
  | "automation_attach_inactive"
  | "automation_attach_project_mismatch"
  | "automation_attach_principal_mismatch"
  | "automation_attach_binding_mismatch"
  | "automation_attach_device_pinned"
  | "automation_attach_off_peak"
  | "automation_attach_already_attached";

/** Bounded display facts of one existing managed definition; never a prompt, token or body. */
export interface LumiAutomationAttachCandidate {
  managedAutomationId: string;
  name: string;
  status: string;
  version: number;
  scheduleKind: string | null;
  scheduleExpression: string | null;
  scheduleTimezone: string | null;
  attachable: boolean;
  refusal?: LumiAutomationAttachRefusal;
}

export type LumiAutomationAttachPreviewProjection =
  | {
      localAutomationId: string;
      title: string;
      adoptable: false;
      reason: LumiAutomationUnsupportedReason;
    }
  | {
      localAutomationId: string;
      title: string;
      adoptable: true;
      revision: number;
      projectId: string;
      candidates: LumiAutomationAttachCandidate[];
      truncated: boolean;
    };

/** Only who executes the original: no prompt, token, lease or server body. */
export interface LumiAutomationAdoptionProjection {
  localAutomationId: string;
  state: "suppressed" | "managed" | "releasing";
  /** `attached`: shared definition owned elsewhere; returning this original never changes it. */
  origin?: "created" | "attached";
  managedAutomationId: string | null;
  /**
   * Occurrences of this automation that ended in an unknown outcome (lost lease, restart
   * after start, unconfirmed settle). Never retried; shown as "needs reconciliation".
   */
  ambiguousOccurrences?: number;
}

export interface LumiDeviceStateProjection {
  status: "not_enrolled" | "pending" | "active" | "reauth_required";
  orgId: string;
  enrollmentId?: string | null;
  device?: { id: string; orgId: string; tokenExpiresAt: string; policyVersion: number };
}

export interface LumiWorkspaceProjection {
  status: "local_unmanaged" | "org_managed";
  orgId: string;
  workspaceKey: string;
  stage: LumiWorkspaceStage;
  ownership: "local_unmanaged" | "org_managed";
  /** Server label only; `local_credential` until a server row says otherwise. */
  credentialMode: P08CredentialMode;
  /** Server row version, echoed back as a fence by `set-workspace-credential-mode`. */
  adoptionVersion: number | null;
  /** Control-plane origin for the existing web console; no ids, never a secret. */
  credentialConsoleUrl: string;
  deviceUsable: boolean;
  projectId: string | null;
  deviceId: string | null;
  adoptionStateId: string | null;
  workspaceBindingId: string | null;
  displayName: string | null;
}

export interface LumiProjectProjection {
  id: string;
  name: string;
  slug: string;
  archived: boolean;
  visibility: "org" | "restricted";
}

export interface LumiManagedAgentProjection {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  version: number;
  defaultModelAlias: string | null;
  lifecycle: "active" | "disabled" | "archived";
}

export interface LumiManagedModelProjection {
  alias: string;
  displayName: string;
  available: boolean;
  lifecycle: "active" | "disabled";
}

export interface LumiManagedSessionProjection {
  agentSessionId: string;
  orgId: string;
  projectId: string;
  deviceId: string;
  workspaceBindingId: string | null;
  agentDefinitionId: string;
  agentDefinitionVersion: number;
  externalId: string | null;
  title: string | null;
  lifecycle: "active" | "closed" | "archived";
  version: number;
}

export interface LumiManagedRunProjection {
  runId: string;
  orgId: string;
  projectId: string;
  agentSessionId: string;
  deviceId: string;
  agentDefinitionId: string;
  agentDefinitionVersion: number;
  workspaceBindingId: string;
  modelAlias: string;
  policySnapshotId: string | null;
  policyVersion: number | null;
  state: string;
  version: number;
  requestId: string | null;
}

export interface LumiAccountProjection {
  user: { id: string; email: string; displayName: string };
  organizations: {
    id: string;
    displayName: string;
    slug: string;
    state: string;
    role: string;
    status: string;
  }[];
}

export interface LumiSignInProjection {
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
}

export type LumiAccountResult =
  | {
      ok: true;
      account?: LumiAccountProjection;
      signIn?: LumiSignInProjection;
      restored?: boolean;
      device?: LumiDeviceStateProjection;
      workspace?: LumiWorkspaceProjection;
      projects?: LumiProjectProjection[];
      agents?: LumiManagedAgentProjection[];
      models?: LumiManagedModelProjection[];
      managedRun?: LumiManagedRunProjection;
      managedContext?: ZCodeManagedRunContext;
      automationPreview?: LumiAutomationPreviewProjection;
      automationAttachPreview?: LumiAutomationAttachPreviewProjection;
      automationAdoption?: LumiAutomationAdoptionProjection;
      automationAdoptions?: LumiAutomationAdoptionProjection[];
    }
  | { ok: false; code: string };

export interface LumiAccountBridge {
  request(command: LumiAccountCommand): Promise<LumiAccountResult>;
}
