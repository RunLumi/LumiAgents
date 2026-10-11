import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationManagedAdoption } from "../session/automationManagedAdoption.js";
import {
  LumiAutomationLeaseError,
  LumiAutomationLeaseHostTransport,
  LumiAutomationWireError,
  type LumiDueOccurrence,
} from "./automationLeaseTransport.js";
import { createJournaledLeasePort } from "./automationJournaledLeases.js";
import {
  createManagedOccurrenceDriver,
  isStartRefusedBeforeStart,
  type OccurrenceDriverPorts,
} from "./automationOccurrenceDriver.js";

const hex = (letter: string) => letter.repeat(32);
const ORG = `org_${hex("a")}`;
const OCC = `occ_${hex("1")}`;
const MANAGED = `aut_${hex("2")}`;
const RUN = `run_${hex("4")}`;
const RSE = `rse_${hex("5")}`;
const POL = `pol_${hex("6")}`;
const USER = `usr_${hex("7")}`;
const FAR = "2999-01-01T00:00:00.000Z";

const due: LumiDueOccurrence = {
  occurrenceId: OCC,
  automationId: MANAGED,
  attempt: 0,
  scheduledFor: "2026-10-08T01:00:00.000Z",
  offPeakMode: "normal",
  policySnapshotId: POL,
  policyVersion: 4,
  state: "pending",
  heartbeatIntervalSeconds: 30,
};

const marker: AutomationManagedAdoption = {
  localAutomationId: "automation-local-1",
  orgId: ORG,
  managedAutomationId: MANAGED,
  state: "managed",
  origin: "created",
  idempotencyKey: "k",
  correlation: "lumi-local:automation-local-1",
  createdAt: 1,
  updatedAt: 1,
};

/** 一个最小的 Worker 租约状态机：单一 active 租约、围栏、ambiguous。 */
class FakeWorker {
  state: "pending" | "leased" | "started" | "succeeded" | "failed" | "ambiguous" = "pending";
  holder: string | null = null;
  version = 0;
  fence = 0;
  token = "";
  calls: { device: string; op: string }[] = [];
  claimRefusal: string | undefined;
  startRefusal: string | undefined;

  port(device: string): OccurrenceDriverPorts["leases"] {
    const refuse = (status: number, reason: string) => {
      throw new LumiAutomationLeaseError(status, reason);
    };
    const checkFence = (body: {
      lease_version: number;
      lease_fence: number;
      lease_token: string;
    }) => {
      if (this.state === "ambiguous") refuse(409, "occurrence_ambiguous");
      if (
        this.holder !== device ||
        body.lease_token !== this.token ||
        body.lease_version !== this.version ||
        body.lease_fence !== this.fence
      )
        refuse(409, "lease_fence_invalid");
    };
    return {
      listDue: async () => [due],
      claim: async (item, principal) => {
        this.calls.push({ device, op: "claim" });
        if (this.claimRefusal) refuse(403, this.claimRefusal);
        if (this.state !== "pending") refuse(409, "occurrence_already_claimed");
        this.state = "leased";
        this.holder = device;
        this.version = 1;
        this.fence = 1;
        this.token = `token-${device}-0123456789abcdef`;
        return {
          occurrence: {
            occurrence_id: item.occurrenceId,
            automation_id: item.automationId,
            attempt: 1,
            scheduled_for: item.scheduledFor,
            off_peak_mode: item.offPeakMode,
            policy_snapshot_id: item.policySnapshotId,
            policy_version: item.policyVersion,
            execution_principal: principal,
          },
          attempt: 1,
          device_id: `dvc_${hex("8")}`,
          lease: {
            lease_id: `lse_${hex("3")}`,
            lease_version: this.version,
            lease_fence: this.fence,
            expires_at: FAR,
          },
          lease_token: this.token,
        };
      },
      start: async (occurrenceId, body) => {
        this.calls.push({ device, op: "start" });
        checkFence(body);
        if (this.startRefusal) refuse(403, this.startRefusal);
        this.state = "started";
        return {
          occurrence_id: occurrenceId,
          attempt: 1,
          run_id: RUN,
          agent_session_id: RSE,
          lease_id: body.lease_id,
          lease_version: this.version,
          lease_fence: this.fence,
        };
      },
      renew: async (leaseId, _attempt, body) => {
        this.calls.push({ device, op: "renew" });
        checkFence(body);
        this.version += 1;
        return {
          occurrence_id: OCC,
          attempt: 1,
          lease: {
            lease_id: leaseId,
            lease_version: this.version,
            lease_fence: this.fence,
            expires_at: FAR,
          },
        };
      },
      settle: async (occurrenceId, attempt, _run, body, outcome) => {
        this.calls.push({ device, op: "settle" });
        checkFence(body);
        this.state = outcome.outcome;
        return {
          occurrence_id: occurrenceId,
          attempt,
          settled_state: outcome.outcome,
          lease_version: body.lease_version,
          lease_fence: body.lease_fence,
          idempotent: false,
        };
      },
      release: async (occurrenceId, attempt, body) => {
        this.calls.push({ device, op: "release" });
        checkFence(body);
        this.state = "pending";
        this.holder = null;
        return {
          occurrence_id: occurrenceId,
          attempt,
          released: true as const,
          lease_version: body.lease_version,
          lease_fence: body.lease_fence,
        };
      },
    };
  }
}

