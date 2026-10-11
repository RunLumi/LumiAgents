import assert from "node:assert/strict";
import test from "node:test";
import { P06AutomationFenceGuard } from "@zcode/shared";
import {
  LumiAutomationLeaseError,
  LumiAutomationLeaseHostTransport,
  LumiAutomationWireError,
  type LumiDeviceEnvelopeRequest,
} from "./automationLeaseTransport.js";

const hex = (letter: string) => letter.repeat(32);
const OCC = `occ_${hex("1")}`;
const AUT = `aut_${hex("2")}`;
const LSE = `lse_${hex("3")}`;
const RUN = `run_${hex("4")}`;
const RSE = `rse_${hex("5")}`;
const POL = `pol_${hex("6")}`;
const USR = `usr_${hex("7")}`;
const DVC = `dvc_${hex("8")}`;
const TOKEN = "lease-token-0123456789abcdef";
const FAR_FUTURE = "2999-01-01T00:00:00.000Z";

// Shapes below are copied from apps/api/src/routes/automations.rs (due_projection, claim_occurrence,
// renew_lease, start_grant, settle_occurrence, release_occurrence), not from the client schemas.
const dueItem = {
  occurrence_id: OCC,
  automation_id: AUT,
  project_id: `prj_${hex("9")}`,
  schedule_rule_id: `sch_${hex("a")}`,
  kind: "scheduled",
  off_peak_mode: "normal",
  policy_snapshot_id: POL,
  policy_version: 4,
  attempt: 0,
  scheduled_for_utc: "2026-10-08T01:00:00Z",
  state: "pending",
  lease_ttl_seconds: 300,
  heartbeat_interval_seconds: 30,
  required_capabilities: [],
  execution_policy: {
    model_alias: "coding-default",
    budget_id: null,
    tool_policy_scope: "project",
  },
};
const claimBody = {
  occurrence_id: OCC,
  attempt: 1,
  lease_id: LSE,
  lease_version: 1,
  lease_fence: 1,
  expires_at: FAR_FUTURE,
  state: "leased",
  lease_token: TOKEN,
};
const startBody = {
  occurrence_id: OCC,
  attempt: 1,
  run_id: RUN,
  agent_session_id: RSE,
  lease_id: LSE,
  lease_version: 1,
  lease_fence: 1,
  expires_at: FAR_FUTURE,
};

interface Call {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}

function fakeWorker(
  respond: (call: Call) => { status: number; body: unknown },
  calls: Call[] = [],
): LumiDeviceEnvelopeRequest {
  return async (path, method, body) => {
    const call = { path, method, ...(body === undefined ? {} : { body }) };
    calls.push(call);
    return respond(call);
  };
}

const principal = { kind: "user" as const, id: USR };
const wireRefusal = (error: unknown) => error instanceof LumiAutomationWireError;

test("a real-shaped due, claim, start, renew, settle sequence satisfies the fence guard", async () => {
  const calls: Call[] = [];
  const transport = new LumiAutomationLeaseHostTransport(
    fakeWorker((call) => {
      if (call.path.startsWith("/api/v1/devices/automations/due"))
        return { status: 200, body: { items: [dueItem], next_cursor: null, has_more: false } };
      if (call.path.endsWith("/claim")) return { status: 201, body: claimBody };
      if (call.path.endsWith("/start")) return { status: 201, body: startBody };
      if (call.path.endsWith("/renew"))
        return {
          status: 200,
          body: {
            lease_id: LSE,
            occurrence_id: OCC,
            lease_version: 2,
            lease_fence: 1,
            expires_at: FAR_FUTURE,
          },
        };
      return {
        status: 200,
        body: { occurrence_id: OCC, state: "succeeded", run_id: RUN, lease_id: LSE },
      };
    }, calls),
    () => DVC,
  );
  const guard = new P06AutomationFenceGuard();

  const [due] = await transport.listDue();
  assert.equal(due?.scheduledFor, "2026-10-08T01:00:00.000Z");
  guard.acceptClaim(await transport.claim(due!, principal));
  guard.acceptStart(await transport.start(OCC, guard.buildFenceRequest({})));
  guard.acceptRenew(await transport.renew(LSE, 1, guard.buildFenceRequest({})));
  assert.deepEqual(guard.currentFence, { leaseId: LSE, leaseVersion: 2, leaseFence: 1 });

  const grant = guard.toExecutionGrant();
  await transport.settle(OCC, grant.attempt, grant.runId, guard.buildFenceRequest({}), {
    outcome: "succeeded",
  });
  guard.markSettled();
  assert.equal(guard.phase, "settled");

  const settle = calls.find((call) => call.path.endsWith("/settle"))!;
  assert.equal("run_id" in settle.body!, false, "the Worker rejects an unknown run_id field");
  assert.equal(settle.body?.outcome, "succeeded");
  assert.equal(settle.body?.lease_token, TOKEN, "the token travels only in the body");
  assert.ok(
    calls.every((call) => !call.path.includes(TOKEN)),
    "never in a URL",
  );
});

