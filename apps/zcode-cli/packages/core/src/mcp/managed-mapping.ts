/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice. */

import type { McpToolDescriptor } from "@zcode/contracts";
import type { ManagedToolIdentity, ManagedToolSource } from "../tool/types.js";
import {
  canonicalizeManagedFingerprint,
  createManagedResourceId,
  createManagedToolFingerprint,
  normalizeManagedCapabilityId,
  normalizeManagedSource,
} from "../tool/executor/managed-tool-identity.js";

/** Host-supplied, non-secret MCP catalog projection. */
export interface ManagedMcpRegistrationOptions {
  source?: ManagedToolSource;
  registrationId?: string;
  sourceKey?: string;
  toolId?: string | ((descriptor: McpToolDescriptor) => string);
  toolFingerprint?: string | ((descriptor: McpToolDescriptor) => string);
  capabilityIds?: readonly string[];
  catalogued?: boolean;
}

export interface ManagedMcpRegistration {
  mcpRegistrationId: string;
  source: ManagedToolSource;
  fingerprint: string;
  tools: readonly ManagedToolIdentity[];
}

/**
 * Map a descriptor to a stable identity. Display name/description are excluded
 * from the fingerprint; schema, annotations, source and server/tool names are
 * included. A descriptor without an explicit host mapping is intentionally
 * uncatalogued, which makes an unknown privileged MCP fail closed.
 */
export function mapMcpToolToManagedIdentity(
  descriptor: McpToolDescriptor,
  options: ManagedMcpRegistrationOptions = {},
): ManagedToolIdentity {
  const normalizedSource = normalizeManagedSource(options.source);
  const source = normalizedSource ?? "custom";
  const registrationId = resolveRegistrationId(descriptor, options, source);
  const stableName = `mcp:${descriptor.serverName}:${descriptor.toolName}`;
  const explicitFingerprint = resolveOptionValue(options.toolFingerprint, descriptor);
  const normalizedFingerprint = normalizeFingerprint(explicitFingerprint);
  const capabilityIds = normalizeCapabilityIds(options.capabilityIds);
  const fingerprint =
    normalizedFingerprint ??
    createManagedToolFingerprint({
      kind: "mcp-tool",
      source,
      registrationId,
      serverName: descriptor.serverName,
      toolName: descriptor.toolName,
      inputSchema: descriptor.inputSchema,
      outputSchema: descriptor.outputSchema,
      annotations: descriptor.annotations,
      capabilityIds,
    });
  const explicitToolId = resolveOptionValue(options.toolId, descriptor);
  const normalizedToolId = normalizeToolId(explicitToolId);
  const toolId =
    normalizedToolId ??
    createManagedResourceId("tool", {
      registrationId,
      serverName: descriptor.serverName,
      toolName: descriptor.toolName,
    });
  // `source` and all explicit identity fields are host options. Descriptor
  // text is intentionally never treated as catalog membership. A malformed
  // explicit projection is uncatalogued rather than silently repaired.
  const sourceProjectionValid = options.source === undefined || normalizedSource !== undefined;
  const explicitIdentityValid =
    (options.registrationId === undefined || /^mcp_[0-9a-f]{32}$/.test(options.registrationId)) &&
    (options.toolFingerprint === undefined || normalizedFingerprint !== undefined) &&
    (options.toolId === undefined || normalizedToolId !== undefined);
  const catalogued =
    sourceProjectionValid &&
    explicitIdentityValid &&
    (options.catalogued ?? normalizedSource !== undefined);

  return {
    toolId,
    name: stableName,
    fingerprint,
    source,
    riskClass: "mcp",
    capabilityIds,
    mcpRegistrationId: registrationId,
    catalogued,
  };
}

export const createMcpManagedToolIdentity = mapMcpToolToManagedIdentity;

export function createManagedMcpRegistration(
  descriptors: readonly McpToolDescriptor[],
  options: ManagedMcpRegistrationOptions = {},
): ManagedMcpRegistration {
  const normalizedSource = normalizeManagedSource(options.source);
  const source = normalizedSource ?? "custom";
  const registrationId = resolveRegistrationId(descriptors[0], options, source);
  const tools = descriptors
    .map((descriptor) =>
      mapMcpToolToManagedIdentity(descriptor, {
        ...options,
        source,
        catalogued: options.catalogued ?? normalizedSource !== undefined,
      }),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const fingerprint = createManagedToolFingerprint({
    kind: "mcp-registration",
    source,
    registrationId,
    tools: tools.map((tool) => ({
      name: tool.name,
      fingerprint: tool.fingerprint,
    })),
  });
  return { mcpRegistrationId: registrationId, source, fingerprint, tools };
}

export const createMcpManagedRegistration = createManagedMcpRegistration;

function resolveRegistrationId(
  descriptor: McpToolDescriptor | undefined,
  options: ManagedMcpRegistrationOptions,
  source: ManagedToolSource,
): string {
  const explicit = options.registrationId;
  if (typeof explicit === "string" && /^mcp_[0-9a-f]{32}$/.test(explicit)) return explicit;
  return createManagedResourceId("mcp", {
    source,
    sourceKey: options.sourceKey ?? descriptor?.serverName ?? "unknown",
  });
}

function resolveOptionValue(
  value: string | ((descriptor: McpToolDescriptor) => string) | undefined,
  descriptor: McpToolDescriptor,
): string | undefined {
  if (typeof value === "function") return value(descriptor);
  return value;
}

function normalizeFingerprint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = canonicalizeManagedFingerprint(value.trim());
  if (!/^[A-Za-z0-9._:-]{4,128}$/.test(normalized)) return undefined;
  return normalized;
}

function normalizeToolId(value: unknown): string | undefined {
  return typeof value === "string" && /^tool_[0-9a-f]{32}$/.test(value) ? value : undefined;
}

function normalizeCapabilityIds(values: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? ["mcp"])
        .map((value) => normalizeManagedCapabilityId(value))
        .filter((value): value is string => value !== undefined),
    ),
  ].sort();
}
