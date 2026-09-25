import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import type { BrowserCommand } from "./browser-use/commands.js";
import {
  authorizeBrowserComputerAction,
  validateManagedPolicyEvaluation,
} from "./managed-policy-authorization.js";
import {
  managedInvocationFingerprintInput,
  summarizeBrowserPolicyCommand,
} from "./managed-policy-fingerprint.js";
import type {
  BrowserComputerPolicyGate,
  ManagedPolicyContext,
  ManagedPolicyRequest,
} from "./p05-browser-computer-policy.js";

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

function browserFingerprint(command: BrowserCommand): string {
  return createHash("sha256")
    .update(
      managedInvocationFingerprintInput({
        surface: "browser",
        sessionId: "session_test",
        turnId: "turn_test",
        toolName: "browser",
        argumentsSummary: summarizeBrowserPolicyCommand(command),
        payload: command,
      }),
    )
    .digest("hex");
}

function request(overrides: Partial<ManagedPolicyRequest> = {}): ManagedPolicyRequest {
  const command: BrowserCommand = { method: "navigate", url: "https://example.test/docs" };
  return {
    surface: "browser",
    sessionId: "session_test",
    turnId: "turn_test",
    workspaceKey: "workspace_test",
    requestId: "req_0123456789abcdef0123456789abcdef",
    toolName: "browser",
    invocationFingerprint: browserFingerprint(command),
    argumentsSummary: "method=navigate; host=example.test",
    managed: managedContext(),
    ...overrides,
  };
}

function allowResponse(context = managedContext(), extra: Record<string, unknown> = {}) {
  return {
    mode: "managed_organization" as const,
    decision: "allow" as const,
    runId: context.runId,
    toolCallId: context.toolCallId,
    toolId: context.toolId,
    toolFingerprint: context.toolFingerprint,
    invocationFingerprint: request().invocationFingerprint,
    policyVersion: 7,
    policyState: "ok" as const,
    ...extra,
  };
}

function gateReturning(response: unknown, overrides: Partial<BrowserComputerPolicyGate> = {}) {
  return {
    evaluate: () => response,
    ...overrides,
  } satisfies BrowserComputerPolicyGate;
}

test("accepts an exact, current managed allow", () => {
  const result = validateManagedPolicyEvaluation(request(), allowResponse());
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "managed_organization");
});

test("rejects a changed tool fingerprint before the decision is interpreted", () => {
  const result = validateManagedPolicyEvaluation(
    request(),
    allowResponse(managedContext(), { toolFingerprint: "sha256:changed" }),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.code, "tool_fingerprint_changed");
});

test("rejects a changed tool id", () => {
  const result = validateManagedPolicyEvaluation(
    request(),
    allowResponse(managedContext(), { toolId: "tool_other" }),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.code, "tool_id_changed");
});

test("rejects a decision bound to another run or tool call", () => {
  const otherRun = validateManagedPolicyEvaluation(
    request(),
    allowResponse(managedContext(), { runId: "run_other" }),
  );
  assert.equal(otherRun.allowed, false);
  assert.equal(otherRun.code, "run_mismatch");

  const otherCall = validateManagedPolicyEvaluation(
    request(),
    allowResponse(managedContext(), { toolCallId: "tcl_other" }),
  );
  assert.equal(otherCall.allowed, false);
  assert.equal(otherCall.code, "tool_call_mismatch");
});

test("rejects a decision bound to another invocation", () => {
  const result = validateManagedPolicyEvaluation(
    request(),
    allowResponse(managedContext(), { invocationFingerprint: "0".repeat(64) }),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.code, "binding_mismatch");
});

test("fails closed on a stale policy version", () => {
  const result = validateManagedPolicyEvaluation(
    request({ expectedPolicyVersion: 6 }),
    allowResponse(),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.code, "policy_version_mismatch");
});

test("fails closed on an expired policy", () => {
  const result = validateManagedPolicyEvaluation(
    request(),
    allowResponse(managedContext(), { policyExpiresAt: "2020-01-01T00:00:00.000Z" }),
    new Date("2026-01-01T00:00:00.000Z"),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.code, "policy_expired");
});

test("fails closed on an expired approval", () => {
  const result = validateManagedPolicyEvaluation(
    request(),
    allowResponse(managedContext(), { approvalExpiresAt: "2020-01-01T00:00:00.000Z" }),
    new Date("2026-01-01T00:00:00.000Z"),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.code, "approval_expired");
});

test("fails closed on every non-ok policy state", () => {
  for (const policyState of ["missing", "schema_unsupported", "expired", "unavailable"]) {
    const result = validateManagedPolicyEvaluation(
      request(),
      allowResponse(managedContext(), { policyState }),
    );
    assert.equal(result.allowed, false, policyState);
    assert.equal(result.code, "policy_unavailable", policyState);
  }
});

