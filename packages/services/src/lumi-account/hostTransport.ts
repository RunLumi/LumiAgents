/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { LumiAccountError } from "./errors.js";
import { LumiAdoptionHostTransport, type LumiAdoptionRecord } from "./adoptionTransport.js";
import { LumiReviewedToolCatalogTransport } from "./reviewedToolCatalog.js";
import { LumiAutomationAdoptionHostTransport } from "./automationAdoptionTransport.js";
export { LumiAccountError } from "./errors.js";
export type { LumiAdoptionRecord } from "./adoptionTransport.js";
type AdoptionInput<K extends keyof LumiAdoptionHostTransport> =
  LumiAdoptionHostTransport[K] extends (input: infer I, ...rest: never[]) => unknown ? I : never;

export type { LumiSignInProjection, LumiAccountProjection } from "@zcode/shared";
import type {
  LumiSignInProjection,
  LumiAccountProjection,
  LumiProjectProjection,
} from "@zcode/shared";

export interface LumiSessionEnvelope {
  version: 1;
  origin: string;
  session: string;
  csrf: string;
  expiresAt: string;
}
/** Host-private port; never register load/save as renderer RPC methods. */
export interface LumiSessionPersistence {
  load(): Promise<LumiSessionEnvelope | null>;
  save(record: LumiSessionEnvelope): Promise<void>;
  clear(): Promise<void>;
}

/** Host-only fixed-route transport. Never register this object as renderer RPC. */
export class LumiAccountHostTransport {
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  readonly #persistence: LumiSessionPersistence | undefined;
  readonly #adoption: LumiAdoptionHostTransport;
  #writes: Promise<void> = Promise.resolve();
  #session: string | undefined;
  #csrf: string | undefined;
  #generation = 0;
  #pending: { code: string; verifier: string; expires: number } | undefined;

