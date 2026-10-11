/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { randomBytes } from "node:crypto";
import { createLumiPrivateVault, type LumiVaultEncryption } from "./lumiPrivateVault.js";

export type LumiWorkspaceEnvironment = "local" | "ssh" | "wsl" | "docker" | "remote";

export interface LumiWorkspaceMapping {
  workspaceIdentity: string;
  workspaceKey: string;
  adoptionStateId: string | null;
  deviceBindingId: string | null;
  projectId: string | null;
  displayName: string | null;
  environmentType: LumiWorkspaceEnvironment | null;
}

export interface LumiWorkspaceVaultRecord {
  version: 1;
  origin: string;
  orgId: string;
  userId: string;
  installationId: string;
  mappings: LumiWorkspaceMapping[];
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function opaque(prefix: string, value: unknown): value is string {
  return typeof value === "string" && new RegExp("^" + prefix + "_[0-9a-f]{32}$").test(value);
}

function validateMapping(value: unknown): LumiWorkspaceMapping {
  if (!value || typeof value !== "object") throw new Error("lumi_workspace_invalid");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
      "adoptionStateId,deviceBindingId,displayName,environmentType,projectId,workspaceIdentity,workspaceKey" ||
    typeof row.workspaceIdentity !== "string" ||
    !row.workspaceIdentity ||
    row.workspaceIdentity.length > 4096 ||
    hasControlCharacters(row.workspaceIdentity) ||
    typeof row.workspaceKey !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.workspaceKey) ||
    (row.adoptionStateId !== null && !opaque("wst", row.adoptionStateId)) ||
    (row.deviceBindingId !== null && !opaque("wsb", row.deviceBindingId)) ||
    (row.projectId !== null && !opaque("prj", row.projectId)) ||
    (row.displayName !== null &&
      (typeof row.displayName !== "string" || !row.displayName || row.displayName.length > 120)) ||
    (row.environmentType !== null &&
      !["local", "ssh", "wsl", "docker", "remote"].includes(String(row.environmentType)))
  ) {
    throw new Error("lumi_workspace_invalid");
  }
  return row as unknown as LumiWorkspaceMapping;
}

/** Main-private mapping; the server-facing key is random and the local identity never leaves this vault. */
export function createLumiWorkspaceVault(options: {
  directory: string;
  origin: string;
  orgId: string;
  userId: string;
  encryption: LumiVaultEncryption;
  platform?: NodeJS.Platform;
}) {
  const origin = new URL(options.origin).origin;
  if (!/^usr_[0-9a-f]{32}$/.test(options.userId)) throw new Error("lumi_workspace_invalid");

  function validate(value: unknown): LumiWorkspaceVaultRecord {
    if (!value || typeof value !== "object") throw new Error("lumi_workspace_invalid");
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).sort().join(",") !== "installationId,mappings,orgId,origin,userId,version" ||
      row.version !== 1 ||
      row.origin !== origin ||
      row.orgId !== options.orgId ||
      row.userId !== options.userId ||
      !Array.isArray(row.mappings) ||
      row.mappings.length > 10_000 ||
      typeof row.installationId !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.installationId)
    )
      throw new Error("lumi_workspace_invalid");
    const mappings = row.mappings.map(validateMapping);
    if (new Set(mappings.map((mapping) => mapping.workspaceIdentity)).size !== mappings.length)
      throw new Error("lumi_workspace_invalid");
    if (new Set(mappings.map((mapping) => mapping.workspaceKey)).size !== mappings.length)
      throw new Error("lumi_workspace_invalid");
    return {
      version: 1,
      origin,
      orgId: options.orgId,
      userId: options.userId,
      installationId: row.installationId,
      mappings,
    };
  }

  const vault = createLumiPrivateVault<LumiWorkspaceVaultRecord>({
    directory: options.directory,
    identity: `${origin}:${options.orgId}:${options.userId}`,
    namespace: "workspace",
    encryption: options.encryption,
    platform: options.platform,
    validate,
  });

  return {
    load: vault.load,
    save: vault.save,
    async createEmpty(): Promise<LumiWorkspaceVaultRecord> {
      return validate({
        version: 1,
        origin,
        orgId: options.orgId,
        userId: options.userId,
        installationId: randomBytes(32).toString("hex"),
        mappings: [],
      });
    },
  };
}
