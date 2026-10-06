/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { createHash, randomBytes } from "node:crypto";

export class LumiAccountError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
  ) {
    super(code);
    this.name = "LumiAccountError";
  }
}

export interface LumiSignInProjection {
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
}

/** Host-only fixed-route transport. Never register this object as renderer RPC. */
export class LumiAccountHostTransport {
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  #session: string | undefined;
  #csrf: string | undefined;
  #generation = 0;
  #pending: { code: string; verifier: string; expires: number } | undefined;

  constructor(origin: string, fetchImpl: typeof fetch = fetch) {
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
  }

  async #request(path: string, method: "GET" | "POST", body?: unknown) {
    const headers: Record<string, string> = { Accept: "application/json" };
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
      // Never interpolate server body/URL into errors: it could contain a credential.
      throw new LumiAccountError("lumi_request_refused", response.status);
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

  async completeSignIn(): Promise<void> {
    const pending = this.#pending;
    const generation = this.#generation;
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
    this.#session = cookies.get("lumi_session");
    this.#csrf = cookies.get("lumi_csrf");
    this.cancelSignIn();
  }

  async readAccount(): Promise<unknown> {
    return (await this.#request("/api/v1/me", "GET")).json();
  }

  async signOut(): Promise<void> {
    this.cancelSignIn();
    // Capture the old session in the request before clearing it. A late logout
    // must never clear a newer sign-in that completed while the request ran.
    const logout = this.#session ? this.#request("/api/v1/auth/logout", "POST", {}) : undefined;
    this.#session = undefined;
    this.#csrf = undefined;
    await logout;
  }
}
