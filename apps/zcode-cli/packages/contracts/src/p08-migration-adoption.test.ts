import assert from "node:assert/strict";
import test from "node:test";

import {
  P08_ADOPTION_API_BASE_PATH,
  P08_COMPATIBILITY_ROUTE,
  P08AdoptionWizard,
  assertP08StageRequestable,
  buildP08AdoptionPath,
  isP08AdoptionError,
  resolveOfflineCompatibility,
  type P08AdoptionCompatibilityResponse,
  type P08AdoptionTransport,
  type P08AdoptionState,
} from "./p08-migration-adoption.js";
import {
  ownershipForStage,
  type P08AdoptionStage,
  type P08AutomationImportCandidate,
  type P08ClientFingerprint,
  type P08CompatibilityPolicy,
  type P08CredentialMode,
  type P08StageRequest,
  type P08TelemetryReport,
} from "@zcode/shared";

const HEX = "0123456789abcdef0123456789abcdef";
const ORG_ID = `org_${HEX}`;
const STATE_ID = `wst_${HEX}`;

const policy: P08CompatibilityPolicy = {
  protocol_major: 1,
  protocol_min: 1,
  protocol_max: 1,
  policy_schema_min: 1,
  policy_schema_max: 1,
  min_client_app_version: "0.4.0",
  local_only_eligible: true,
  history_sync_eligible: false,
};

const fingerprint: P08ClientFingerprint = {
  protocol_major: 1,
  policy_schema_version: 1,
  app_version: "0.16.9",
};

const compatibilityResponse: P08AdoptionCompatibilityResponse = {
  policy,
  verdict: "supported",
  stages: ["local_unmanaged", "account_optional", "device_enrolled", "workspace_bound", "managed_policy", "history_sync"],
};

interface Recorder {
  readonly calls: string[];
  readonly requests: P08StageRequest[];
  readonly idempotencyKeys: string[];
  readonly candidates: P08AutomationImportCandidate[][];
  readonly telemetry: P08TelemetryReport[];
  /** When set, every transport method rejects with it. */
  offline?: Error;
}

function stateAt(stage: P08AdoptionStage, mode: P08CredentialMode): P08AdoptionState {
  return {
    adoption_state_id: STATE_ID,
    org_id: ORG_ID,
    project_id: `prj_${HEX}`,
    device_id: `dvc_${HEX}`,
    external: { installation_id: "installation-0123456789abcd", workspace_key: "workspace-default" },
    stage,
    ownership: ownershipForStage(stage),
    credential_mode: mode,
    version: 1,
    reversion_count: 0,
  };
}

/**
 * A transport that records what it was asked to send. Its whole purpose is to
 * make the upload surface observable: if a content field ever reached a request
 * body, it would be visible in `recorder.requests`.
 */
function createTransport(recorder: Recorder): P08AdoptionTransport {
  const guard = <T>(fn: () => Promise<T>): Promise<T> =>
    recorder.offline === undefined ? fn() : Promise.reject(recorder.offline);
  return {
    getCompatibility: () => {
      recorder.calls.push("compatibility");
      return guard(async () => compatibilityResponse);
    },
    getAdoption: () => {
      recorder.calls.push("adoption");
      return guard(async () => ({}));
    },
    createBinding: (input) => {
      recorder.calls.push("createBinding");
      recorder.requests.push(input.body);
      recorder.idempotencyKeys.push(input.idempotencyKey);
      return guard(async () => stateAt(input.body.stage, input.body.credential_mode ?? "local_credential"));
    },
    advanceBinding: (input) => {
      recorder.calls.push("advanceBinding");
      recorder.requests.push(input.body);
      recorder.idempotencyKeys.push(input.idempotencyKey);
      return guard(async () => stateAt(input.body.stage, input.body.credential_mode ?? "local_credential"));
    },
    rollbackBinding: (input) => {
      recorder.calls.push("rollbackBinding");
      recorder.idempotencyKeys.push(input.idempotencyKey);
      return guard(async () => ({
        state: stateAt("local_unmanaged", "local_credential"),
        local_data_modified: false as const,
      }));
    },
    reportTelemetry: (input) => {
      recorder.calls.push("telemetry");
      recorder.telemetry.push(input.body);
      return guard(async () => ({}));
    },
    previewAutomationImport: (input) => {
      recorder.calls.push("importPreview");
      recorder.candidates.push([...input.candidates]);
      return guard(async () => ({
        model_capability_check: "deferred_to_dispatch",
        importable: [],
        blocked: [],
        active_automation_limit: 0,
      }));
    },
  };
}

