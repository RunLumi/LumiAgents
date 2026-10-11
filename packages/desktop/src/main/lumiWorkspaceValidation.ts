import {
  credentialModeRequiresManaged,
  P08_CREDENTIAL_MODES,
  type LumiWorkspaceEnvironment,
  type LumiWorkspaceStage,
  type P08CredentialMode,
} from "@zcode/shared";

export function isCredentialModeLabel(value: unknown): value is P08CredentialMode {
  return (P08_CREDENTIAL_MODES as readonly unknown[]).includes(value);
}

/** Mirrors the server's `credential_mode_requires_managed`: the org label needs org ownership. */
export function isCredentialModePermitted(
  mode: P08CredentialMode,
  ownership: "local_unmanaged" | "org_managed",
): boolean {
  return !credentialModeRequiresManaged(mode) || ownership === "org_managed";
}

// `history_sync` (stage 5) is deliberately absent: it must not be constructible from the bridge.
const CREDENTIAL_CHOICE_STAGES = [
  "local_unmanaged",
  "account_optional",
  "device_enrolled",
  "workspace_bound",
  "managed_policy",
];
const CREDENTIAL_CHOICE_KEYS = [
  "action",
  "orgId",
  "projectId",
  "workspacePath",
  "workspaceIdentity",
  "environmentType",
  "credentialMode",
  "expectedStage",
  "expectedVersion",
  "confirm",
];

/** Strict bridge shape for `set-workspace-credential-mode`: no field can carry a secret. */
export function isCredentialChoiceCommand(command: Record<string, unknown>): boolean {
  return (
    command.confirm === true &&
    typeof command.projectId === "string" &&
    /^prj_[0-9a-f]{32}$/.test(command.projectId) &&
    isCredentialModeLabel(command.credentialMode) &&
    CREDENTIAL_CHOICE_STAGES.includes(String(command.expectedStage)) &&
    typeof command.expectedVersion === "number" &&
    Number.isSafeInteger(command.expectedVersion) &&
    command.expectedVersion >= 1 &&
    Object.keys(command).every((key) => CREDENTIAL_CHOICE_KEYS.includes(key))
  );
}

export function isLumiResourceId(
  value: string | null | undefined,
  prefix: string,
): value is string {
  return typeof value === "string" && new RegExp("^" + prefix + "_[0-9a-f]{32}$").test(value);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function resolveLocalWorkspaceIdentity(input: {
  workspacePath: string;
  workspaceIdentity?: string;
  environmentType: LumiWorkspaceEnvironment;
}): string {
  const identity = input.workspaceIdentity?.trim() || input.workspacePath.trim();
  if (
    !identity ||
    identity.length > 4096 ||
    !input.workspacePath ||
    input.workspacePath.length > 4096 ||
    hasControlCharacters(identity) ||
    !["local", "ssh", "wsl", "docker", "remote"].includes(input.environmentType)
  )
    throw new Error("lumi_workspace_invalid");
  return identity;
}

export function isNextWorkspaceStage(
  current: LumiWorkspaceStage,
  requested: LumiWorkspaceStage,
): boolean {
  const stages: readonly LumiWorkspaceStage[] = [
    "local_unmanaged",
    "account_optional",
    "device_enrolled",
    "workspace_bound",
    "managed_policy",
    "history_sync",
  ];
  return stages.indexOf(requested) === stages.indexOf(current) + 1 && requested !== "history_sync";
}
