/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
import { ToolScheduler } from "../scheduler.js";
import { executeTools } from "../../runtime/methods/tools.js";
import { executeTurnToolSchedule } from "../../runtime/methods/turn-tool-execution.js";

test("turn tool boundary prevents a real file side effect without the managed broker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lumi-managed-tool-boundary-"));
  const path = join(directory, "sentinel.txt");
  try {
    await writeFile(path, "before");
    let handlerCalls = 0;
    const executor = createExecutor({
      entry: makeEntry(async () => {
        handlerCalls++;
        await writeFile(path, "after");
        return { ok: true };
      }, managedIdentity(currentFingerprint)),
    });
    const runtime = {
      executor,
      rootTraceContext: { traceId: "trace_fixture", sessionId, turnId: "turn_fixture" },
      createEvent: () => ({}),
      appendEvent: async () => {},
      executeTools,
    };
    const calls = [{ id: toolCallId, name: "PrivilegedTestTool", input: {} }];
    const schedule = new ToolScheduler().schedule([
      {
        toolCallId,
        toolName: "PrivilegedTestTool",
        dependsOn: [],
        destructive: true,
      },
    ]);
    // Local positive control proves that the handler and local permissions work.
    const local = await executeTurnToolSchedule(
      runtime as never,
      {
        model: { providerId: "fixture-local" } as never,
      },
      calls,
      schedule,
      {},
    );
    assert.equal(local.results[0].success, true);
    assert.equal(await readFile(path, "utf8"), "after");
    await writeFile(path, "before");
    const beforeCalls = handlerCalls;
    const managed = await executeTurnToolSchedule(
      runtime as never,
      {
        model: { providerId: "lumi-managed" } as never,
        managedContext: contractManagedContext(),
      },
      calls,
      schedule,
      {},
    );
    assert.equal(managed.results[0].success, false);
    assert.equal(handlerCalls, beforeCalls);
    assert.equal(await readFile(path, "utf8"), "before");
    assert.match(managed.results[0].error?.message ?? "", /managed.*decision/i);
    assert.throws(
      () =>
        executeTurnToolSchedule(
          runtime as never,
          {
            model: { providerId: "lumi-managed" } as never,
          },
          calls,
          schedule,
          {},
        ),
      /lumi_managed_tool_context_missing/,
    );
    assert.equal(handlerCalls, beforeCalls);
    // Execution context is per call: managed refusal cannot poison the next local turn.
    const localAgain = await executeTurnToolSchedule(
      runtime as never,
      {
        model: { providerId: "fixture-local" } as never,
      },
      calls,
      schedule,
      {},
    );
    assert.equal(localAgain.results[0].success, true);
    assert.equal(await readFile(path, "utf8"), "after");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

test("an installed reverse broker preserves local tool execution without per-turn managed context", async () => {
  let handlerCalls = 0;
  let brokerCalls = 0;
  const adapter = {
    ...createLumiManagedToolDecisionPortAdapter({
      requestDecision: async () => {
        brokerCalls++;
        throw new Error("unexpected broker call");
      },
    }),
    isManaged: () => false,
  };
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls++;
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    adapter,
  });
  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });
  assert.equal(result.success, true);
  assert.equal(handlerCalls, 1);
  assert.equal(brokerCalls, 0);
  const managed = await executor.execute(
    { id: toolCallId, name: "PrivilegedTestTool", input: {} },
    { managedContext: contractManagedContext() },
  );
  assert.equal(managed.success, false);
  assert.equal(brokerCalls, 1, "explicit managed context must override the local default");
  assert.equal(handlerCalls, 1, "broker refusal must precede handler I/O");
});

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
  assert.match(
    summaries[0] ?? "",
    new RegExp(
      `input_digest=${createHash("sha256").update(JSON.stringify(handlerInput)).digest("hex")}`,
    ),
  );
  assert.doesNotMatch(summaries[0] ?? "", /hook-modified/);
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

