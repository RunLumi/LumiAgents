import type {
  LumiDeviceStateProjection,
  LumiAccountProjection,
  LumiAccountResult,
  LumiSignInProjection,
  LumiProjectProjection,
  LumiWorkspaceProjection,
  LumiManagedAgentProjection,
  LumiManagedModelProjection,
} from "@zcode/shared";
/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { LumiAccountCommand } from "@zcode/shared";
import {
  dispatchLumiAutomationCommand,
  type AutomationCommandOwner,
} from "./lumiAutomationCommands.js";
import { isCredentialChoiceCommand } from "./lumiWorkspaceValidation.js";

type WorkspaceReadCommand = Extract<LumiAccountCommand, { action: "read-workspace" }>;
type WorkspaceBindCommand = Extract<LumiAccountCommand, { action: "bind-workspace" }>;
type WorkspaceAdvanceCommand = Extract<LumiAccountCommand, { action: "advance-workspace" }>;
type WorkspaceRollbackCommand = Extract<LumiAccountCommand, { action: "rollback-workspace" }>;
type WorkspaceCredentialModeCommand = Extract<
  LumiAccountCommand,
  { action: "set-workspace-credential-mode" }
>;

interface AccountOwner extends AutomationCommandOwner {
  beginSignIn(name: string): Promise<LumiSignInProjection>;
  completeSignIn(): Promise<void>;
  cancelSignIn(): void;
  readAccount(): Promise<LumiAccountProjection>;
  restoreSession(): Promise<boolean>;
  signOut(): Promise<void>;
  enrollDevice?(orgId: string): Promise<LumiDeviceStateProjection>;
  readDevice?(orgId: string): Promise<LumiDeviceStateProjection>;
  syncDevicePolicy?(orgId: string): Promise<unknown>;
  refreshDevice?(orgId: string): Promise<LumiDeviceStateProjection>;
  recoverDevice?(orgId: string): Promise<LumiDeviceStateProjection>;
  beginManagedRun?(input: {
    orgId: string;
    workspaceIdentity: string;
    agentDefinitionId: string;
    modelAlias: string;
  }): Promise<import("@zcode/shared").ZCodeManagedRunContext>;
  listManagedOptions?(
    orgId: string,
    projectId: string,
  ): Promise<{
    agents: LumiManagedAgentProjection[];
    models: LumiManagedModelProjection[];
  }>;
  abortManagedRunBeforeAuth?(runId: string): Promise<void>;
  listProjects?(orgId: string): Promise<LumiProjectProjection[]>;
  readWorkspace?(command: WorkspaceReadCommand): Promise<LumiWorkspaceProjection>;
  bindWorkspace?(command: WorkspaceBindCommand): Promise<LumiWorkspaceProjection>;
  advanceWorkspace?(command: WorkspaceAdvanceCommand): Promise<LumiWorkspaceProjection>;
  setWorkspaceCredentialMode?(
    command: WorkspaceCredentialModeCommand,
  ): Promise<LumiWorkspaceProjection>;
  rollbackWorkspace?(command: WorkspaceRollbackCommand): Promise<LumiWorkspaceProjection>;
}

const WORKSPACE_ENVIRONMENTS = ["local", "ssh", "wsl", "docker", "remote"];
const WORKSPACE_STAGES = [
  "account_optional",
  "device_enrolled",
  "workspace_bound",
  "managed_policy",
];

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function validWorkspaceScope(command: Record<string, unknown>): boolean {
  return (
    typeof command.orgId === "string" &&
    /^org_[0-9a-f]{32}$/.test(command.orgId) &&
    typeof command.workspacePath === "string" &&
    command.workspacePath.length > 0 &&
    command.workspacePath.length <= 4096 &&
    !hasControlCharacters(command.workspacePath) &&
    (command.workspaceIdentity === undefined ||
      (typeof command.workspaceIdentity === "string" &&
        command.workspaceIdentity.length > 0 &&
        command.workspaceIdentity.length <= 4096 &&
        !hasControlCharacters(command.workspaceIdentity))) &&
    WORKSPACE_ENVIRONMENTS.includes(String(command.environmentType))
  );
}

function safeError(error: unknown, fallback: string): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : fallback;
  return /^lumi_[a-z_]{1,80}$/.test(code) ? code : fallback;
}

