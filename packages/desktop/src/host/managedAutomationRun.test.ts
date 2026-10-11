/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { buildRemoteWorkspaceIdentity, type ModelSelection } from "@zcode/shared";
import {
  createManagedAutomationRunner,
  type ManagedAutomationRunRequest,
} from "./managedAutomationRun.js";

const suffix = "0123456789abcdef0123456789abcdef";
const context = {
  organizationId: `org_${suffix}`,
  projectId: `prj_${suffix}`,
  deviceId: `dvc_${suffix}`,
  agentSessionId: `rse_${suffix}`,
  runId: `run_${suffix}`,
  agentDefinitionId: `agd_${suffix}`,
  agentDefinitionVersion: 1,
  requestId: `req_${suffix}`,
  externalId: `occ_${suffix}`,
  executionMode: "managed" as const,
  policySnapshotId: `pol_${suffix}`,
  policyVersion: 3,
};
const request: ManagedAutomationRunRequest = {
  type: "lumi-managed-automation-run",
  requestId: "main-1",
  localAutomationId: "automation-1",
  workspacePath: "/local/ws",
  prompt: "do the nightly review",
  modelAlias: "coding-default",
  managedContext: context,
};
const selection = { providerId: "lumi-managed", modelId: "coding-default" } as ModelSelection;

function harness(overrides: Partial<Record<"alias" | "create" | "send", () => never>> = {}) {
  const calls: { name: string; arg: unknown }[] = [];
  const runner = createManagedAutomationRunner({
    resolve: () => ({
      agent: {
        prepareManagedProviderAlias: async (arg) => {
          calls.push({ name: "alias", arg });
          overrides.alias?.();
          return selection;
        },
      },
      tasks: {
        createTask: async (arg) => {
          calls.push({ name: "create", arg });
          overrides.create?.();
          return { taskId: "task-1" };
        },
        sendPrompt: async (arg) => {
          calls.push({ name: "send", arg });
          overrides.send?.();
        },
        stopGeneration: async (arg) => void calls.push({ name: "stop", arg }),
      },
    }),
    traceId: (taskId) => `trace-${taskId}` as never,
  });
  return { runner, calls };
}

test("the managed run is one alias preparation, one task, one prompt with the exact context", async () => {
  const { runner, calls } = harness();
  assert.deepEqual(await runner.run(request), { ok: true, taskId: "task-1" });
  assert.deepEqual(
    calls.map((call) => call.name),
    ["alias", "create", "send"],
    "the alias must be registered before the task selects it",
  );
  assert.deepEqual(calls[0]?.arg, {
    modelAlias: "coding-default",
    managedContext: context,
    workspace: { workspacePath: "/local/ws" },
  });
  const create = calls[1]?.arg as Record<string, unknown>;
  assert.equal(create.modelSelection, selection);
  assert.equal(create.deferPersistenceUntilFirstPrompt, true);
  assert.equal(create.automationId, "automation-1", "attributed to the retained original");
  const send = calls[2]?.arg as Record<string, unknown>;
  assert.equal(send.content, request.prompt);
  assert.equal(send.automationId, "automation-1", "automation mutation tools stay denied");
  assert.equal(send.modelSelection, selection);
  assert.deepEqual(send.modelExecution, { selectionScope: "execution", managedContext: context });
  assert.equal(send.clientMode, "desktop-continuous");
});

test("a remote workspace is refused before any service is touched", async () => {
  const { runner, calls } = harness();
  const result = await runner.run({
    ...request,
    workspaceIdentity: buildRemoteWorkspaceIdentity("/srv/app", {
      kind: "ssh",
      host: "build.example.com",
      port: 22,
      username: "dev",
    }),
  });
  assert.deepEqual(result, { ok: false, errorCode: "lumi_managed_automation_remote_unsupported" });
  assert.deepEqual(calls, []);
});

