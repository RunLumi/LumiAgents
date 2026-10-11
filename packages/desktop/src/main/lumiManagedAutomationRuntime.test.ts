/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import type { ManagedOccurrence, SkippedOccurrence } from "@zcode/services/node";
import {
  createManagedAutomationRuntime,
  type ManagedAutomationRuntimeDeps,
} from "./lumiManagedAutomationRuntime.js";

const hex = (letter: string) => letter.repeat(32);
const ORG = `org_${hex("a")}`;
const OCC = `occ_${hex("1")}`;
const OCC_2 = `occ_${hex("2")}`;
const MANAGED = `aut_${hex("3")}`;
const RUN = `run_${hex("4")}`;
const RUN_2 = `run_${hex("5")}`;
const PROMPT = "NIGHTLY REVIEW SECRET PROMPT sk-live-999";
const LOCAL = "automation-local-1";

const context = (runId: string) => ({
  organizationId: ORG,
  projectId: `prj_${hex("b")}`,
  deviceId: `dvc_${hex("c")}`,
  agentSessionId: `rse_${hex("d")}`,
  runId,
  agentDefinitionId: `agd_${hex("e")}`,
  agentDefinitionVersion: 1,
  requestId: `req_${hex("f")}`,
  executionMode: "managed" as const,
});

function occurrence(occurrenceId: string, runId: string) {
  const calls: string[] = [];
  const handle = {
    localAutomationId: LOCAL,
    grant: {
      occurrence: { occurrence_id: occurrenceId, automation_id: MANAGED },
      attempt: 1,
      leaseId: `lse_${hex("6")}`,
      leaseVersion: 1,
      leaseFence: 1,
      runId,
      agentSessionId: `rse_${hex("d")}`,
      phase: "started",
    },
    heartbeatIntervalMs: 30_000,
    phase: () => "started",
    renew: async () => void calls.push("renew"),
    settle: async (outcome: unknown) => void calls.push(`settle:${JSON.stringify(outcome)}`),
  } as unknown as ManagedOccurrence;
  return { handle, calls };
}

interface Options {
  host?: boolean;
  dispatch?: ManagedAutomationRuntimeDeps["host"]["dispatch"];
  original?: Awaited<ReturnType<ManagedAutomationRuntimeDeps["readOriginal"]>>;
  activateError?: Error;
  occurrences?: ManagedOccurrence[];
  skipped?: SkippedOccurrence[];
  recoverError?: Error;
  orgs?: string[];
  revokeResult?: "confirmed" | "unconfirmed" | Error;
}

function harness(options: Options = {}) {
  const log: string[] = [];
  const events: string[] = [];
  const journal: { state: string; reason?: string; occurrenceId: string }[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const dispatched: unknown[] = [];
  const activations: { hooks?: { onTerminal: (r: never) => Promise<void> } }[] = [];
  let polls = 0;
  let recovers = 0;
  const deps: ManagedAutomationRuntimeDeps = {
    async recoverInterrupted() {
      recovers++;
      if (options.recoverError) throw options.recoverError;
    },
    listOrgIds: async () => options.orgs ?? [ORG],
    driverFor: async () => ({
      async poll() {
        polls++;
        return { started: options.occurrences ?? [], skipped: options.skipped ?? [] };
      },
    }),
    readOriginal: async () =>
      options.original === undefined
        ? { prompt: PROMPT, workspacePath: "/ws", workspaceIdentity: "/ws", mode: "build" }
        : options.original,
    async activate(input) {
      events.push("activate");
      activations.push({ hooks: input.hooks as never });
      if (options.activateError) throw options.activateError;
      return {
        context: context(input.occurrence.grant.runId),
        modelAlias: "coding-default",
        workspaceIdentity: "/ws",
      };
    },
    async failRun(runId, reasonCode) {
      events.push(`failRun:${runId}:${reasonCode}`);
    },
    async revokeRun(runId) {
      events.push(`revoke:${runId}`);
      if (options.revokeResult instanceof Error) throw options.revokeResult;
      return options.revokeResult;
    },
    host: {
      available: () => options.host ?? true,
      dispatch:
        options.dispatch ??
        (async (input) => {
          dispatched.push(input);
          events.push("dispatch");
          return { ok: true, taskId: "task-1" };
        }),
    },
    journal: {
      async record(input) {
        journal.push({
          state: input.state,
          reason: input.reason,
          occurrenceId: input.occurrenceId,
        });
      },
    },
    every(ms, fn) {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    log: (_level, message) => void log.push(message),
  };
  return {
    runtime: createManagedAutomationRuntime(deps),
    log,
    events,
    journal,
    timers,
    dispatched,
    activations,
    polls: () => polls,
    recovers: () => recovers,
  };
}

test("without a local host nothing is read, claimed or started", async () => {
  const h = harness({ host: false });
  assert.deepEqual(await h.runtime.poll(), { status: "no_host" });
  assert.equal(h.polls(), 0);
  assert.equal(h.recovers(), 0);
});

test("restart reconciliation runs once before the first claim and fails closed", async () => {
  const ok = harness({ occurrences: [] });
  await ok.runtime.poll();
  await ok.runtime.poll();
  assert.equal(ok.recovers(), 1);

  const broken = harness({ recoverError: new Error("db locked /Users/me"), occurrences: [] });
  assert.deepEqual(await broken.runtime.poll(), { status: "recovery_failed" });
  assert.equal(broken.polls(), 0, "no claim may happen before reconciliation succeeded");
  assert.equal(
    broken.log.some((line) => line.includes("/Users/me")),
    false,
  );
});

test("a started occurrence is activated, dispatched with the local prompt and renewed", async () => {
  const occ = occurrence(OCC, RUN);
  const h = harness({ occurrences: [occ.handle] });
  const summary = await h.runtime.poll();
  assert.deepEqual(summary, { status: "ok", started: 1, skipped: 0 });
  assert.deepEqual(h.events, ["activate", "dispatch"]);
  const sent = h.dispatched[0] as Record<string, unknown>;
  assert.equal(sent.prompt, PROMPT);
  assert.equal(sent.localAutomationId, LOCAL);
  assert.equal(sent.modelAlias, "coding-default");
  assert.deepEqual(sent.managedContext, context(RUN));
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0]?.ms, 30_000);
  assert.equal(h.log.join("\n").includes("SECRET"), false, "the prompt is never logged");

  h.timers[0]!.fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(occ.calls, ["renew"]);
});

