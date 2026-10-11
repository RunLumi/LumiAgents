/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { id, instant } from "./deviceFields.js";
import { LumiAccountError } from "./errors.js";
import { pagePath, readCompletePages } from "./pagination.js";

export interface DeviceEnrollmentInput {
  org_slug: string;
  public_key: string;
  key_fingerprint: string;
  device_name: string;
  platform: string;
  app_version: string;
}
export interface LumiDeviceProjection {
  id: string;
  orgId: string;
  tokenExpiresAt: string;
  policyVersion: number;
}
export interface LumiDeviceCredential extends LumiDeviceProjection {
  token: string;
}

export interface LumiWorkspaceBinding {
  id: string;
  orgId: string;
  projectId: string;
  deviceId: string;
  workspaceIdentity: string;
  displayName: string;
  environmentType: "local" | "ssh" | "wsl" | "docker" | "remote";
}

/** Device-only transport. Human cookies never accompany these requests. Main owns custody. */
export class LumiDeviceHostTransport {
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  #credential: LumiDeviceCredential | undefined;
  readonly #persistence:
    | {
        load(): Promise<LumiDeviceCredential | null>;
        save(value: LumiDeviceCredential): Promise<void>;
      }
    | undefined;
  constructor(
    origin: string,
    fetchImpl: typeof fetch = fetch,
    persistence?: {
      load(): Promise<LumiDeviceCredential | null>;
      save(value: LumiDeviceCredential): Promise<void>;
    },
  ) {
    const url = new URL(origin);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    )
      throw new LumiAccountError("lumi_origin_invalid");
    this.#origin = url.origin;
    this.#fetch = fetchImpl;
    this.#persistence = persistence;
  }

  async listWorkspaceBindings(): Promise<LumiWorkspaceBinding[]> {
    // The route has no cursor and a hard ceiling of 100 rows; a full page fails closed (see pagination.ts).
    return readCompletePages<LumiWorkspaceBinding>({
      fetchPage: (cursor) =>
        this.#request(pagePath("/api/v1/devices/bindings", cursor), "GET", undefined, true),
      parse: (value) => {
        if (!value || typeof value !== "object")
          throw new LumiAccountError("lumi_device_response_invalid");
        return this.#workspaceBinding(value as Record<string, unknown>);
      },
      keyOf: (item) => item.id,
      invalid: "lumi_device_response_invalid",
      ceilingWithoutCursor: true,
    });
  }

  async createWorkspaceBinding(input: {
    projectId: string;
    workspaceIdentity: string;
    displayName: string;
    environmentType: LumiWorkspaceBinding["environmentType"];
  }): Promise<LumiWorkspaceBinding> {
    if (
      !this.#credential ||
      !/^prj_[0-9a-f]{32}$/.test(input.projectId) ||
      !/^[A-Za-z0-9._~-]{1,256}$/.test(input.workspaceIdentity) ||
      !input.displayName.trim() ||
      input.displayName.length > 120 ||
      !["local", "ssh", "wsl", "docker", "remote"].includes(input.environmentType)
    )
      throw new LumiAccountError("lumi_workspace_invalid");
    const row = await this.#request(
      "/api/v1/devices/bindings",
      "POST",
      {
        project_id: input.projectId,
        workspace_identity: input.workspaceIdentity,
        display_name: input.displayName.trim(),
        environment_type: input.environmentType,
      },
      true,
    );
    if (!row) throw new LumiAccountError("lumi_device_response_invalid");
    return this.#workspaceBinding(row);
  }

  async deleteWorkspaceBinding(bindingId: string): Promise<void> {
    if (!/^wsb_[0-9a-f]{32}$/.test(bindingId)) throw new LumiAccountError("lumi_workspace_invalid");
    await this.#request(`/api/v1/devices/bindings/${bindingId}`, "DELETE", undefined, true);
  }

  #workspaceBinding(value: Record<string, unknown>): LumiWorkspaceBinding {
    if (
      typeof value.id !== "string" ||
      !/^wsb_[0-9a-f]{32}$/.test(value.id) ||
      value.org_id !== this.#credential?.orgId ||
      typeof value.project_id !== "string" ||
      !/^prj_[0-9a-f]{32}$/.test(value.project_id) ||
      value.device_id !== this.#credential?.id ||
      typeof value.workspace_identity !== "string" ||
      !/^[A-Za-z0-9._~-]{1,256}$/.test(value.workspace_identity) ||
      typeof value.display_name !== "string" ||
      !value.display_name ||
      value.display_name.length > 128 ||
      !["local", "ssh", "wsl", "docker", "remote"].includes(String(value.environment_type))
    )
      throw new LumiAccountError("lumi_device_response_invalid");
    return {
      id: value.id,
      orgId: value.org_id as string,
      projectId: value.project_id,
      deviceId: this.#credential?.id as string,
      workspaceIdentity: value.workspace_identity,
      displayName: value.display_name,
      environmentType: value.environment_type as LumiWorkspaceBinding["environmentType"],
    };
  }

  async restore(): Promise<boolean> {
    const value = await this.#persistence?.load();
    if (!value) return false;
    id(value.id, "dvc");
    id(value.orgId, "org");
    if (
      !/^[0-9a-f]{64}$/.test(value.token) ||
      !Number.isFinite(Date.parse(value.tokenExpiresAt)) ||
      !Number.isSafeInteger(value.policyVersion)
    )
      throw new LumiAccountError("lumi_device_response_invalid");
    this.#credential = value;
    return true;
  }
  async #request(
    path: string,
    method: "GET" | "POST" | "DELETE",
    body?: unknown,
    authenticated = false,
  ) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authenticated) {
      if (!this.#credential || Date.parse(this.#credential.tokenExpiresAt) <= Date.now())
        throw new LumiAccountError("lumi_device_token_expired");
      headers.Authorization = `DeviceToken ${this.#credential.token}`;
    }
    const response = await this.#fetch(new URL(path, this.#origin), {
      method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new LumiAccountError("lumi_device_refused", response.status);
    return response.status === 204
      ? undefined
      : ((await response.json()) as Record<string, unknown>);
  }
  async begin(input: DeviceEnrollmentInput) {
    const row = await this.#request("/api/v1/devices/enrollments", "POST", input);
    if (!row || typeof row.user_code !== "string" || row.verification_uri !== "/devices")
      throw new LumiAccountError("lumi_device_response_invalid");
    return {
      enrollmentId: id(row.enrollment_id, "enr"),
      userCode: row.user_code,
      expiresAt: instant(row.expires_at),
    };
  }
  async challenge(enrollmentId: string): Promise<string> {
    const row = await this.#request(
      `/api/v1/devices/enrollments/${id(enrollmentId, "enr")}`,
      "GET",
    );
    if (
      row?.status !== "approved" ||
      typeof row.challenge !== "string" ||
      !row.challenge ||
      row.challenge.length > 256
    )
      throw new LumiAccountError("lumi_device_not_approved");
    return row.challenge;
  }
  async complete(enrollmentId: string, signature: string): Promise<LumiDeviceProjection> {
    const row = await this.#request(
      `/api/v1/devices/enrollments/${id(enrollmentId, "enr")}/complete`,
      "POST",
      { signature },
    );
    if (
      !row ||
      !row.device ||
      typeof row.device !== "object" ||
      typeof row.device_token !== "string" ||
      !/^[0-9a-f]{64}$/.test(row.device_token) ||
      !Number.isSafeInteger(row.policy_version)
    )
      throw new LumiAccountError("lumi_device_response_invalid");
    const device = row.device as Record<string, unknown>;
    const credential: LumiDeviceCredential = {
      id: id(device.id, "dvc"),
      orgId: id(device.org_id, "org"),
      token: row.device_token,
      tokenExpiresAt: instant(row.token_expires_at),
      policyVersion: row.policy_version as number,
    };
    await this.#persistence?.save(credential);
    this.#credential = credential;
    return this.projection();
  }
  projection(): LumiDeviceProjection {
    if (!this.#credential) throw new LumiAccountError("lumi_device_missing");
    const { id, orgId, tokenExpiresAt, policyVersion } = this.#credential;
    return { id, orgId, tokenExpiresAt, policyVersion };
  }
  async policy() {
    const row = await this.#request("/api/v1/devices/policy", "GET", undefined, true);
    if (!row || row.org_id !== this.#credential?.orgId || !Number.isSafeInteger(row.policy_version))
      throw new LumiAccountError("lumi_policy_invalid");
    instant(row.expires_at);
    return row;
  }
  async acknowledge(policyVersion: number): Promise<void> {
    if (!Number.isSafeInteger(policyVersion) || policyVersion < 1)
      throw new LumiAccountError("lumi_policy_invalid");
    await this.#request(
      "/api/v1/devices/policy/ack",
      "POST",
      { policy_version: policyVersion },
      true,
    );
  }

  async adoptRecoveredToken(value: {
    deviceToken: string;
    expiresAt: string;
    policyVersion: number;
  }): Promise<LumiDeviceProjection> {
    if (
      !this.#credential ||
      !/^[0-9a-f]{64}$/.test(value.deviceToken) ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= Date.now() ||
      !Number.isSafeInteger(value.policyVersion)
    )
      throw new LumiAccountError("lumi_device_response_invalid");
    const next = {
      ...this.#credential,
      token: value.deviceToken,
      tokenExpiresAt: value.expiresAt,
      policyVersion: value.policyVersion,
    };
    await this.#persistence?.save(next);
    this.#credential = next;
    return this.projection();
  }

  async refresh(
    appVersion: string,
    signNonce: (nonce: string) => Promise<string>,
  ): Promise<LumiDeviceProjection> {
    const row = await this.#request("/api/v1/devices/token/nonce", "GET", undefined, true);
    if (typeof row?.nonce !== "string" || !row.nonce || row.nonce.length > 256)
      throw new LumiAccountError("lumi_device_response_invalid");
    const signature = await signNonce(row.nonce);
    const result = await this.#request(
      "/api/v1/devices/token",
      "POST",
      { device_id: this.#credential?.id, nonce: row.nonce, signature, app_version: appVersion },
      true,
    );
    if (
      !result ||
      typeof result.device_token !== "string" ||
      !/^[0-9a-f]{64}$/.test(result.device_token) ||
      !Number.isSafeInteger(result.policy_version) ||
      !this.#credential
    )
      throw new LumiAccountError("lumi_device_response_invalid");
    const credential: LumiDeviceCredential = {
      ...this.#credential,
      token: result.device_token,
      tokenExpiresAt: instant(result.token_expires_at),
      policyVersion: result.policy_version as number,
    };
    await this.#persistence?.save(credential);
    this.#credential = credential;
    return this.projection();
  }
}
