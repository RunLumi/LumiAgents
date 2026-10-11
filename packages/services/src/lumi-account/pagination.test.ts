import test from "node:test";
import assert from "node:assert/strict";
import { LumiAdoptionHostTransport } from "./adoptionTransport.js";
import { LumiDeviceHostTransport } from "./deviceTransport.js";
import { readCompletePages } from "./pagination.js";

const orgId = `org_${"a".repeat(32)}`;
const hex = (n: number, width = 32) => n.toString(16).padStart(width, "0");

function project(n: number) {
  return {
    id: `prj_${hex(n)}`,
    name: `Project ${n}`,
    slug: `project-${n}`,
    archived: false,
    visibility: "org",
  };
}

function adoption(n: number, org = orgId) {
  return {
    adoption_state_id: `wst_${hex(n)}`,
    org_id: org,
    external_installation_id: "1".repeat(64),
    external_workspace_key: hex(n, 64),
    display_name: `Workspace ${n}`,
    bound_project_id: null,
    bound_device_id: null,
    stage: "local_unmanaged",
    ownership: "local_unmanaged",
    credential_mode: "local_credential",
    version: 1,
  };
}

const rows = <T>(count: number, make: (n: number) => T, from = 1) =>
  Array.from({ length: count }, (_, i) => make(from + i));