test("polls never overlap: a second request while one runs is dropped", async () => {
  const occ = occurrence(OCC, RUN);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const h = harness({
    occurrences: [occ.handle],
    dispatch: async () => {
      await gate;
      return { ok: true, taskId: "t" };
    },
  });
  const first = h.runtime.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await h.runtime.poll(), { status: "busy" });
  release();
  await first;
  assert.equal(h.polls(), 1);
});

test("a missing original is a post-start failure: failed settlement, no dispatch, never a release", async () => {
  const occ = occurrence(OCC, RUN);
  const h = harness({ occurrences: [occ.handle], original: null });
  await h.runtime.poll();
  assert.deepEqual(occ.calls, [
    `settle:${JSON.stringify({ outcome: "failed", reasonCode: "automation_original_missing" })}`,
  ]);
  assert.equal(h.events.includes("dispatch"), false);
  assert.equal(h.timers.length, 0);
});

test("an activation refusal settles failed and starts no heartbeat or host work", async () => {
  const occ = occurrence(OCC, RUN);
  const h = harness({
    occurrences: [occ.handle],
    activateError: new Error("lumi_managed_policy_stale"),
  });
  await h.runtime.poll();
  assert.deepEqual(occ.calls, [
    `settle:${JSON.stringify({ outcome: "failed", reasonCode: "run_activation_failed" })}`,
  ]);
  assert.equal(h.events.includes("dispatch"), false);
  assert.equal(h.timers.length, 0);
});

test("a host that refuses the dispatch fails the run exactly once and stops renewing", async () => {
  const occ = occurrence(OCC, RUN);
  const h = harness({
    occurrences: [occ.handle],
    dispatch: async () => ({ ok: false, errorCode: "lumi_managed_automation_prompt_failed" }),
  });
  await h.runtime.poll();
  assert.deepEqual(
    h.events.filter((event) => event.startsWith("failRun")),
    [`failRun:${RUN}:host_dispatch_failed`],
  );
  assert.equal(h.timers[0]?.cancelled, true);
});

test("a renewal refusal ends authority: revoke, ambiguous journal, no later settlement", async () => {
  const occ = occurrence(OCC, RUN);
  (occ.handle as unknown as { renew(): Promise<void> }).renew = async () => {
    throw Object.assign(new Error("refused"), { reason: "lease_fence_invalid" });
  };
  const h = harness({ occurrences: [occ.handle] });
  await h.runtime.poll();
  h.timers[0]!.fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.timers[0]?.cancelled, true);
  assert.deepEqual(
    h.events.filter((event) => event.startsWith("revoke")),
    [`revoke:${RUN}`],
  );
  assert.deepEqual(
    h.journal.map((row) => [row.state, row.reason]),
    [["ambiguous", "lease_lost"]],
  );
  // 终态回调晚到：权威已丢失，不能再向服务端结算。
  await h.activations[0]!.hooks!.onTerminal({ outcome: "succeeded" } as never);
  assert.equal(
    occ.calls.some((call) => call.startsWith("settle")),
    false,
  );
});

