/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { P08CredentialMode } from "./p08-migration-adoption.js";

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
    };

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
    }
  | { ok: false; code: string };

export interface LumiAccountBridge {
  request(command: LumiAccountCommand): Promise<LumiAccountResult>;
}