  constructor(
    origin: string,
    fetchImpl: typeof fetch = fetch,
    persistence?: LumiSessionPersistence,
  ) {
    const url = new URL(origin);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new LumiAccountError("lumi_origin_invalid");
    }
    this.#origin = url.origin;
    this.#fetch = fetchImpl;
    this.#persistence = persistence;
    this.#adoption = new LumiAdoptionHostTransport((path, method, body, headers) =>
      this.#request(path, method, body, headers),
    );
    this.#automations = new LumiAutomationAdoptionHostTransport((path, method, body, headers) =>
      this.#request(path, method, body, headers),
    );
  }

  readonly #automations: LumiAutomationAdoptionHostTransport;

  /**
   * P08 preview + P06 definition operations; Main-only like every other member.
   * A method, not a public field: the transport must stay free of enumerable state.
   */
  automations(): LumiAutomationAdoptionHostTransport {
    return this.#automations;
  }

  async #request(
    path: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ) {
    const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.#session && this.#csrf) {
      headers.Cookie = `lumi_session=${this.#session}; lumi_csrf=${this.#csrf}`;
      if (method !== "GET") headers["X-CSRF-Token"] = this.#csrf;
    }
    const response = await this.#fetch(new URL(path, this.#origin), {
      method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      // Never interpolate server body/URL into errors: it could contain a credential. Only the
      // stable reason is read, so device recovery can tell a revoked device from other refusals.
      const body: unknown = await response.json().catch(() => null);
      const reason = (body as { error?: { details?: { reason?: unknown } } } | null)?.error?.details
        ?.reason;
      throw new LumiAccountError(
        reason === "device_revoked" ? "lumi_device_revoked" : "lumi_request_refused",
        response.status,
      );
    }
    return response;
  }

  cancelSignIn(): void {
    this.#generation++;
    this.#pending = undefined;
  }

  async beginSignIn(deviceName: string): Promise<LumiSignInProjection> {
    this.cancelSignIn();
    const generation = this.#generation;
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const response = await this.#request("/api/v1/auth/device-code", "POST", {
      device_name: deviceName,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const row = (await response.json()) as Record<string, unknown>;
    if (generation !== this.#generation) throw new LumiAccountError("lumi_flow_cancelled");
    const expires = typeof row.expires_at === "string" ? Date.parse(row.expires_at) : NaN;
    if (
      typeof row.device_code !== "string" ||
      !row.device_code ||
      row.device_code.length > 256 ||
      typeof row.user_code !== "string" ||
      !/^[A-Z0-9]{8}$/.test(row.user_code) ||
      row.verification_uri !== "/desktop" ||
      !Number.isFinite(expires) ||
      expires <= Date.now()
    ) {
      throw new LumiAccountError("lumi_response_invalid");
    }
    this.#pending = { code: row.device_code, verifier, expires };
    const url = new URL("/desktop", this.#origin);
    url.searchParams.set("user_code", row.user_code);
    return {
      userCode: row.user_code,
      verificationUrl: url.href,
      expiresAt: row.expires_at as string,
    };
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.#writes.then(operation);
    this.#writes = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async restoreSession(): Promise<boolean> {
    const generation = this.#generation;
    return this.#serialize(async () => {
      const row = await this.#persistence?.load();
      if (generation !== this.#generation) throw new LumiAccountError("lumi_flow_cancelled");
      if (
        !row ||
        row.version !== 1 ||
        row.origin !== this.#origin ||
        !/^[0-9a-f]{64}$/.test(row.session) ||
        !/^[0-9a-f]{64}$/.test(row.csrf) ||
        !Number.isFinite(Date.parse(row.expiresAt)) ||
        Date.parse(row.expiresAt) <= Date.now()
      )
        return false;
      this.#session = row.session;
      this.#csrf = row.csrf;
      return true;
    });
  }

  completeSignIn(): Promise<void> {
    const generation = this.#generation;
    return this.#serialize(() => this.#completeSignIn(generation));
  }

  async #completeSignIn(generation: number): Promise<void> {
    const pending = this.#pending;
    if (generation !== this.#generation) throw new LumiAccountError("lumi_flow_cancelled");
    if (!pending || pending.expires <= Date.now()) {
      this.cancelSignIn();
      throw new LumiAccountError("lumi_flow_expired");
    }
    const response = await this.#request("/api/v1/auth/device-code/exchange", "POST", {
      device_code: pending.code,
      code_verifier: pending.verifier,
    });
    if (generation !== this.#generation) throw new LumiAccountError("lumi_flow_cancelled");
    const cookies = new Map<string, string>();
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      if (name !== "lumi_session" && name !== "lumi_csrf") continue;
      const value = pair.slice(separator + 1);
      if (cookies.has(name) || !/^[0-9a-f]{64}$/.test(value))
        throw new LumiAccountError("lumi_cookie_invalid");
      cookies.set(name, value);
    }
    if (!cookies.has("lumi_session") || !cookies.has("lumi_csrf"))
      throw new LumiAccountError("lumi_cookie_missing");
    const body = (await response.json()) as { session?: { expires_at?: unknown } };
    if (generation !== this.#generation) throw new LumiAccountError("lumi_flow_cancelled");
    if (this.#persistence) {
      const expiresAt = body.session?.expires_at;
      if (
        typeof expiresAt !== "string" ||
        !Number.isFinite(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) <= Date.now()
      ) {
        throw new LumiAccountError("lumi_response_invalid");
      }
      await this.#persistence.save({
        version: 1,
        origin: this.#origin,
        session: cookies.get("lumi_session")!,
        csrf: cookies.get("lumi_csrf")!,
        expiresAt,
      });
      if (generation !== this.#generation) {
        await this.#persistence.clear();
        throw new LumiAccountError("lumi_flow_cancelled");
      }
    }
    this.#session = cookies.get("lumi_session");
    this.#csrf = cookies.get("lumi_csrf");
    this.cancelSignIn();
  }

  async readAccount(): Promise<LumiAccountProjection> {
    const body = (await (await this.#request("/api/v1/me", "GET")).json()) as Record<
      string,
      unknown
    >;
    const text = (value: unknown, max: number): string => {
      if (typeof value !== "string" || !value || value.length > max)
        throw new LumiAccountError("lumi_response_invalid");
      return value;
    };
    if (
      !body.user ||
      typeof body.user !== "object" ||
      !Array.isArray(body.organizations) ||
      body.organizations.length > 100
    ) {
      throw new LumiAccountError("lumi_response_invalid");
    }
    const user = body.user as Record<string, unknown>;
    return {
      user: {
        id: text(user.id, 128),
        email: text(user.email, 320),
        displayName: text(user.display_name, 256),
      },
      organizations: body.organizations.map((item: Record<string, unknown>) => {
        if (!item || typeof item.organization !== "object" || !item.organization)
          throw new LumiAccountError("lumi_response_invalid");
        const org = item.organization as Record<string, unknown>;
        return {
          id: text(org.org_id, 128),
          displayName: text(org.display_name, 256),
          slug: text(org.slug, 63),
          state: text(org.state, 32),
          role: text(item.role, 32),
          status: text(item.status, 32),
        };
      }),
    };
  }

  /** Main-only input to one managed inference attempt; caller must keep it ephemeral. */
  async readManagedInferenceBearer(orgId: string, userId: string): Promise<string> {
    if (!/^org_[0-9a-f]{32}$/.test(orgId) || !/^usr_[0-9a-f]{32}$/.test(userId))
      throw new LumiAccountError("lumi_managed_auth_refused");
    if (!this.#session) throw new LumiAccountError("lumi_cookie_missing");
    const account = await this.readAccount();
    const membership = account.organizations.find(
      (organization) =>
        organization.id === orgId &&
        organization.state === "active" &&
        organization.status === "active",
    );
    if (account.user.id !== userId || !membership)
      throw new LumiAccountError("lumi_managed_auth_refused");
    return this.#session;
  }

  async approveDeviceEnrollment(
    orgId: string,
    enrollmentId: string,
    key: string = randomUUID(),
  ): Promise<void> {
    if (
      !/^org_[0-9a-f]{32}$/.test(orgId) ||
      !/^enr_[0-9a-f]{32}$/.test(enrollmentId) ||
      !key ||
      key.length > 128
    ) {
      throw new LumiAccountError("lumi_enrollment_invalid");
    }
    await this.#request(
      `/api/v1/orgs/${orgId}/devices/enrollments/${enrollmentId}/approve`,
      "POST",
      {},
      { "Idempotency-Key": key },
    );
  }

  async createDeviceRecoveryChallenge(orgId: string, deviceId: string, key = randomUUID()) {
    if (
      !/^org_[0-9a-f]{32}$/.test(orgId) ||
      !/^dvc_[0-9a-f]{32}$/.test(deviceId) ||
      !key ||
      key.length > 128
    )
      throw new LumiAccountError("lumi_device_invalid");
    const path = "/api/v1/orgs/" + orgId + "/devices/" + deviceId + "/recovery-challenges";
    const row = (await (
      await this.#request(path, "POST", { device_id: deviceId }, { "Idempotency-Key": key })
    ).json()) as Record<string, unknown>;
    if (
      typeof row.challenge !== "string" ||
      !row.challenge ||
      row.challenge.length > 256 ||
      typeof row.expires_at !== "string" ||
      !Number.isFinite(Date.parse(row.expires_at)) ||
      Date.parse(row.expires_at) <= Date.now()
    )
      throw new LumiAccountError("lumi_response_invalid");
    return { challenge: row.challenge, expiresAt: row.expires_at };
  }

  async recoverDeviceToken(
    orgId: string,
    deviceId: string,
    input: { challenge: string; signature: string; appVersion: string },
  ) {
    if (!/^org_[0-9a-f]{32}$/.test(orgId) || !/^dvc_[0-9a-f]{32}$/.test(deviceId))
      throw new LumiAccountError("lumi_device_invalid");
    const path = "/api/v1/orgs/" + orgId + "/devices/" + deviceId + "/recover-token";
    const row = (await (
      await this.#request(path, "POST", {
        challenge: input.challenge,
        signature: input.signature,
        app_version: input.appVersion,
      })
    ).json()) as Record<string, unknown>;
    if (
      typeof row.device_token !== "string" ||
      !/^[0-9a-f]{64}$/.test(row.device_token) ||
      typeof row.token_expires_at !== "string" ||
      !Number.isFinite(Date.parse(row.token_expires_at)) ||
      Date.parse(row.token_expires_at) <= Date.now() ||
      !Number.isSafeInteger(row.policy_version)
    )
      throw new LumiAccountError("lumi_response_invalid");
    return {
      deviceToken: row.device_token,
      expiresAt: row.token_expires_at,
      policyVersion: row.policy_version as number,
    };
  }

  resolveReviewedToolIdentity(
    orgId: string,
    descriptor: import("@zcode/shared").ZCodeManagedToolIdentity,
  ) {
    return new LumiReviewedToolCatalogTransport(
      async (path) => (await (await this.#request(path, "GET")).json()) as Record<string, unknown>,
    ).resolve(orgId, descriptor);
  }
  listProjects(orgId: string): Promise<LumiProjectProjection[]> {
    return this.#adoption.listProjects(orgId);
  }

  listAgents(orgId: string, projectId: string) {
    return this.#adoption.listAgents(orgId, projectId);
  }

  listManagedModels(orgId: string) {
    return this.#adoption.listManagedModels(orgId);
  }

  closeManagedSession(orgId: string, agentSessionId: string) {
    return this.#adoption.closeManagedSession(orgId, agentSessionId);
  }

  listAdoptionRecords(orgId: string): Promise<LumiAdoptionRecord[]> {
    return this.#adoption.listAdoptionRecords(orgId);
  }

  createAdoptionRecord(input: AdoptionInput<"createAdoptionRecord">, key: string) {
    return this.#adoption.createAdoptionRecord(input, key);
  }

  advanceAdoptionRecord(input: AdoptionInput<"advanceAdoptionRecord">, key: string) {
    return this.#adoption.advanceAdoptionRecord(input, key);
  }

  changeAdoptionCredentialMode(input: AdoptionInput<"changeAdoptionCredentialMode">, key: string) {
    return this.#adoption.changeAdoptionCredentialMode(input, key);
  }

  rollbackAdoptionRecord(input: AdoptionInput<"rollbackAdoptionRecord">, key: string) {
    return this.#adoption.rollbackAdoptionRecord(input, key);
  }

  async signOut(): Promise<void> {
    this.cancelSignIn();
    // Capture the old session in the request before clearing it. A late logout
    // must never clear a newer sign-in that completed while the request ran.
    const logout = this.#session ? this.#request("/api/v1/auth/logout", "POST", {}) : undefined;
    this.#session = undefined;
    this.#csrf = undefined;
    await this.#serialize(async () => {
      try {
        await logout;
      } finally {
        await this.#persistence?.clear();
      }
    });
  }
}