export async function dispatchLumiAccountCommand(options: {
  trusted: boolean;
  command: unknown;
  getOwner(): AccountOwner;
}): Promise<LumiAccountResult> {
  if (!options.trusted) return { ok: false, code: "lumi_sender_denied" };
  if (options.command && typeof options.command === "object") {
    const command = options.command as Record<string, unknown>;
    const automationResult = await dispatchLumiAutomationCommand(command, options.getOwner);
    if (automationResult) return automationResult;
    if (command.action === "list-projects") {
      if (
        typeof command.orgId !== "string" ||
        !/^org_[0-9a-f]{32}$/.test(command.orgId) ||
        Object.keys(command).some((key) => !["action", "orgId"].includes(key))
      )
        return { ok: false, code: "lumi_command_invalid" };
      try {
        const projects = await options.getOwner().listProjects?.(command.orgId);
        return projects ? { ok: true, projects } : { ok: false, code: "lumi_command_unsupported" };
      } catch (error) {
        return { ok: false, code: safeError(error, "lumi_workspace_action_failed") };
      }
    }
    if (command.action === "begin-managed-run") {
      if (
        command.confirm !== true ||
        typeof command.orgId !== "string" ||
        !/^org_[0-9a-f]{32}$/.test(command.orgId) ||
        typeof command.workspaceIdentity !== "string" ||
        !command.workspaceIdentity.trim() ||
        command.workspaceIdentity.length > 4096 ||
        hasControlCharacters(command.workspaceIdentity) ||
        typeof command.agentDefinitionId !== "string" ||
        !/^agd_[0-9a-f]{32}$/.test(command.agentDefinitionId) ||
        typeof command.modelAlias !== "string" ||
        !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(command.modelAlias) ||
        Object.keys(command).some(
          (key) =>
            ![
              "action",
              "orgId",
              "workspaceIdentity",
              "agentDefinitionId",
              "modelAlias",
              "confirm",
            ].includes(key),
        )
      )
        return { ok: false, code: "lumi_command_invalid" };
      try {
        const context = await options.getOwner().beginManagedRun?.({
          orgId: command.orgId,
          workspaceIdentity: command.workspaceIdentity,
          agentDefinitionId: command.agentDefinitionId,
          modelAlias: command.modelAlias,
        });
        return context
          ? { ok: true, managedContext: context }
          : { ok: false, code: "lumi_command_unsupported" };
      } catch (error) {
        return { ok: false, code: safeError(error, "lumi_managed_run_failed") };
      }
    }
    if (command.action === "list-managed-options") {
      if (
        typeof command.orgId !== "string" ||
        !/^org_[0-9a-f]{32}$/.test(command.orgId) ||
        typeof command.projectId !== "string" ||
        !/^prj_[0-9a-f]{32}$/.test(command.projectId) ||
        Object.keys(command).some((key) => !["action", "orgId", "projectId"].includes(key))
      )
        return { ok: false, code: "lumi_command_invalid" };
      try {
        const managedOptions = await options
          .getOwner()
          .listManagedOptions?.(command.orgId, command.projectId);
        return managedOptions
          ? { ok: true, ...managedOptions }
          : { ok: false, code: "lumi_command_unsupported" };
      } catch (error) {
        return { ok: false, code: safeError(error, "lumi_managed_options_failed") };
      }
    }
    if (command.action === "abort-managed-run") {
      if (
        command.confirm !== true ||
        typeof command.runId !== "string" ||
        !/^run_[0-9a-f]{32}$/.test(command.runId) ||
        Object.keys(command).some((key) => !["action", "runId", "confirm"].includes(key))
      )
        return { ok: false, code: "lumi_command_invalid" };
      try {
        await options.getOwner().abortManagedRunBeforeAuth?.(command.runId);
        return { ok: true };
      } catch (error) {
        return { ok: false, code: safeError(error, "lumi_managed_run_abort_failed") };
      }
    }
    if (
      String(command.action).endsWith("-workspace") ||
      command.action === "set-workspace-credential-mode"
    ) {
      if (!validWorkspaceScope(command)) return { ok: false, code: "lumi_command_invalid" };
      try {
        const owner = options.getOwner();
        switch (command.action) {
          case "read-workspace":
            if (
              Object.keys(command).some(
                (key) =>
                  ![
                    "action",
                    "orgId",
                    "workspacePath",
                    "workspaceIdentity",
                    "environmentType",
                  ].includes(key),
              )
            )
              return { ok: false, code: "lumi_command_invalid" };
            return owner.readWorkspace
              ? { ok: true, workspace: await owner.readWorkspace(command as WorkspaceReadCommand) }
              : { ok: false, code: "lumi_command_unsupported" };
          case "bind-workspace":
            if (
              command.confirm !== true ||
              typeof command.projectId !== "string" ||
              !/^prj_[0-9a-f]{32}$/.test(command.projectId) ||
              typeof command.displayName !== "string" ||
              !command.displayName.trim() ||
              command.displayName.length > 120 ||
              Object.keys(command).some(
                (key) =>
                  ![
                    "action",
                    "orgId",
                    "projectId",
                    "workspacePath",
                    "workspaceIdentity",
                    "environmentType",
                    "displayName",
                    "confirm",
                  ].includes(key),
              )
            )
              return { ok: false, code: "lumi_command_invalid" };
            return owner.bindWorkspace
              ? { ok: true, workspace: await owner.bindWorkspace(command as WorkspaceBindCommand) }
              : { ok: false, code: "lumi_command_unsupported" };
          case "advance-workspace":
            if (
              command.confirm !== true ||
              typeof command.projectId !== "string" ||
              !/^prj_[0-9a-f]{32}$/.test(command.projectId) ||
              !WORKSPACE_STAGES.includes(String(command.stage)) ||
              Object.keys(command).some(
                (key) =>
                  ![
                    "action",
                    "orgId",
                    "projectId",
                    "workspacePath",
                    "workspaceIdentity",
                    "environmentType",
                    "stage",
                    "confirm",
                  ].includes(key),
              )
            )
              return { ok: false, code: "lumi_command_invalid" };
            return owner.advanceWorkspace
              ? {
                  ok: true,
                  workspace: await owner.advanceWorkspace(command as WorkspaceAdvanceCommand),
                }
              : { ok: false, code: "lumi_command_unsupported" };
          case "set-workspace-credential-mode":
            if (!isCredentialChoiceCommand(command))
              return { ok: false, code: "lumi_command_invalid" };
            return owner.setWorkspaceCredentialMode
              ? {
                  ok: true,
                  workspace: await owner.setWorkspaceCredentialMode(
                    command as WorkspaceCredentialModeCommand,
                  ),
                }
              : { ok: false, code: "lumi_command_unsupported" };
          case "rollback-workspace":
            if (
              command.confirm !== true ||
              Object.keys(command).some(
                (key) =>
                  ![
                    "action",
                    "orgId",
                    "workspacePath",
                    "workspaceIdentity",
                    "environmentType",
                    "confirm",
                  ].includes(key),
              )
            )
              return { ok: false, code: "lumi_command_invalid" };
            return owner.rollbackWorkspace
              ? {
                  ok: true,
                  workspace: await owner.rollbackWorkspace(command as WorkspaceRollbackCommand),
                }
              : { ok: false, code: "lumi_command_unsupported" };
          default:
            return { ok: false, code: "lumi_command_invalid" };
        }
      } catch (error) {
        return { ok: false, code: safeError(error, "lumi_workspace_action_failed") };
      }
    }
    if (
      typeof command.orgId !== "string" ||
      !/^org_[0-9a-f]{32}$/.test(command.orgId) ||
      Object.keys(command).some((key) => !["action", "orgId", "confirm"].includes(key)) ||
      !["enroll-device", "read-device", "sync-device", "refresh-device", "recover-device"].includes(
        String(command.action),
      ) ||
      (command.action === "enroll-device" && command.confirm !== true)
    )
      return { ok: false, code: "lumi_command_invalid" };
    try {
      const owner = options.getOwner();
      if (command.action === "enroll-device" && owner.enrollDevice)
        return { ok: true, device: await owner.enrollDevice(command.orgId) };
      if (command.action === "read-device" && owner.readDevice)
        return { ok: true, device: await owner.readDevice(command.orgId) };
      if (command.action === "refresh-device" && owner.refreshDevice)
        return { ok: true, device: await owner.refreshDevice(command.orgId) };
      if (command.action === "recover-device" && owner.recoverDevice && command.confirm === true)
        return { ok: true, device: await owner.recoverDevice(command.orgId) };
      if (command.action === "sync-device" && owner.syncDevicePolicy && owner.readDevice) {
        await owner.syncDevicePolicy(command.orgId);
        return { ok: true, device: await owner.readDevice(command.orgId) };
      }
      return { ok: false, code: "lumi_command_unsupported" };
    } catch {
      return { ok: false, code: "lumi_device_action_failed" };
    }
  }
  if (
    !["begin", "complete", "cancel", "read", "restore", "logout"].includes(
      String(options.command),
    ) ||
    typeof options.command !== "string"
  ) {
    return { ok: false, code: "lumi_command_invalid" };
  }
  try {
    const owner = options.getOwner();
    switch (options.command) {
      case "begin": {
        const signIn = await owner.beginSignIn("Lumi Agents Desktop");
        return { ok: true, signIn };
      }
      case "complete":
        await owner.completeSignIn();
        return { ok: true, account: await owner.readAccount() };
      case "cancel":
        owner.cancelSignIn();
        return { ok: true };
      case "read":
        return { ok: true, account: await owner.readAccount() };
      case "restore": {
        const restored = await owner.restoreSession();
        return restored
          ? { ok: true, restored, account: await owner.readAccount() }
          : { ok: true, restored };
      }
      case "logout":
        await owner.signOut();
        return { ok: true };
      default:
        return { ok: false, code: "lumi_command_invalid" };
    }
  } catch (error) {
    return { ok: false, code: safeError(error, "lumi_account_failed") };
  }
}
