import assert from "node:assert/strict";
import { connect } from "node:net";
import test from "node:test";

import type { ComputerUseRuntime } from "@zcode/zcode-cua";
import type { BrowserComputerPolicyGate, ManagedPolicyContext } from "@zcode/shared";

import { createNodeReplCuaBroker, type NodeReplCuaPolicyOptions } from "./cua-broker.js";

/**
 * P05-INT-04: the CUA broker is the last boundary before
 * `ComputerUseRuntime.execute`. These tests pin the stop condition from the
 * packet: a denied, expired, or unbound decision must mean `runtime.execute` is
 * never called.
 */

const PLACEHOLDER_RESULT = { error: "Computer Use is not available in this build." };

function managedContext(overrides: Partial<ManagedPolicyContext> = {}): ManagedPolicyContext {
  return {
    mode: "managed_organization",
    orgId: "org_0123456789abcdef0123456789abcdef",
    projectId: "prj_0123456789abcdef0123456789abcdef",
    deviceId: "dvc_0123456789abcdef0123456789abcdef",
    agentSessionId: "rse_0123456789abcdef0123456789abcdef",
    runId: "run_0123456789abcdef0123456789abcdef",
    toolCallId: "tcl_0123456789abcdef0123456789abcdef",
    toolId: "tool_0123456789abcdef0123456789abcdef",
    toolFingerprint: "sha256:tool",
    capabilityIds: ["cap_computer"],
    riskClass: "computer",
    action: "computer",
    argumentsSummary: "method=cua.screenshot; scope=main",
    ...overrides,
  };
}

function createRuntime(): {
  runtime: ComputerUseRuntime;
  calls: Array<{ toolName: string }>;
} {
  const calls: Array<{ toolName: string }> = [];
  return {
    calls,
    runtime: {
      execute: async (input) => {
        calls.push({ toolName: input.toolName });
        return PLACEHOLDER_RESULT;
      },
      closeSession: async () => undefined,
      dispose: async () => undefined,
    },
  };
}

async function call(
  broker: { connection: { socketPath: string; token: string } },
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const socket = connect(broker.connection.socketPath);
  const chunks: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => chunks.push(chunk));
  const closed = new Promise<void>((resolve, reject) => {
    socket.once("end", () => resolve());
    socket.once("close", () => resolve());
    socket.once("error", reject);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  socket.write(`${JSON.stringify(payload)}\n`);
  await closed;
  socket.destroy();
  const line = Buffer.concat(chunks).toString("utf8").trim();
  return JSON.parse(line) as Record<string, unknown>;
}

function baseContext(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: "session_test",
    runtimeScope: "main",
    workspaceKey: "workspace_test",
    ...extra,
  };
}

async function withBroker(
  options: NodeReplCuaPolicyOptions,
  run: (input: {
    broker: { connection: { socketPath: string; token: string } };
    calls: Array<{ toolName: string }>;
  }) => Promise<void>,
): Promise<void> {
  const { runtime, calls } = createRuntime();
  const broker = createNodeReplCuaBroker({ runtime, ...options });
  await broker.ready;
  try {
    await run({ broker, calls });
  } finally {
    await broker.close();
  }
}

function denyGate(
  context: ManagedPolicyContext,
  extra: Record<string, unknown> = {},
): BrowserComputerPolicyGate {
  return {
    evaluate: (request) => ({
      mode: "managed_organization" as const,
      decision: "deny" as const,
      runId: context.runId,
      toolCallId: context.toolCallId,
      toolId: context.toolId,
      toolFingerprint: context.toolFingerprint,
      invocationFingerprint: request.invocationFingerprint,
      policyVersion: 4,
      policyState: "ok" as const,
      ...extra,
    }),
  };
}

function allowGate(
  context: ManagedPolicyContext,
  extra: Record<string, unknown> = {},
): BrowserComputerPolicyGate {
  return {
    evaluate: (request) => ({
      mode: "managed_organization" as const,
      decision: "allow" as const,
      runId: context.runId,
      toolCallId: context.toolCallId,
      toolId: context.toolId,
      toolFingerprint: context.toolFingerprint,
      invocationFingerprint: request.invocationFingerprint,
      policyVersion: 4,
      policyState: "ok" as const,
      ...extra,
    }),
  };
}

test("a managed deny never reaches runtime.execute", async () => {
  const context = managedContext();
  await withBroker({ policyGate: denyGate(context) }, async ({ broker, calls }) => {
    const response = await call(broker, {
      id: "cua-1",
      token: broker.connection.token,
      method: "cua.screenshot",
      input: {},
      context: baseContext({ managed: context }),
    });
    assert.equal(response.ok, false);
    assert.equal(response.reasonCode, "tool_denied");
    assert.equal(response.sideEffect, "none");
    assert.equal(calls.length, 0);
  });
});

test("a managed request without a gate is refused", async () => {
  const context = managedContext();
  await withBroker({}, async ({ broker, calls }) => {
    const response = await call(broker, {
      id: "cua-2",
      token: broker.connection.token,
      method: "cua.screenshot",
      input: {},
      context: baseContext({ managed: context }),
    });
    assert.equal(response.ok, false);
    assert.equal(response.reasonCode, "policy_unavailable");
    assert.equal(calls.length, 0);
  });
});

