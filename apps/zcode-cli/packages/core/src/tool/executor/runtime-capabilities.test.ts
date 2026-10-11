/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ManagedRuntimeCapabilities, ManagedToolDecisionPort } from "@zcode/contracts";
import { PermissionService } from "../../permission/service.js";
import { createToolRegistry } from "../registry.js";
import type { ToolEntry } from "../types.js";
import { createToolExecutor } from "./impl.js";
import { createLumiManagedToolDecisionPortAdapter } from "./managed-decision.js";
import { summarizeRuntimeCapabilities } from "./runtime-capabilities.js";

const none: ManagedRuntimeCapabilities = {
  filesystem_write: false,
  process_execution: false,
  network_access: false,
  mcp_execution: false,
  browser_use: false,
  computer_use: false,
};

test("snapshot re-evaluates changed metadata on the same registered entry", () => {
  const registry = createToolRegistry();
  const tool = entry("MutableFixture", { sideEffectScope: "workspace" });
  registry.register(tool);
  assert.equal(summarizeRuntimeCapabilities(registry).filesystem_write, true);
  Object.assign(tool.metadata!, { readOnly: true, needsApproval: false });
  assert.deepEqual(summarizeRuntimeCapabilities(registry), none);
});

function entry(
  name: string,
  metadata: Record<string, unknown>,
  handler: ToolEntry["handler"] = async () => ({ ok: true }),
): ToolEntry {
  return {
    capability: `${name} fixture`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
    metadata: {
      name,
      readOnly: false,
      destructive: false,
      concurrentSafe: false,
      riskLevel: "medium",
      needsApproval: true,
      ...metadata,
    },
    permission: {
      permission: "execute",
      reason: "fixture",
      riskLevel: "medium",
      sideEffectScope: "workspace",
      needsApproval: true,
      patternSources: ["toolName"],
      denyPriority: "beforeAsk",
    },
    resultBudget: {
      maxInlineBytes: 16_384,
      maxModelBytes: 16_384,
      strategy: "truncate",
      preview: { direction: "head" },
    },
    timeout: { kind: "timed", defaultMs: 1_000, allowCallOverride: false },
    cancellation: { supported: true, cleanup: "bestEffort", userVisibleMessage: "cancelled" },
    trace: {
      required: true,
      propagateToAdapters: true,
      recordInput: "summary",
      recordOutput: "summary",
    },
    handler,
  } as unknown as ToolEntry;
}

test("snapshot reflects only model-visible registered tool classes and is all-false when empty", () => {
  const registry = createToolRegistry();
  assert.deepEqual(summarizeRuntimeCapabilities(registry), none);

  registry.register(entry("ReadFixture", { readOnly: true, needsApproval: false }));
  assert.deepEqual(summarizeRuntimeCapabilities(registry), none);

  registry.register(entry("WriteFixture", { sideEffectScope: "workspace" }));
  registry.register(entry("NetFixture", { sideEffectScope: "network" }));
  // A hidden tool is not exposed to the model and must not claim availability.
  registry.register(entry("HiddenShell", { sideEffectScope: "system", providerVisible: false }));
  assert.deepEqual(summarizeRuntimeCapabilities(registry), {
    ...none,
    filesystem_write: true,
    network_access: true,
  });

  registry.register(entry("ShellFixture", { sideEffectScope: "system" }));
  assert.equal(summarizeRuntimeCapabilities(registry).process_execution, true);

  // Unregistering removes the claim: the snapshot is derived, never cached state.
  registry.unregister("WriteFixture");
  assert.equal(summarizeRuntimeCapabilities(registry).filesystem_write, false);
});

test("snapshot contains only the six strict booleans and no tool names, paths or schemas", () => {
  const registry = createToolRegistry();
  registry.register(entry("/secret/path/Tool", { sideEffectScope: "workspace" }));
  const snapshot = summarizeRuntimeCapabilities(registry);
  assert.deepEqual(Object.keys(snapshot).sort(), Object.keys(none).sort());
  assert.ok(Object.values(snapshot).every((value) => typeof value === "boolean"));
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|path|Tool/);
});

const context = {
  organizationId: `org_${"1".repeat(32)}`,
  projectId: `prj_${"2".repeat(32)}`,
  deviceId: `dvc_${"3".repeat(32)}`,
  agentSessionId: `rse_${"4".repeat(32)}`,
  runId: `run_${"5".repeat(32)}`,
  agentDefinitionId: `agd_${"6".repeat(32)}`,
  agentDefinitionVersion: 1,
  requestId: `req_${"7".repeat(32)}`,
  executionMode: "managed" as const,
};

