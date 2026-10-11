/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { randomUUID } from "node:crypto";
import {
  credentialModeRequiresManaged,
  P08_CREDENTIAL_MODES,
  type LumiManagedAgentProjection,
  type LumiManagedModelProjection,
  type LumiProjectProjection,
  type LumiWorkspaceStage,
  type P08CredentialMode,
} from "@zcode/shared";
import { LumiAccountError } from "./errors.js";
import { pagePath, readCompletePages } from "./pagination.js";

type AdoptionRequest = (
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  extraHeaders?: Record<string, string>,
) => Promise<Response>;

export interface LumiAdoptionRecord {
  adoptionStateId: string;
  orgId: string;
  installationId: string;
  workspaceKey: string;
  displayName: string;
  projectId: string | null;
  deviceId: string | null;
  stage: LumiWorkspaceStage;
  ownership: "local_unmanaged" | "org_managed";
  credentialMode: P08CredentialMode;
  version: number;
}

function isCredentialMode(value: unknown): value is P08CredentialMode {
  return (P08_CREDENTIAL_MODES as readonly unknown[]).includes(value);
}

function adoptionRecord(value: unknown): LumiAdoptionRecord {
  if (!value || typeof value !== "object") throw new LumiAccountError("lumi_response_invalid");
  const row = value as Record<string, unknown>;
  if (
    typeof row.adoption_state_id !== "string" ||
    !/^wst_[0-9a-f]{32}$/.test(row.adoption_state_id) ||
    typeof row.org_id !== "string" ||
    !/^org_[0-9a-f]{32}$/.test(row.org_id) ||
    typeof row.external_installation_id !== "string" ||
    row.external_installation_id.length < 16 ||
    row.external_installation_id.length > 128 ||
    !/^[A-Za-z0-9._~-]+$/.test(row.external_installation_id) ||
    typeof row.external_workspace_key !== "string" ||
    !/^[A-Za-z0-9._~-]{1,256}$/.test(row.external_workspace_key) ||
    typeof row.display_name !== "string" ||
    !row.display_name ||
    row.display_name.length > 128 ||
    (row.bound_project_id !== null &&
      (typeof row.bound_project_id !== "string" ||
        !/^prj_[0-9a-f]{32}$/.test(row.bound_project_id))) ||
    (row.bound_device_id !== null &&
      (typeof row.bound_device_id !== "string" ||
        !/^dvc_[0-9a-f]{32}$/.test(row.bound_device_id))) ||
    ![
      "local_unmanaged",
      "account_optional",
      "device_enrolled",
      "workspace_bound",
      "managed_policy",
      "history_sync",
    ].includes(String(row.stage)) ||
    !["local_unmanaged", "org_managed"].includes(String(row.ownership)) ||
    !isCredentialMode(row.credential_mode) ||
    !Number.isSafeInteger(row.version) ||
    (row.version as number) < 1 ||
    // 与服务端 credential_mode_requires_managed 一致：组织标签只可能出现在组织托管的行上。
    (credentialModeRequiresManaged(row.credential_mode) && row.ownership !== "org_managed")
  )
    throw new LumiAccountError("lumi_response_invalid");
  return {
    adoptionStateId: row.adoption_state_id,
    orgId: row.org_id,
    installationId: row.external_installation_id,
    workspaceKey: row.external_workspace_key,
    displayName: row.display_name,
    projectId: row.bound_project_id as string | null,
    deviceId: row.bound_device_id as string | null,
    stage: row.stage as LumiWorkspaceStage,
    ownership: row.ownership as LumiAdoptionRecord["ownership"],
    credentialMode: row.credential_mode,
    version: row.version as number,
  };
}

function projectProjection(value: unknown): LumiProjectProjection {
  const item = value as Record<string, unknown> | null;
  if (
    !item ||
    typeof item.id !== "string" ||
    !/^prj_[0-9a-f]{32}$/.test(item.id) ||
    typeof item.name !== "string" ||
    !item.name ||
    item.name.length > 128 ||
    typeof item.slug !== "string" ||
    !/^[a-z0-9-]{3,63}$/.test(item.slug) ||
    typeof item.archived !== "boolean" ||
    !["org", "restricted"].includes(String(item.visibility))
  )
    throw new LumiAccountError("lumi_response_invalid");
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    archived: item.archived,
    visibility: item.visibility as "org" | "restricted",
  };
}