test("per-call reviewed resolution maps server ID without mutating shared runtime identity", async () => {
  let effects = 0,
    decisions = 0;
  const entry = makeEntry(
    async () => {
      effects++;
      return { ok: true };
    },
    { ...managedIdentity(currentFingerprint)!, catalogued: false },
  );
  const original = JSON.stringify(entry.managedIdentity),
    serverId = `tool_${"d".repeat(32)}`;
  const executor = createExecutor({
    entry,
    adapter: createLumiManagedToolDecisionAdapter({
      context: contractManagedContext(),
      resolveIdentity: async (request) => ({ ...request.tool, toolId: serverId, catalogued: true }),
      decide: async (request) => {
        decisions++;
        assert.equal(request.tool.toolId, serverId);
        return {
          decision: "allow",
          runId: request.context.runId,
          toolCallId: request.toolCallId,
          toolId: request.tool.toolId,
          toolFingerprint: request.tool.fingerprint,
          riskClass: request.tool.riskClass,
          policyVersion: 3,
          policyState: "ok",
          argumentsHash: request.argumentsHash,
        };
      },
    }),
  });
  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });
  assert.equal(result.success, true);
  assert.equal(effects, 1);
  assert.equal(decisions, 1);
  assert.equal(JSON.stringify(entry.managedIdentity), original);
});
test("unknown or changed catalog resolution cannot reach broker or handler", async () => {
  for (const patch of [
    undefined,
    { riskClass: "read_only" },
    { fingerprint: "d".repeat(64) },
    { source: "plugin" },
    { capabilityIds: [`cap_${"d".repeat(32)}`] },
    { name: "OtherTool" },
    { catalogued: false },
  ]) {
    let effects = 0,
      decisions = 0;
    const executor = createExecutor({
      entry: makeEntry(
        async () => {
          effects++;
          return { ok: true };
        },
        { ...managedIdentity(currentFingerprint)!, catalogued: false },
      ),
      adapter: createLumiManagedToolDecisionAdapter({
        context: contractManagedContext(),
        resolveIdentity: async (request) =>
          patch ? ({ ...request.tool, catalogued: true, ...patch } as never) : undefined,
        decide: async () => {
          decisions++;
          return { decision: "allow" };
        },
      }),
    });
    const result = await executor.execute({
      id: toolCallId,
      name: "PrivilegedTestTool",
      input: {},
    });
    assert.equal(result.success, false);
    assert.equal(effects, 0);
    assert.equal(decisions, 0);
  }
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

test("approval cannot authorize an input object mutated while waiting, with real file effects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lumi-managed-argument-binding-"));
  const path = join(directory, "sentinel.txt");
  const pendingInput = { operation: "write" };
  let mutate = false;
  let handlerCalls = 0;
  const approvalId = `apr_${"8".repeat(32)}`;
  try {
    await writeFile(path, "before");
    const adapter = createLumiManagedToolDecisionAdapter({
      context: contractManagedContext(),
      requireBoundResult: true,
      decide: async () => ({
        decision: "require_per_use_approval",
        approvalId,
        approvalMode: "per_use",
      }),
      waitForApproval: async (request) => {
        if (mutate) pendingInput.operation = "delete";
        return {
          decision: "allow",
          runId: request.context.runId,
          toolCallId: request.toolCallId,
          toolId: request.tool.toolId,
          toolFingerprint: request.tool.fingerprint,
          riskClass: request.tool.riskClass,
          policyVersion: 3,
          policyState: "ok",
          argumentsHash: request.argumentsHash,
          approvalId,
          approvalMode: "per_use",
          approvalExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    });
    const executor = createExecutor({
      entry: makeEntry(async () => {
        handlerCalls++;
        await writeFile(path, "after");
        return { ok: true };
      }, managedIdentity(currentFingerprint)),
      adapter,
    });
    const control = await executor.execute({
      id: toolCallId,
      name: "PrivilegedTestTool",
      input: pendingInput,
    });
    assert.equal(control.success, true);
    assert.equal(await readFile(path, "utf8"), "after");
    await writeFile(path, "before");
    mutate = true;
    const changed = await executor.execute({
      id: toolCallId,
      name: "PrivilegedTestTool",
      input: pendingInput,
    });
    assert.equal(changed.success, false);
    assert.equal(handlerCalls, 1);
    assert.equal(await readFile(path, "utf8"), "before");
    assert.match(changed.error?.message ?? "", /arguments_changed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a mutation between gate completion and handler admission is refused", async () => {
  const input = { operation: "write" };
  let handlerCalls = 0;
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls++;
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    adapter: createLumiManagedToolDecisionAdapter({
      context: { mode: "managed", runId: "run_fixture" },
      decide: async () => {
        queueMicrotask(() =>
          queueMicrotask(() => {
            input.operation = "delete";
          }),
        );
        return { decision: "allow" };
      },
    }),
  });
  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input });
  assert.equal(result.success, false);
  assert.equal(handlerCalls, 0);
  assert.match(result.error?.message ?? "", /arguments_changed/);
});

test("an asynchronous managed handler owns an isolated approved input snapshot", async () => {
  const input = { operation: "write" };
  let observed: unknown;
  const executor = createExecutor({
    entry: makeEntry(async (received) => {
      input.operation = "delete";
      await Promise.resolve();
      observed = received;
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    adapter: createLumiManagedToolDecisionAdapter({
      context: { mode: "managed", runId: "run_fixture" },
      decide: async () => ({ decision: "allow" }),
    }),
  });
  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input });
  assert.equal(result.success, true);
  assert.deepEqual(observed, { operation: "write" });
  assert.notEqual(observed, input);
});

