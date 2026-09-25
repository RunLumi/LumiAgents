/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { PermissionService } from "../../permission/service.js";
import { createToolRegistry } from "../registry.js";
import { createToolExecutor } from "./impl.js";
import type { ToolEntry } from "../types.js";
import {
  createLumiManagedToolDecisionAdapter,
  createLumiManagedToolDecisionPortAdapter,
} from "./managed-decision.js";
import type { ManagedToolDecisionPort, ManagedToolDecisionRequest } from "@zcode/contracts";

const sessionId = "session_test" as never;
const toolCallId = "tool_call_test" as never;

function makeEntry(
  handler: (input: unknown) => Promise<unknown>,
  managedIdentity?: ToolEntry["managedIdentity"],
): ToolEntry {
  return {
    capability: "Test privileged tool",
    inputSchema: {
      type: "object",
      properties: { operation: { type: "string" } },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      additionalProperties: false,
    },
    metadata: {
      name: "PrivilegedTestTool",
      readOnly: false,
      destructive: true,
      concurrentSafe: false,
      sideEffectScope: "system",
      riskLevel: "high",
      needsApproval: true,
      ...(managedIdentity ? { managedIdentity } : {}),
    },
    ...(managedIdentity ? { managedIdentity } : {}),
    permission: {
      permission: "execute",
      reason: "Privileged test operation",
      riskLevel: "high",
      sideEffectScope: "system",
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
    cancellation: {
      supported: true,
      cleanup: "bestEffort",
      userVisibleMessage: "cancelled",
    },
    trace: {
      required: true,
      propagateToAdapters: true,
      recordInput: "summary",
      recordOutput: "summary",
    },
    handler,
  } as unknown as ToolEntry;
}

function createExecutor(input: {
  entry: ToolEntry;
  adapter?: ReturnType<typeof createLumiManagedToolDecisionAdapter>;
  hookRunner?: { run: (...args: never[]) => Promise<unknown> };
  maxConcurrency?: number;
}) {
  const registry = createToolRegistry();
  registry.register(input.entry);
  return createToolExecutor({
    registry,
    permissionService: new PermissionService({
      allowedTools: new Set(["PrivilegedTestTool"]),
      disallowedTools: new Set(),
      autoApproveHighRisk: true,
      allowMediumRiskInAutoMode: true,
    }),
    permissionBroker: {
      requestPermission: async () => ({ decision: "deny" as const }),
    },
    emitEvent: async () => {},
    sessionId,
    getMode: () => "build",
    getWorkingDirectory: () => ".",
    getWorkspaceRoot: () => ".",
    ...(input.adapter ? { managedDecisionAdapter: input.adapter } : {}),
    ...(input.hookRunner ? { hookRunner: input.hookRunner as never } : {}),
    ...(input.maxConcurrency === undefined ? {} : { maxConcurrency: input.maxConcurrency }),
  });
}

function managedIdentity(fingerprint: string): ToolEntry["managedIdentity"] {
  return {
    toolId: `tool_${"a".repeat(32)}`,
    name: "PrivilegedTestTool",
    fingerprint,
    source: "built_in",
    riskClass: "destructive",
    capabilityIds: [],
    catalogued: true,
  };
}

const currentFingerprint = `sha256:${"b".repeat(64)}`;
const changedFingerprint = `sha256:${"c".repeat(64)}`;

function contractManagedContext() {
  return {
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
}

test("an explicit local-only context preserves unmanaged execution", async () => {
  let adapterCalls = 0;
  let handlerCalls = 0;
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls += 1;
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    adapter: createLumiManagedToolDecisionAdapter({
      context: { mode: "local", runId: "run_test" },
      decide: async () => {
        adapterCalls += 1;
        return { decision: "deny" };
      },
    }),
  });

  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });

  assert.equal(result.success, true);
  assert.equal(adapterCalls, 0);
  assert.equal(handlerCalls, 1);
});

test("a managed gate cannot be bypassed by a local allow", async () => {
  let handlerCalls = 0;
  const adapter = createLumiManagedToolDecisionAdapter({
    context: { mode: "managed", runId: "run_test" },
    decide: async () => ({ decision: "deny", reason: "tool_denied" }),
  });
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls += 1;
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    adapter,
  });

  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });

  assert.equal(result.success, false);
  assert.equal(handlerCalls, 0);
  assert.match(result.error?.message ?? "", /managed tool decision/i);
});

test("unmanaged local execution keeps the existing local allow behavior", async () => {
  let handlerCalls = 0;
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls += 1;
      return { ok: true };
    }),
  });

  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });

  assert.equal(result.success, true);
  assert.equal(handlerCalls, 1);
});

