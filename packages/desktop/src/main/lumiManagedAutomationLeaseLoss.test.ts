/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// Lease loss → Host stop, wired with the REAL runtime, activation, Main bridge and Host runner
// (spec 07「Lease loss stops the owning Host's work」). Only the edges are fakes: the device/P06
// ports, and an Agent whose turn is a real abort-sensitive timer that writes a marker file.
// Every message crosses the real strict Host schemas in both directions.
//
// This proves the Main↔Host wiring and the race handling in-process. It does NOT prove that a real
// Agent turn aborts under `stopGeneration`; that is the Electron proof (spec 07, UNPROVEN here).
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { hostIncomingMessageSchema, hostResponseMessageSchema } from "@zcode/shared";
import type { ModelSelection } from "@zcode/shared";
import type { ManagedOccurrence } from "@zcode/services/node";
import { createManagedAutomationRunner } from "../host/managedAutomationRun.js";
import {
  createManagedAutomationActivation,
  type ActivationRunProjection,
} from "./lumiManagedAutomationActivation.js";
import { createManagedAutomationHostBridge } from "./lumiManagedAutomationHostBridge.js";
import { createManagedAutomationRuntime } from "./lumiManagedAutomationRuntime.js";

const hex = (letter: string) => letter.repeat(32);
const ORG = `org_${hex("a")}`;
const PROJECT = `prj_${hex("b")}`;
const DEVICE = `dvc_${hex("c")}`;
const SESSION = `rse_${hex("d")}`;
const RUN = `run_${hex("4")}`;
const AGENT = `agd_${hex("e")}`;
const BINDING = `wsb_${hex("f")}`;
const POLICY = `pol_${hex("6")}`;
const OCC = `occ_${hex("1")}`;
const REQ = `req_${hex("7")}`;
const TURN_MS = 60;

const queuedRun: ActivationRunProjection = {
  runId: RUN,
  state: "queued",
  orgId: ORG,
  projectId: PROJECT,
  deviceId: DEVICE,
  agentSessionId: SESSION,
  agentDefinitionId: AGENT,
  agentDefinitionVersion: 2,
  modelAlias: "coding-default",
  policySnapshotId: POLICY,
  policyVersion: 4,
  requestId: null,
  workspaceBindingId: BINDING,
  version: 1,
};

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await sleep(5);
  assert.equal(condition(), true, "condition not reached in time");
}