test("a broker resolving after cancellation cannot enter the real file handler", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lumi-managed-tool-cancel-"));
  const path = join(directory, "sentinel.txt");
  const controller = new AbortController();
  let handlerCalls = 0;
  let handlerWrite = Promise.resolve();
  try {
    await writeFile(path, "before");
    const port: ManagedToolDecisionPort = {
      requestDecision: async (request) => {
        controller.abort();
        return {
          decision: "allow",
          runId: request.context.runId,
          toolCallId: request.toolCallId,
          toolId: request.tool.toolId,
          toolFingerprint: request.tool.fingerprint,
          riskClass: request.tool.riskClass,
          policyVersion: 3,
          policyState: "ok",
          argumentsHash: request.argumentsHash,
        };
      },
    };
    const executor = createExecutor({
      entry: makeEntry(async () => {
        handlerCalls++;
        handlerWrite = writeFile(path, "after");
        await handlerWrite;
        return { ok: true };
      }, managedIdentity(currentFingerprint)),
      adapter: createLumiManagedToolDecisionPortAdapter(port),
    });
    const result = await executor.execute(
      { id: toolCallId, name: "PrivilegedTestTool", input: {} },
      { managedContext: contractManagedContext(), signal: controller.signal },
    );
    // executeWithTimeout can report cancellation while its awaited gate still completes.
    // Drain that completion and measure actual handler I/O, not just the status.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await handlerWrite;
    assert.equal(result.success, false);
    assert.equal(handlerCalls, 0);
    assert.equal(await readFile(path, "utf8"), "before");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("managed handler completes once but tool success waits for result ACK without sending output", async () => {
  let handlerCalls = 0,
    reportCalls = 0,
    resolveAck = () => {},
    ready = () => {};
  const ack = new Promise<void>((resolve) => {
    resolveAck = resolve;
  });
  const reporting = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const entry = {
    ...makeEntry(async () => {
      handlerCalls++;
      return { ok: true, output: "PRIVATE_HANDLER_OUTPUT" };
    }, managedIdentity(currentFingerprint)),
    outputSchema: { type: "object", additionalProperties: true },
  };
  const adapter = createLumiManagedToolDecisionAdapter({
    context: contractManagedContext(),
    requireBoundResult: true,
    requireResultReporting: true,
    decide: async (request) => ({
      decision: "allow",
      runId: request.context.runId,
      toolCallId: request.toolCallId,
      toolId: request.tool.toolId,
      toolFingerprint: request.tool.fingerprint,
      riskClass: request.tool.riskClass,
      policyVersion: 3,
      policyState: "ok",
      argumentsHash: request.argumentsHash,
    }),
    reportResult: async (request, status) => {
      reportCalls++;
      assert.equal(status, "completed");
      assert.equal(JSON.stringify(request).includes("PRIVATE_HANDLER_OUTPUT"), false);
      ready();
      await ack;
    },
  });
  const executor = createExecutor({ entry, adapter });
  let completed = false;
  const execution = executor
    .execute({ id: toolCallId, name: "PrivilegedTestTool", input: { operation: "write" } })
    .then((result) => {
      completed = true;
      return result;
    });
  try {
    await Promise.race([
      reporting,
      execution.then(() => {
        throw new Error("completed without required reporting");
      }),
    ]);
    assert.equal(handlerCalls, 1);
    assert.equal(completed, false);
    assert.equal(reportCalls, 1);
    resolveAck();
    assert.equal((await execution).success, true);
    assert.equal(handlerCalls, 1);
  } finally {
    resolveAck();
  }
});

test("missing required reporter prevents handler and broker admission", async () => {
  let handlerCalls = 0,
    decisions = 0;
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls++;
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    adapter: createLumiManagedToolDecisionAdapter({
      context: contractManagedContext(),
      requireResultReporting: true,
      decide: async () => {
        decisions++;
        return { decision: "allow" };
      },
    }),
  });
  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });
  assert.equal(result.success, false);
  assert.equal(handlerCalls, 0);
  assert.equal(decisions, 0);
  assert.match(result.error?.message ?? "", /managed_result_reporting_unavailable/);
});

test("handler failure reports failed with no exception text", async () => {
  const statuses: string[] = [];
  const executor = createExecutor({
    entry: makeEntry(async () => {
      throw new Error("PRIVATE_HANDLER_EXCEPTION");
    }, managedIdentity(currentFingerprint)),
    adapter: createLumiManagedToolDecisionAdapter({
      context: { mode: "managed", runId: "run_fixture" },
      requireResultReporting: true,
      decide: async () => ({ decision: "allow" }),
      reportResult: async (request, status) => {
        statuses.push(status);
        assert.equal(JSON.stringify(request).includes("PRIVATE_HANDLER_EXCEPTION"), false);
      },
    }),
  });
  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });
  assert.equal(result.success, false);
  assert.deepEqual(statuses, ["failed"]);
});

