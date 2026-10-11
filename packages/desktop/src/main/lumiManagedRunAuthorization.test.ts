import test from "node:test";
import assert from "node:assert/strict";
import {
  assertManagedRunLeaseMatch,
  assertManagedRunLeaseCurrent,
} from "./lumiManagedRunAuthorization.js";

const suffix = "0123456789abcdef0123456789abcdef";
const context = {
  organizationId: `org_${suffix}`,
  projectId: `prj_${suffix}`,
  deviceId: `dvc_${suffix}`,
  agentSessionId: `rse_${suffix}`,
  runId: `run_${suffix}`,
  agentDefinitionId: `agd_${suffix}`,
  agentDefinitionVersion: 2,
  requestId: `req_${suffix}`,
  executionMode: "managed" as const,
  policySnapshotId: `pol_${suffix}`,
  policyVersion: 3,
};
const request = {
  sessionId: "zcode-session-1",
  workspaceIdentity: "/local/workspace",
  providerId: "lumi-managed",
  modelId: "coding-default",
  managedContext: context,
};
const lease = {
  context,
  workspaceIdentity: "/local/workspace",
  modelAlias: "coding-default",
};

test("managed auth is bound to the exact active run, alias and workspace", () => {
  assert.doesNotThrow(() => assertManagedRunLeaseMatch(lease, request));
  assert.throws(
    () => assertManagedRunLeaseMatch(lease, { ...request, workspaceIdentity: "/other" }),
    /lumi_managed_auth_refused/,
  );
  assert.throws(
    () => assertManagedRunLeaseMatch({ ...lease, hostSessionId: "zcode-session-2" }, request),
    /lumi_managed_auth_refused/,
  );
  assert.throws(
    () =>
      assertManagedRunLeaseMatch(lease, {
        ...request,
        managedContext: { ...context, runId: `run_${"9".repeat(32)}` },
      }),
    /lumi_managed_auth_refused/,
  );
});

test("late results lose authority when logout or settlement removes or replaces the lease", async () => {
  const leases = new Map([[context.runId, lease]]);
  const captured = leases.get(context.runId)!;
  assert.doesNotThrow(() => assertManagedRunLeaseCurrent(captured, leases.get(context.runId)));
  await Promise.resolve();
  leases.clear();
  assert.throws(
    () => assertManagedRunLeaseCurrent(captured, leases.get(context.runId)),
    /lumi_managed_auth_refused/,
  );
  leases.set(context.runId, { ...lease });
  assert.throws(
    () => assertManagedRunLeaseCurrent(captured, leases.get(context.runId)),
    /lumi_managed_auth_refused/,
  );
});