function newRecorder(): Recorder {
  return { calls: [], requests: [], idempotencyKeys: [], candidates: [], telemetry: [] };
}

function newWizard(recorder: Recorder, withFingerprint = true): P08AdoptionWizard {
  let counter = 0;
  return new P08AdoptionWizard({
    transport: createTransport(recorder),
    installationId: "installation-0123456789abcd",
    workspaceKey: "workspace-default",
    nextIdempotencyKey: () => `idem-${(counter += 1)}`,
    ...(withFingerprint ? { fingerprint } : {}),
  });
}

/** Assert a stable local refusal code rather than a message string. */
async function rejectsWithCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    assert.ok(isP08AdoptionError(error), `expected an adoption error, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

test("P08 routes are built from validated opaque IDs only", () => {
  assert.equal(P08_COMPATIBILITY_ROUTE, "/api/v1/compatibility");
  assert.equal(buildP08AdoptionPath("bindings", { orgId: ORG_ID }), `${P08_ADOPTION_API_BASE_PATH}/orgs/${ORG_ID}/adoption/bindings`);
  assert.equal(
    buildP08AdoptionPath("binding", { orgId: ORG_ID, stateId: STATE_ID }),
    `${P08_ADOPTION_API_BASE_PATH}/orgs/${ORG_ID}/adoption/bindings/${STATE_ID}`,
  );
  assert.equal(
    buildP08AdoptionPath("rollback", { orgId: ORG_ID, stateId: STATE_ID }),
    `${P08_ADOPTION_API_BASE_PATH}/orgs/${ORG_ID}/adoption/bindings/${STATE_ID}/rollback`,
  );
  assert.equal(
    buildP08AdoptionPath("import-preview", { orgId: ORG_ID }),
    `${P08_ADOPTION_API_BASE_PATH}/orgs/${ORG_ID}/adoption/automation-imports/preview`,
  );
});

test("the compatibility route needs no organization at all", () => {
  // It is deliberately outside the org tree: a local client that has never signed
  // in has to be able to ask what this control plane supports before deciding
  // whether to create an account at all. It therefore takes no ID, and passing
  // one is harmless rather than an error — the one unauthenticated route should
  // not be the awkward one to call.
  assert.equal(buildP08AdoptionPath("compatibility"), "/api/v1/compatibility");
  assert.equal(buildP08AdoptionPath("compatibility", { orgId: ORG_ID }), "/api/v1/compatibility");
  assert.equal(P08_COMPATIBILITY_ROUTE.includes(ORG_ID), false);
});

test("a non-opaque identifier can never reach a path segment", () => {
  for (const bad of ["../../etc/passwd", "org_XYZ", "", "org_", ORG_ID.toUpperCase()]) {
    assert.throws(
      () => buildP08AdoptionPath("bindings", { orgId: bad }),
      /requires a org_ opaque ID/,
      bad,
    );
  }
  // A traversal attempt that happens to look opaque is still rejected, because
  // the shape check requires exactly 32 lowercase hex characters.
  assert.throws(() => buildP08AdoptionPath("bindings", { orgId: `org_${"g".repeat(32)}` }));
});

// ---------------------------------------------------------------------------
// Offline startup
// ---------------------------------------------------------------------------

test("stage 0 is answerable with no network and no account", () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  recorder.offline = new Error("network is unreachable");
  assert.deepEqual(wizard.localStage0(), { stage: "local_unmanaged", ownership: "local_unmanaged" });
  assert.deepEqual(recorder.calls, [], "stage 0 must not touch the transport");
});

test("an unreachable control plane is a disclosure gap, not a failure", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  recorder.offline = new Error("network is unreachable");
  assert.equal(await wizard.checkCompatibility(), undefined);
  assert.deepEqual(wizard.localStage0().stage, "local_unmanaged");
});

test("offline compatibility is permissive and never blocks stage 0", () => {
  assert.deepEqual(resolveOfflineCompatibility(undefined, undefined), {
    verdict: "supported",
    localOnlyAvailable: true,
    managedAllowed: true,
  });
  assert.deepEqual(resolveOfflineCompatibility(policy, fingerprint), {
    verdict: "supported",
    localOnlyAvailable: true,
    managedAllowed: true,
  });
  const stale = resolveOfflineCompatibility(policy, { ...fingerprint, app_version: "0.1.0" });
  assert.equal(stale.verdict, "upgrade_required");
  assert.equal(stale.localOnlyAvailable, true, "stage 0 survives an old client");
  assert.equal(stale.managedAllowed, false);
});

// ---------------------------------------------------------------------------
// The ladder, driven
// ---------------------------------------------------------------------------

test("no stage is skipped by any call the wizard exposes", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await wizard.begin({ orgId: ORG_ID });
  assert.equal(wizard.state?.stage, "local_unmanaged");
  assert.equal(wizard.nextStage(), "account_optional");

  await rejectsWithCode(
    () => wizard.advance({ orgId: ORG_ID, stage: "workspace_bound", policy }),
    "adoption_stage_not_successor",
  );
  await rejectsWithCode(
    () => wizard.advance({ orgId: ORG_ID, stage: "managed_policy", policy }),
    "adoption_stage_not_successor",
  );
  // Nothing was sent for either refusal.
  assert.deepEqual(recorder.calls, ["createBinding"]);
});

test("each explicit step advances exactly one stage and nothing else", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await wizard.begin({ orgId: ORG_ID });
  for (const stage of ["account_optional", "device_enrolled"] as const) {
    await wizard.advance({ orgId: ORG_ID, stage, policy });
  }
  assert.equal(wizard.state?.stage, "device_enrolled");
  assert.deepEqual(
    recorder.calls,
    ["createBinding", "advanceBinding", "advanceBinding"],
  );
  // Every advance named exactly the stage the caller asked for.
  assert.deepEqual(
    recorder.requests.map((r) => r.stage),
    ["local_unmanaged", "account_optional", "device_enrolled"],
  );
  // And every mutation carried a distinct idempotency key, which is what makes a
  // resumed wizard safe to replay.
  assert.deepEqual(recorder.idempotencyKeys, ["idem-1", "idem-2", "idem-3"]);
});

test("signing in does not move the stage: ownership comes from the stage alone", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await wizard.begin({ orgId: ORG_ID });
  // A compatibility check is a read. It must not have any effect on the ladder.
  await wizard.checkCompatibility();
  assert.equal(wizard.state?.stage, "local_unmanaged");
  assert.equal(wizard.state?.ownership, "local_unmanaged");
});

test("a managed stage is refused without a complete binding", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await wizard.begin({ orgId: ORG_ID });
  await wizard.advance({ orgId: ORG_ID, stage: "account_optional", policy });
  await wizard.advance({ orgId: ORG_ID, stage: "device_enrolled", policy });
  await rejectsWithCode(
    () => wizard.advance({ orgId: ORG_ID, stage: "workspace_bound", policy, bindingComplete: false }),
    "adoption_binding_incomplete",
  );
  const bound = await wizard.advance({
    orgId: ORG_ID,
    stage: "workspace_bound",
    policy,
    bindingComplete: true,
  });
  assert.equal(bound.stage, "workspace_bound");
  assert.equal(bound.ownership, "org_managed");
});

test("history sync is unreachable from the wizard while the switch is off", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await wizard.begin({ orgId: ORG_ID });
  for (const stage of ["account_optional", "device_enrolled", "workspace_bound"] as const) {
    await wizard.advance({ orgId: ORG_ID, stage, policy, bindingComplete: true });
  }
  await wizard.advance({
    orgId: ORG_ID,
    stage: "managed_policy",
    policy,
    mode: "org_managed_credential",
    bindingComplete: true,
  });
  await rejectsWithCode(
    () =>
      wizard.advance({
        orgId: ORG_ID,
        stage: "history_sync",
        policy,
        mode: "org_managed_credential",
        bindingComplete: true,
      }),
    "adoption_history_sync_not_available",
  );
  assert.equal(wizard.state?.stage, "managed_policy");
});

test("the standalone stage-5 guard refuses the same two ways", () => {
  assert.throws(
    () => assertP08StageRequestable("history_sync", policy, "org_managed_credential"),
    /history sync is switched off/,
  );
  const enabled: P08CompatibilityPolicy = { ...policy, history_sync_eligible: true };
  assert.throws(
    () => assertP08StageRequestable("history_sync", enabled, "local_credential"),
    /managed inference/,
  );
  assert.doesNotThrow(() =>
    assertP08StageRequestable("history_sync", enabled, "org_managed_credential"),
  );
  // Every earlier stage is always requestable.
  assert.doesNotThrow(() => assertP08StageRequestable("managed_policy", policy, "local_credential"));
});

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

test("rollback is the only way back and it returns local data untouched", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await wizard.begin({ orgId: ORG_ID });
  for (const stage of ["account_optional", "device_enrolled", "workspace_bound"] as const) {
    await wizard.advance({ orgId: ORG_ID, stage, policy, bindingComplete: true });
  }
  const result = await wizard.rollback({ orgId: ORG_ID });
  assert.equal(result.local_data_modified, false);
  assert.equal(result.state.stage, "local_unmanaged");
  // The credential label returns to local too: keeping org_managed_credential
  // after an unbind would claim the organization still holds a secret for a
  // workspace it no longer governs.
  assert.equal(result.state.credential_mode, "local_credential");
  assert.equal(result.state.ownership, "local_unmanaged");
  // The adoption record survives, so a re-enrolled workspace is recognised.
  assert.equal(result.state.reversion_count, 0);
  assert.equal(wizard.state?.stage, "local_unmanaged");
});

test("rolling back a workspace that is already local is refused, not a no-op success", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await rejectsWithCode(() => wizard.rollback({ orgId: ORG_ID }), "adoption_rollback_is_the_only_way_back");
  await wizard.begin({ orgId: ORG_ID });
  await rejectsWithCode(() => wizard.rollback({ orgId: ORG_ID }), "adoption_rollback_is_the_only_way_back");
  assert.equal(recorder.calls.includes("rollbackBinding"), false);
});

test("backwards through the ladder is refused rather than decremented", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await wizard.begin({ orgId: ORG_ID });
  await wizard.advance({ orgId: ORG_ID, stage: "account_optional", policy });
  await rejectsWithCode(
    () => wizard.advance({ orgId: ORG_ID, stage: "local_unmanaged", policy }),
    "adoption_rollback_is_the_only_way_back",
  );
});

// ---------------------------------------------------------------------------
// The upload surface
// ---------------------------------------------------------------------------

test("no stage request body can carry local content", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await wizard.begin({ orgId: ORG_ID });
  await wizard.advance({ orgId: ORG_ID, stage: "account_optional", policy });
  for (const request of recorder.requests) {
    assert.deepEqual(
      Object.keys(request).sort(),
      // stage, external, credential_mode, expected_version — nothing else.
      ["credential_mode", "expected_version", "external", "stage"].filter((k) => k in request).sort(),
    );
    assert.deepEqual(Object.keys(request.external).sort(), ["installation_id", "workspace_key"]);
    const serialized = JSON.stringify(request);
    assert.equal(serialized.includes("/Users/"), false, "no path may appear");
  }
});

test("stage 0 cannot be begun with a managed credential", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await rejectsWithCode(
    () => wizard.begin({ orgId: ORG_ID, mode: "org_managed_credential" }),
    "adoption_credential_mode_requires_managed",
  );
  assert.deepEqual(recorder.calls, []);
});

test("the workspace reference is a body field, never a path segment", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await wizard.begin({ orgId: ORG_ID });
  const request = recorder.requests[0];
  assert.ok(request);
  assert.equal(request.external.installation_id, "installation-0123456789abcd");
  assert.equal(request.external.workspace_key, "workspace-default");
  // The route the wizard used carried only the opaque org ID.
  assert.equal(buildP08AdoptionPath("bindings", { orgId: ORG_ID }).includes("workspace-default"), false);
});

test("advance before begin is refused rather than creating a binding implicitly", async () => {
  const recorder = newRecorder();
  const wizard = newWizard(recorder);
  await rejectsWithCode(
    () => wizard.advance({ orgId: ORG_ID, stage: "account_optional", policy }),
    "adoption_stage_not_successor",
  );
  assert.deepEqual(recorder.calls, []);
});
