/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { ManagedRuntimeCapabilities, ManagedToolRiskClass } from "@zcode/contracts";
import type { ToolEntry } from "../types.js";
import type { ToolRegistry } from "../registry.js";
import { resolveManagedToolIdentity } from "./managed-tool-identity.js";

const CAPABILITY_BY_RISK: Readonly<
  Partial<Record<ManagedToolRiskClass, keyof ManagedRuntimeCapabilities>>
> = {
  filesystem_write: "filesystem_write",
  process_execution: "process_execution",
  network: "network_access",
  mcp: "mcp_execution",
  browser: "browser_use",
  computer: "computer_use",
};

function riskOf(entry: ToolEntry): ManagedToolRiskClass {
  // Registry entries are public mutable objects; identity-only caching can
  // publish obsolete support after metadata or attached identity changes.
  return resolveManagedToolIdentity(entry).riskClass;
}

/**
 * Snapshot of what this session's actual ToolRegistry exposes to the model.
 * Support is not permission: catalog identity, grants, policy and approval
 * remain independent server-side requirements.
 */
export function summarizeRuntimeCapabilities(registry: ToolRegistry): ManagedRuntimeCapabilities {
  const result: { -readonly [K in keyof ManagedRuntimeCapabilities]: boolean } = {
    filesystem_write: false,
    process_execution: false,
    network_access: false,
    mcp_execution: false,
    browser_use: false,
    computer_use: false,
  };
  for (const name of registry.list()) {
    const entry = registry.get(name);
    if (!entry || entry.metadata?.providerVisible === false) continue;
    const key = CAPABILITY_BY_RISK[riskOf(entry)];
    if (key) result[key] = true;
  }
  return result;
}
