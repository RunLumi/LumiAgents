/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice. */

import { createHash } from "node:crypto";
import type {
  ManagedToolIdentity,
  ManagedToolRiskClass,
  ManagedToolSource,
  ToolEntry,
} from "../types.js";

const opaqueIdPattern = /^[a-z][a-z0-9]*_[0-9a-f]{32}$/;
const metadataIdPattern = /^[A-Za-z0-9._:-]{1,160}$/;
const MAX_ARGUMENT_SUMMARY_LENGTH = 512;
const MAX_ARGUMENT_FIELDS = 24;
const MAX_ARGUMENT_VALUE_LENGTH = 160;

/** Canonical JSON used only for identity hashing. */
export function stableSerialize(value: unknown): string {
  return serializeStableValue(value, new WeakSet<object>());
}

export function createStableManagedHash(namespace: string, value: unknown): string {
  return createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(stableSerialize(value))
    .digest("hex");
}

export function createManagedResourceId(
  prefix: "tool" | "mcp" | "tcl" | "cap",
  value: unknown,
): string {
  return `${prefix}_${createStableManagedHash(`lumi-managed-id-v1:${prefix}`, value).slice(0, 32)}`;
}

export function createManagedCapabilityId(value: unknown): string {
  return createManagedResourceId("cap", value);
}

export function createManagedToolFingerprint(value: unknown): string {
  // The control-plane tool endpoint accepts the raw SHA-256 digest. A
  // `sha256:` prefix is accepted by some legacy projections, but is rejected
  // by the current P05 route validator.
  return createStableManagedHash("lumi-tool-fingerprint-v1", value);
}

/**
 * Resolve the trusted identity attached by the host. When no host projection is
 * present, return a deterministic *uncatalogued* identity. The distinction is
 * security significant: deterministic identity is useful for diagnostics, but
 * an uncatalogued privileged identity is denied by the managed gate.
 */
export function resolveManagedToolIdentity(entry: ToolEntry): ManagedToolIdentity {
  const attached = entry.managedIdentity ?? entry.metadata?.managedIdentity;
  if (attached) return normalizeAttachedIdentity(entry, attached);

  const mcp = entry.metadata?.mcpPresentation;
  const source: ManagedToolSource = mcp ? "custom" : "built_in";
  const stableName = mcp
    ? `mcp:${mcp.serverName}:${mcp.toolName}`
    : (entry.metadata?.name ?? "unknown");
  const riskClass = deriveRiskClass(entry);
  const capabilityIds = deriveCapabilityIds(entry, riskClass);
  const mcpRegistrationId = mcp
    ? createManagedResourceId("mcp", { source, sourceKey: mcp.serverName })
    : undefined;
  const fingerprint = createManagedToolFingerprint({
    kind: mcp ? "mcp" : "tool",
    source,
    stableName,
    inputSchema: entry.inputSchema,
    outputSchema: entry.outputSchema,
    runtimeInputSchema: entry.runtimeInputSchema,
    permission: entry.permission,
    readOnly: entry.metadata?.readOnly === true,
    destructive: entry.metadata?.destructive === true,
    needsApproval: entry.metadata?.needsApproval === true,
    sideEffectScope: entry.metadata?.sideEffectScope,
    riskLevel: entry.metadata?.riskLevel,
    capabilityIds,
    ...(mcp ? { serverName: mcp.serverName, toolName: mcp.toolName } : {}),
  });

  return {
    toolId: createManagedResourceId("tool", { source, stableName }),
    name: stableName,
    fingerprint,
    source,
    riskClass,
    capabilityIds,
    ...(mcpRegistrationId ? { mcpRegistrationId } : {}),
    catalogued: false,
  };
}

export function isManagedIdentityValid(identity: ManagedToolIdentity): boolean {
  return (
    isOpaqueId(identity.toolId, "tool") &&
    validMetadataId(identity.name) &&
    validFingerprint(identity.fingerprint) &&
    isManagedSource(identity.source) &&
    isManagedRiskClass(identity.riskClass) &&
    Array.isArray(identity.capabilityIds) &&
    identity.capabilityIds.length <= 128 &&
    identity.capabilityIds.every((value) => isOpaqueId(value, "cap")) &&
    (identity.mcpRegistrationId === undefined || isOpaqueId(identity.mcpRegistrationId, "mcp"))
  );
}

export function isPrivilegedManagedIdentity(identity: ManagedToolIdentity): boolean {
  return identity.riskClass !== "read_only";
}

export function normalizeManagedSource(value: unknown): ManagedToolSource | undefined {
  if (value === "built_in" || value === "builtin" || value === "built-in") return "built_in";
  if (value === "plugin") return "plugin";
  if (value === "custom" || value === "user_custom" || value === "user-custom") return "custom";
  return undefined;
}

