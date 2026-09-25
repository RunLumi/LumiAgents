/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice. */

/**
 * Runtime-only boundary for the Lumi control-plane inference endpoint.
 *
 * The desktop must send a stable Lumi alias, never a provider/model string as
 * route authority. A managed session token is deliberately kept out of the
 * static provider projection. It is captured by a per-run auth source and is
 * resolved only while a physical model request is being prepared.
 */

export const LUMI_MANAGED_PROVIDER_ID = "lumi-managed" as const;
export const LUMI_MANAGED_PROVIDER_KIND = "openai-compatible" as const;

/**
 * P05 correlation headers are diagnostic/request-routing inputs only. The
 * control plane still resolves the principal, membership, device, project and
 * policy from its authenticated token; these headers never grant authority.
 *
 * `X-Org-ID` remains the P04 tenant-context header. The remaining names are
 * explicit about the P05 resource axes so they cannot be confused with the
 * P02 login session or a provider's own session header.
 */
export const LUMI_MANAGED_CORRELATION_HEADERS = Object.freeze({
  organizationId: "X-Org-ID",
  projectId: "X-Project-ID",
  deviceId: "X-Device-ID",
  agentSessionId: "X-Agent-Session-ID",
  runId: "X-Run-ID",
  agentDefinitionId: "X-Agent-Definition-ID",
  agentDefinitionVersion: "X-Agent-Definition-Version",
  requestId: "X-Correlation-ID",
  externalId: "X-Lumi-External-ID",
  executionMode: "X-Lumi-Execution-Mode",
});

export type LumiManagedCorrelationHeader =
  (typeof LUMI_MANAGED_CORRELATION_HEADERS)[keyof typeof LUMI_MANAGED_CORRELATION_HEADERS];

const OPAQUE_ID = /^(org|prj|dvc|rse|run|agd|req)_[0-9a-f]{32}$/;
const VISIBLE_ASCII = /^[\x21-\x7e]+$/;
const MAX_EXTERNAL_ID_LENGTH = 256;
const MAX_SESSION_TOKEN_LENGTH = 4096;
const STABLE_ALIAS = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/**
 * Static, non-secret managed provider facts.
 *
 * `sessionToken` is accepted only as a compatibility input for callers of the
 * original P04 helper. It is intentionally ignored here; use
 * `createLumiManagedRequestAuthSource` for the runtime credential.
 */
export interface LumiManagedInferenceConfig {
  /** Origin of the Lumi control plane, without a query or fragment. */
  readonly controlPlaneBaseUrl: string;
  readonly organizationId: string;
  /** @deprecated Runtime credentials belong to an auth source, never static config. */
  readonly sessionToken?: string;
}