function gate(input: {
  directory: string;
  port: ManagedToolDecisionPort;
  registerReadOnly?: boolean;
}) {
  const registry = createToolRegistry();
  const path = join(input.directory, "sentinel.txt");
  let handlerCalls = 0;
  const written = entry("WriteFixture", { sideEffectScope: "workspace" }, async () => {
    handlerCalls++;
    await writeFile(path, "after");
    return { ok: true };
  });
  registry.register({
    ...written,
    // Catalogued identity so the only variable under test is the capability report.
    managedIdentity: {
      toolId: `tool_${"a".repeat(32)}`,
      name: "WriteFixture",
      fingerprint: `sha256:${"b".repeat(64)}`,
      source: "built_in",
      riskClass: "filesystem_write",
      capabilityIds: [],
      catalogued: true,
    },
  });
  if (input.registerReadOnly)
    registry.register(entry("ReadFixture", { readOnly: true, needsApproval: false }));
  const executor = createToolExecutor({
    registry,
    permissionService: new PermissionService({
      allowedTools: new Set(["WriteFixture", "ReadFixture"]),
      disallowedTools: new Set(),
      autoApproveHighRisk: true,
      allowMediumRiskInAutoMode: true,
    }),
    permissionBroker: { requestPermission: async () => ({ decision: "deny" as const }) },
    emitEvent: async () => {},
    sessionId: "session_test" as never,
    getMode: () => "build",
    getWorkingDirectory: () => ".",
    getWorkspaceRoot: () => ".",
    managedDecisionAdapter: createLumiManagedToolDecisionPortAdapter(input.port),
  });
  return { executor, path, calls: () => handlerCalls };
}

function allowing(): ManagedToolDecisionPort["requestDecision"] {
  return async (request) => ({
    decision: "allow",
    runId: request.context.runId,
    toolCallId: request.toolCallId,
    toolId: request.tool.toolId,
    toolFingerprint: request.tool.fingerprint,
    riskClass: request.tool.riskClass,
    policyVersion: 1,
    policyState: "ok",
  });
}

test("a refused runtime capability report prevents broker admission and the real file effect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lumi-capability-gate-"));
  try {
    let brokerCalls = 0;
    const fixture = gate({
      directory,
      port: {
        reportRuntimeCapabilities: async () => {
          throw new Error("stale lease");
        },
        requestDecision: async (request) => {
          brokerCalls++;
          return allowing()(request);
        },
      },
    });
    await writeFile(fixture.path, "before");
    const result = await fixture.executor.execute(
      { id: "tool_call_test" as never, name: "WriteFixture", input: {} },
      { managedContext: context },
    );
    assert.equal(result.success, false);
    assert.equal(brokerCalls, 0);
    assert.equal(fixture.calls(), 0);
    assert.equal(await readFile(fixture.path, "utf8"), "before");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the exact registry snapshot is reported once per run before admission and re-reported on change", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lumi-capability-gate-"));
  try {
    const order: string[] = [];
    const reported: ManagedRuntimeCapabilities[] = [];
    const fixture = gate({
      directory,
      registerReadOnly: true,
      port: {
        reportRuntimeCapabilities: async (request) => {
          order.push("report");
          reported.push(request.capabilities);
          assert.equal(request.context.runId, context.runId);
          assert.equal(request.traceId, request.trace.traceId);
        },
        requestDecision: async (request) => {
          order.push("decision");
          return allowing()(request);
        },
        reportResult: async () => {
          order.push("result");
        },
      },
    });
    const run = () =>
      fixture.executor.execute(
        { id: "tool_call_test" as never, name: "WriteFixture", input: {} },
        { managedContext: context },
      );
    assert.equal((await run()).success, true);
    assert.equal((await run()).success, true);
    assert.equal(fixture.calls(), 2);
    assert.equal(await readFile(fixture.path, "utf8"), "after");
    // Unchanged snapshot is not re-sent; report always precedes the decision.
    assert.deepEqual(order, ["report", "decision", "result", "decision", "result"]);
    assert.deepEqual(reported, [{ ...none, filesystem_write: true }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("read-only managed calls do not depend on the capability report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lumi-capability-gate-"));
  try {
    let reports = 0;
    const fixture = gate({
      directory,
      registerReadOnly: true,
      port: {
        reportRuntimeCapabilities: async () => {
          reports++;
          throw new Error("unavailable");
        },
        requestDecision: allowing(),
      },
    });
    const result = await fixture.executor.execute(
      { id: "tool_call_test" as never, name: "ReadFixture", input: {} },
      { managedContext: context },
    );
    assert.equal(reports, 0);
    assert.equal(result.success, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
