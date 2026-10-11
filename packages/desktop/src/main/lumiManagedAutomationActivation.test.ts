/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import type { ManagedOccurrence } from "@zcode/services/node";
import {
  createManagedAutomationActivation,
  type ActivationRunProjection,
} from "./lumiManagedAutomationActivation.js";

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

const occurrence = {
  localAutomationId: "automation-1",
  grant: {
    occurrence: { occurrence_id: OCC, automation_id: `aut_${hex("2")}` },
    runId: RUN,
    agentSessionId: SESSION,
  },
} as unknown as ManagedOccurrence;

const queuedRun = (overrides: Partial<ActivationRunProjection> = {}): ActivationRunProjection => ({
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
  ...overrides,
});

const authorized = (overrides: Record<string, unknown> = {}) => ({
  projectId: PROJECT,
  deviceId: DEVICE,
  workspaceBindingId: BINDING,
  policySnapshotId: POLICY,
  policyVersion: 4,
  ...overrides,
});

function harness(
  options: {
    run?: ActivationRunProjection;
    authorize?: Record<string, unknown> | Error;
    startError?: Error;
    started?: Partial<ActivationRunProjection>;
    terminalError?: Error;
    closeError?: Error;
    hostStop?: "ok" | "refused" | "throws";
    retireThrows?: boolean;
  } = {},
) {
  const events: string[] = [];
  const retired: string[] = [];
  const registry = new Map<string, unknown>();
  const hookCalls: unknown[] = [];
  let current = options.run ?? queuedRun();
  const device = {
    async getManagedRun() {
      events.push("getRun");
      return current;
    },
    async startManagedRun(run: ActivationRunProjection) {
      events.push("startRun");
      if (options.startError) throw options.startError;
      const started = {
        ...run,
        state: "running" as const,
        requestId: REQ,
        ...options.started,
      };
      // 服务端读回：启动之后 run 就是 running（终态结算要求 running）。
      // 读回的是被授予的那个 run（不是启动响应里可能出错的内容）。
      current = { ...started, runId: run.runId, version: run.version + 2 };
      return started;
    },
    async completeManagedRun() {
      events.push("p05:complete");
      if (options.terminalError) throw options.terminalError;
    },
    async failManagedRun(_run: unknown, code: string) {
      events.push(`p05:fail:${code}`);
      if (options.terminalError) throw options.terminalError;
    },
    async cancelManagedRun() {
      events.push("p05:cancel");
      if (options.terminalError) throw options.terminalError;
    },
  };
  const activation = createManagedAutomationActivation({
    deviceFor: async () => device,
    authorizeWorkspace: async () => {
      events.push("authorize");
      if (options.authorize instanceof Error) throw options.authorize;
      return authorized(options.authorize) as never;
    },
    lease: (runId) => registry.get(runId) as never,
    register: (runId, entry) => void registry.set(runId, entry),
    unregister: (runId) => void registry.delete(runId),
    closeSession: async () => {
      events.push("closeSession");
      if (options.closeError) throw options.closeError;
    },
    onEnded: () => void events.push("ended"),
    cancelHostRun: async (runId) => {
      events.push(`hostStop:${runId}:lease=${registry.has(runId)}`);
      if (options.hostStop === "throws") throw new Error("channel closed /Users/me");
      return { ok: options.hostStop !== "refused" };
    },
    retireHostRun: (runId) => {
      retired.push(runId);
      if (options.retireThrows) throw new Error("retire failed");
    },
  });
  const hooks = {
    onTerminal: async (result: unknown) => {
      events.push("p06:settle");
      hookCalls.push(result);
    },
  };
  return { activation, events, registry, hooks, hookCalls, retired };
}

const input = (h: ReturnType<typeof harness>) => ({
  orgId: ORG,
  occurrence,
  original: { prompt: "p", workspacePath: "/ws", workspaceIdentity: "/ws-id" },
  hooks: h.hooks,
});

test("a valid occurrence run is validated, started and registered with server-issued context", async () => {
  const h = harness();
  const result = await h.activation.activate(input(h));
  assert.deepEqual(h.events, ["getRun", "authorize", "startRun"]);
  assert.equal(result.modelAlias, "coding-default");
  assert.equal(result.workspaceIdentity, "/ws-id");
  assert.deepEqual(result.context, {
    organizationId: ORG,
    projectId: PROJECT,
    deviceId: DEVICE,
    agentSessionId: SESSION,
    runId: RUN,
    agentDefinitionId: AGENT,
    agentDefinitionVersion: 2,
    requestId: REQ,
    externalId: OCC,
    executionMode: "managed",
    policySnapshotId: POLICY,
    policyVersion: 4,
  });
  const entry = h.registry.get(RUN) as Record<string, unknown>;
  assert.equal(entry.modelAlias, "coding-default");
  assert.equal(entry.automation, h.hooks);
  assert.equal(entry.hostSessionId, undefined, "bound later by the first authorized request");
});