/** Fixed-route P03/P08 account operations. The authenticated request port stays private to main. */
export class LumiAdoptionHostTransport {
  readonly #request: AdoptionRequest;

  constructor(request: AdoptionRequest) {
    this.#request = request;
  }

  async listAgents(orgId: string, projectId: string): Promise<LumiManagedAgentProjection[]> {
    if (!/^org_[0-9a-f]{32}$/.test(orgId) || !/^prj_[0-9a-f]{32}$/.test(projectId))
      throw new LumiAccountError("lumi_managed_agent_invalid");
    const response = await this.#request(
      `/api/v1/orgs/${orgId}/agents?project_id=${encodeURIComponent(projectId)}&limit=100`,
      "GET",
    );
    const row = (await response.json()) as Record<string, unknown>;
    if (!Array.isArray(row.items) || row.items.length > 100 || row.has_more === true)
      throw new LumiAccountError("lumi_response_invalid");
    return row.items.map((item: Record<string, unknown>) => {
      if (
        !item ||
        typeof item.id !== "string" ||
        !/^agd_[0-9a-f]{32}$/.test(item.id) ||
        item.org_id !== orgId ||
        (item.project_id !== null && item.project_id !== projectId) ||
        typeof item.name !== "string" ||
        !item.name ||
        item.name.length > 128 ||
        typeof item.version !== "number" ||
        !Number.isSafeInteger(item.version) ||
        !["active", "disabled", "archived"].includes(String(item.lifecycle)) ||
        (item.default_model_alias !== null &&
          (typeof item.default_model_alias !== "string" ||
            !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(item.default_model_alias)))
      )
        throw new LumiAccountError("lumi_response_invalid");
      return {
        id: item.id,
        orgId,
        projectId: item.project_id as string | null,
        name: item.name,
        version: item.version,
        defaultModelAlias: item.default_model_alias as string | null,
        lifecycle: item.lifecycle as LumiManagedAgentProjection["lifecycle"],
      };
    });
  }

  async listManagedModels(orgId: string): Promise<LumiManagedModelProjection[]> {
    if (!/^org_[0-9a-f]{32}$/.test(orgId)) throw new LumiAccountError("lumi_managed_model_invalid");
    const response = await this.#request("/api/v1/inference/models?limit=100", "GET", undefined, {
      "X-Org-ID": orgId,
    });
    const row = (await response.json()) as Record<string, unknown>;
    if (!Array.isArray(row.items) || row.items.length > 100 || row.has_more === true)
      throw new LumiAccountError("lumi_response_invalid");
    return row.items.map((item: Record<string, unknown>) => {
      if (
        !item ||
        typeof item.alias !== "string" ||
        !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(item.alias) ||
        typeof item.display_name !== "string" ||
        !item.display_name ||
        item.display_name.length > 128 ||
        typeof item.available !== "boolean" ||
        !["active", "disabled"].includes(String(item.lifecycle))
      )
        throw new LumiAccountError("lumi_response_invalid");
      return {
        alias: item.alias,
        displayName: item.display_name,
        available: item.available,
        lifecycle: item.lifecycle as LumiManagedModelProjection["lifecycle"],
      };
    });
  }

  async closeManagedSession(orgId: string, agentSessionId: string): Promise<void> {
    if (!/^org_[0-9a-f]{32}$/.test(orgId) || !/^rse_[0-9a-f]{32}$/.test(agentSessionId))
      throw new LumiAccountError("lumi_managed_session_invalid");
    const response = await this.#request(`/api/v1/orgs/${orgId}/sessions/${agentSessionId}`, "GET");
    const current = (await response.json()) as Record<string, unknown>;
    if (
      current.id !== agentSessionId ||
      current.org_id !== orgId ||
      !["active", "closed", "archived"].includes(String(current.lifecycle)) ||
      !Number.isSafeInteger(current.version)
    )
      throw new LumiAccountError("lumi_response_invalid");
    if (current.lifecycle !== "active") return;
    await this.#request(
      `/api/v1/orgs/${orgId}/sessions/${agentSessionId}/close`,
      "POST",
      { version: current.version },
      { "Idempotency-Key": randomUUID() },
    );
  }

  async listProjects(orgId: string): Promise<LumiProjectProjection[]> {
    if (!/^org_[0-9a-f]{32}$/.test(orgId)) throw new LumiAccountError("lumi_org_invalid");
    return readCompletePages<LumiProjectProjection>({
      fetchPage: async (cursor) =>
        (await this.#request(pagePath(`/api/v1/orgs/${orgId}/projects`, cursor), "GET")).json(),
      parse: projectProjection,
      keyOf: (item) => item.id,
      invalid: "lumi_response_invalid",
      ceilingWithoutCursor: false,
    });
  }

  /**
   * Every adoption row of the org, or a failure. The list route has no cursor and a hard ceiling
   * of 100, so a full page cannot prove completeness and fails closed with `lumi_page_incomplete`:
   * the owner uses this list to decide whether a workspace already has a row before it creates one.
   */
  async listAdoptionRecords(orgId: string): Promise<LumiAdoptionRecord[]> {
    if (!/^org_[0-9a-f]{32}$/.test(orgId)) throw new LumiAccountError("lumi_org_invalid");
    return readCompletePages<LumiAdoptionRecord>({
      fetchPage: async (cursor) =>
        (
          await this.#request(pagePath(`/api/v1/orgs/${orgId}/adoption/bindings`, cursor), "GET")
        ).json(),
      parse: (value) => {
        const record = adoptionRecord(value);
        // A row of another organization is never part of this org's list.
        if (record.orgId !== orgId) throw new LumiAccountError("lumi_response_invalid");
        return record;
      },
      keyOf: (item) => item.adoptionStateId,
      invalid: "lumi_response_invalid",
      ceilingWithoutCursor: true,
    });
  }

  async createAdoptionRecord(
    input: {
      orgId: string;
      installationId: string;
      workspaceKey: string;
      displayName: string;
      projectId: string;
      deviceId: string;
      clientAppVersion: string;
      rebindVersion?: number;
    },
    idempotencyKey: string,
  ): Promise<LumiAdoptionRecord> {
    if (
      !/^org_[0-9a-f]{32}$/.test(input.orgId) ||
      !/^prj_[0-9a-f]{32}$/.test(input.projectId) ||
      !/^dvc_[0-9a-f]{32}$/.test(input.deviceId) ||
      !/^[A-Za-z0-9._~-]{16,128}$/.test(input.installationId) ||
      !/^[A-Za-z0-9._~-]{1,256}$/.test(input.workspaceKey) ||
      !input.displayName.trim() ||
      input.displayName.length > 120 ||
      !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(input.clientAppVersion) ||
      (input.rebindVersion !== undefined &&
        (!Number.isSafeInteger(input.rebindVersion) || input.rebindVersion <= 0)) ||
      !idempotencyKey ||
      idempotencyKey.length > 128
    )
      throw new LumiAccountError("lumi_workspace_invalid");
    const response = await this.#request(
      `/api/v1/orgs/${input.orgId}/adoption/bindings`,
      "POST",
      {
        installation_id: input.installationId,
        workspace_key: input.workspaceKey,
        display_name: input.displayName.trim(),
        project_id: input.projectId,
        device_id: input.deviceId,
        stage: "local_unmanaged",
        credential_mode: "local_credential",
        ...(input.rebindVersion === undefined ? {} : { rebind_version: input.rebindVersion }),
        client_protocol_major: 1,
        policy_schema_version: 1,
        client_app_version: input.clientAppVersion,
      },
      { "Idempotency-Key": idempotencyKey },
    );
    return adoptionRecord(await response.json());
  }

  async advanceAdoptionRecord(
    input: {
      orgId: string;
      adoptionStateId: string;
      stage: Exclude<LumiWorkspaceStage, "local_unmanaged" | "history_sync">;
      /** The mode read from the server in the same operation; there is no default. */
      credentialMode: P08CredentialMode;
      version: number;
      clientAppVersion: string;
    },
    idempotencyKey: string,
  ): Promise<LumiAdoptionRecord> {
    if (
      !/^org_[0-9a-f]{32}$/.test(input.orgId) ||
      !/^wst_[0-9a-f]{32}$/.test(input.adoptionStateId) ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1 ||
      !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(input.clientAppVersion) ||
      !["account_optional", "device_enrolled", "workspace_bound", "managed_policy"].includes(
        input.stage,
      ) ||
      !isCredentialMode(input.credentialMode) ||
      !idempotencyKey ||
      idempotencyKey.length > 128
    )
      throw new LumiAccountError("lumi_workspace_invalid");
    const response = await this.#request(
      `/api/v1/orgs/${input.orgId}/adoption/bindings/${input.adoptionStateId}`,
      "PATCH",
      {
        stage: input.stage,
        credential_mode: input.credentialMode,
        version: input.version,
        client_protocol_major: 1,
        policy_schema_version: 1,
        client_app_version: input.clientAppVersion,
      },
      { "Idempotency-Key": idempotencyKey },
    );
    return adoptionRecord(await response.json());
  }

  /**
   * Label-only change that keeps the stage. The response is never authority: the owner re-reads
   * the row, because a server that does not persist a mode-only PATCH still answers 200.
   */
  async changeAdoptionCredentialMode(
    input: {
      orgId: string;
      adoptionStateId: string;
      stage: Exclude<LumiWorkspaceStage, "history_sync">;
      credentialMode: P08CredentialMode;
      version: number;
      clientAppVersion: string;
    },
    idempotencyKey: string,
  ): Promise<LumiAdoptionRecord> {
    if (
      !/^org_[0-9a-f]{32}$/.test(input.orgId) ||
      !/^wst_[0-9a-f]{32}$/.test(input.adoptionStateId) ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1 ||
      !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(input.clientAppVersion) ||
      ![
        "local_unmanaged",
        "account_optional",
        "device_enrolled",
        "workspace_bound",
        "managed_policy",
      ].includes(input.stage) ||
      !isCredentialMode(input.credentialMode) ||
      !idempotencyKey ||
      idempotencyKey.length > 128
    )
      throw new LumiAccountError("lumi_workspace_invalid");
    const response = await this.#request(
      `/api/v1/orgs/${input.orgId}/adoption/bindings/${input.adoptionStateId}`,
      "PATCH",
      {
        stage: input.stage,
        credential_mode: input.credentialMode,
        version: input.version,
        client_protocol_major: 1,
        policy_schema_version: 1,
        client_app_version: input.clientAppVersion,
      },
      { "Idempotency-Key": idempotencyKey },
    );
    const record = adoptionRecord(await response.json());
    // 幂等重放返回的是完整服务端行：必须正是被请求的那一行，而不是别的组织/记录。
    if (record.adoptionStateId !== input.adoptionStateId || record.orgId !== input.orgId)
      throw new LumiAccountError("lumi_response_invalid");
    return record;
  }

  async rollbackAdoptionRecord(
    input: { orgId: string; adoptionStateId: string; version: number },
    idempotencyKey: string,
  ): Promise<LumiAdoptionRecord> {
    if (
      !/^org_[0-9a-f]{32}$/.test(input.orgId) ||
      !/^wst_[0-9a-f]{32}$/.test(input.adoptionStateId) ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1 ||
      !idempotencyKey ||
      idempotencyKey.length > 128
    )
      throw new LumiAccountError("lumi_workspace_invalid");
    const response = await this.#request(
      `/api/v1/orgs/${input.orgId}/adoption/bindings/${input.adoptionStateId}/rollback`,
      "POST",
      { version: input.version },
      { "Idempotency-Key": idempotencyKey },
    );
    return adoptionRecord(await response.json());
  }
}
