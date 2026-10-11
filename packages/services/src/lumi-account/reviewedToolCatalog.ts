/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { zcodeManagedToolIdentitySchema, type ZCodeManagedToolIdentity } from "@zcode/shared";
import { LumiAccountError } from "./errors.js";

/** Main-only read. This never registers a tool or grants execution. */
export class LumiReviewedToolCatalogTransport {
  constructor(private readonly read: (path: string) => Promise<Record<string, unknown>>) {}
  async resolve(
    orgId: string,
    descriptor: ZCodeManagedToolIdentity,
  ): Promise<ZCodeManagedToolIdentity | undefined> {
    if (!/^org_[0-9a-f]{32}$/.test(orgId)) throw new LumiAccountError("lumi_org_invalid");
    const local = zcodeManagedToolIdentitySchema.parse(descriptor);
    let cursor: string | undefined, match: ZCodeManagedToolIdentity | undefined;
    const visited = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const row = await this.read(
        `/api/v1/orgs/${orgId}/tools?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (!Array.isArray(row.items) || row.items.length > 100 || typeof row.has_more !== "boolean")
        throw new LumiAccountError("lumi_response_invalid");
      for (const value of row.items) {
        if (!value || typeof value !== "object")
          throw new LumiAccountError("lumi_response_invalid");
        const item = value as Record<string, unknown>;
        if (
          item.org_id !== orgId ||
          typeof item.version !== "number" ||
          !Number.isSafeInteger(item.version) ||
          item.version < 1 ||
          !["active", "review", "disabled"].includes(String(item.lifecycle))
        )
          throw new LumiAccountError("lumi_response_invalid");
        if (item.tool_id !== undefined && item.id !== undefined && item.tool_id !== item.id)
          throw new LumiAccountError("lumi_response_invalid");
        const identity = zcodeManagedToolIdentitySchema.parse({
          toolId: item.tool_id ?? item.id,
          name: local.name,
          fingerprint: item.fingerprint,
          source: item.source,
          riskClass: item.risk_class,
          capabilityIds: item.capability_ids,
          catalogued: true,
          ...(local.mcpRegistrationId ? { mcpRegistrationId: local.mcpRegistrationId } : {}),
        });
        if (identity.fingerprint !== local.fingerprint || item.lifecycle !== "active") continue;
        if (
          identity.source !== local.source ||
          identity.riskClass !== local.riskClass ||
          JSON.stringify([...identity.capabilityIds].sort()) !==
            JSON.stringify([...local.capabilityIds].sort())
        )
          throw new LumiAccountError("lumi_tool_catalog_mismatch");
        if (match) throw new LumiAccountError("lumi_tool_catalog_ambiguous");
        match = identity;
      }
      if (!row.has_more) return match;
      if (
        typeof row.next_cursor !== "string" ||
        !row.next_cursor ||
        row.next_cursor.length > 512 ||
        visited.has(row.next_cursor)
      )
        throw new LumiAccountError("lumi_tool_catalog_incomplete");
      cursor = row.next_cursor;
      visited.add(cursor);
    }
    throw new LumiAccountError("lumi_tool_catalog_incomplete");
  }
}