test("every grant/run/authorization mismatch refuses before the run is started", async () => {
  const mismatches: [string, ActivationRunProjection | undefined, Record<string, unknown>][] = [
    ["not queued", queuedRun({ state: "running" }), {}],
    ["other run id", queuedRun({ runId: `run_${hex("9")}` }), {}],
    ["other session", queuedRun({ agentSessionId: `rse_${hex("9")}` }), {}],
    ["other org", queuedRun({ orgId: `org_${hex("9")}` }), {}],
    ["other device", queuedRun({ deviceId: `dvc_${hex("9")}` }), {}],
    ["other project", undefined, { projectId: `prj_${hex("9")}` }],
    ["other binding", undefined, { workspaceBindingId: `wsb_${hex("9")}` }],
    ["no binding on run", queuedRun({ workspaceBindingId: null }), {}],
    ["device differs from authorized", undefined, { deviceId: `dvc_${hex("9")}` }],
    ["newer policy version", undefined, { policyVersion: 5 }],
    ["other policy snapshot", undefined, { policySnapshotId: `pol_${hex("9")}` }],
    ["run without policy", queuedRun({ policySnapshotId: null, policyVersion: null }), {}],
    ["no model alias", queuedRun({ modelAlias: null }), {}],
  ];
  for (const [name, run, authorize] of mismatches) {
    const h = harness({ ...(run ? { run } : {}), authorize });
    await assert.rejects(
      h.activation.activate(input(h)),
      (error: unknown) => error instanceof Error,
      name,
    );
    assert.equal(h.events.includes("startRun"), false, `${name}: run must not start`);
    assert.equal(h.registry.size, 0, `${name}: nothing is registered`);
    // queued 的 run 由我们收回；已经 running 的不是我们启动的，不归我们取消；
    // 投影里 run id 不是授予的那个时，更不能拿它去取消任何东西。
    const projected = run ?? queuedRun();
    assert.equal(
      h.events.includes("p05:cancel"),
      projected.state === "queued" && projected.runId === RUN,
      `${name}: only the granted, queued run is cancelled`,
    );
  }
});

test("a workspace authorization refusal also cancels the queued run and registers nothing", async () => {
  const h = harness({ authorize: new Error("lumi_workspace_not_managed") });
  await assert.rejects(h.activation.activate(input(h)), /lumi_workspace_not_managed/);
  // 清理时重新读取 run（持有的投影可能已过期），仍是 queued 才取消。
  assert.deepEqual(h.events, ["getRun", "authorize", "getRun", "p05:cancel"]);
  assert.equal(h.registry.size, 0);
});

test("a refused or malformed P05 start cancels the run and leaves no authority", async () => {
  for (const [options, cancels] of [
    [{ startError: new Error("lumi_request_refused") }, true],
    // 服务端已把 run 判为终态：无需（也不能）再取消。
    [{ started: { state: "failed" as never } }, false],
    [{ started: { requestId: null } }, true],
    [{ started: { runId: `run_${hex("9")}` } }, true],
  ] as const) {
    const h = harness(options);
    await assert.rejects(h.activation.activate(input(h)));
    assert.equal(h.registry.size, 0);
    assert.equal(h.events.includes("p05:cancel"), cancels);
  }
});

test("terminal order is P05 terminal, then P06 settlement, and authority ends before P06", async () => {
  const h = harness();
  await h.activation.activate(input(h));
  await h.activation.settle(RUN, "complete");
  assert.deepEqual(h.events.slice(3), [
    "getRun",
    "p05:complete",
    "closeSession",
    "p06:settle",
    "ended",
  ]);
  assert.deepEqual(h.hookCalls, [{ outcome: "succeeded" }]);
  assert.equal(h.registry.size, 0);
});

test("failure and cancellation map to failed settlements with stable reason codes", async () => {
  for (const [outcome, p05, reason] of [
    ["fail", "p05:fail:agent_failed", "agent_failed"],
    ["cancel", "p05:cancel", "user_cancelled"],
  ] as const) {
    const h = harness();
    await h.activation.activate(input(h));
    h.events.length = 0;
    // 运行态必须再次是 running：模拟服务端读回
    await h.activation.settle(RUN, outcome);
    assert.equal(h.events.includes(p05), true);
    assert.deepEqual(h.hookCalls, [{ outcome: "failed", reasonCode: reason }]);
  }
});

test("a P05 report failure still ends authority and settles P06 failed, then surfaces the refusal", async () => {
  const failing = harness({ terminalError: new Error("network") });
  await failing.activation.activate(input(failing));
  await assert.rejects(failing.activation.settle(RUN, "complete"), /lumi_managed_run_refused/);
  assert.deepEqual(failing.hookCalls, [{ outcome: "failed", reasonCode: "run_report_failed" }]);
  assert.equal(failing.registry.size, 0);
});

test("session close failure never blocks the authoritative P06 settlement", async () => {
  const h = harness({ closeError: new Error("forbidden") });
  await h.activation.activate(input(h));
  await h.activation.settle(RUN, "complete");
  assert.deepEqual(h.hookCalls, [{ outcome: "succeeded" }]);
});