function driverFor(
  worker: FakeWorker,
  device: string,
  overrides: Partial<OccurrenceDriverPorts> = {},
) {
  return createManagedOccurrenceDriver({
    orgId: ORG,
    leases: worker.port(device),
    findMarkerByManagedId: async (_org, id) => (id === MANAGED ? marker : null),
    principalFor: async () => ({ kind: "user", id: USER }),
    currentPolicyVersion: async () => 4,
    ...overrides,
  });
}

test("a due adopted occurrence claims, starts, renews and settles through the guard", async () => {
  const worker = new FakeWorker();
  const { started, skipped } = await driverFor(worker, "A").poll();
  assert.equal(skipped.length, 0);
  const [handle] = started;
  assert.equal(handle?.grant.runId, RUN);
  assert.equal(handle?.heartbeatIntervalMs, 30_000);
  assert.equal(handle?.localAutomationId, "automation-local-1");
  assert.equal(
    JSON.stringify(handle).includes("token-A"),
    false,
    "the lease token never leaves the driver",
  );
  assert.deepEqual(
    worker.calls.map((call) => call.op),
    ["claim", "start"],
  );

  await handle!.renew();
  await handle!.settle({ outcome: "succeeded" });
  assert.equal(handle!.phase(), "settled");
  assert.equal(worker.state, "succeeded");
  await assert.rejects(
    handle!.settle({ outcome: "succeeded" }),
    "a settled attempt cannot settle twice",
  );
});

test("an occurrence of an automation not adopted here is never claimed", async () => {
  const worker = new FakeWorker();
  const driver = driverFor(worker, "A", { findMarkerByManagedId: async () => null });
  const { started, skipped } = await driver.poll();
  assert.equal(started.length, 0);
  assert.deepEqual(
    skipped.map((item) => item.code),
    ["not_adopted_here"],
  );
  assert.deepEqual(worker.calls, [], "no claim, so no server retry budget was spent");

  const releasing = driverFor(worker, "A", {
    findMarkerByManagedId: async () => ({ ...marker, state: "releasing" }),
  });
  assert.equal((await releasing.poll()).skipped[0]?.code, "not_adopted_here");
  assert.deepEqual(worker.calls, []);
});

test("two clients race one occurrence and exactly one executes", async () => {
  const worker = new FakeWorker();
  const [a, b] = await Promise.all([driverFor(worker, "A").poll(), driverFor(worker, "B").poll()]);
  const winners = [a, b].filter((result) => result.started.length === 1);
  const losers = [a, b].filter((result) => result.started.length === 0);
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.deepEqual(
    losers[0]?.skipped.map((item) => [item.code, item.reason]),
    [["lost_race", "occurrence_already_claimed"]],
  );
  const loserDevice = a.started.length === 0 ? "A" : "B";
  assert.deepEqual(
    worker.calls.filter((call) => call.device === loserDevice).map((call) => call.op),
    ["claim"],
    "the loser performed no start, renew or settle",
  );
});

