/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice. */

import assert from "node:assert/strict";
import test from "node:test";
import type { McpToolDescriptor } from "@zcode/contracts";
import { createManagedMcpRegistration, mapMcpToolToManagedIdentity } from "./managed-mapping.js";

function descriptor(overrides: Partial<McpToolDescriptor> = {}): McpToolDescriptor {
  return {
    serverName: "fixture-server",
    toolName: "submit",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    ...overrides,
  };
}

test("MCP source and registration identity are stable", () => {
  const first = mapMcpToolToManagedIdentity(descriptor(), {
    source: "plugin",
    registrationId: `mcp_${"b".repeat(32)}`,
  });
  const second = mapMcpToolToManagedIdentity(descriptor(), {
    source: "plugin",
    registrationId: `mcp_${"b".repeat(32)}`,
  });

  assert.deepEqual(first, second);
  assert.equal(first.source, "plugin");
  assert.equal(first.mcpRegistrationId, `mcp_${"b".repeat(32)}`);
  assert.equal(first.catalogued, true);
  assert.match(first.capabilityIds[0] ?? "", /^cap_[0-9a-f]{32}$/);
});

test("changing an MCP schema changes the tool fingerprint", () => {
  const first = mapMcpToolToManagedIdentity(descriptor(), { source: "custom" });
  const second = mapMcpToolToManagedIdentity(
    descriptor({
      inputSchema: {
        type: "object",
        properties: { value: { type: "number" } },
        additionalProperties: false,
      },
    }),
    { source: "custom" },
  );

  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal(first.toolId, second.toolId);
});

test("an untrusted descriptor is uncatalogued and the registration includes its current tool set", () => {
  const identity = mapMcpToolToManagedIdentity(descriptor());
  const registration = createManagedMcpRegistration([descriptor()]);

  assert.equal(identity.catalogued, false);
  assert.equal(registration.tools[0]?.fingerprint, identity.fingerprint);
  assert.equal(registration.mcpRegistrationId, identity.mcpRegistrationId);
});

test("descriptor annotations cannot self-authorize catalog membership", () => {
  const spoofedDescriptor = {
    ...descriptor(),
    source: "built_in",
    official: true,
    toolId: `tool_${"9".repeat(32)}`,
    toolFingerprint: `sha256:${"8".repeat(64)}`,
  } as McpToolDescriptor;
  const identity = mapMcpToolToManagedIdentity(spoofedDescriptor);

  assert.equal(identity.source, "custom");
  assert.equal(identity.catalogued, false);
  assert.notEqual(identity.toolId, `tool_${"9".repeat(32)}`);
  assert.notEqual(identity.fingerprint, `sha256:${"8".repeat(64)}`);
});