test("revoke removes authority and cancels best effort without touching P06", async () => {
  const h = harness();
  await h.activation.activate(input(h));
  await h.activation.revoke(RUN);
  assert.equal(h.registry.size, 0);
  assert.equal(h.events.includes("p05:cancel"), true);
  assert.deepEqual(h.hookCalls, []);
  // 授权已撤销：之后迟到的终态不再有任何服务端副作用。
  await assert.rejects(h.activation.settle(RUN, "complete"), /lumi_managed_run_missing/);
  assert.deepEqual(h.hookCalls, []);
});

test("revoke unregisters first, then stops the owning host before the slower P05 cancel finishes", async () => {
  const h = harness();
  await h.activation.activate(input(h));
  h.events.length = 0;
  assert.equal(await h.activation.revoke(RUN), "confirmed");
  // 授权先撤销（host stop 发出时租约已不在），P05 取消随后，onEnded 最后。
  assert.deepEqual(h.events, [`hostStop:${RUN}:lease=false`, "getRun", "p05:cancel", "ended"]);
  assert.deepEqual(h.hookCalls, []);
});

test("revoke still stops the host when the lease was already gone, and never touches P05", async () => {
  const h = harness();
  assert.equal(await h.activation.revoke(RUN), "confirmed");
  assert.deepEqual(h.events, [`hostStop:${RUN}:lease=false`]);
});

test("a host that refuses or throws leaves the stop unconfirmed but authority and P05 cancel still end", async () => {
  for (const hostStop of ["refused", "throws"] as const) {
    const h = harness({ hostStop });
    await h.activation.activate(input(h));
    assert.equal(await h.activation.revoke(RUN), "unconfirmed", hostStop);
    assert.equal(h.registry.size, 0);
    assert.equal(h.events.includes("p05:cancel"), true);
    assert.equal(h.events.includes("ended"), true);
    assert.deepEqual(h.hookCalls, []);
  }
});

test("settling a run that is not an automation lease is refused so interactive runs keep their path", async () => {
  const h = harness();
  await assert.rejects(h.activation.settle(RUN, "complete"), /lumi_managed_run_missing/);
  assert.deepEqual(h.retired, [], "an unknown or late terminal retires nothing");
});

test("a Host terminal relay retires the run's stop authority exactly once, for every outcome", async () => {
  for (const outcome of ["complete", "fail", "cancel"] as const) {
    const h = harness();
    await h.activation.activate(input(h));
    assert.deepEqual(h.retired, [], "activation alone retires nothing");
    await h.activation.settle(RUN, outcome);
    assert.deepEqual(h.retired, [RUN], outcome);
    await assert.rejects(h.activation.settle(RUN, outcome), /lumi_managed_run_missing/);
    assert.deepEqual(h.retired, [RUN], `${outcome}: a repeated terminal does not retire again`);
  }
});

test("the Host terminal is proof even when the P05 report fails, and a failing retire never blocks settlement", async () => {
  const failing = harness({ terminalError: new Error("network") });
  await failing.activation.activate(input(failing));
  await assert.rejects(failing.activation.settle(RUN, "complete"), /lumi_managed_run_refused/);
  assert.deepEqual(failing.retired, [RUN]);
  assert.deepEqual(failing.hookCalls, [{ outcome: "failed", reasonCode: "run_report_failed" }]);

  const throwing = harness({ retireThrows: true });
  await throwing.activation.activate(input(throwing));
  await throwing.activation.settle(RUN, "complete");
  assert.deepEqual(throwing.hookCalls, [{ outcome: "succeeded" }]);
});

test("revoke never retires, whatever the stop outcome: only a confirmed ACK in the bridge frees the owner", async () => {
  for (const hostStop of ["ok", "refused", "throws"] as const) {
    const h = harness({ hostStop });
    await h.activation.activate(input(h));
    await h.activation.revoke(RUN);
    assert.deepEqual(h.retired, [], hostStop);
  }
});

test("a failed dispatch settles the occurrence, then stops that one run on its Host, and never retires", async () => {
  for (const hostStop of ["ok", "refused", "throws"] as const) {
    const h = harness({ hostStop });
    await h.activation.activate(input(h));
    h.events.length = 0;
    await h.activation.failDispatch(RUN, "host_dispatch_failed");
    assert.equal(h.events.includes("p05:fail:host_dispatch_failed"), true, hostStop);
    assert.deepEqual(h.hookCalls, [{ outcome: "failed", reasonCode: "host_dispatch_failed" }]);
    assert.equal(h.events.at(-1), `hostStop:${RUN}:lease=false`, "stop is asked after authority ended");
    assert.deepEqual(h.retired, [], `${hostStop}: a dispatch failure is not a terminal proof`);
  }
});

test("a failed dispatch for a run with no lease still asks the Host to stop it and surfaces the refusal", async () => {
  const h = harness();
  await assert.rejects(h.activation.failDispatch(RUN, "host_dispatch_failed"), /lumi_managed_run_missing/);
  assert.deepEqual(h.events, [`hostStop:${RUN}:lease=false`]);
  assert.deepEqual(h.retired, []);
});
