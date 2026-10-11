/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// Real wiring (spec 07 "Retirement wiring"): the assembly's activation drives the real Host bridge.
// The bridge's stop authority (run → owning Host) is freed only by a proven Host terminal or a
// Host-confirmed stop, so the bound neither evicts a live run nor starves a long-lived app.
import assert from "node:assert/strict";
import test from "node:test";
import type { ManagedOccurrence } from "@zcode/services/node";
import { createManagedAutomationAssembly } from "./lumiManagedAutomationAssembly.js";
import { createManagedAutomationHostBridge } from "./lumiManagedAutomationHostBridge.js";

const hex = (letter: string) => letter.repeat(32);
const runHex = (n: number) => n.toString(16).padStart(32, "0");
const ORG = `org_${hex("a")}`;
const PROJECT = `prj_${hex("b")}`;
const DEVICE = `dvc_${hex("c")}`;
const SESSION = `rse_${hex("d")}`;
const AGENT = `agd_${hex("e")}`;
const BINDING = `wsb_${hex("f")}`;
const POLICY = `pol_${hex("6")}`;
const REQ = `req_${hex("7")}`;
const CAP = 256;

const runId = (n: number) => `run_${runHex(n)}`;

function setup(cancelTimeoutMs = 1_000) {
  const posted: Record<string, unknown>[] = [];
  const target = { postMessage: (message: unknown) => void posted.push(message as Record<string, unknown>) };
  const bridge = createManagedAutomationHostBridge({
    resolveHost: () => target,
    timeoutMs: 1_000,
    cancelTimeoutMs,
  });
  const states = new Map<string, "queued" | "running">();
  const projection = (id: string) => ({
    runId: id,
    state: states.get(id) ?? "queued",
    orgId: ORG,
    projectId: PROJECT,
    deviceId: DEVICE,
    agentSessionId: SESSION,
    agentDefinitionId: AGENT,
    agentDefinitionVersion: 2,
    modelAlias: "coding-default",
    policySnapshotId: POLICY,
    policyVersion: 4,
    requestId: states.get(id) === "running" ? REQ : null,
    workspaceBindingId: BINDING,
    version: 1,
  });
  const device = {
    getManagedRun: async (id: string) => projection(id),
    startManagedRun: async (run: { runId: string }) => {
      states.set(run.runId, "running");
      return projection(run.runId);
    },
    completeManagedRun: async () => undefined,
    failManagedRun: async () => undefined,
    cancelManagedRun: async () => undefined,
    refreshRuntimeCapabilities: async () => undefined,
  };
  const managedRuns = new Map();
  const assembly = createManagedAutomationAssembly({
    transport: { closeManagedSession: async () => undefined } as never,
    deviceFor: async () => device as never,
    authorizeWorkspace: async () =>
      ({
        projectId: PROJECT,
        deviceId: DEVICE,
        workspaceBindingId: BINDING,
        policySnapshotId: POLICY,
        policyVersion: 4,
      }) as never,
    managedRuns,
    repo: () => {
      throw new Error("repo is not used by activation");
    },
    host: bridge,
    log: () => undefined,
  });
  const hostTerminals: unknown[] = [];
  const hooks = { onTerminal: async (result: unknown) => void hostTerminals.push(result) };

  /** activate → dispatch → Host accepts; the run is now live on the Host. */
  async function startRun(n: number) {
    const occurrence = {
      localAutomationId: "automation-1",
      grant: {
        occurrence: { occurrence_id: `occ_${runHex(n)}`, automation_id: `aut_${hex("2")}` },
        runId: runId(n),
        agentSessionId: SESSION,
      },
    } as unknown as ManagedOccurrence;
    const activated = await assembly.activation.activate({
      orgId: ORG,
      occurrence,
      original: { workspacePath: "/ws", workspaceIdentity: "/ws-id" },
      hooks,
    } as never);
    const before = posted.length;
    const dispatching = bridge.dispatch({
      localAutomationId: "automation-1",
      workspacePath: "/ws",
      workspaceIdentity: "/ws-id",
      prompt: "p",
      modelAlias: activated.modelAlias,
      managedContext: activated.context,
    });
    assert.equal(posted.length, before + 1, `run ${n}: the run message was posted`);
    bridge.handleResult({
      type: "lumi-managed-automation-run-result",
      requestId: posted[before]!.requestId as string,
      ok: true,
      taskId: `task-${n}`,
    });
    assert.deepEqual(await dispatching, { ok: true, taskId: `task-${n}` });
  }

  const ack = (index: number, override: Record<string, unknown> = {}) =>
    bridge.handleCancelResult({
      type: "lumi-managed-automation-cancel-result",
      requestId: posted[index]!.requestId as string,
      runId: posted[index]!.runId as string,
      ok: true,
      outcome: "stopped",
      ...override,
    } as never);

  return { assembly, bridge, posted, startRun, ack, hostTerminals };
}