test("failed report is unknown delivery and never retries the handler", async () => {
  let handlerCalls = 0,
    reports = 0;
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls++;
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    adapter: createLumiManagedToolDecisionAdapter({
      context: { mode: "managed", runId: "run_fixture" },
      requireResultReporting: true,
      decide: async () => ({ decision: "allow" }),
      reportResult: async () => {
        reports++;
        throw new Error("PRIVATE_REPORT_ERROR");
      },
    }),
  });
  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });
  assert.equal(result.success, false);
  assert.equal(handlerCalls, 1);
  assert.equal(reports, 1);
  assert.match(result.error?.message ?? "", /result delivery failed/);
  assert.doesNotMatch(result.error?.message ?? "", /PRIVATE_REPORT_ERROR/);
});

async function waitForCleanupReport(report: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      report,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("automatic cancellation report missing")), 1500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("managed admission and report wait do not consume native handler deadline", async () => {
  let handlerCalls = 0;
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 60));
  const entry = {
    ...makeEntry(async () => {
      handlerCalls++;
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    timeout: { kind: "timed" as const, defaultMs: 20, allowCallOverride: false },
  };
  const executor = createExecutor({
    entry,
    adapter: createLumiManagedToolDecisionAdapter({
      context: { mode: "managed", runId: "run_fixture" },
      requireResultReporting: true,
      decide: async () => {
        await pause();
        return { decision: "allow" };
      },
      reportResult: async () => {
        await pause();
      },
    }),
  });
  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });
  assert.equal(result.success, true);
  assert.equal(handlerCalls, 1);
});
test("native handler still times out after managed wait exclusion", async () => {
  const entry = {
    ...makeEntry(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    timeout: { kind: "timed" as const, defaultMs: 20, allowCallOverride: false },
  };
  const executor = createExecutor({
    entry,
    adapter: createLumiManagedToolDecisionAdapter({
      context: { mode: "managed", runId: "run_fixture" },
      decide: async () => ({ decision: "allow" }),
    }),
  });
  const result = await executor.execute({ id: toolCallId, name: "PrivilegedTestTool", input: {} });
  assert.equal(result.success, false);
  assert.match(result.error?.message ?? "", /timed out|timeout/i);
});

test("cancelled managed execution reports cancelled without raw failure detail", async () => {
  const controller = new AbortController();
  let ready = () => {};
  const reported = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const statuses: string[] = [];
  const executor = createExecutor({
    entry: makeEntry(async () => {
      controller.abort();
      throw new Error("PRIVATE_CANCEL_DETAIL");
    }, managedIdentity(currentFingerprint)),
    adapter: createLumiManagedToolDecisionAdapter({
      context: { mode: "managed", runId: "run_fixture" },
      requireResultReporting: true,
      decide: async () => ({ decision: "allow" }),
      reportResult: async (request, status) => {
        statuses.push(status);
        assert.equal(JSON.stringify(request).includes("PRIVATE_CANCEL_DETAIL"), false);
        ready();
      },
    }),
  });
  const execution = executor.execute(
    { id: toolCallId, name: "PrivilegedTestTool", input: {} },
    { signal: controller.signal },
  );
  await waitForCleanupReport(reported);
  assert.equal((await execution).success, false);
  assert.deepEqual(statuses, ["cancelled"]);
});

test("late allow after cancellation reports the claimed call cancelled without entering handler", async () => {
  const controller = new AbortController();
  let handlerCalls = 0,
    ready = () => {};
  const reported = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const statuses: string[] = [];
  const executor = createExecutor({
    entry: makeEntry(async () => {
      handlerCalls++;
      return { ok: true };
    }, managedIdentity(currentFingerprint)),
    adapter: createLumiManagedToolDecisionAdapter({
      context: { mode: "managed", runId: "run_fixture" },
      requireResultReporting: true,
      decide: async () => {
        controller.abort();
        return { decision: "allow" };
      },
      reportResult: async (_request, status) => {
        statuses.push(status);
        ready();
      },
    }),
  });
  const execution = executor.execute(
    { id: toolCallId, name: "PrivilegedTestTool", input: {} },
    { signal: controller.signal },
  );
  await waitForCleanupReport(reported);
  assert.equal((await execution).success, false);
  assert.equal(handlerCalls, 0);
  assert.deepEqual(statuses, ["cancelled"]);
});