test("lease loss journals ambiguous whether or not the host confirmed the stop, and never settles", async () => {
  for (const revokeResult of ["confirmed", "unconfirmed", new Error("boom /Users/me")] as const) {
    const occ = occurrence(OCC, RUN);
    (occ.handle as unknown as { renew(): Promise<void> }).renew = async () => {
      throw new Error("refused");
    };
    const h = harness({ occurrences: [occ.handle], revokeResult });
    await h.runtime.poll();
    h.timers[0]!.fn();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      h.journal.map((row) => [row.state, row.reason]),
      [["ambiguous", "lease_lost"]],
    );
    assert.equal(
      occ.calls.some((call) => call.startsWith("settle")),
      false,
    );
    assert.equal(
      h.events.some((event) => event.startsWith("failRun")),
      false,
      "lease loss is not a post-start failure to report",
    );
    const warned = h.log.some((line) => line.includes("host stop unconfirmed"));
    assert.equal(warned, revokeResult !== "confirmed");
    assert.equal(
      h.log.some((line) => line.includes("/Users/me")),
      false,
    );
  }
});

test("a terminal outcome settles once, stops the heartbeat and journals settled", async () => {
  const occ = occurrence(OCC, RUN);
  const h = harness({ occurrences: [occ.handle] });
  await h.runtime.poll();
  await h.activations[0]!.hooks!.onTerminal({ outcome: "succeeded" } as never);
  await h.activations[0]!.hooks!.onTerminal({ outcome: "succeeded" } as never);
  assert.deepEqual(occ.calls, [`settle:${JSON.stringify({ outcome: "succeeded" })}`]);
  assert.equal(h.timers[0]?.cancelled, true);
  assert.deepEqual(
    h.journal.map((row) => row.state),
    ["settled"],
  );
});

test("an unconfirmed settlement is ambiguous and is never retried", async () => {
  const occ = occurrence(OCC, RUN);
  let attempts = 0;
  (occ.handle as unknown as { settle(): Promise<void> }).settle = async () => {
    attempts++;
    throw new Error("socket closed");
  };
  const h = harness({ occurrences: [occ.handle] });
  await h.runtime.poll();
  await h.activations[0]!.hooks!.onTerminal({
    outcome: "failed",
    reasonCode: "agent_failed",
  } as never);
  assert.equal(attempts, 1);
  assert.deepEqual(
    h.journal.map((row) => [row.state, row.reason]),
    [["ambiguous", "settle_unconfirmed"]],
  );
});

test("two occurrences are independent: one failing does not stop the other", async () => {
  const bad = occurrence(OCC, RUN);
  const good = occurrence(OCC_2, RUN_2);
  let first = true;
  const h = harness({
    occurrences: [bad.handle, good.handle],
    dispatch: async () => {
      if (first) {
        first = false;
        return { ok: false, errorCode: "lumi_managed_automation_task_failed" };
      }
      return { ok: true, taskId: "ok" };
    },
  });
  assert.deepEqual(await h.runtime.poll(), { status: "ok", started: 2, skipped: 0 });
  assert.equal(h.timers[0]?.cancelled, true);
  assert.equal(h.timers[1]?.cancelled, false);
});

test("skipped occurrences are counted and logged by stable code only", async () => {
  const h = harness({
    skipped: [
      { occurrenceId: OCC, code: "lost_race", reason: "occurrence_already_claimed" },
      { occurrenceId: OCC_2, code: "not_adopted_here" },
    ],
  });
  assert.deepEqual(await h.runtime.poll(), { status: "ok", started: 0, skipped: 2 });
  const text = h.log.join("\n");
  assert.match(text, /lost_race/);
  assert.match(text, /occurrence_already_claimed/);
});

test("a driver failure for one org is logged by class and does not abort the others", async () => {
  const log: string[] = [];
  const polled: string[] = [];
  const runtime = createManagedAutomationRuntime({
    recoverInterrupted: async () => undefined,
    listOrgIds: async () => [ORG, `org_${hex("9")}`],
    driverFor: async (orgId) => ({
      async poll() {
        polled.push(orgId);
        if (orgId === ORG) throw new Error("fetch failed https://internal.example/path?token=abc");
        return { started: [], skipped: [] };
      },
    }),
    readOriginal: async () => null,
    activate: async () => {
      throw new Error("unused");
    },
    failRun: async () => undefined,
    revokeRun: async () => undefined,
    host: { available: () => true, dispatch: async () => ({ ok: true, taskId: "t" }) },
    journal: { record: async () => undefined },
    every: () => () => undefined,
    log: (_level, message) => void log.push(message),
  });
  assert.deepEqual(await runtime.poll(), { status: "ok", started: 0, skipped: 0 });
  assert.equal(polled.length, 2);
  assert.equal(log.join("\n").includes("internal.example"), false);
});