test("more than 256 completed runs never exhaust the bound, and a still-active first run keeps its stop path", async () => {
  const { assembly, bridge, posted, startRun, ack } = setup();
  await startRun(0); // control: stays live on the Host throughout
  for (let n = 1; n <= CAP + 44; n++) {
    await startRun(n);
    await assembly.activation.settle(runId(n), "complete"); // the Host's terminal relay
  }
  assert.equal(bridge.available(), true, "300 completed runs leave capacity");

  // Terminal cleanup happened once and for the right runs: a completed run is no longer known…
  const postedBefore = posted.length;
  assert.deepEqual(await bridge.cancel(runId(1)), {
    ok: false,
    errorCode: "lumi_managed_automation_run_unknown",
  });
  assert.equal(posted.length, postedBefore, "an unknown run posts nothing");

  // …while the control run still reaches its owning Host.
  const stopping = bridge.cancel(runId(0));
  assert.equal(posted.length, postedBefore + 1);
  assert.equal(posted.at(-1)!.runId, runId(0));
  ack(posted.length - 1);
  assert.deepEqual(await stopping, { ok: true, outcome: "stopped" });
});

test("at the bound new work is refused before posting, and one Host terminal frees exactly one slot", async () => {
  const { assembly, bridge, posted, startRun } = setup();
  for (let n = 1; n <= CAP; n++) await startRun(n);
  assert.equal(bridge.available(), false);
  const postedBefore = posted.length;
  assert.deepEqual(
    await bridge.dispatch({
      localAutomationId: "automation-1",
      workspacePath: "/ws",
      prompt: "p",
      modelAlias: "coding-default",
      managedContext: {
        organizationId: ORG,
        projectId: PROJECT,
        deviceId: DEVICE,
        agentSessionId: SESSION,
        runId: runId(CAP + 1),
        agentDefinitionId: AGENT,
        agentDefinitionVersion: 2,
        requestId: REQ,
        executionMode: "managed",
      },
    }),
    { ok: false, errorCode: "lumi_managed_automation_host_busy" },
  );
  assert.equal(posted.length, postedBefore);
  await assembly.activation.settle(runId(10), "fail", "agent_failed");
  assert.equal(bridge.available(), true);
  await startRun(CAP + 1);
  assert.equal(bridge.available(), false, "exactly one slot was freed");
});

test("a late or unknown terminal retires nothing and a repeated terminal does not free a second slot", async () => {
  const { assembly, bridge, startRun } = setup();
  for (let n = 1; n <= CAP; n++) await startRun(n);
  await assert.rejects(assembly.activation.settle(runId(999), "complete"), /lumi_managed_run_missing/);
  assert.equal(bridge.available(), false, "an unknown terminal freed nothing");
  await assembly.activation.settle(runId(1), "complete");
  await assert.rejects(assembly.activation.settle(runId(1), "complete"), /lumi_managed_run_missing/);
  await startRun(CAP + 1);
  assert.equal(bridge.available(), false, "the repeat did not free another slot");
});

