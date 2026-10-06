/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { LumiAccountError } from "./hostTransport.js";

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

function id(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(value))
    throw new LumiAccountError("lumi_device_response_invalid");
  return value;
}
function instant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    Date.parse(value) <= Date.now()
  )
    throw new LumiAccountError("lumi_device_response_invalid");
  return value;
}
/** Device-only transport. Human cookies never accompany these requests. Main owns custody. */
export class LumiDeviceHostTransport {
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  #credential: LumiDeviceCredential | undefined;
  constructor(origin: string, fetchImpl: typeof fetch = fetch) {
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
  }
  async #request(path: string, method: "GET" | "POST", body?: unknown, authenticated = false) {
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
    this.#credential = {
      id: id(device.id, "dvc"),
      orgId: id(device.org_id, "org"),
      token: row.device_token,
      tokenExpiresAt: instant(row.token_expires_at),
      policyVersion: row.policy_version as number,
    };
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
    this.#credential = {
      ...this.#credential,
      token: result.device_token,
      tokenExpiresAt: instant(result.token_expires_at),
      policyVersion: result.policy_version as number,
    };
    return this.projection();
  }
}