test("a lost lease is terminal: ambiguity stops renewal and settlement and never replays", async () => {
  const worker = new FakeWorker();
  const handle = (await driverFor(worker, "A").poll()).started[0]!;
  worker.state = "ambiguous";
  await assert.rejects(
    handle.renew(),
    (error: unknown) => error instanceof LumiAutomationLeaseError,
  );
  assert.equal(handle.phase(), "ambiguous");
  const before = worker.calls.length;
  await assert.rejects(handle.settle({ outcome: "succeeded" }));
  await assert.rejects(handle.renew());
  assert.equal(worker.calls.length, before, "no further wire traffic after ambiguity");
});

test("a superseded holder cannot settle: the server fence is authoritative", async () => {
  const worker = new FakeWorker();
  const handle = (await driverFor(worker, "A").poll()).started[0]!;
  worker.holder = "B";
  await assert.rejects(handle.settle({ outcome: "succeeded" }), (error: unknown) => {
    assert.ok(error instanceof LumiAutomationLeaseError);
    assert.equal(error.reason, "lease_fence_invalid");
    return true;
  });
  assert.notEqual(worker.state, "succeeded");
});

test("a start refusal releases the lease and reports it without side effects", async () => {
  const worker = new FakeWorker();
  worker.startRefusal = "entitlement_not_granted";
  const { started, skipped } = await driverFor(worker, "A").poll();
  assert.equal(started.length, 0);
  assert.deepEqual(
    skipped.map((item) => [item.code, item.reason]),
    [["refused", "entitlement_not_granted"]],
  );
  assert.deepEqual(
    worker.calls.map((call) => call.op),
    ["claim", "start", "release"],
  );
  assert.equal(
    worker.state,
    "pending",
    "released before start, so it is claimable again by the server's rules",
  );
});

test("lost committed start response remains ambiguous with no release or retry", async () => {
  const worker = new FakeWorker();
  const port = worker.port("A");
  const start = port.start;
  port.start = async (...args) => {
    await start(...args);
    throw new Error("response lost");
  };
  const result = await driverFor(worker, "A", { leases: port }).poll();
  assert.equal(result.started.length, 0);
  assert.equal(result.skipped[0]?.code, "needs_reconciliation");
  assert.equal(worker.state, "started");
  assert.deepEqual(
    worker.calls.map((call) => call.op),
    ["claim", "start"],
  );
});

test("revocation and ineligibility are refusals; stale policy is refused before the claim", async () => {
  const revoked = new FakeWorker();
  revoked.claimRefusal = "device_not_eligible";
  const result = await driverFor(revoked, "A").poll();
  assert.deepEqual(
    result.skipped.map((item) => [item.code, item.reason]),
    [["refused", "device_not_eligible"]],
  );
  assert.deepEqual(
    revoked.calls.map((call) => call.op),
    ["claim"],
  );

  const stale = new FakeWorker();
  const staleResult = await driverFor(stale, "A", { currentPolicyVersion: async () => 5 }).poll();
  assert.deepEqual(
    staleResult.skipped.map((item) => [item.code, item.reason]),
    [["refused", "automation_policy_stale"]],
  );
  assert.deepEqual(stale.calls, [], "the claim (and its attempt budget) was never spent");
});

/** 真实传输层 + 只回放 Worker 投影的假请求端：用来验证真实线格式，而不是手写的内部形状。 */
function realTransportDriver(
  respond: (path: string) => { status: number; body: unknown },
  calls: string[],
) {
  const transport = new LumiAutomationLeaseHostTransport(
    async (path) => {
      calls.push(path);
      return respond(path);
    },
    () => `dvc_${hex("8")}`,
  );
  return createManagedOccurrenceDriver({
    orgId: ORG,
    leases: transport,
    findMarkerByManagedId: async () => marker,
    principalFor: async () => ({ kind: "user", id: USER }),
    currentPolicyVersion: async () => 4,
  });
}

