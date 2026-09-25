import assert from "node:assert/strict";
import test from "node:test";

import type { ManagedBrowserComputerPolicyContext } from "@zcode/contracts";
import type { BrowserComputerPolicyGate } from "@zcode/shared";

import { createProtocolBrowserControlBroker } from "./browser-control-broker.js";
import type { ZCodeProtocolAgentServerContext } from "./server-types.js";

/**
 * P05-INT-04: the protocol broker is the agent-side first guard. A refused
 * browser action must never be handed to `requestClient`, because once it is on
 * the protocol the desktop host is the only remaining checkpoint.
 */

const SESSION_ID = "session_test";

function managedContext(
  overrides: Partial<ManagedBrowserComputerPolicyContext> = {},
): ManagedBrowserComputerPolicyContext {
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

function createContext(): {
  context: ZCodeProtocolAgentServerContext;
  requests: Array<{ method: string; params: unknown }>;
} {
  const requests: Array<{ method: string; params: unknown }> = [];
  const context = {
    sessions: new Map([
      [
        SESSION_ID,
        {
          workspace: {
            workspaceKey: "workspace_test",
            workspacePath: "/tmp/workspace_test",
            workspaceIdentity: "workspace_identity_test",
          },
          deliveryKind: "desktop-continuous",
        },
      ],
    ]),
    requestClient: async (method: string, params: unknown) => {
      requests.push({ method, params });
      return { ok: true, elapsedMs: 1 };
    },
  } as unknown as ZCodeProtocolAgentServerContext;
  return { context, requests };
}

function decisionGate(
  context: ManagedBrowserComputerPolicyContext,
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
      policyVersion: 9,
      policyState: "ok" as const,
      ...extra,
    }),
  };
}

const navigate = { method: "navigate", url: "https://example.test/docs" } as const;

test("a managed deny never reaches the protocol transport", async () => {
  const managed = managedContext();
  const { context, requests } = createContext();
  const broker = createProtocolBrowserControlBroker(context, {
    policyGate: {
      evaluate: (request) => ({
        ...(decisionGate(managed).evaluate(request) as Record<string, unknown>),
        decision: "deny",
      }),
    },
  });

  const result = await broker.execute({
    browserId: "iab:test",
    browserGeneration: 1,
    sessionId: SESSION_ID,
    command: navigate,
    managed,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(result.error?.sideEffect, "none");
  assert.equal(requests.length, 0);
});

test("a managed request without a gate is refused before transport", async () => {
  const { context, requests } = createContext();
  const broker = createProtocolBrowserControlBroker(context);
  const result = await broker.execute({
    browserId: "iab:test",
    browserGeneration: 1,
    sessionId: SESSION_ID,
    command: navigate,
    managed: managedContext(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(requests.length, 0);
});

test("requireManagedPolicy refuses a call with no managed run context", async () => {
  const { context, requests } = createContext();
  const broker = createProtocolBrowserControlBroker(context, { requireManagedPolicy: true });
  const result = await broker.execute({
    browserId: "iab:test",
    browserGeneration: 1,
    sessionId: SESSION_ID,
    command: navigate,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(requests.length, 0);
});

test("an expired policy never reaches the protocol transport", async () => {
  const managed = managedContext();
  const { context, requests } = createContext();
  const broker = createProtocolBrowserControlBroker(context, {
    policyGate: decisionGate(managed, { policyExpiresAt: "2020-01-01T00:00:00.000Z" }),
  });
  const result = await broker.execute({
    browserId: "iab:test",
    browserGeneration: 1,
    sessionId: SESSION_ID,
    command: navigate,
    managed,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(requests.length, 0);
});

test("a current managed allow reaches the protocol transport", async () => {
  const managed = managedContext();
  const { context, requests } = createContext();
  const broker = createProtocolBrowserControlBroker(context, { policyGate: decisionGate(managed) });
  const result = await broker.execute({
    browserId: "iab:test",
    browserGeneration: 1,
    sessionId: SESSION_ID,
    command: navigate,
    managed,
  });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "interaction/browserExecute");
});

test("unmanaged local-personal execution is unchanged when no gate is configured", async () => {
  const { context, requests } = createContext();
  const broker = createProtocolBrowserControlBroker(context);
  const result = await broker.execute({
    browserId: "iab:test",
    browserGeneration: 1,
    sessionId: SESSION_ID,
    command: navigate,
  });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
});

test("cancelRequest is exempt so a running action stays cancellable", async () => {
  const { context, requests } = createContext();
  const broker = createProtocolBrowserControlBroker(context, { requireManagedPolicy: true });
  const result = await broker.execute({
    browserId: "iab:test",
    browserGeneration: 1,
    sessionId: SESSION_ID,
    command: { method: "cancelRequest", requestId: "req_other" },
  });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
});