test("a delayed renewal that moves the lease version backwards is refused by the guard", async () => {
  const guard = new P06AutomationFenceGuard();
  const transport = new LumiAutomationLeaseHostTransport(
    fakeWorker(() => ({ status: 201, body: claimBody })),
    () => DVC,
  );
  guard.acceptClaim(await transport.claim(dueItemRef(), principal));
  guard.acceptRenew(renewResponse(2));
  assert.throws(() => guard.acceptRenew(renewResponse(1)), /moved backwards/);
});

function dueItemRef() {
  return {
    occurrenceId: OCC,
    automationId: AUT,
    attempt: 0,
    scheduledFor: "2026-10-08T01:00:00.000Z",
    offPeakMode: "normal" as const,
    policySnapshotId: POL,
    policyVersion: 4,
    state: "pending",
    heartbeatIntervalSeconds: 30,
  };
}

function renewResponse(version: number) {
  return {
    occurrence_id: OCC,
    attempt: 1,
    lease: { lease_id: LSE, lease_version: version, lease_fence: 1, expires_at: FAR_FUTURE },
  };
}

test("refusals carry the stable server reason and never the lease token", async () => {
  const transport = new LumiAutomationLeaseHostTransport(
    fakeWorker(() => ({
      status: 409,
      body: {
        error: {
          code: "conflict",
          message: `secret ${TOKEN}`,
          details: { reason: "occurrence_already_claimed", existing_lease_id: LSE },
        },
      },
    })),
    () => DVC,
  );
  await assert.rejects(transport.claim(dueItemRef(), principal), (error: unknown) => {
    assert.ok(error instanceof LumiAutomationLeaseError);
    assert.equal(error.reason, "occurrence_already_claimed");
    assert.equal(error.status, 409);
    assert.equal(JSON.stringify(error).includes(TOKEN), false);
    assert.equal(error.message.includes(TOKEN), false);
    return true;
  });
  const garbled = new LumiAutomationLeaseHostTransport(
    fakeWorker(() => ({ status: 403, body: { error: { details: { reason: "Not A Code!" } } } })),
    () => DVC,
  );
  await assert.rejects(garbled.claim(dueItemRef(), principal), (error: unknown) => {
    assert.ok(error instanceof LumiAutomationLeaseError);
    assert.equal(error.reason, undefined, "free text is never promoted to a reason");
    return true;
  });
});

test("missing or contradictory facts fail closed instead of being invented", async () => {
  const noDevice = new LumiAutomationLeaseHostTransport(
    fakeWorker(() => ({ status: 201, body: claimBody })),
    () => undefined,
  );
  await assert.rejects(noDevice.claim(dueItemRef(), principal), wireRefusal);

  const otherOccurrence = new LumiAutomationLeaseHostTransport(
    fakeWorker(() => ({ status: 201, body: { ...claimBody, occurrence_id: `occ_${hex("e")}` } })),
    () => DVC,
  );
  await assert.rejects(otherOccurrence.claim(dueItemRef(), principal), wireRefusal);

  const noToken = new LumiAutomationLeaseHostTransport(
    fakeWorker(() => ({ status: 201, body: { ...claimBody, lease_token: undefined } })),
    () => DVC,
  );
  await assert.rejects(noToken.claim(dueItemRef(), principal), wireRefusal);

  const serviceAccount = new LumiAutomationLeaseHostTransport(
    fakeWorker(() => ({ status: 201, body: claimBody })),
    () => DVC,
  );
  const claim = await serviceAccount.claim(dueItemRef(), { kind: "service_account", id: USR });
  assert.throws(
    () => new P06AutomationFenceGuard().acceptClaim(claim),
    /principal is not executable/,
    "the guard still refuses a non-user principal the adapter faithfully relayed",
  );

  const noPolicy = new LumiAutomationLeaseHostTransport(
    fakeWorker(() => ({
      status: 200,
      body: { items: [{ ...dueItem, policy_snapshot_id: null }] },
    })),
    () => DVC,
  );
  await assert.rejects(noPolicy.listDue(), wireRefusal);

  for (const heartbeat of [undefined, 5, 61])
    await assert.rejects(
      new LumiAutomationLeaseHostTransport(
        fakeWorker(() => ({
          status: 200,
          body: { items: [{ ...dueItem, heartbeat_interval_seconds: heartbeat }] },
        })),
        () => DVC,
      ).listDue(),
      wireRefusal,
      "the heartbeat comes from the server inside the frozen 10-60 second bound, never a local default",
    );
});