const wireDue = {
  occurrence_id: OCC,
  automation_id: MANAGED,
  project_id: `prj_${hex("9")}`,
  schedule_rule_id: `sch_${hex("a")}`,
  kind: "scheduled",
  off_peak_mode: "normal",
  policy_snapshot_id: POL,
  policy_version: 4,
  attempt: 0,
  scheduled_for_utc: "2026-10-08T01:00:00Z",
  state: "dispatching",
  lease_ttl_seconds: 300,
  heartbeat_interval_seconds: 30,
  required_capabilities: [],
  execution_policy: {
    model_alias: "coding-default",
    budget_id: null,
    tool_policy_scope: "project",
  },
};

// ORIGINAL FAILURE, retained (control-plane P06-CR-007): the Worker dispatched with a NULL policy.
test("a policy-less dispatched occurrence is never claimed: the poll fails closed with no lease request", async () => {
  const calls: string[] = [];
  const driver = realTransportDriver(
    () => ({
      status: 200,
      body: { items: [{ ...wireDue, policy_snapshot_id: null, policy_version: null }] },
    }),
    calls,
  );
  await assert.rejects(driver.poll(), (error: unknown) => error instanceof LumiAutomationWireError);
  assert.deepEqual(
    calls,
    ["/api/v1/devices/automations/due?limit=20"],
    "only the list was requested",
  );
});

test("a start grant that is not a valid P06 grant is ambiguous: no release, no retry, no execution", async () => {
  // The Worker may already have created the run: an unreadable grant proves nothing about that, so
  // the device must NOT release (which would let another device take it) and must not run anything.
  for (const [name, startBody] of [
    [
      "missing run id",
      {
        occurrence_id: OCC,
        attempt: 1,
        lease_id: `lse_${hex("3")}`,
        lease_version: 1,
        lease_fence: 1,
      },
    ],
    [
      "run id of another family",
      {
        occurrence_id: OCC,
        attempt: 1,
        run_id: `usr_${hex("4")}`,
        agent_session_id: RSE,
        lease_id: `lse_${hex("3")}`,
        lease_version: 1,
        lease_fence: 1,
      },
    ],
    ["empty body", {}],
  ] as const) {
    const calls: string[] = [];
    const driver = realTransportDriver((path) => {
      if (path.startsWith("/api/v1/devices/automations/due"))
        return { status: 200, body: { items: [wireDue] } };
      if (path.endsWith("/claim"))
        return {
          status: 201,
          body: {
            occurrence_id: OCC,
            attempt: 1,
            lease_id: `lse_${hex("3")}`,
            lease_version: 1,
            lease_fence: 1,
            expires_at: FAR,
            state: "leased",
            lease_token: "lease-token-0123456789abcdef",
          },
        };
      return { status: 201, body: startBody };
    }, calls);
    const { started, skipped } = await driver.poll();
    assert.equal(started.length, 0, `${name}: nothing may execute`);
    assert.deepEqual(
      skipped.map((item) => item.code),
      ["needs_reconciliation"],
      name,
    );
    assert.equal(
      calls.some((path) => path.endsWith("/release")),
      false,
      `${name}: a possibly-started occurrence is never released`,
    );
    assert.deepEqual(
      calls.map((path) => path.split("/").pop()?.split("?")[0]),
      ["due", "claim", "start"],
      name,
    );
  }
});

test("a non-executable principal is refused before the claim spends the attempt budget", async () => {
  const worker = new FakeWorker();
  const driver = driverFor(worker, "A", {
    principalFor: async () => ({ kind: "service_account", id: USER }),
  });
  const { started, skipped } = await driver.poll();
  assert.equal(started.length, 0);
  assert.deepEqual(
    skipped.map((item) => [item.code, item.reason]),
    [["refused", "automation_execution_principal_unavailable"]],
  );
  assert.deepEqual(worker.calls, [], "no claim, start or release was sent");
});

