/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice. */

/**
 * Runtime-only boundary for the Lumi control-plane inference endpoint.
 *
 * The desktop must send a stable Lumi alias, never a provider/model string as
 * route authority. The returned API key is the short-lived Lumi session token;
 * it is intentionally not a ProviderConfig field and must not be persisted in
 * the personal provider file.
 */

export const LUMI_MANAGED_PROVIDER_ID = "lumi-managed" as const;
export const LUMI_MANAGED_PROVIDER_KIND = "openai-compatible" as const;

const OPAQUE_ORG_ID = /^org_[0-9a-f]{32}$/;
const STABLE_ALIAS = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MAX_SESSION_TOKEN_LENGTH = 4096;

export interface LumiManagedInferenceConfig {
  /** Origin of the Lumi control plane, without a query or fragment. */
  readonly controlPlaneBaseUrl: string;
  readonly organizationId: string;
  /** Runtime session credential; never write this to a persisted config. */
  readonly sessionToken: string;
}

export interface LumiManagedOpenAiCompatibleConfig {
  readonly providerId: typeof LUMI_MANAGED_PROVIDER_ID;
  readonly kind: typeof LUMI_MANAGED_PROVIDER_KIND;
  readonly baseURL: string;
  readonly apiKey: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface LumiProviderModelIdentity {
  readonly sourceProvider: string;
  readonly sourceModel: string;
  readonly lumiAlias: string;
}

/**
 * Build the smallest OpenAI-compatible client configuration understood by the
 * existing AI SDK adapter. The server still authenticates, authorizes, and
 * resolves the alias; this helper does not choose a provider or model.
 */
export function createLumiManagedOpenAiCompatibleConfig(
  input: LumiManagedInferenceConfig,
): LumiManagedOpenAiCompatibleConfig {
  const baseURL = normalizeControlPlaneBaseUrl(input.controlPlaneBaseUrl);
  const organizationId = normalizeOrganizationId(input.organizationId);
  const sessionToken = normalizeSessionToken(input.sessionToken);
  return Object.freeze({
    providerId: LUMI_MANAGED_PROVIDER_ID,
    kind: LUMI_MANAGED_PROVIDER_KIND,
    baseURL,
    apiKey: sessionToken,
    headers: Object.freeze({ "X-Org-ID": organizationId }),
  });
}

/** Validate a user-selected stable alias without accepting provider IDs. */
export function normalizeLumiModelAlias(alias: string): string {
  const value = alias.trim();
  if (!STABLE_ALIAS.test(value)) {
    throw new Error("Lumi model alias is invalid.");
  }
  return value;
}

/**
 * Resolve a legacy ZCode identity through an explicit server-owned mapping.
 * Unknown identities return null; the caller must not guess a replacement or
 * silently fall back to a local/BYOK provider.
 */
export function resolveLumiAlias(
  source: Pick<LumiProviderModelIdentity, "sourceProvider" | "sourceModel">,
  mappings: readonly LumiProviderModelIdentity[],
): string | null {
  const provider = source.sourceProvider.trim();
  const model = source.sourceModel.trim();
  if (!provider || !model) return null;
  const mapping = mappings.find(
    (candidate) =>
      candidate.sourceProvider.trim() === provider && candidate.sourceModel.trim() === model,
  );
  return mapping ? normalizeLumiModelAlias(mapping.lumiAlias) : null;
}

function normalizeControlPlaneBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Lumi control-plane URL is invalid.");
  }
  if (
    (parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        (parsed.hostname === "localhost" ||
          parsed.hostname === "127.0.0.1" ||
          parsed.hostname === "::1")
      )) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Lumi control-plane URL is not an allowed origin.");
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  const basePath = path.endsWith("/api/v1/inference")
    ? path
    : path.endsWith("/api/v1")
      ? `${path}/inference`
      : `${path}/api/v1/inference`;
  return `${parsed.origin}${basePath}`;
}

function normalizeOrganizationId(value: string): string {
  const normalized = value.trim();
  if (!OPAQUE_ORG_ID.test(normalized)) {
    throw new Error("Lumi organization ID is invalid.");
  }
  return normalized;
}

function normalizeSessionToken(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_SESSION_TOKEN_LENGTH ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  ) {
    throw new Error("Lumi session credential is invalid.");
  }
  return normalized;
}