export interface LumiManagedOpenAiCompatibleConfig {
  readonly providerId: typeof LUMI_MANAGED_PROVIDER_ID;
  readonly kind: typeof LUMI_MANAGED_PROVIDER_KIND;
  readonly baseURL: string;
  /** Only non-secret tenant context is static; per-run correlation is injected below. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface LumiProviderModelIdentity {
  readonly sourceProvider: string;
  readonly sourceModel: string;
  readonly lumiAlias: string;
}

/** The safe, serialized portion of one managed control-plane run. */
export interface ManagedRunContext {
  readonly organizationId: string;
  readonly projectId: string;
  readonly deviceId: string;
  readonly agentSessionId: string;
  readonly runId: string;
  readonly agentDefinitionId: string;
  readonly agentDefinitionVersion: number;
  readonly requestId: string;
  readonly externalId?: string;
  readonly executionMode: "managed" | "local_only";
}

/**
 * Input accepted at the runtime boundary. `orgId` is a compatibility alias for
 * protocol-shaped callers; the normalized context always exposes the clearer
 * `organizationId` name used by the existing managed-inference helper.
 */
export interface ManagedRunContextInput {
  readonly organizationId?: string;
  readonly orgId?: string;
  readonly projectId: string;
  readonly deviceId: string;
  readonly agentSessionId: string;
  readonly runId: string;
  readonly agentDefinitionId: string;
  readonly agentDefinitionVersion: number;
  readonly requestId: string;
  readonly externalId?: string;
  readonly executionMode?: "managed" | "local_only";
}

export type LumiManagedRunContext = ManagedRunContext;

export interface SerializedManagedRunContext {
  readonly org_id: string;
  readonly project_id: string;
  readonly device_id: string;
  readonly agent_session_id: string;
  readonly run_id: string;
  readonly agent_definition_id: string;
  readonly agent_definition_version: number;
  readonly request_id: string;
  readonly external_id?: string;
  readonly execution_mode: "managed" | "local_only";
}

export interface LumiManagedRequestAuth {
  readonly apiKey: string;
  readonly headers: Record<string, string>;
}

export interface LumiManagedRequestAuthSourceInput {
  readonly attempt?: number;
  readonly abortSignal?: AbortSignal;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly traceContext?: unknown;
}

export interface LumiManagedRequestAuthSource {
  resolve(input?: LumiManagedRequestAuthSourceInput): Promise<LumiManagedRequestAuth>;
}

export type LumiManagedSessionToken = string | (() => string | Promise<string>);

export interface LumiManagedRequestAuthSourceInputWithContext {
  readonly context: ManagedRunContextInput;
  readonly sessionToken: LumiManagedSessionToken;
}

export interface LumiManagedRequestDependencies {
  readonly requestAuth: {
    readonly source: LumiManagedRequestAuthSource;
  };
}

/**
 * Build static managed-provider facts. No credential is read from or copied
 * into the returned object, so this projection is safe to pass through a
 * provider registry or model adapter.
 */
export function createLumiManagedOpenAiCompatibleConfig(
  input: LumiManagedInferenceConfig,
): LumiManagedOpenAiCompatibleConfig {
  const baseURL = normalizeControlPlaneBaseUrl(input.controlPlaneBaseUrl);
  const organizationId = normalizeOpaqueId(input.organizationId, "org");
  return Object.freeze({
    providerId: LUMI_MANAGED_PROVIDER_ID,
    kind: LUMI_MANAGED_PROVIDER_KIND,
    baseURL,
    headers: Object.freeze({ [LUMI_MANAGED_CORRELATION_HEADERS.organizationId]: organizationId }),
  });
}

/** Normalize a per-run context without retaining any credential material. */
export function createManagedRunContext(input: ManagedRunContextInput): ManagedRunContext {
  const organizationId = normalizeOpaqueId(input.organizationId ?? input.orgId, "org");
  if (
    input.organizationId !== undefined &&
    input.orgId !== undefined &&
    normalizeOpaqueId(input.organizationId, "org") !== normalizeOpaqueId(input.orgId, "org")
  ) {
    throw new Error("Lumi managed run organization context is inconsistent.");
  }

  return Object.freeze({
    organizationId,
    projectId: normalizeOpaqueId(input.projectId, "prj"),
    deviceId: normalizeOpaqueId(input.deviceId, "dvc"),
    agentSessionId: normalizeOpaqueId(input.agentSessionId, "rse"),
    runId: normalizeOpaqueId(input.runId, "run"),
    agentDefinitionId: normalizeOpaqueId(input.agentDefinitionId, "agd"),
    agentDefinitionVersion: normalizeAgentDefinitionVersion(input.agentDefinitionVersion),
    requestId: normalizeOpaqueId(input.requestId, "req"),
    ...(input.externalId === undefined
      ? {}
      : { externalId: normalizeExternalId(input.externalId) }),
    executionMode: normalizeExecutionMode(input.executionMode),
  });
}

/** Serialize the protocol's safe snake_case context; never include auth material. */
export function serializeManagedRunContext(
  input: ManagedRunContextInput,
): SerializedManagedRunContext {
  const context = createManagedRunContext(input);
  return Object.freeze({
    org_id: context.organizationId,
    project_id: context.projectId,
    device_id: context.deviceId,
    agent_session_id: context.agentSessionId,
    run_id: context.runId,
    agent_definition_id: context.agentDefinitionId,
    agent_definition_version: context.agentDefinitionVersion,
    request_id: context.requestId,
    ...(context.externalId === undefined ? {} : { external_id: context.externalId }),
    execution_mode: context.executionMode,
  });
}

/** Build the safe request headers applied by the existing auth seam. */
export function createLumiManagedCorrelationHeaders(
  input: ManagedRunContextInput,
): Readonly<Record<string, string>> {
  const context = createManagedRunContext(input);
  return Object.freeze({
    [LUMI_MANAGED_CORRELATION_HEADERS.organizationId]: context.organizationId,
    [LUMI_MANAGED_CORRELATION_HEADERS.projectId]: context.projectId,
    [LUMI_MANAGED_CORRELATION_HEADERS.deviceId]: context.deviceId,
    [LUMI_MANAGED_CORRELATION_HEADERS.agentSessionId]: context.agentSessionId,
    [LUMI_MANAGED_CORRELATION_HEADERS.runId]: context.runId,
    [LUMI_MANAGED_CORRELATION_HEADERS.agentDefinitionId]: context.agentDefinitionId,
    [LUMI_MANAGED_CORRELATION_HEADERS.agentDefinitionVersion]: String(
      context.agentDefinitionVersion,
    ),
    [LUMI_MANAGED_CORRELATION_HEADERS.requestId]: context.requestId,
    ...(context.externalId === undefined
      ? {}
      : { [LUMI_MANAGED_CORRELATION_HEADERS.externalId]: context.externalId }),
    [LUMI_MANAGED_CORRELATION_HEADERS.executionMode]: context.executionMode,
  });
}

/** Short alias for callers that already use the P05 context vocabulary. */
export const createManagedRunHeaders = createLumiManagedCorrelationHeaders;

/**
 * Create a per-run source. The token is captured in a closure and is not an
 * enumerable property of the source or of the returned request dependencies.
 * A resolver function is supported for a short-lived token refresh without
 * moving the credential into static configuration.
 */
export function createLumiManagedRequestAuthSource(
  input: LumiManagedRequestAuthSourceInputWithContext,
): LumiManagedRequestAuthSource {
  const context = createManagedRunContext(input.context);
  if (context.executionMode !== "managed") {
    throw new Error("Managed inference auth requires a managed run context.");
  }
  const tokenSource = input.sessionToken;
  return Object.freeze({
    resolve: async (_input?: LumiManagedRequestAuthSourceInput) => {
      const sessionToken = normalizeSessionToken(
        typeof tokenSource === "function" ? await tokenSource() : tokenSource,
      );
      return Object.freeze({
        apiKey: sessionToken,
        headers: { ...createLumiManagedCorrelationHeaders(context) },
      }) as LumiManagedRequestAuth;
    },
  });
}

/** Adapt the source to the existing ModelRequestDependencies seam. */
export function createLumiManagedRequestDependencies(
  input: LumiManagedRequestAuthSourceInputWithContext,
): LumiManagedRequestDependencies {
  return Object.freeze({
    requestAuth: Object.freeze({
      source: createLumiManagedRequestAuthSource(input),
    }),
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

function normalizeOpaqueId(value: string | undefined, prefix: string): string {
  const normalized = value?.trim() ?? "";
  if (!OPAQUE_ID.test(normalized) || !normalized.startsWith(`${prefix}_`)) {
    throw new Error(`Lumi ${prefix} ID is invalid.`);
  }
  return normalized;
}

function normalizeAgentDefinitionVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Lumi agent definition version is invalid.");
  }
  return value;
}

function normalizeExternalId(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_EXTERNAL_ID_LENGTH ||
    !VISIBLE_ASCII.test(normalized)
  ) {
    throw new Error("Lumi external run ID is invalid.");
  }
  return normalized;
}

function normalizeExecutionMode(
  value: "managed" | "local_only" | undefined,
): "managed" | "local_only" {
  if (value === undefined) return "managed";
  if (value === "managed" || value === "local_only") return value;
  throw new Error("Lumi managed execution mode is invalid.");
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
