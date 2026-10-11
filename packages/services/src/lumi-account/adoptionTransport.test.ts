import test from "node:test";
import assert from "node:assert/strict";
import { LumiAdoptionHostTransport } from "./adoptionTransport.js";

const orgId = `org_${"a".repeat(32)}`;
const adoptionStateId = `wst_${"f".repeat(32)}`;

function row(mode: string, stage = "workspace_bound", version = 4) {
  return {
    adoption_state_id: adoptionStateId,
    org_id: orgId,
    external_installation_id: "1".repeat(64),
    external_workspace_key: "2".repeat(64),
    display_name: "Customer Project",
    bound_project_id: `prj_${"d".repeat(32)}`,
    bound_device_id: `dvc_${"c".repeat(32)}`,
    stage,
    ownership: "org_managed",
    credential_mode: mode,
    version,
  };
}

function transport(respond: (body: Record<string, unknown>) => unknown) {
  const sent: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const instance = new LumiAdoptionHostTransport(async (path, method, body) => {
    const parsed = (body ?? {}) as Record<string, unknown>;
    sent.push({ path, method, body: parsed });
    return new Response(JSON.stringify(respond(parsed)), { status: 200 });
  });
  return { instance, sent };
}

const base = { orgId, adoptionStateId, version: 3, clientAppVersion: "3.14.3" };

test("advance sends the supplied label and never a hardcoded local_credential", async () => {
  for (const mode of ["metadata_only", "org_managed_credential", "local_credential"] as const) {
    const { instance, sent } = transport((body) => row(String(body.credential_mode)));
    await instance.advanceAdoptionRecord(
      { ...base, stage: "managed_policy", credentialMode: mode },
      "idem-1",
    );
    assert.equal(sent[0]!.method, "PATCH");
    assert.equal(sent[0]!.body.credential_mode, mode);
    assert.equal(sent[0]!.body.stage, "managed_policy");
  }
});

test("a mode-only change keeps the stage, sends only frozen fields and no secret field", async () => {
  const { instance, sent } = transport((body) => row(String(body.credential_mode)));
  const record = await instance.changeAdoptionCredentialMode(
    { ...base, stage: "managed_policy", credentialMode: "metadata_only" },
    "idem-2",
  );
  assert.equal(record.credentialMode, "metadata_only");
  assert.deepEqual(Object.keys(sent[0]!.body).sort(), [
    "client_app_version",
    "client_protocol_major",
    "credential_mode",
    "policy_schema_version",
    "stage",
    "version",
  ]);
  assert.equal(sent[0]!.path, `/api/v1/orgs/${orgId}/adoption/bindings/${adoptionStateId}`);
});

test("invalid label, stage 5 and bad versions are refused before any request", async () => {
  const { instance, sent } = transport(() => row("local_credential"));
  await assert.rejects(
    instance.changeAdoptionCredentialMode(
      { ...base, stage: "managed_policy", credentialMode: "copy_local_key" as never },
      "k",
    ),
    /lumi_workspace_invalid/,
  );
  await assert.rejects(
    instance.changeAdoptionCredentialMode(
      { ...base, stage: "history_sync" as never, credentialMode: "metadata_only" },
      "k",
    ),
    /lumi_workspace_invalid/,
  );
  await assert.rejects(
    instance.changeAdoptionCredentialMode(
      { ...base, version: 0, stage: "managed_policy", credentialMode: "metadata_only" },
      "k",
    ),
    /lumi_workspace_invalid/,
  );
  assert.equal(sent.length, 0);
});

test("a response row with an unknown label is rejected", async () => {
  const { instance } = transport(() => row("copy_local_key"));
  await assert.rejects(
    instance.changeAdoptionCredentialMode(
      { ...base, stage: "managed_policy", credentialMode: "metadata_only" },
      "k",
    ),
    /lumi_response_invalid/,
  );
});

const modeChange = {
  ...base,
  stage: "managed_policy" as const,
  credentialMode: "metadata_only" as const,
};

test("a replayed full row for another record or organization is rejected", async () => {
  for (const patch of [
    { adoption_state_id: `wst_${"1".repeat(32)}` },
    { org_id: `org_${"9".repeat(32)}` },
  ]) {
    const { instance } = transport(() => ({ ...row("metadata_only"), ...patch }));
    await assert.rejects(
      instance.changeAdoptionCredentialMode(modeChange, "k"),
      /lumi_response_invalid/,
    );
  }
});

test("a replayed row that breaks the label/ownership or version invariant is rejected", async () => {
  const broken = [
    { ...row("org_managed_credential"), ownership: "local_unmanaged" },
    { ...row("metadata_only"), version: 0 },
    { ...row("metadata_only"), version: 1.5 },
    { ...row("metadata_only"), version: "4" },
    { ...row("metadata_only"), stage: "history_sync_v2" },
  ];
  for (const body of broken) {
    const { instance } = transport(() => body);
    await assert.rejects(
      instance.changeAdoptionCredentialMode(modeChange, "k"),
      /lumi_response_invalid/,
    );
  }
});

test("a replayed row keeps the server's own mode, which the owner then fences by re-reading", async () => {
  const { instance } = transport(() => row("local_credential", "managed_policy", 7));
  const record = await instance.changeAdoptionCredentialMode(modeChange, "k");
  assert.equal(record.credentialMode, "local_credential");
  assert.equal(record.version, 7);
});