async function build(options: { gateAdmission?: boolean; renewFails?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "lumi-leaseloss-"));
  const admission = options.gateAdmission ? deferred() : undefined;
  const marker = join(dir, "tool.marker");
  const exists = () =>
    access(marker).then(
      () => true,
      () => false,
    );
  const events: string[] = [];
  const registry = new Map<string, unknown>();
  const journal: { state: string; reason?: string }[] = [];
  const occurrenceCalls: string[] = [];
  const timers: (() => void)[] = [];
  let turn: { controller: AbortController; done: Promise<"done" | "aborted"> } | undefined;
  const stopsSeenWithLease: boolean[] = [];

  // --- Host side: the real runner over a fake Agent ---------------------------------------------
  const runner = createManagedAutomationRunner({
    resolve: () => ({
      agent: { prepareManagedProviderAlias: async () => ({ providerId: "p" }) as ModelSelection },
      tasks: {
        createTask: async () => ({ taskId: "task-1" }),
        sendPrompt: async () => {
          await admission?.promise;
          const controller = new AbortController();
          const done = (async () => {
            try {
              await sleep(TURN_MS, undefined, { signal: controller.signal });
              await writeFile(marker, "tool side effect");
              return "done" as const;
            } catch (error) {
              if ((error as { name?: string }).name === "AbortError") return "aborted" as const;
              throw error;
            }
          })();
          turn = { controller, done };
        },
        stopGeneration: async () => {
          stopsSeenWithLease.push(registry.has(RUN));
          turn?.controller.abort();
        },
      },
    }),
    traceId: () => "trace-1" as never,
  });

  // --- Main side: the real bridge, wired to the runner through the real strict schemas ----------
  const bridge: ReturnType<typeof createManagedAutomationHostBridge> =
    createManagedAutomationHostBridge({
      resolveHost: () => ({
        postMessage(raw) {
          const parsed = hostIncomingMessageSchema.parse(raw);
          if (parsed.type === "lumi-managed-automation-run") {
            events.push("host:run");
            void runner.run(parsed).then((result) => {
              bridge.handleResult(
                hostResponseMessageSchema.parse({
                  type: "lumi-managed-automation-run-result",
                  requestId: parsed.requestId,
                  ...result,
                }) as never,
              );
            });
          } else if (parsed.type === "lumi-managed-automation-cancel") {
            events.push("host:cancel");
            void runner.cancel(parsed.runId).then((result) => {
              bridge.handleCancelResult(
                hostResponseMessageSchema.parse({
                  type: "lumi-managed-automation-cancel-result",
                  requestId: parsed.requestId,
                  runId: parsed.runId,
                  ...result,
                }) as never,
              );
            });
          } else assert.fail(`unexpected host message ${parsed.type}`);
        },
      }),
      timeoutMs: 5_000,
      cancelTimeoutMs: 5_000,
    });

  // --- Device / P06 fakes behind the real activation and runtime --------------------------------
  let current = queuedRun;
  const device = {
    async getManagedRun() {
      return current;
    },
    async startManagedRun(run: ActivationRunProjection) {
      current = { ...run, state: "running", requestId: REQ };
      return current;
    },
    async completeManagedRun() {
      events.push("p05:complete");
    },
    async failManagedRun() {
      events.push("p05:fail");
    },
    async cancelManagedRun() {
      events.push("p05:cancel");
    },
  };
  const activation = createManagedAutomationActivation({
    deviceFor: async () => device,
    authorizeWorkspace: async () =>
      ({
        projectId: PROJECT,
        deviceId: DEVICE,
        workspaceBindingId: BINDING,
        policySnapshotId: POLICY,
        policyVersion: 4,
      }) as never,
    lease: (runId) => registry.get(runId) as never,
    register: (runId, entry) => void registry.set(runId, entry),
    unregister: (runId) => void registry.delete(runId),
    closeSession: async () => undefined,
    onEnded: () => undefined,
    cancelHostRun: (runId) => bridge.cancel(runId),
  });
  const occurrence = {
    localAutomationId: "automation-1",
    grant: {
      occurrence: { occurrence_id: OCC, automation_id: `aut_${hex("2")}` },
      attempt: 1,
      runId: RUN,
      agentSessionId: SESSION,
    },
    heartbeatIntervalMs: 30_000,
    renew: async () => {
      if (options.renewFails) throw new Error("lease refused");
    },
    settle: async (outcome: unknown) =>
      void occurrenceCalls.push(`settle:${JSON.stringify(outcome)}`),
  } as unknown as ManagedOccurrence;
  const runtime = createManagedAutomationRuntime({
    recoverInterrupted: async () => undefined,
    listOrgIds: async () => [ORG],
    driverFor: async () => ({ poll: async () => ({ started: [occurrence], skipped: [] }) }),
    readOriginal: async () => ({ prompt: "p", workspacePath: "/ws", workspaceIdentity: "/ws" }),
    activate: (input) => activation.activate(input),
    failRun: (runId, code) => activation.settle(runId, "fail", code),
    revokeRun: (runId) => activation.revoke(runId),
    host: bridge,
    journal: {
      record: async (input) => void journal.push({ state: input.state, reason: input.reason }),
    },
    every: (_ms, fn) => {
      timers.push(fn);
      return () => undefined;
    },
    log: () => undefined,
  });

  return {
    runtime,
    registry,
    journal,
    occurrenceCalls,
    events,
    timers,
    admission,
    exists,
    turn: () => turn,
    stopsSeenWithLease,
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

test("positive control: with the lease held the turn runs to completion and leaves its side effect", async () => {
  const h = await build();
  try {
    await h.runtime.poll();
    assert.equal(await h.turn()!.done, "done");
    assert.equal(await h.exists(), true);
    assert.deepEqual(h.stopsSeenWithLease, []);
  } finally {
    await h.dispose();
  }
});

test("a lost lease aborts the in-flight turn on its owning host, never settles, and journals ambiguous", async () => {
  const h = await build({ renewFails: true });
  try {
    await h.runtime.poll();
    assert.equal(h.turn() !== undefined, true, "the run is in flight");
    h.timers[0]!(); // heartbeat tick: renewal is refused
    await until(() => h.journal.length > 0);
    assert.equal(await h.turn()!.done, "aborted", "the real in-flight work was aborted");
    await sleep(TURN_MS * 2);
    assert.equal(await h.exists(), false, "no tool side effect after the lease was lost");
    assert.deepEqual(h.stopsSeenWithLease, [false], "authority was removed before the stop");
    assert.equal(h.registry.size, 0);
    assert.deepEqual(h.events.filter((event) => event.startsWith("host:cancel")).length, 1);
    assert.equal(h.events.includes("p05:cancel"), true);
    assert.deepEqual(h.occurrenceCalls, [], "nothing is settled over the newer server state");
    assert.deepEqual(h.journal, [{ state: "ambiguous", reason: "lease_lost" }]);
  } finally {
    await h.dispose();
  }
});

test("a lease lost while the prompt is still being admitted aborts the turn once it starts and never settles", async () => {
  const h = await build({ renewFails: true, gateAdmission: true });
  try {
    const polling = h.runtime.poll(); // blocks in dispatch: the Agent has not admitted the prompt
    await until(() => h.events.includes("host:run") && h.timers.length > 0);
    h.timers[0]!(); // renewal is refused while sendPrompt is pending
    await until(() => h.events.includes("host:cancel"));
    assert.equal(
      h.turn(),
      undefined,
      "no turn exists yet, so the first stop cannot abort anything",
    );
    h.admission!.release(); // the Agent admits the prompt after the lease is already gone
    await polling;
    await until(() => h.journal.length > 0);
    assert.equal(await h.turn()!.done, "aborted", "the stop repeated after admission aborted it");
    await sleep(TURN_MS * 2);
    assert.equal(await h.exists(), false);
    assert.deepEqual(h.occurrenceCalls, [], "the cancelled dispatch result cannot settle or retry");
    assert.deepEqual(h.journal, [{ state: "ambiguous", reason: "lease_lost" }]);
    assert.equal(h.registry.size, 0);
  } finally {
    await h.dispose();
  }
});