test("managed context is preserved when a batch is chunked", async () => {
  let handlerCalls = 0;
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls += 1;
      return { ok: true };
    }),
    maxConcurrency: 1,
  });

  const results = await executor.executeBatch(
    [
      { id: toolCallId, name: "PrivilegedTestTool", input: {} },
      { id: "tool_call_second" as never, name: "PrivilegedTestTool", input: {} },
    ],
    { managedContext: { mode: "managed", runId: "run_test" } },
  );

  assert.equal(
    results.every((result) => !result.success),
    true,
  );
  assert.equal(handlerCalls, 0);
});

test("managed decision re-evaluates hook-modified input", async () => {
  let handlerInput: unknown;
  const summaries: string[] = [];
  const adapter = createLumiManagedToolDecisionAdapter({
    context: { mode: "managed", runId: "run_test" },
    decide: async (request) => {
      summaries.push(request.argumentsSummary);
      return { decision: "allow", toolFingerprint: request.tool.fingerprint };
    },
  });
  const executor = createExecutor({
    entry: makeEntry(async (input) => {
      handlerInput = input;
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    adapter,
    hookRunner: {
      run: async () => ({ additionalContexts: [], updatedInput: { operation: "hook-modified" } }),
    },
  });

  const result = await executor.execute({
    id: toolCallId,
    name: "PrivilegedTestTool",
    input: { operation: "model-input" },
  });

  assert.equal(result.success, true);
  assert.deepEqual(handlerInput, { operation: "hook-modified" });
  assert.match(summaries[0] ?? "", /operation=hook-modified/);
  assert.doesNotMatch(summaries[0] ?? "", /model-input/);
});

test("a changed managed fingerprint is denied", async () => {
  let handlerCalls = 0;
  const adapter = createLumiManagedToolDecisionAdapter({
    context: { mode: "managed", runId: "run_test" },
    decide: async () => ({ decision: "allow", toolFingerprint: `sha256:${"d".repeat(64)}` }),
  });
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls += 1;
      return { ok: true };
    }, managedIdentity(changedFingerprint)),
    adapter,
  });

  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });

  assert.equal(result.success, false);
  assert.equal(handlerCalls, 0);
  assert.match(result.error?.message ?? "", /fingerprint/i);
});

test("an unknown privileged tool is denied before a permissive adapter can allow it", async () => {
  let adapterCalls = 0;
  let handlerCalls = 0;
  const adapter = createLumiManagedToolDecisionAdapter({
    context: { mode: "managed", runId: "run_test" },
    decide: async () => {
      adapterCalls += 1;
      return { decision: "allow" };
    },
  });
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls += 1;
      return { ok: true };
    }),
    adapter,
  });

  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });

  assert.equal(result.success, false);
  assert.equal(adapterCalls, 0);
  assert.equal(handlerCalls, 0);
  assert.match(result.error?.message ?? "", /unknown|managed/i);
});

test("a contract-shaped port is adapted and requires an exact bound allow", async () => {
  let observedRequest: ManagedToolDecisionRequest | undefined;
  const port: ManagedToolDecisionPort = {
    requestDecision: async (request) => {
      observedRequest = request;
      return {
        decision: "allow",
        runId: request.context.runId,
        toolCallId: request.toolCallId,
        toolId: request.tool.toolId,
        toolFingerprint: request.tool.fingerprint,
        riskClass: request.tool.riskClass,
        policyVersion: 3,
        policyState: "ok",
      };
    },
  };
  const executor = createExecutor({
    entry: makeEntry(async () => ({ ok: true }), managedIdentity(currentFingerprint)),
    adapter: createLumiManagedToolDecisionPortAdapter(port),
  });

  const result = await executor.execute(
    { id: toolCallId, name: "PrivilegedTestTool", input: {} },
    { managedContext: contractManagedContext() },
  );

  assert.equal(result.success, true);
  assert.equal(observedRequest?.context.executionMode, "managed");
  assert.equal(observedRequest?.toolCallId.startsWith("tcl_"), true);
  assert.equal(
    observedRequest?.argumentsHash,
    createHash("sha256")
      .update(observedRequest?.argumentsSummary ?? "")
      .digest("hex"),
  );
});

test("a full managed context cannot be authorized by an unbound allow", async () => {
  let handlerCalls = 0;
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls += 1;
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    adapter: createLumiManagedToolDecisionAdapter({
      context: contractManagedContext(),
      decide: async () => ({ decision: "allow" }),
    }),
  });

  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });

  assert.equal(result.success, false);
  assert.equal(handlerCalls, 0);
  assert.match(result.error?.message ?? "", /managed tool decision/i);
});