test("a guard rejection after a granted claim returns the lease before any side effect", async () => {
  const worker = new FakeWorker();
  // The server grants a lease whose policy snapshot is older than the host's current policy.
  const ports = worker.port("A");
  const driver = createManagedOccurrenceDriver({
    orgId: ORG,
    leases: {
      ...ports,
      // listDue under-reports the version so the pre-claim check passes; the claim reveals the truth.
      listDue: async () => [{ ...due, policyVersion: 5 }],
      claim: async (item, principal) => {
        const claim = await ports.claim(item, principal);
        return { ...claim, occurrence: { ...claim.occurrence, policy_version: 3 } };
      },
    },
    findMarkerByManagedId: async () => marker,
    principalFor: async () => ({ kind: "user", id: USER }),
    currentPolicyVersion: async () => 4,
  });
  const { started, skipped } = await driver.poll();
  assert.equal(started.length, 0);
  assert.equal(skipped[0]?.reason, "automation_policy_stale");
  assert.deepEqual(
    worker.calls.map((call) => call.op),
    ["claim", "release"],
  );
  assert.equal(worker.state, "pending");
});

// ---------------------------------------------------------------------------
// DE2E-CLI-01: start refusal classification, race loser and off-peak, through the journal.
// ---------------------------------------------------------------------------

const wireClaim = {
  occurrence_id: OCC,
  attempt: 1,
  lease_id: `lse_${hex("3")}`,
  lease_version: 1,
  lease_fence: 1,
  expires_at: FAR,
  state: "leased",
  lease_token: "lease-token-0123456789abcdef",
};

const envelope = (reason: string, extra: Record<string, unknown> = {}) => ({
  error: { code: "conflict", message: "refused", details: { reason, ...extra } },
});

/** Real transport + the journaled port Main assembles + an in-memory journal (spec 07). */
function journaledWireDriver(respond: (path: string) => { status: number; body: unknown }) {
  const calls: string[] = [];
  const rows: { state: string; reason?: string }[] = [];
  const transport = new LumiAutomationLeaseHostTransport(
    async (path) => {
      calls.push(path.split("/").pop()?.split("?")[0] ?? path);
      return respond(path);
    },
    () => `dvc_${hex("8")}`,
  );
  const leases = createJournaledLeasePort({
    leases: transport,
    orgId: ORG,
    localIdFor: async () => marker.localAutomationId,
    journal: {
      async record(input) {
        rows.push({ state: input.state, ...(input.reason ? { reason: input.reason } : {}) });
      },
    },
  });
  const driver = createManagedOccurrenceDriver({
    orgId: ORG,
    leases,
    findMarkerByManagedId: async () => marker,
    principalFor: async () => ({ kind: "user", id: USER }),
    currentPolicyVersion: async () => 4,
  });
  return {
    calls,
    rows,
    async poll() {
      try {
        return await driver.poll();
      } finally {
        await leases.sweepUnconfirmed();
      }
    },
  };
}

function startRefusedWith(status: number, reason: string) {
  return (path: string) => {
    if (path.startsWith("/api/v1/devices/automations/due"))
      return { status: 200, body: { items: [wireDue] } };
    if (path.endsWith("/claim")) return { status: 201, body: wireClaim };
    if (path.endsWith("/start")) return { status, body: envelope(reason) };
    if (path.endsWith("/release"))
      return {
        status: 200,
        body: { occurrence_id: OCC, lease_id: wireClaim.lease_id, state: "pending" },
      };
    return { status: 500, body: undefined };
  };
}

// Worker `dispatch_block` + `authorize_device`/`require_device`: refused before any write.
const PROVEN_NOT_STARTED: [number, string][] = [
  [409, "entitlement_limit_exceeded"],
  [403, "entitlement_grace_expired"],
  [403, "entitlement_not_granted"],
  [409, "policy_snapshot_stale"],
  [409, "organization_suspended"],
  [409, "organization_not_found"],
  [409, "organization_pending_deletion"],
  [409, "execution_principal_unavailable"],
  [403, "device_revoked"],
  [403, "device_not_approved"],
  [403, "organization_not_active"],
  [401, "device_token_expired"],
];