export function normalizeManagedCapabilityId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (isOpaqueId(normalized, "cap")) return normalized;
  if (!/^[A-Za-z][A-Za-z0-9._:-]{0,95}$/.test(normalized)) return undefined;
  return createManagedCapabilityId(normalized);
}

export function createManagedArgumentsSummary(input: unknown): string {
  const fields: string[] = [];
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    for (const key of Object.keys(record).sort().slice(0, MAX_ARGUMENT_FIELDS)) {
      if (!isSummaryKey(key)) continue;
      const value = summarizeArgumentValue(key, record[key]);
      if (value !== undefined) fields.push(`${key.toLowerCase()}=${value}`);
    }
  }

  const summary = fields.length > 0 ? fields.join(";") : summarizeNonObject(input);
  return truncateSummary(summary);
}

export function createManagedArgumentsHash(summary: string): string {
  // Match the control-plane approval binding: SHA-256 over the exact bounded
  // summary string, with no runtime-specific namespace or serialization layer.
  return createHash("sha256").update(summary).digest("hex");
}

export function createManagedToolCallId(localToolCallId: string): string {
  const value = localToolCallId.trim();
  if (isOpaqueId(value, "tcl")) return value;
  return createManagedResourceId("tcl", value);
}

function normalizeAttachedIdentity(
  entry: ToolEntry,
  attached: ManagedToolIdentity,
): ManagedToolIdentity {
  const mcp = entry.metadata?.mcpPresentation;
  const source = normalizeManagedSource(attached.source) ?? (mcp ? "custom" : "built_in");
  const name = validMetadataId(attached.name)
    ? attached.name
    : mcp
      ? `mcp:${mcp.serverName}:${mcp.toolName}`
      : (entry.metadata?.name ?? "unknown");
  const stableName = mcp ? `mcp:${mcp.serverName}:${mcp.toolName}` : name;
  const validToolId = isOpaqueId(attached.toolId, "tool");
  const normalizedAttachedFingerprint = canonicalizeManagedFingerprint(attached.fingerprint);
  const validFingerprintValue = validFingerprint(normalizedAttachedFingerprint);
  const attachedSourceValid = normalizeManagedSource(attached.source) !== undefined;
  const attachedNameValid = validMetadataId(attached.name);
  const attachedRiskClassValid = isManagedRiskClass(attached.riskClass);
  const attachedCapabilityIdsValid =
    Array.isArray(attached.capabilityIds) &&
    attached.capabilityIds.every((value) => normalizeManagedCapabilityId(value) !== undefined);
  const capabilityIds = normalizeCapabilityIds(attached.capabilityIds);
  const mcpRegistrationId = normalizeMcpRegistrationId(
    attached.mcpRegistrationId ??
      (mcp ? createManagedResourceId("mcp", { source, sourceKey: mcp.serverName }) : undefined),
  );
  const attachedMcpRegistrationIdValid =
    (attached.mcpRegistrationId === undefined && !mcp) ||
    isOpaqueId(attached.mcpRegistrationId, "mcp");

  return {
    toolId: validToolId ? attached.toolId : createManagedResourceId("tool", { source, stableName }),
    name,
    fingerprint: validFingerprintValue
      ? normalizedAttachedFingerprint
      : createManagedToolFingerprint({
          kind: "attached",
          source,
          stableName,
          inputSchema: entry.inputSchema,
          outputSchema: entry.outputSchema,
          permission: entry.permission,
          capabilityIds,
        }),
    source,
    riskClass: isManagedRiskClass(attached.riskClass) ? attached.riskClass : deriveRiskClass(entry),
    capabilityIds,
    ...(mcpRegistrationId ? { mcpRegistrationId } : {}),
    catalogued:
      attached.catalogued !== false &&
      attachedSourceValid &&
      attachedNameValid &&
      attachedRiskClassValid &&
      attachedCapabilityIdsValid &&
      attachedMcpRegistrationIdValid &&
      validToolId &&
      validFingerprintValue,
  };
}

function deriveRiskClass(entry: ToolEntry): ManagedToolRiskClass {
  const metadata = entry.metadata;
  const mcp = metadata?.mcpPresentation;
  if (mcp || entry.permission?.permission === "mcp") return "mcp";
  if (hasCapability(entry, "browser")) return "browser";
  if (hasCapability(entry, "computer")) return "computer";
  if (hasCapability(entry, "credential")) return "credential_bearing";
  if (metadata?.destructive === true) return "destructive";
  if (metadata?.readOnly === true) return "read_only";
  switch (metadata?.sideEffectScope) {
    case "network":
      return "network";
    case "system":
      return "process_execution";
    case "workspace":
    case "git":
      return "filesystem_write";
    default:
      return metadata?.needsApproval === true ? "external_side_effect" : "read_only";
  }
}

