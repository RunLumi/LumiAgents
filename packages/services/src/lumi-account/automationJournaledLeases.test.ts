/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import { createJournaledLeasePort } from "./automationJournaledLeases.js";
import type { LumiDueOccurrence } from "./automationLeaseTransport.js";

const hex = (letter: string) => letter.repeat(32);
const ORG = `org_${hex("a")}`;
const OCC = `occ_${hex("1")}`;
const OCC_OFF = `occ_${hex("9")}`;
const MANAGED = `aut_${hex("2")}`;
const RUN = `run_${hex("4")}`;

const due = (overrides: Partial<LumiDueOccurrence> = {}): LumiDueOccurrence => ({
  occurrenceId: OCC,
  automationId: MANAGED,
  attempt: 0,
  scheduledFor: "2026-10-08T01:00:00.000Z",
  offPeakMode: "normal",
  policySnapshotId: `pol_${hex("6")}`,
  policyVersion: 4,
  state: "pending",
  heartbeatIntervalSeconds: 30,
  ...overrides,
});

type Record = {
  occurrenceId: string;
  state: string;
  runId?: string;
  reason?: string;
  localAutomationId: string;
  managedAutomationId: string;
};

function harness(
  options: {
    items?: LumiDueOccurrence[];
    startError?: unknown;
    releaseError?: unknown;
    journalFailsOn?: string;
  } = {},
) {
  const rows: Record[] = [];
  const calls: string[] = [];
  const base = {
    async listDue() {
      calls.push("listDue");
      return options.items ?? [due()];
    },
    async claim(item: LumiDueOccurrence) {
      calls.push("claim");
      return { occurrence: { occurrence_id: item.occurrenceId } } as never;
    },
    async start() {
      calls.push("start");
      if (options.startError) throw options.startError;
      return { run_id: RUN } as never;
    },
    async renew() {
      calls.push("renew");
      return {} as never;
    },
    async settle() {
      calls.push("settle");
      return {} as never;
    },
    async release() {
      calls.push("release");
      if (options.releaseError) throw options.releaseError;
      return {} as never;
    },
  };
  const port = createJournaledLeasePort({
    leases: base,
    orgId: ORG,
    localIdFor: async () => "automation-local-1",
    journal: {
      async record(input) {
        if (options.journalFailsOn === input.state) throw new Error("journal unavailable");
        calls.push(`journal:${input.state}`);
        rows.push({ ...input });
        return undefined;
      },
    },
  });
  return { port, rows, calls };
}

test("the starting breadcrumb is durable before the start request leaves", async () => {
  const { port, rows, calls } = harness();
  await port.listDue();
  await port.claim(due(), {} as never);
  await port.start(OCC, {} as never);
  assert.deepEqual(calls, ["listDue", "claim", "journal:starting", "start", "journal:started"]);
  assert.equal(rows[0]?.localAutomationId, "automation-local-1");
  assert.equal(rows[1]?.runId, RUN);
});

test("if the breadcrumb cannot be written, start is never sent", async () => {
  const { port, calls } = harness({ journalFailsOn: "starting" });
  await port.listDue();
  await port.claim(due(), {} as never);
  await assert.rejects(port.start(OCC, {} as never));
  assert.equal(calls.includes("start"), false);
});

test("the journal has no off-peak rule of its own: the driver's shared classifier decides", async () => {
  const { port, calls } = harness({
    items: [due({ occurrenceId: OCC_OFF, offPeakMode: "off_peak" }), due()],
  });
  const listed = await port.listDue();
  assert.deepEqual(
    listed.map((item) => item.occurrenceId),
    [OCC_OFF, OCC],
  );
  assert.equal("refusedOffPeak" in port, false);
  assert.equal(calls.includes("claim"), false);
});

test("a lost or failed start leaves starting until sweep marks it ambiguous, never released", async () => {
  const { port, rows } = harness({ startError: new Error("socket hang up") });
  await port.listDue();
  await port.claim(due(), {} as never);
  await assert.rejects(port.start(OCC, {} as never));
  assert.equal(rows.at(-1)?.state, "starting");
  await port.sweepUnconfirmed();
  assert.deepEqual(
    rows.slice(-1).map((row) => [row.state, row.reason]),
    [["ambiguous", "start_unconfirmed"]],
  );
});

test("a confirmed pre-start release is journaled as released and not swept", async () => {
  const { port, rows } = harness({ startError: new Error("refused") });
  await port.listDue();
  await port.claim(due(), {} as never);
  await assert.rejects(port.start(OCC, {} as never));
  await port.release(OCC, 0, {} as never);
  await port.sweepUnconfirmed();
  assert.deepEqual(
    rows.map((row) => row.state),
    ["starting", "released"],
  );
});

test("a started occurrence is never touched by the sweep", async () => {
  const { port, rows } = harness();
  await port.listDue();
  await port.claim(due(), {} as never);
  await port.start(OCC, {} as never);
  await port.sweepUnconfirmed();
  assert.deepEqual(
    rows.map((row) => row.state),
    ["starting", "started"],
  );
});

test("an unknown occurrence cannot reach start through the journal", async () => {
  const { port, calls } = harness();
  await assert.rejects(port.start(`occ_${hex("8")}`, {} as never));
  assert.equal(calls.includes("start"), false);
});