test("each stage failure maps to one stable code and never echoes the underlying text", async () => {
  const leak = () => {
    throw new Error("EACCES /Users/me/.zcode/secret-token sk-live-1");
  };
  for (const [stage, code, expected] of [
    ["alias", "lumi_managed_automation_alias_unavailable", ["alias"]],
    ["create", "lumi_managed_automation_task_failed", ["alias", "create"]],
    ["send", "lumi_managed_automation_prompt_failed", ["alias", "create", "send"]],
  ] as const) {
    const { runner, calls } = harness({ [stage]: leak });
    const result = await runner.run(request);
    assert.deepEqual(result, { ok: false, errorCode: code });
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.deepEqual(
      calls.map((call) => call.name),
      expected,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// Lease-loss cancellation races. The fake Agent runs a REAL abort-sensitive turn: a timer that
// writes a marker file when it finishes, and that `stopGeneration` aborts through an
// AbortController. A stop that arrives before the Agent admitted the prompt is a no-op, exactly
// like the real v4 `stop` on an idle session — that is the race the runner must close.
// ---------------------------------------------------------------------------------------------

const TURN_MS = 40;
const runIdOf = (letter: string) => `run_${letter.repeat(32)}`;
const requestFor = (runId: string): ManagedAutomationRunRequest => ({
  ...request,
  requestId: `main-${runId}`,
  managedContext: { ...context, runId },
});

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

type Gate = "alias" | "create" | "send";

async function raceHarness(gated: Gate[] = []) {
  const dir = await mkdtemp(join(tmpdir(), "lumi-cancel-"));
  const gates = Object.fromEntries(gated.map((name) => [name, deferred()])) as Partial<
    Record<Gate, ReturnType<typeof deferred>>
  >;
  const calls: string[] = [];
  const turns = new Map<
    string,
    { controller: AbortController; done: Promise<"done" | "aborted"> }
  >();
  let nextTask = 0;
  let stopFails = 0;
  const markerFor = (taskId: string) => join(dir, `${taskId}.marker`);
  const exists = (taskId: string) =>
    access(markerFor(taskId)).then(
      () => true,
      () => false,
    );
  const runner = createManagedAutomationRunner({
    resolve: () => ({
      agent: {
        prepareManagedProviderAlias: async () => {
          calls.push("alias");
          await gates.alias?.promise;
          return selection;
        },
      },
      tasks: {
        createTask: async () => {
          calls.push("create");
          await gates.create?.promise;
          return { taskId: `task-${++nextTask}` };
        },
        sendPrompt: async ({ taskId }) => {
          calls.push(`send:${taskId}`);
          await gates.send?.promise; // admission is the await: the turn only starts after it
          const controller = new AbortController();
          const done = (async () => {
            try {
              await sleep(TURN_MS, undefined, { signal: controller.signal });
              await writeFile(markerFor(taskId), "tool side effect");
              return "done" as const;
            } catch (error) {
              if ((error as { name?: string }).name === "AbortError") return "aborted" as const;
              throw error;
            }
          })();
          turns.set(taskId, { controller, done });
        },
        stopGeneration: async ({ taskId }) => {
          calls.push(`stop:${taskId}`);
          if (stopFails > 0) {
            stopFails--;
            throw new Error("agent unreachable /Users/me");
          }
          turns.get(taskId)?.controller.abort(); // no turn yet => nothing to abort
        },
      },
    }),
    traceId: (taskId) => `trace-${taskId}` as never,
  });
  return {
    runner,
    calls,
    gates,
    turns,
    exists,
    failNextStops: (count: number) => void (stopFails = count),
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

test("positive control: an uncancelled turn finishes and leaves its side effect", async () => {
  const h = await raceHarness();
  try {
    const result = await h.runner.run(requestFor(runIdOf("1")));
    assert.deepEqual(result, { ok: true, taskId: "task-1" });
    assert.equal(await h.turns.get("task-1")!.done, "done");
    assert.equal(await h.exists("task-1"), true, "the harness side effect is observable");
  } finally {
    await h.dispose();
  }
});

test("cancel while the alias is being registered prevents any task and any prompt", async () => {
  const h = await raceHarness(["alias"]);
  try {
    const running = h.runner.run(requestFor(runIdOf("1")));
    assert.deepEqual(await h.runner.cancel(runIdOf("1")), { ok: true, outcome: "prevented" });
    h.gates.alias!.release();
    assert.deepEqual(await running, { ok: false, errorCode: "lumi_managed_automation_cancelled" });
    assert.deepEqual(h.calls, ["alias"], "no createTask, no sendPrompt, nothing to stop");
  } finally {
    await h.dispose();
  }
});

test("cancel while the task is being created sends no prompt", async () => {
  const h = await raceHarness(["create"]);
  try {
    const running = h.runner.run(requestFor(runIdOf("1")));
    await sleep(0); // let the run reach the createTask await
    assert.deepEqual(await h.runner.cancel(runIdOf("1")), { ok: true, outcome: "prevented" });
    h.gates.create!.release();
    assert.deepEqual(await running, { ok: false, errorCode: "lumi_managed_automation_cancelled" });
    assert.deepEqual(h.calls, ["alias", "create"]);
    assert.equal(h.turns.size, 0);
  } finally {
    await h.dispose();
  }
});

test("a stop that races ahead of prompt admission is repeated after admission and really aborts the turn", async () => {
  const h = await raceHarness(["send"]);
  try {
    const running = h.runner.run(requestFor(runIdOf("1")));
    await sleep(0);
    await sleep(0);
    assert.equal(h.calls.includes("send:task-1"), true, "the prompt is in flight, not admitted");
    const cancelling = h.runner.cancel(runIdOf("1"));
    await sleep(0);
    assert.equal(h.turns.size, 0, "the first stop hit an idle Agent and was a no-op");
    h.gates.send!.release(); // the Agent now admits the prompt and starts the turn
    assert.deepEqual(await cancelling, { ok: true, outcome: "stopped" });
    assert.deepEqual(await running, { ok: false, errorCode: "lumi_managed_automation_cancelled" });
    assert.equal(await h.turns.get("task-1")!.done, "aborted", "the in-flight work was aborted");
    await sleep(TURN_MS * 2);
    assert.equal(
      await h.exists("task-1"),
      false,
      "the aborted turn never produced its side effect",
    );
    assert.deepEqual(
      h.calls.filter((call) => call.startsWith("stop")),
      ["stop:task-1", "stop:task-1"],
      "once before and once after admission",
    );
  } finally {
    await h.dispose();
  }
});

test("cancel after the prompt was dispatched aborts only that run's task", async () => {
  const h = await raceHarness();
  try {
    assert.equal((await h.runner.run(requestFor(runIdOf("1")))).ok, true);
    assert.equal((await h.runner.run(requestFor(runIdOf("2")))).ok, true);
    assert.deepEqual(await h.runner.cancel(runIdOf("1")), { ok: true, outcome: "stopped" });
    assert.equal(await h.turns.get("task-1")!.done, "aborted");
    assert.equal(await h.exists("task-1"), false);
    // The unrelated task is untouched and still finishes (positive control for the abort above).
    assert.equal(await h.turns.get("task-2")!.done, "done");
    assert.equal(await h.exists("task-2"), true);
    assert.deepEqual(
      h.calls.filter((call) => call.startsWith("stop")),
      ["stop:task-1"],
    );
  } finally {
    await h.dispose();
  }
});

test("an unknown or never-dispatched run is refused and stops nothing", async () => {
  const h = await raceHarness();
  try {
    assert.equal((await h.runner.run(requestFor(runIdOf("1")))).ok, true);
    assert.deepEqual(await h.runner.cancel(runIdOf("7")), {
      ok: false,
      errorCode: "lumi_managed_automation_run_unknown",
    });
    assert.deepEqual(
      h.calls.filter((call) => call.startsWith("stop")),
      [],
    );
    assert.equal(await h.turns.get("task-1")!.done, "done", "the known run keeps running");
  } finally {
    await h.dispose();
  }
});

test("duplicate and concurrent cancels are idempotent and stop the task once", async () => {
  const h = await raceHarness();
  try {
    assert.equal((await h.runner.run(requestFor(runIdOf("1")))).ok, true);
    const [a, b] = await Promise.all([
      h.runner.cancel(runIdOf("1")),
      h.runner.cancel(runIdOf("1")),
    ]);
    assert.deepEqual(a, { ok: true, outcome: "stopped" });
    assert.deepEqual(b, { ok: true, outcome: "stopped" });
    assert.deepEqual(await h.runner.cancel(runIdOf("1")), {
      ok: true,
      outcome: "already_cancelled",
    });
    assert.equal(h.calls.filter((call) => call.startsWith("stop")).length, 1);
  } finally {
    await h.dispose();
  }
});

test("a failed stop is reported, not memoised, and a retry really stops the turn", async () => {
  const h = await raceHarness();
  try {
    assert.equal((await h.runner.run(requestFor(runIdOf("1")))).ok, true);
    h.failNextStops(1);
    const failed = await h.runner.cancel(runIdOf("1"));
    assert.deepEqual(failed, { ok: false, errorCode: "lumi_managed_automation_stop_failed" });
    assert.equal(JSON.stringify(failed).includes("/Users/me"), false, "no error text leaks");
    assert.deepEqual(await h.runner.cancel(runIdOf("1")), { ok: true, outcome: "stopped" });
    assert.equal(await h.turns.get("task-1")!.done, "aborted");
    assert.equal(await h.exists("task-1"), false);
  } finally {
    await h.dispose();
  }
});

test("a cancelled run is never dispatched again, even when the replay carries a fresh request id", async () => {
  const h = await raceHarness(["alias"]);
  try {
    const running = h.runner.run(requestFor(runIdOf("1")));
    await h.runner.cancel(runIdOf("1"));
    h.gates.alias!.release();
    await running;
    assert.deepEqual(await h.runner.run({ ...requestFor(runIdOf("1")), requestId: "replay" }), {
      ok: false,
      errorCode: "lumi_managed_automation_duplicate",
    });
    assert.deepEqual(h.calls, ["alias"]);
  } finally {
    await h.dispose();
  }
});

test("the same run is never dispatched twice by one host", async () => {
  const { runner, calls } = harness();
  assert.equal((await runner.run(request)).ok, true);
  const again = await runner.run({ ...request, requestId: "main-2" });
  assert.deepEqual(again, { ok: false, errorCode: "lumi_managed_automation_duplicate" });
  assert.equal(calls.filter((call) => call.name === "create").length, 1);

  // 失败的尝试同样占用 run：失败后的重放也不能再建 task（Main 只在 start 之后派发一次）。
  const failing = harness({
    send: () => {
      throw new Error("boom");
    },
  });
  assert.equal((await failing.runner.run(request)).ok, false);
  assert.deepEqual(await failing.runner.run({ ...request, requestId: "main-3" }), {
    ok: false,
    errorCode: "lumi_managed_automation_duplicate",
  });
});
