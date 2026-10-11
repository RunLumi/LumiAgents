import assert from "node:assert/strict";
import test from "node:test";
import { createLumiManagedToolAdmission } from "./lumiManagedToolAdmission.js";

function harness(hostSessionId: string | null = "ses-1") {
  const leases = new Map<string, any>();
  const calls: string[] = [];
  const lease: any = {
    context: { runId: "run-1" },
    modelAlias: "m",
    workspaceIdentity: "w",
    hostSessionId: hostSessionId ?? undefined,
    deviceOwner: {
      requestManagedToolDecision: async () => {
        calls.push("decide");
        leases.delete("run-1");
        return { decision: "allow" };
      },
      reportManagedToolResult: async () => {
        calls.push("report");
      },
    },
  };
  leases.set("run-1", lease);
  const admission = createLumiManagedToolAdmission<any>({
    lease: (runId) => leases.get(runId),
    authorize: async () => {
      calls.push("authorize");
    },
    resolveIdentity: (async () => undefined) as never,
  });
  return { admission, leases, calls, lease };
}
const params = { sessionId: "ses-1", context: { runId: "run-1", organizationId: "org" } } as any;

test("tool admission refuses an unbound or mismatched host session before authorizing", async () => {
  const unbound = harness(null);
  await assert.rejects(
    unbound.admission.reportManagedToolResult({ workspaceIdentity: "w", params }),
    /lumi_managed_result_refused/,
  );
  const mismatched = harness("other");
  await assert.rejects(
    mismatched.admission.resolveManagedToolIdentity({ workspaceIdentity: "w", params }),
    /lumi_identity_refused/,
  );
  assert.deepEqual([...unbound.calls, ...mismatched.calls], []);
});

test("tool admission re-checks the exact live lease after the awaited decision", async () => {
  const { admission, calls } = harness();
  await assert.rejects(
    admission.requestManagedToolDecision({ workspaceIdentity: "w", params }),
    /lumi_managed_auth_refused/,
  );
  assert.deepEqual(calls, ["authorize", "decide"]);
});

test("identity resolution returns null for an unreviewed tool while the lease is live", async () => {
  const { admission } = harness();
  assert.deepEqual(await admission.resolveManagedToolIdentity({ workspaceIdentity: "w", params }), {
    runId: "run-1",
    identity: null,
  });
});