test("a start refusal that proves no run was created releases and is never needs-reconciliation", async () => {
  for (const [status, reason] of PROVEN_NOT_STARTED) {
    const h = journaledWireDriver(startRefusedWith(status, reason));
    const { started, skipped } = await h.poll();
    assert.equal(started.length, 0, reason);
    assert.deepEqual(
      skipped.map((item) => [item.code, item.reason]),
      [["refused", reason]],
      `${reason}: a refusal, not needs_reconciliation`,
    );
    assert.deepEqual(h.calls, ["due", "claim", "start", "release"], `${reason}: released`);
    assert.deepEqual(
      h.rows.map((row) => row.state),
      ["starting", "released"],
      `${reason}: the journal never shows a possibly-started run`,
    );
  }
});

test("a start failure that cannot prove 'not started' stays ambiguous and is never released", async () => {
  for (const [status, reason] of [
    [409, "lease_fence_invalid"],
    [409, "automation_invalid_state"],
    [409, "occurrence_ambiguous"],
    // A client-local guard code is not a server start refusal: unknown on the wire.
    [409, "automation_policy_stale"],
    [403, "some_future_reason"],
    // A known pre-start code on a 5xx is not a refusal the Worker made deliberately.
    [503, "entitlement_not_granted"],
  ] as const) {
    const h = journaledWireDriver(startRefusedWith(status, reason));
    const { started, skipped } = await h.poll();
    assert.equal(started.length, 0, reason);
    assert.equal(skipped[0]?.code, "needs_reconciliation", reason);
    assert.deepEqual(h.calls, ["due", "claim", "start"], `${reason}: no release`);
    assert.deepEqual(
      h.rows.map((row) => [row.state, row.reason]),
      [
        ["starting", undefined],
        ["ambiguous", "start_unconfirmed"],
      ],
      reason,
    );
  }
  assert.equal(isStartRefusedBeforeStart(new Error("socket hang up")), false);
});

test("a race loser (sequential or concurrent) is a lost race: no start, no journal row", async () => {
  for (const details of [{}, { existing_lease_id: `lse_${hex("e")}` }]) {
    const h = journaledWireDriver((path) => {
      if (path.startsWith("/api/v1/devices/automations/due"))
        return { status: 200, body: { items: [wireDue] } };
      if (path.endsWith("/claim"))
        return { status: 409, body: envelope("occurrence_already_claimed", details) };
      return { status: 500, body: undefined };
    });
    const { started, skipped } = await h.poll();
    assert.equal(started.length, 0);
    assert.deepEqual(
      skipped.map((item) => [item.code, item.reason]),
      [["lost_race", "occurrence_already_claimed"]],
      JSON.stringify(details),
    );
    assert.deepEqual(h.calls, ["due", "claim"], "the loser sends nothing after the claim");
    assert.deepEqual(h.rows, [], "no journal row, so no 'Check run history' badge");
  }
});

test("an off_peak occurrence is refused by the shared P06 classifier before any claim", async () => {
  const worker = new FakeWorker();
  const offPeak = { ...due, offPeakMode: "off_peak" as const };
  const driver = driverFor(worker, "A", {
    leases: { ...worker.port("A"), listDue: async () => [offPeak] },
  });
  const { started, skipped } = await driver.poll();
  assert.equal(started.length, 0);
  assert.deepEqual(
    skipped.map((item) => [item.code, item.reason]),
    [["refused", "off_peak_not_allowed"]],
  );
  assert.deepEqual(worker.calls, [], "no claim, start or release");

  const h = journaledWireDriver((path) =>
    path.startsWith("/api/v1/devices/automations/due")
      ? { status: 200, body: { items: [{ ...wireDue, off_peak_mode: "off_peak" }] } }
      : { status: 500, body: undefined },
  );
  const result = await h.poll();
  assert.deepEqual(
    result.skipped.map((item) => [item.code, item.reason]),
    [["refused", "off_peak_not_allowed"]],
    "the assembled path reports the stable reason instead of silently dropping it",
  );
  assert.deepEqual(h.calls, ["due"]);
  assert.deepEqual(h.rows, []);
});