function deriveCapabilityIds(entry: ToolEntry, riskClass: ManagedToolRiskClass): readonly string[] {
  const capabilities = new Set<string>();
  if (entry.metadata?.mcpPresentation || riskClass === "mcp") {
    capabilities.add(createManagedCapabilityId("mcp"));
  }
  if (riskClass === "browser") capabilities.add(createManagedCapabilityId("browser"));
  if (riskClass === "computer") capabilities.add(createManagedCapabilityId("computer"));
  if (riskClass === "network") capabilities.add(createManagedCapabilityId("network"));
  if (riskClass === "process_execution") capabilities.add(createManagedCapabilityId("process"));
  if (riskClass === "filesystem_write") capabilities.add(createManagedCapabilityId("filesystem"));
  return [...capabilities].sort();
}

function hasCapability(entry: ToolEntry, value: string): boolean {
  const searchable = `${entry.capability ?? ""} ${entry.metadata?.description ?? ""}`.toLowerCase();
  return searchable.includes(value);
}

function summarizeNonObject(input: unknown): string {
  if (input === null) return "type=null";
  if (Array.isArray(input)) return `type=array;length=${input.length}`;
  if (typeof input === "string") return `type=string;length=${input.length}`;
  if (typeof input === "number" || typeof input === "boolean" || typeof input === "bigint") {
    return `${typeof input}=${String(input)}`;
  }
  return `type=${typeof input}`;
}

function summarizeArgumentValue(key: string, value: unknown): string | undefined {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value !== "string") return `[${Array.isArray(value) ? "array" : typeof value}]`;
  if (isSensitiveKey(key)) return "[redacted]";
  const normalized = stripControlCharacters(value).trim();
  if (normalized.length === 0) return "";
  if (key.toLowerCase() === "url" || normalized.includes("://")) {
    return sanitizeUrlValue(normalized);
  }
  if (/(bearer\s+|token\s*[=:]|secret\s*[=:]|password\s*[=:])/i.test(normalized)) {
    return "[redacted]";
  }
  return truncateValue(normalized);
}

function truncateValue(value: string): string {
  return value.length <= MAX_ARGUMENT_VALUE_LENGTH
    ? value
    : `${value.slice(0, MAX_ARGUMENT_VALUE_LENGTH)}…`;
}

function truncateSummary(value: string): string {
  return value.length <= MAX_ARGUMENT_SUMMARY_LENGTH
    ? value
    : `${value.slice(0, MAX_ARGUMENT_SUMMARY_LENGTH - 1)}…`;
}

function isSummaryKey(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value);
}

function isSensitiveKey(value: string): boolean {
  return /(secret|token|password|authorization|cookie|credential|api[_-]?key|prompt|body|content)/i.test(
    value,
  );
}

function stripControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? " " : character;
  }).join("");
}

function sanitizeUrlValue(value: string): string {
  try {
    const parsed = new URL(value);
    if (!parsed.hostname) return "[url]";
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return "[url]";
  }
}

function normalizeCapabilityIds(values: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => normalizeManagedCapabilityId(value))
        .filter((value): value is string => value !== undefined),
    ),
  ].sort();
}

function normalizeMcpRegistrationId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return isOpaqueId(value, "mcp") ? value : undefined;
}

function validMetadataId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    metadataIdPattern.test(value) &&
    value.trim() === value &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  );
}

export function canonicalizeManagedFingerprint(value: unknown): string {
  if (typeof value !== "string") return "";
  if (!value.startsWith("sha256:")) return value;
  const suffix = value.slice("sha256:".length);
  return /^[A-Za-z0-9._-]{1,122}$/.test(suffix) ? suffix : value;
}

function validFingerprint(value: unknown): value is string {
  // The shared P05 contract permits a bounded, printable fingerprint token.
  // Runtime-derived fingerprints are SHA-256, but host catalog projections may
  // use another stable digest/opaque fingerprint format.
  return typeof value === "string" && /^[A-Za-z0-9._:-]{4,128}$/.test(value);
}

function isOpaqueId(value: unknown, prefix: "tool" | "mcp" | "tcl" | "cap"): value is string {
  return typeof value === "string" && opaqueIdPattern.test(value) && value.startsWith(`${prefix}_`);
}

function isManagedSource(value: unknown): value is ManagedToolSource {
  return value === "built_in" || value === "plugin" || value === "custom";
}

function isManagedRiskClass(value: unknown): value is ManagedToolRiskClass {
  return (
    value === "read_only" ||
    value === "filesystem_write" ||
    value === "process_execution" ||
    value === "network" ||
    value === "mcp" ||
    value === "browser" ||
    value === "computer" ||
    value === "credential_bearing" ||
    value === "external_side_effect" ||
    value === "destructive"
  );
}

function serializeStableValue(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : '"[nonfinite]"';
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return `"${value.toString()}n"`;
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "function" || typeof value === "symbol") return `"[${typeof value}]"`;
  if (seen.has(value)) return '"[circular]"';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => serializeStableValue(item, seen)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeStableValue(record[key], seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}