function adoptionTransport(pages: unknown[]) {
  const paths: string[] = [];
  const instance = new LumiAdoptionHostTransport(async (path) => {
    paths.push(path);
    const body = pages[paths.length - 1];
    if (body === undefined) throw new Error("unexpected extra request");
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { instance, paths };
}

test("projects: follows next_cursor across pages until has_more is false", async () => {
  const { instance, paths } = adoptionTransport([
    { items: rows(100, project), next_cursor: "aa01", has_more: true },
    { items: rows(100, project, 101), next_cursor: "aa02", has_more: true },
    { items: rows(3, project, 201), next_cursor: null, has_more: false },
  ]);
  const projects = await instance.listProjects(orgId);
  assert.equal(projects.length, 203);
  assert.equal(new Set(projects.map((item) => item.id)).size, 203);
  assert.deepEqual(paths, [
    `/api/v1/orgs/${orgId}/projects?limit=100`,
    `/api/v1/orgs/${orgId}/projects?limit=100&cursor=aa01`,
    `/api/v1/orgs/${orgId}/projects?limit=100&cursor=aa02`,
  ]);
});

test("projects: a full last page with has_more=false is complete (server fetches limit+1)", async () => {
  const { instance } = adoptionTransport([
    { items: rows(100, project), next_cursor: null, has_more: false },
  ]);
  assert.equal((await instance.listProjects(orgId)).length, 100);
});

test("projects: has_more without a usable cursor, a cycle, an empty continuation or a repeated row all fail", async () => {
  const bad: unknown[][] = [
    [{ items: rows(2, project), next_cursor: null, has_more: true }],
    [{ items: rows(2, project), has_more: true }],
    [
      { items: rows(2, project), next_cursor: "aa01", has_more: true },
      { items: rows(2, project, 3), next_cursor: "aa01", has_more: true },
    ],
    [
      { items: rows(2, project), next_cursor: "aa01", has_more: true },
      { items: [], has_more: true, next_cursor: "aa02" },
    ],
    [
      { items: rows(2, project), next_cursor: "aa01", has_more: true },
      { items: rows(2, project, 2), next_cursor: null, has_more: false },
    ],
    [{ items: rows(2, project), next_cursor: "aa01", has_more: false }],
    [{ items: rows(2, project), next_cursor: "not a cursor!", has_more: true }],
    [{ items: rows(101, project), has_more: false }],
  ];
  for (const pages of bad) {
    const { instance } = adoptionTransport(pages);
    await assert.rejects(instance.listProjects(orgId), /lumi_response_invalid/);
  }
});

test("projects: an endless continuation is bounded instead of looping", async () => {
  let call = 0;
  const instance = new LumiAdoptionHostTransport(async () => {
    call += 1;
    return new Response(
      JSON.stringify({
        items: rows(1, project, call),
        next_cursor: `c${hex(call, 4)}`,
        has_more: true,
      }),
      { status: 200 },
    );
  });
  await assert.rejects(instance.listProjects(orgId), /lumi_page_incomplete/);
  assert.ok(call <= 20);
});

test("adoption: a full page of 100 rows is never treated as complete", async () => {
  for (const extra of [{}, { has_more: false }, { has_more: false, next_cursor: null }]) {
    const { instance } = adoptionTransport([
      { items: rows(100, (n) => adoption(n)), count: 100, ...extra },
    ]);
    await assert.rejects(instance.listAdoptionRecords(orgId), /lumi_page_incomplete/);
  }
});

test("adoption: fewer than 100 rows is complete; rows of another org or repeated rows are refused", async () => {
  const ok = adoptionTransport([{ items: rows(99, (n) => adoption(n)), count: 99 }]);
  assert.equal((await ok.instance.listAdoptionRecords(orgId)).length, 99);
  const foreign = adoptionTransport([
    { items: [adoption(1), adoption(2, `org_${"b".repeat(32)}`)], count: 2 },
  ]);
  await assert.rejects(foreign.instance.listAdoptionRecords(orgId), /lumi_response_invalid/);
  const repeated = adoptionTransport([{ items: [adoption(1), adoption(1)], count: 2 }]);
  await assert.rejects(repeated.instance.listAdoptionRecords(orgId), /lumi_response_invalid/);
});

test("adoption: follows a real cursor if the server starts sending one", async () => {
  const { instance, paths } = adoptionTransport([
    { items: rows(100, (n) => adoption(n)), next_cursor: "bb01", has_more: true },
    { items: rows(5, (n) => adoption(n), 101), next_cursor: null, has_more: false },
  ]);
  assert.equal((await instance.listAdoptionRecords(orgId)).length, 105);
  assert.equal(paths[1], `/api/v1/orgs/${orgId}/adoption/bindings?limit=100&cursor=bb01`);
});

test("readCompletePages: non-object and non-array bodies are refused", async () => {
  for (const body of [null, "x", { items: "no" }, { items: [], has_more: "yes" }]) {
    await assert.rejects(
      readCompletePages({
        fetchPage: async () => body,
        parse: (value) => value,
        keyOf: String,
        invalid: "lumi_response_invalid",
        ceilingWithoutCursor: false,
      }),
      /lumi_response_invalid/,
    );
  }
});

const deviceId = `dvc_${"c".repeat(32)}`;
function binding(n: number) {
  return {
    id: `wsb_${hex(n)}`,
    org_id: orgId,
    project_id: `prj_${"d".repeat(32)}`,
    device_id: deviceId,
    workspace_identity: hex(n, 64),
    display_name: `Workspace ${n}`,
    environment_type: "local",
  };
}

async function deviceTransport(items: unknown[]) {
  const instance = new LumiDeviceHostTransport(
    "https://agents-cp.example",
    async () => new Response(JSON.stringify({ items, next_cursor: null, has_more: false })),
    {
      async load() {
        return {
          id: deviceId,
          orgId,
          token: "e".repeat(64),
          tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          policyVersion: 1,
        };
      },
      async save() {},
    },
  );
  await instance.restore();
  return instance;
}

test("device bindings: the server's hard ceiling with has_more=false is not proof of completeness", async () => {
  await assert.rejects(
    (await deviceTransport(rows(100, binding))).listWorkspaceBindings(),
    /lumi_page_incomplete/,
  );
  assert.equal(
    (await (await deviceTransport(rows(99, binding))).listWorkspaceBindings()).length,
    99,
  );
  await assert.rejects(
    (await deviceTransport([binding(1), binding(1)])).listWorkspaceBindings(),
    /lumi_device_response_invalid/,
  );
});
