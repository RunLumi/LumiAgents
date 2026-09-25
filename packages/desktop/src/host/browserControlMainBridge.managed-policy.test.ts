import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserCommand,
  BrowserComputerPolicyGate,
  ManagedPolicyContext,
} from "@zcode/shared";

import { createBrowserControlMainBridge } from "./browserControlMainBridge.js";

/**
 * P05-INT-04: the desktop host bridge is the authoritative pre-dispatch guard.
 * These tests pin the property that matters: a refused browser action must never
 * reach `postToMain`, so main never gets a chance to execute it.
 */

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
    capabilityIds: ["cap_browser"],
    riskClass: "browser",
    action: "browser",
    argumentsSummary: "method=navigate; host=example.test",
    ...overrides,
  };
}

const navigate: BrowserCommand = { method: "navigate", url: "https://example.test/docs" };

function createBridge(input: {
  gate?: BrowserComputerPolicyGate;
  requireManagedPolicy?: boolean;
  timeoutMs?: number;
}) {
  const posted: unknown[] = [];
  const bridge = createBrowserControlMainBridge({
    postToMain: (message) => {
      posted.push(message);
    },
    ...(input.gate ? { policyGate: input.gate } : {}),
    ...(input.requireManagedPolicy ? { requireManagedPolicy: true } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
  });
  return { bridge, posted };
}

function allowGate(context: ManagedPolicyContext): BrowserComputerPolicyGate {
  return {
    evaluate: (request) => ({
      mode: "managed_organization" as const,
      decision: "allow" as const,
      runId: context.runId,
      toolCallId: context.toolCallId,
      toolId: context.toolId,
      toolFingerprint: context.toolFingerprint,
      invocationFingerprint: request.invocationFingerprint,
      policyVersion: 3,
      policyState: "ok" as const,
    }),
  };
}
test("a managed deny never reaches main", async () => {
  const context = managedContext();
  const { bridge, posted } = createBridge({
    gate: {
      evaluate: (request) => ({
        mode: "managed_organization" as const,
        decision: "deny" as const,
        runId: context.runId,
        toolCallId: context.toolCallId,
        toolId: context.toolId,
        toolFingerprint: context.toolFingerprint,
        invocationFingerprint: request.invocationFingerprint,
        policyVersion: 3,
        policyState: "ok" as const,
      }),
    },
  });

  const result = await bridge.execute({
    sessionId: "session_test",
    command: navigate,
    managed: context,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(result.error?.sideEffect, "none");
  assert.equal(posted.length, 0);
  bridge.dispose();
});

test("a managed request without a gate is refused before transport", async () => {
  const { bridge, posted } = createBridge({});
  const result = await bridge.execute({
    sessionId: "session_test",
    command: navigate,
    managed: managedContext(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(posted.length, 0);
  bridge.dispose();
});

test("requireManagedPolicy refuses a run with no managed context", async () => {
  const { bridge, posted } = createBridge({ requireManagedPolicy: true });
  const result = await bridge.execute({ sessionId: "session_test", command: navigate });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(posted.length, 0);
  bridge.dispose();
});

test("an expired policy is refused before transport", async () => {
  const context = managedContext();
  const { bridge, posted } = createBridge({
    gate: {
      evaluate: (request) => ({
        mode: "managed_organization" as const,
        decision: "allow" as const,
        runId: context.runId,
        toolCallId: context.toolCallId,
        toolId: context.toolId,
        toolFingerprint: context.toolFingerprint,
        invocationFingerprint: request.invocationFingerprint,
        policyVersion: 3,
        policyState: "ok" as const,
        policyExpiresAt: "2020-01-01T00:00:00.000Z",
      }),
    },
  });
  const result = await bridge.execute({
    sessionId: "session_test",
    command: navigate,
    managed: context,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(posted.length, 0);
  bridge.dispose();
});

test("a pending per-use approval is not executable", async () => {
  const context = managedContext();
  const { bridge, posted } = createBridge({
    gate: {
      evaluate: (request) => ({
        mode: "managed_organization" as const,
        decision: "require_per_use_approval" as const,
        runId: context.runId,
        toolCallId: context.toolCallId,
        toolId: context.toolId,
        toolFingerprint: context.toolFingerprint,
        invocationFingerprint: request.invocationFingerprint,
        policyVersion: 3,
        policyState: "ok" as const,
        approvalId: "apr_0123456789abcdef0123456789abcdef",
      }),
    },
  });
  const result = await bridge.execute({
    sessionId: "session_test",
    command: navigate,
    managed: context,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(posted.length, 0);
  bridge.dispose();
});

test("a decision bound to another tool fingerprint is refused", async () => {
  const context = managedContext();
  const { bridge, posted } = createBridge({
    gate: {
      evaluate: (request) => ({
        ...(allowGate(context).evaluate(request) as Record<string, unknown>),
        toolFingerprint: "sha256:tampered",
      }),
    },
  });
  const result = await bridge.execute({
    sessionId: "session_test",
    command: navigate,
    managed: context,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(posted.length, 0);
  bridge.dispose();
});

test("a current managed allow reaches main and correlates by requestId", async () => {
  const context = managedContext();
  const { bridge, posted } = createBridge({ gate: allowGate(context) });
  const pending = bridge.execute({
    requestId: "req_test",
    sessionId: "session_test",
    command: navigate,
    managed: context,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(posted.length, 1);
  assert.equal((posted[0] as { requestId: string }).requestId, "req_test");

  await bridge.handleResult({
    requestId: "req_test",
    result: {
      ok: true,
      state: {
        url: "https://example.test/docs",
        title: "Docs",
        canGoBack: false,
        canGoForward: false,
      },
      elapsedMs: 5,
    },
  });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.state?.url, "https://example.test/docs");
  bridge.dispose();
});

test("unmanaged local-personal execution is unchanged when no gate is configured", async () => {
  const { bridge, posted } = createBridge({});
  const pending = bridge.execute({
    requestId: "req_local",
    sessionId: "session_test",
    command: navigate,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(posted.length, 1);
  await bridge.handleResult({ requestId: "req_local", result: { ok: true, elapsedMs: 1 } });
  assert.equal((await pending).ok, true);
  bridge.dispose();
});

test("cancelRequest is exempt so a running action stays cancellable", async () => {
  const { bridge, posted } = createBridge({ requireManagedPolicy: true });
  const pending = bridge.execute({
    requestId: "req_cancel",
    sessionId: "session_test",
    command: { method: "cancelRequest", requestId: "req_other" },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(posted.length, 1);
  await bridge.handleResult({ requestId: "req_cancel", result: { ok: true, elapsedMs: 1 } });
  assert.equal((await pending).ok, true);
  bridge.dispose();
});

test("policy denial does not consume the requestId correlation slot", async () => {
  const context = managedContext({ argumentsSummary: "method=snapshot" });
  let call = 0;
  const gate: BrowserComputerPolicyGate = {
    evaluate: (request) => {
      call += 1;
      if (call === 1) return { mode: "managed_organization", decision: "deny" };
      return allowGate(context).evaluate(request);
    },
  };
  const { bridge, posted } = createBridge({ gate });
  const denied = await bridge.execute({
    requestId: "req_reuse",
    sessionId: "session_test",
    command: { method: "snapshot" },
    managed: context,
  });
  assert.equal(denied.error?.code, "policy_denied");
  assert.equal(posted.length, 0);

  const pending = bridge.execute({
    requestId: "req_reuse",
    sessionId: "session_test",
    command: { method: "snapshot" },
    managed: context,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await bridge.handleResult({ requestId: "req_reuse", result: { ok: true, elapsedMs: 1 } });
  assert.equal((await pending).ok, true);
  bridge.dispose();
});