test("requireManagedPolicy refuses a call with no managed run context", async () => {
  await withBroker({ requireManagedPolicy: true }, async ({ broker, calls }) => {
    const response = await call(broker, {
      id: "cua-3",
      token: broker.connection.token,
      method: "cua.screenshot",
      input: {},
      context: baseContext(),
    });
    assert.equal(response.ok, false);
    assert.equal(response.reasonCode, "managed_context_required");
    assert.equal(calls.length, 0);
  });
});

test("an expired policy never reaches runtime.execute", async () => {
  const context = managedContext();
  await withBroker(
    { policyGate: allowGate(context, { policyExpiresAt: "2020-01-01T00:00:00.000Z" }) },
    async ({ broker, calls }) => {
      const response = await call(broker, {
        id: "cua-4",
        token: broker.connection.token,
        method: "cua.screenshot",
        input: {},
        context: baseContext({ managed: context }),
      });
      assert.equal(response.ok, false);
      assert.equal(response.reasonCode, "policy_expired");
      assert.equal(calls.length, 0);
    },
  );
});

test("a pending per-use approval is not executable", async () => {
  const context = managedContext();
  await withBroker(
    {
      policyGate: {
        evaluate: (request) => ({
          ...(allowGate(context).evaluate(request) as Record<string, unknown>),
          decision: "require_per_use_approval",
        }),
      },
    },
    async ({ broker, calls }) => {
      const response = await call(broker, {
        id: "cua-5",
        token: broker.connection.token,
        method: "cua.click",
        input: {},
        context: baseContext({ managed: context }),
      });
      assert.equal(response.ok, false);
      assert.equal(response.reasonCode, "approval_required");
      assert.equal(calls.length, 0);
    },
  );
});

test("a decision bound to another run never reaches runtime.execute", async () => {
  const context = managedContext();
  await withBroker(
    { policyGate: denyGate(context, { runId: "run_other" }) },
    async ({ broker, calls }) => {
      const response = await call(broker, {
        id: "cua-6",
        token: broker.connection.token,
        method: "cua.screenshot",
        input: {},
        context: baseContext({ managed: context }),
      });
      assert.equal(response.ok, false);
      assert.equal(response.reasonCode, "run_mismatch");
      assert.equal(calls.length, 0);
    },
  );
});

test("a gate transport failure fails closed", async () => {
  const context = managedContext();
  await withBroker(
    {
      policyGate: {
        evaluate: () => {
          throw new Error("device token rejected");
        },
      },
    },
    async ({ broker, calls }) => {
      const response = await call(broker, {
        id: "cua-7",
        token: broker.connection.token,
        method: "cua.screenshot",
        input: {},
        context: baseContext({ managed: context }),
      });
      assert.equal(response.ok, false);
      assert.equal(response.reasonCode, "policy_unavailable");
      assert.equal(calls.length, 0);
    },
  );
});

test("a current managed allow dispatches and the placeholder response is preserved", async () => {
  const context = managedContext();
  await withBroker({ policyGate: allowGate(context) }, async ({ broker, calls }) => {
    const response = await call(broker, {
      id: "cua-8",
      token: broker.connection.token,
      method: "cua.screenshot",
      input: { region: "screen" },
      context: baseContext({ managed: context }),
    });
    assert.equal(response.ok, true);
    // The policy guard does not make computer use executable: the staging
    // runtime's own unavailable result must pass through unchanged.
    assert.deepEqual(response.result, PLACEHOLDER_RESULT);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.toolName, "cua.screenshot");
  });
});

test("local-personal execution is unchanged when no gate is configured", async () => {
  await withBroker({}, async ({ broker, calls }) => {
    const response = await call(broker, {
      id: "cua-9",
      token: broker.connection.token,
      method: "cua.screenshot",
      input: {},
      context: baseContext(),
    });
    assert.equal(response.ok, true);
    assert.deepEqual(response.result, PLACEHOLDER_RESULT);
    assert.equal(calls.length, 1);
  });
});

test("an invalid client-declared managed context does not disable enforcement", async () => {
  const context = managedContext();
  await withBroker({ requireManagedPolicy: true }, async ({ broker, calls }) => {
    const response = await call(broker, {
      id: "cua-10",
      token: broker.connection.token,
      method: "cua.screenshot",
      input: {},
      context: baseContext({ managed: { mode: "managed_organization" } }),
    });
    assert.equal(response.ok, false);
    assert.equal(response.reasonCode, "managed_context_required");
    assert.equal(calls.length, 0);
  });
});

test("the broker still rejects an unauthorized token before policy runs", async () => {
  const context = managedContext();
  await withBroker({ policyGate: allowGate(context) }, async ({ broker, calls }) => {
    const response = await call(broker, {
      id: "cua-11",
      token: "wrong-token",
      method: "cua.screenshot",
      input: {},
      context: baseContext(),
    });
    assert.equal(response.ok, false);
    assert.equal(calls.length, 0);
  });
});