// ORIGINAL FAILURE, retained (control-plane P06-CR-007). A real replay (`scheduler-json-fixed`)
// dispatched an occurrence whose policy was NULL, so `due` returned exactly this item, the client
// refused the list on every poll (`GET due` 200, then nothing) and never claimed. The refusal is
// correct and must stay: the Worker binds the policy at dispatch; the client never invents one.
test("the due item a policy-less dispatch emitted is refused and nothing is claimed", async () => {
  const calls: Call[] = [];
  const transport = new LumiAutomationLeaseHostTransport(
    fakeWorker((call) => {
      if (call.path.startsWith("/api/v1/devices/automations/due"))
        return {
          status: 200,
          body: {
            items: [
              { ...dueItem, state: "dispatching", policy_snapshot_id: null, policy_version: null },
            ],
            next_cursor: null,
            has_more: false,
          },
        };
      return { status: 201, body: claimBody };
    }, calls),
    () => DVC,
  );
  await assert.rejects(transport.listDue(), wireRefusal);
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/api/v1/devices/automations/due?limit=20"],
    "no claim, start or release request was ever sent",
  );
});

test("a malformed policy on a due item is refused BEFORE any claim can spend a server attempt", async () => {
  // These are strings/integers, so the old typeof check let them through; the claim decode
  // would then reject them AFTER the Worker had granted a lease.
  const bad: [string, Record<string, unknown>][] = [
    ["snapshot id not a pol_ id", { policy_snapshot_id: "x" }],
    ["snapshot id of another family", { policy_snapshot_id: `usr_${hex("6")}` }],
    ["snapshot id too short", { policy_snapshot_id: "pol_abc" }],
    ["snapshot id upper-case", { policy_snapshot_id: `pol_${"A".repeat(32)}` }],
    ["version zero", { policy_version: 0 }],
    ["version negative", { policy_version: -1 }],
    ["version fractional", { policy_version: 1.5 }],
    ["version a string", { policy_version: "4" }],
    ["snapshot id absent", { policy_snapshot_id: undefined }],
    ["version absent", { policy_version: undefined }],
    ["occurrence id of another family", { occurrence_id: `aut_${hex("1")}` }],
    ["negative attempt", { attempt: -1 }],
  ];
  for (const [name, patch] of bad) {
    const calls: Call[] = [];
    const transport = new LumiAutomationLeaseHostTransport(
      fakeWorker(() => ({ status: 200, body: { items: [{ ...dueItem, ...patch }] } }), calls),
      () => DVC,
    );
    await assert.rejects(transport.listDue(), wireRefusal, name);
    assert.equal(
      calls.some((call) => call.path.endsWith("/claim")),
      false,
      `${name}: never claimed`,
    );
  }
});

test("a populated server policy flows unchanged from due into the claimed occurrence", async () => {
  // Positive control for the two tests above: the same item with a real policy is accepted, and the
  // claim's occurrence carries the SERVER's snapshot, not a value derived on the device.
  const transport = new LumiAutomationLeaseHostTransport(
    fakeWorker((call) =>
      call.path.endsWith("/claim")
        ? { status: 201, body: claimBody }
        : { status: 200, body: { items: [{ ...dueItem, state: "dispatching" }] } },
    ),
    () => DVC,
  );
  const [due] = await transport.listDue();
  assert.equal(due?.policySnapshotId, POL);
  assert.equal(due?.policyVersion, 4);
  const claim = await transport.claim(due!, principal);
  assert.equal(claim.occurrence.policy_snapshot_id, POL);
  assert.equal(claim.occurrence.policy_version, 4);
  new P06AutomationFenceGuard().acceptClaim(claim);
});

test("settle refuses a response that names another run or state", async () => {
  const guard = new P06AutomationFenceGuard();
  const settleWith = (body: Record<string, unknown>) =>
    new LumiAutomationLeaseHostTransport(
      fakeWorker(() => ({ status: 200, body })),
      () => DVC,
    );
  const fence = {
    lease_id: LSE,
    lease_version: 1,
    lease_fence: 1,
    lease_token: TOKEN,
  };
  void guard;
  await assert.rejects(
    settleWith({
      occurrence_id: OCC,
      state: "succeeded",
      run_id: `run_${hex("f")}`,
      lease_id: LSE,
    }).settle(OCC, 1, RUN, fence, { outcome: "succeeded" }),
    wireRefusal,
  );
  await assert.rejects(
    settleWith({ occurrence_id: OCC, state: "failed", run_id: RUN, lease_id: LSE }).settle(
      OCC,
      1,
      RUN,
      fence,
      { outcome: "succeeded" },
    ),
    wireRefusal,
  );
});