test("does not treat an approval requirement as executable", () => {
  for (const decision of ["require_session_approval", "require_per_use_approval"] as const) {
    const result = validateManagedPolicyEvaluation(
      request(),
      allowResponse(managedContext(), { decision }),
    );
    assert.equal(result.allowed, false, decision);
    assert.equal(result.code, "approval_required", decision);
  }
});

test("does not let a local response bypass managed context", () => {
  const result = validateManagedPolicyEvaluation(request(), { mode: "local_personal" });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "managed_context_required");
});

test("rejects a malformed or non-positive policy version", () => {
  for (const policyVersion of [0, -1, 1.5, undefined]) {
    const result = validateManagedPolicyEvaluation(
      request(),
      allowResponse(managedContext(), { policyVersion }),
    );
    assert.equal(result.allowed, false, String(policyVersion));
    assert.equal(result.code, "policy_invalid", String(policyVersion));
  }
});

test("managed authorization denies without a gate", async () => {
  const result = await authorizeBrowserComputerAction({ request: request() });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "policy_unavailable");
});

test("managed authorization denies when the gate transport throws", async () => {
  const result = await authorizeBrowserComputerAction({
    request: request(),
    gate: {
      evaluate: () => {
        throw new Error("device token rejected");
      },
    },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "policy_unavailable");
});

test("managed authorization allows a current allow from the gate", async () => {
  const result = await authorizeBrowserComputerAction({
    request: request(),
    gate: gateReturning(allowResponse()),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "managed_organization");
});

test("unmanaged execution stays local-personal and claims no managed authorization", async () => {
  const result = await authorizeBrowserComputerAction({
    request: request({ managed: undefined }),
  });
  assert.deepEqual(result, { allowed: true, mode: "local_personal" });
});

test("requireManagedPolicy denies when no managed run context can be resolved", async () => {
  const result = await authorizeBrowserComputerAction({
    request: request({ managed: undefined }),
    requireManagedPolicy: true,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "managed_context_required");
});

test("a gate-resolved managed context still requires a current allow", async () => {
  const context = managedContext();
  const result = await authorizeBrowserComputerAction({
    request: request({ managed: undefined }),
    requireManagedPolicy: true,
    gate: gateReturning(allowResponse(context), { resolveManagedContext: () => context }),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "managed_organization");
});

test("a broken managed context resolver fails closed", async () => {
  const result = await authorizeBrowserComputerAction({
    request: request({ managed: undefined }),
    gate: gateReturning(allowResponse(), {
      resolveManagedContext: () => {
        throw new Error("run state unavailable");
      },
    }),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "policy_unavailable");
});

test("an invalid managed context is refused before any transport call", async () => {
  let called = false;
  const result = await authorizeBrowserComputerAction({
    request: request({ managed: { mode: "managed_organization" } as ManagedPolicyContext }),
    gate: gateReturning(allowResponse(), {
      evaluate: () => {
        called = true;
        return allowResponse();
      },
    }),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "managed_context_invalid");
  assert.equal(called, false);
});

test("browser summaries expose the destination host but never page content", () => {
  assert.equal(
    summarizeBrowserPolicyCommand({
      method: "navigate",
      url: "https://Example.test/docs?q=secret",
    }),
    "method=navigate; host=example.test",
  );
  assert.equal(
    summarizeBrowserPolicyCommand({ method: "fill", ref: "e12", value: "hunter2" }),
    "method=fill",
  );
  assert.equal(
    summarizeBrowserPolicyCommand({ method: "evaluate", expression: "document.body.innerText" }),
    "method=evaluate",
  );
  assert.equal(
    summarizeBrowserPolicyCommand({ method: "handleDialog", accept: true, promptText: "secret" }),
    "method=handleDialog; sensitive=redacted",
  );
  assert.equal(
    summarizeBrowserPolicyCommand({
      method: "playwright",
      action: { name: "locator", selector: "#password", operation: "fill", value: "hunter2" },
    }),
    "method=playwright; action=locator; operation=fill",
  );
});

test("invocation fingerprints are stable, order independent, and content bound", () => {
  const fingerprint = (payload: unknown) =>
    createHash("sha256")
      .update(
        managedInvocationFingerprintInput({
          surface: "browser",
          sessionId: "session_test",
          toolName: "browser",
          argumentsSummary: "method=navigate; host=example.test",
          payload,
        }),
      )
      .digest("hex");

  assert.equal(
    fingerprint({ method: "navigate", url: "https://example.test" }),
    fingerprint({ url: "https://example.test", method: "navigate" }),
  );
  assert.notEqual(
    fingerprint({ method: "navigate", url: "https://example.test" }),
    fingerprint({ method: "navigate", url: "https://other.test" }),
  );
  assert.notEqual(
    fingerprint({ method: "navigate", url: "https://example.test" }),
    fingerprint({ method: "navigate", url: "https://example.test/x" }),
  );
});