test("an unconfirmed revoke stop keeps the owner; a late Host terminal is refused; a retried stop still works", async () => {
  const { assembly, bridge, posted, startRun, ack } = setup(20);
  await startRun(1);
  const before = posted.length;
  assert.equal(await assembly.activation.revoke(runId(1)), "unconfirmed", "no ACK within the bound");
  assert.equal(posted.length, before + 1, "revoke asked only the owning Host, once");
  await assert.rejects(assembly.activation.settle(runId(1), "complete"), /lumi_managed_run_missing/);

  const retry = bridge.cancel(runId(1));
  assert.equal(posted.length, before + 2, "the owner survived: the stop is really retried");
  ack(posted.length - 1, { ok: false, outcome: undefined, errorCode: "lumi_managed_automation_stop_failed" });
  assert.deepEqual(await retry, { ok: false, errorCode: "lumi_managed_automation_stop_failed" });

  const confirmed = bridge.cancel(runId(1));
  ack(posted.length - 1);
  assert.deepEqual(await confirmed, { ok: true, outcome: "stopped" });
  assert.deepEqual(await bridge.cancel(runId(1)), { ok: true, outcome: "already_cancelled" });
});

test("a Host-confirmed revoke stop frees the slot without any terminal relay", async () => {
  const { assembly, bridge, posted, startRun, ack } = setup();
  for (let n = 1; n <= CAP; n++) await startRun(n);
  assert.equal(bridge.available(), false);
  const revoking = assembly.activation.revoke(runId(3));
  ack(posted.length - 1);
  assert.equal(await revoking, "confirmed");
  assert.equal(bridge.available(), true);
});

test("a failed dispatch is not a terminal proof: the Host is asked to stop that run and only its ACK frees the slot", async () => {
  const { assembly, bridge, posted, startRun, ack } = setup(20);
  for (let n = 1; n <= CAP - 1; n++) await startRun(n);
  // Run CAP: activated and posted, but the Host refuses the prompt (a task may still exist).
  const occurrence = {
    localAutomationId: "automation-1",
    grant: { occurrence: { occurrence_id: `occ_${runHex(CAP)}` }, runId: runId(CAP), agentSessionId: SESSION },
  } as unknown as ManagedOccurrence;
  const activated = await assembly.activation.activate({
    orgId: ORG,
    occurrence,
    original: { workspacePath: "/ws", workspaceIdentity: "/ws-id" },
    hooks: { onTerminal: async () => undefined },
  } as never);
  const dispatching = bridge.dispatch({
    localAutomationId: "automation-1",
    workspacePath: "/ws",
    workspaceIdentity: "/ws-id",
    prompt: "p",
    modelAlias: activated.modelAlias,
    managedContext: activated.context,
  });
  bridge.handleResult({
    type: "lumi-managed-automation-run-result",
    requestId: posted.at(-1)!.requestId as string,
    ok: false,
    errorCode: "lumi_managed_automation_prompt_failed",
  });
  assert.equal((await dispatching).ok, false);
  assert.equal(bridge.available(), false, "a refusal alone does not free the slot");

  const before = posted.length;
  // The stop is asked after the occurrence settles; with no ACK inside the bound it stays unconfirmed.
  await assembly.activation.failDispatch(runId(CAP), "host_dispatch_failed");
  assert.equal(posted.length, before + 1, "exactly one stop request was posted");
  assert.equal(posted.at(-1)!.type, "lumi-managed-automation-cancel");
  assert.equal(posted.at(-1)!.runId, runId(CAP), "the stop targets that one run on its Host");
  assert.equal(bridge.available(), false, "an unACKed stop frees nothing");

  const stopping = bridge.cancel(runId(CAP));
  ack(posted.length - 1);
  assert.deepEqual(await stopping, { ok: true, outcome: "stopped" });
  assert.equal(bridge.available(), true, "the confirmed ACK freed the slot");
});
