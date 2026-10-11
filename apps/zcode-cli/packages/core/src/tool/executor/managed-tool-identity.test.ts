import assert from "node:assert/strict";
import test from "node:test";
import { createToolRegistry, registerBuiltInTools } from "../../index.js";
import { resolveManagedToolIdentity } from "./managed-tool-identity.js";
import { createManagedToolCallId } from "./managed-tool-identity.js";

test("provider call IDs are stable within a run and independent across runs", () => {
  const first = createManagedToolCallId("call_mock_1", `run_${"a".repeat(32)}`);
  assert.equal(first, createManagedToolCallId("call_mock_1", `run_${"a".repeat(32)}`));
  assert.notEqual(first, createManagedToolCallId("call_mock_1", `run_${"b".repeat(32)}`));
});

test("real Write fingerprint survives successful and failed runtime validation", () => {
  const registry = createToolRegistry();
  registerBuiltInTools(registry, { allowedTools: ["Write"] });
  const entry = registry.get("Write")!;
  const schema = entry.runtimeInputSchema as { safeParse(value: unknown): { success: boolean } };
  const before = resolveManagedToolIdentity(entry).fingerprint;
  assert.equal(
    schema.safeParse({ file_path: "/private/tmp/lumi-e2e-fixture.txt", content: "fixture" })
      .success,
    true,
  );
  assert.equal(resolveManagedToolIdentity(entry).fingerprint, before);
  assert.equal(schema.safeParse({ content: 4 }).success, false);
  assert.equal(resolveManagedToolIdentity(entry).fingerprint, before);
});

test("changed declarative runtime constraint changes reviewed identity", () => {
  const registry = createToolRegistry();
  registerBuiltInTools(registry, { allowedTools: ["Write"] });
  const entry = registry.get("Write")!;
  const schema = entry.runtimeInputSchema as {
    shape: { content: { min(n: number): unknown } };
    extend(value: Record<string, unknown>): unknown;
  };
  const first = {
    ...entry,
    runtimeInputSchema: schema.extend({ content: schema.shape.content.min(1) }),
  };
  const second = {
    ...entry,
    runtimeInputSchema: schema.extend({ content: schema.shape.content.min(2) }),
  };
  assert.notEqual(
    resolveManagedToolIdentity(first).fingerprint,
    resolveManagedToolIdentity(second).fingerprint,
  );
});
import { createManagedCapabilityId, createManagedResourceId } from "./managed-tool-identity.js";

test("browser and computer requirements reference the deployed platform catalog", () => {
  assert.equal(createManagedCapabilityId("browser"), "cap_62726f77736572000000000000000000");
  assert.equal(createManagedCapabilityId("computer"), "cap_636f6d70757465720000000000000000");
  for (const capability of ["filesystem", "process", "network", "mcp"]) {
    assert.equal(createManagedCapabilityId(capability), createManagedResourceId("cap", capability));
    assert.match(createManagedCapabilityId(capability), /^cap_[0-9a-f]{32}$/);
  }
  assert.notEqual(createManagedCapabilityId("Browser"), createManagedCapabilityId("browser"));
});
