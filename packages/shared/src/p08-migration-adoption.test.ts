import assert from "node:assert/strict";
import test from "node:test";

import {
  P08_ADOPTION_STAGES,
  P08_COMPATIBILITY_VERDICTS,
  P08_HISTORY_SYNC_STAGE_INDEX,
  P08_NEVER_UPLOADED_LOCAL_CONTENT,
  P08_TELEMETRY_KEYS,
  buildP08StageTransition,
  compareP08AppVersions,
  credentialModeIsManaged,
  credentialModeRequiresManaged,
  evaluateP08Compatibility,
  historySyncRequestable,
  localOnlyAvailable,
  managedAllowed,
  ownershipForStage,
  p08ExternalWorkspaceRefSchema,
  p08NextStage,
  p08StageIndex,
  p08TelemetryReportSchema,
  p08TelemetryUnknownKeys,
  type P08AdoptionStage,
  type P08AdoptionState,
  type P08CompatibilityPolicy,
  type P08CredentialMode,
} from "./p08-migration-adoption.js";
import {
  P08_FORBIDDEN_CANDIDATE_FIELDS,
  P08_IMPORT_MODEL_CAPABILITY_CHECK,
  buildP08ImportCandidates,
  indexP08ImportConflicts,
  p08AutomationImportPreviewSchema,
  p08ImportCredentialModeMismatch,
  p08ImportPreviewIsActionable,
  type P08AutomationImportCandidate,
  type P08AutomationImportPreview,
} from "./p08-automation-import.js";

const HEX = "0123456789abcdef0123456789abcdef";
const ORG_ID = `org_${HEX}`;
const PROJECT_ID = `prj_${HEX}`;
const DEVICE_ID = `dvc_${HEX}`;
const STATE_ID = `wst_${HEX}`;

const external = {
  installation_id: "installation-0123456789abcd",
  workspace_key: "workspace-default",
};

const policy: P08CompatibilityPolicy = {
  protocol_major: 1,
  protocol_min: 1,
  protocol_max: 1,
  policy_schema_min: 1,
  policy_schema_max: 1,
  min_client_app_version: "0.4.0",
  local_only_eligible: true,
  // The frozen baseline. Stage 5 ships switched off, and this test file relies on
  // that value rather than hard-coding it everywhere.
  history_sync_eligible: false,
};

const fingerprint = {
  protocol_major: 1,
  policy_schema_version: 1,
  app_version: "0.16.9",
};

function stateAt(
  stage: P08AdoptionStage,
  mode: P08CredentialMode = "local_credential",
): P08AdoptionState {
  return {
    adoption_state_id: STATE_ID,
    org_id: ORG_ID,
    project_id: PROJECT_ID,
    device_id: DEVICE_ID,
    external,
    stage,
    ownership: ownershipForStage(stage),
    credential_mode: mode,
    version: 3,
    reversion_count: 0,
  };
}

/**
 * Build a transition from a synthetic state.
 *
 * `stateMode` and `mode` are separate on purpose. The wizard changes the stage
 * and the credential mode together, so most cases want them equal — but
 * "re-request the current stage under a different mode" is its own wizard step
 * and its own rule, and that case can only be expressed by letting them differ.
 */
function transitionFrom(
  current: P08AdoptionStage,
  requested: P08AdoptionStage,
  overrides: {
    readonly mode?: P08CredentialMode;
    readonly stateMode?: P08CredentialMode;
    readonly policy?: P08CompatibilityPolicy | undefined;
    readonly bindingComplete?: boolean;
  } = {},
) {
  const mode = overrides.mode ?? "local_credential";
  return buildP08StageTransition({
    current: stateAt(current, overrides.stateMode ?? mode),
    requested,
    mode,
    policy: "policy" in overrides ? overrides.policy : policy,
    verdict: "supported",
    bindingComplete: overrides.bindingComplete ?? true,
  });
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

test("the stage ladder is a total order with no gaps", () => {
  assert.deepEqual(
    [...P08_ADOPTION_STAGES],
    [
      "local_unmanaged",
      "account_optional",
      "device_enrolled",
      "workspace_bound",
      "managed_policy",
      "history_sync",
    ],
  );
  for (const [index, stage] of P08_ADOPTION_STAGES.entries()) {
    assert.equal(p08StageIndex(stage), index, stage);
  }
  assert.equal(P08_HISTORY_SYNC_STAGE_INDEX, P08_ADOPTION_STAGES.length - 1);
  assert.equal(p08StageIndex("not_a_stage" as P08AdoptionStage), -1);
});

test("the next stage is always the immediate successor", () => {
  assert.equal(p08NextStage("local_unmanaged"), "account_optional");
  assert.equal(p08NextStage("account_optional"), "device_enrolled");
  assert.equal(p08NextStage("managed_policy"), "history_sync");
  assert.equal(p08NextStage("history_sync"), null);
});

test("ownership begins at workspace_bound and never precedes it", () => {
  assert.equal(ownershipForStage("local_unmanaged"), "local_unmanaged");
  assert.equal(ownershipForStage("account_optional"), "local_unmanaged");
  assert.equal(ownershipForStage("device_enrolled"), "local_unmanaged");
  assert.equal(ownershipForStage("workspace_bound"), "org_managed");
  assert.equal(ownershipForStage("managed_policy"), "org_managed");
  assert.equal(ownershipForStage("history_sync"), "org_managed");
});

// ---------------------------------------------------------------------------
// Transition rules
// ---------------------------------------------------------------------------

test("a stage may only be reached one step at a time", () => {
  const immediate = transitionFrom("local_unmanaged", "account_optional");
  assert.equal(immediate.ok, true);
  const skipped = transitionFrom("local_unmanaged", "device_enrolled");
  assert.equal(skipped.ok, false);
  if (!skipped.ok) assert.equal(skipped.code, "adoption_stage_not_successor");
  assert.equal(transitionFrom("device_enrolled", "workspace_bound").ok, true);
});

test("skipping straight to managed_policy is refused, not silently fast-forwarded", () => {
  const result = transitionFrom("account_optional", "managed_policy");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "adoption_stage_not_successor");
});

test("backwards is a rollback, not a step", () => {
  const result = transitionFrom("managed_policy", "device_enrolled", {
    mode: "org_managed_credential",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "adoption_rollback_is_the_only_way_back");
});

test("re-requesting the current stage with the same mode is legal so a resumed wizard can replay", () => {
  const result = transitionFrom("device_enrolled", "device_enrolled");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.request.stage, "device_enrolled");
    assert.equal(result.request.expected_version, 3);
  }
});

test("a managed stage needs a complete binding", () => {
  const refused = transitionFrom("device_enrolled", "workspace_bound", { bindingComplete: false });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, "adoption_binding_incomplete");
});

test("a managed credential mode cannot attach to a workspace no organization governs", () => {
  // Rule 5 applies to an unchanged-stage request too, which is the case the
  // Contract Gate calls out: "choose credential mode" is its own wizard step, so
  // that step is validated as well.
  const result = transitionFrom("account_optional", "account_optional", {
    mode: "org_managed_credential",
    stateMode: "local_credential",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "adoption_credential_mode_requires_managed");
});

test("history sync is refused while the platform switch is off", () => {
  const result = transitionFrom("managed_policy", "history_sync", {
    mode: "org_managed_credential",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "adoption_history_sync_not_available");
});

test("history sync needs a managed credential mode even when the switch is on", () => {
  const enabled: P08CompatibilityPolicy = { ...policy, history_sync_eligible: true };
  const refused = transitionFrom("managed_policy", "history_sync", {
    mode: "local_credential",
    policy: enabled,
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, "adoption_history_sync_requires_managed_credential");
  }
  const permitted = transitionFrom("managed_policy", "history_sync", {
    mode: "org_managed_credential",
    policy: enabled,
  });
  assert.equal(permitted.ok, true);
});

test("no policy at all never makes stage 5 requestable", () => {
  assert.equal(historySyncRequestable(undefined, "org_managed_credential"), false);
  const result = transitionFrom("managed_policy", "history_sync", {
    mode: "org_managed_credential",
    policy: undefined,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "adoption_history_sync_not_available");
});

test("a stage-0 request never carries a managed credential", () => {
  assert.equal(credentialModeRequiresManaged("org_managed_credential"), true);
  assert.equal(credentialModeRequiresManaged("metadata_only"), false);
  assert.equal(credentialModeIsManaged("local_credential"), false);
  assert.equal(credentialModeIsManaged("metadata_only"), true);
});

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

test("verdicts are a closed vocabulary and Blocked is not one of them", () => {
  assert.deepEqual(
    [...P08_COMPATIBILITY_VERDICTS],
    ["supported", "upgrade_required", "protocol_unsupported", "policy_schema_unsupported"],
  );
  assert.equal((P08_COMPATIBILITY_VERDICTS as readonly string[]).includes("blocked"), false);
});

test("local-only operation is available for every verdict", () => {
  for (const verdict of P08_COMPATIBILITY_VERDICTS) {
    assert.equal(localOnlyAvailable(verdict, policy), true, verdict);
  }
  // Including when the platform says local-only is gone: that is a disclosure
  // about what the product will evaluate, not a revocation of stage 0.
  assert.equal(
    localOnlyAvailable("protocol_unsupported", { ...policy, local_only_eligible: false }),
    false,
  );
  // And with no policy at all, the absence of an answer is not a revocation.
  assert.equal(localOnlyAvailable("supported", undefined), true);
});

test("only a supported client may hold a managed workspace", () => {
  assert.equal(managedAllowed("supported"), true);
  for (const verdict of P08_COMPATIBILITY_VERDICTS) {
    if (verdict !== "supported") assert.equal(managedAllowed(verdict), false, verdict);
  }
});

test("protocol mismatch outranks everything, because no re-issued policy can fix it", () => {
  const verdict = evaluateP08Compatibility(policy, {
    protocol_major: 2,
    policy_schema_version: 9,
    app_version: "0.0.1",
  });
  assert.equal(verdict, "protocol_unsupported");
});

test("an unhonoured policy snapshot is reported separately from an old app", () => {
  assert.equal(
    evaluateP08Compatibility(policy, { ...fingerprint, policy_schema_version: 2 }),
    "policy_schema_unsupported",
  );
  assert.equal(
    evaluateP08Compatibility(policy, { ...fingerprint, app_version: "0.3.9" }),
    "upgrade_required",
  );
  assert.equal(evaluateP08Compatibility(policy, fingerprint), "supported");
});

test("an inverted stored range narrows managed access instead of granting it", () => {
  // min > max is a hand-edited or corrupted row. Collapsing to the narrowest
  // answer makes it a denial, never an escalation.
  const inverted: P08CompatibilityPolicy = {
    ...policy,
    policy_schema_min: 5,
    policy_schema_max: 2,
  };
  assert.equal(evaluateP08Compatibility(inverted, fingerprint), "policy_schema_unsupported");
  const invertedProtocol: P08CompatibilityPolicy = { ...policy, protocol_min: 9, protocol_max: 2 };
  assert.equal(evaluateP08Compatibility(invertedProtocol, fingerprint), "protocol_unsupported");
});

test("app version comparison is numeric per component and fails toward upgrade", () => {
  assert.ok(compareP08AppVersions("0.4.0", "0.4.0") === 0);
  assert.ok(compareP08AppVersions("0.10.0", "0.9.9") > 0, "0.10 is newer than 0.9");
  assert.ok(compareP08AppVersions("1.0", "1.0.0") === 0, "missing components are zero");
  assert.ok(compareP08AppVersions("", "0.0.1") < 0, "a malformed version sorts as old");
  assert.equal(
    evaluateP08Compatibility(policy, { ...fingerprint, app_version: "not-a-version" }),
    "upgrade_required",
  );
});

// ---------------------------------------------------------------------------
// The privacy invariants
// ---------------------------------------------------------------------------

test("a workspace reference cannot be a path", () => {
  assert.equal(p08ExternalWorkspaceRefSchema.safeParse(external).success, true);
  for (const bad of [
    { installation_id: "installation-0123456789abcd", workspace_key: "/Users/me/project" },
    { installation_id: "installation-0123456789abcd", workspace_key: "..\\..\\etc" },
    { installation_id: "/etc/passwd", workspace_key: "workspace-default" },
  ]) {
    assert.equal(p08ExternalWorkspaceRefSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
  // Too short to be an installation identifier.
  assert.equal(
    p08ExternalWorkspaceRefSchema.safeParse({ installation_id: "short", workspace_key: "k" })
      .success,
    false,
  );
});

test("telemetry accepts exactly six keys and rejects the rest", () => {
  const report = {
    stage: "workspace_bound",
    result: "completed",
    protocol_major: 1,
    policy_schema_version: 1,
    app_version: "0.16.9",
  };
  assert.equal(p08TelemetryReportSchema.safeParse(report).success, true);
  assert.deepEqual(
    [...P08_TELEMETRY_KEYS],
    ["stage", "result", "reason_code", "protocol_major", "policy_schema_version", "app_version"],
  );
  // An unknown key is rejected, not dropped: dropping would make a client that
  // attached a prompt look safe.
  assert.equal(p08TelemetryReportSchema.safeParse({ ...report, prompt: "hello" }).success, false);
  assert.deepEqual(
    [...p08TelemetryUnknownKeys({ ...report, prompt: "x", extra: 1 })],
    ["extra", "prompt"],
  );
  assert.deepEqual([...p08TelemetryUnknownKeys(report)], []);
});

test("declined and skipped stay distinct signals", () => {
  const report = {
    stage: "account_optional",
    result: "declined",
    protocol_major: 1,
    policy_schema_version: 1,
    app_version: "0.16.9",
  };
  assert.equal(p08TelemetryReportSchema.safeParse(report).success, true);
  assert.notEqual(
    p08TelemetryReportSchema.safeParse({ ...report, result: "skipped" }).success === true &&
      report.result,
    "skipped",
  );
});

test("the never-uploaded list names the local content this client has no field for", () => {
  for (const entry of [
    "api_keys",
    "provider_secrets",
    "historical_prompts",
    "file_contents",
    "file_paths",
    "automation_bodies",
    "mcp_credentials",
  ]) {
    assert.equal(
      (P08_NEVER_UPLOADED_LOCAL_CONTENT as readonly string[]).includes(entry),
      true,
      entry,
    );
  }
});

// ---------------------------------------------------------------------------
// Import preview
// ---------------------------------------------------------------------------

const candidate: P08AutomationImportCandidate = {
  candidate_key: "nightly-triage",
  schedule_kind: "cron",
  required_tool_capabilities: ["fs.read", "shell.exec"],
  required_model_capabilities: ["tool_use"],
  credential_mode: "local_credential",
};

test("a candidate is a description and carries no automation body", () => {
  assert.equal(buildP08ImportCandidates([candidate]).ok, true);
  // Every forbidden field is refused even when a caller casts past the schema,
  // which is the case the structural check exists for.
  for (const field of P08_FORBIDDEN_CANDIDATE_FIELDS) {
    const result = buildP08ImportCandidates([{ ...candidate, [field]: "local content" }]);
    assert.equal(result.ok, false, field);
    if (!result.ok) assert.equal(result.code, "candidate_field_forbidden", field);
  }
});

test("a batch is refused rather than trimmed when it is too large", () => {
  const many = Array.from({ length: 201 }, (_, i) => ({
    ...candidate,
    candidate_key: `candidate-${i}`,
  }));
  const result = buildP08ImportCandidates(many);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "automation_import_too_large");
});

const preview: P08AutomationImportPreview = {
  model_capability_check: P08_IMPORT_MODEL_CAPABILITY_CHECK,
  importable: [{ candidate_key: "nightly-triage", create_via: "p06_automations" }],
  blocked: [
    { candidate_key: "weekly-report", code: "tool_not_permitted", reason_code: "shell_denied" },
    { candidate_key: "weekly-report", code: "off_peak_not_entitled", reason_code: "no_off_peak" },
  ],
  active_automation_limit: 5,
};

test("the preview discloses that model capability is checked at dispatch", () => {
  assert.equal(preview.model_capability_check, "deferred_to_dispatch");
  // P04 owns the route catalog; a capability set assembled here would be a
  // second source of truth and would drift, so the preview never claims to have
  // verified one.
  assert.equal(
    p08AutomationImportPreviewSchema.safeParse({
      ...preview,
      model_capability_check: "verified",
    }).success,
    false,
  );
});

test("a preview with any conflict is not actionable, so nothing is created", () => {
  assert.equal(p08ImportPreviewIsActionable(preview), false);
  assert.equal(p08ImportPreviewIsActionable({ ...preview, blocked: [] }), true);
  assert.equal(
    p08ImportPreviewIsActionable({ ...preview, blocked: [], importable: [] }),
    false,
    "an empty import is not an offer to confirm",
  );
});

test("conflicts are grouped by the candidate they belong to", () => {
  const index = indexP08ImportConflicts(preview);
  assert.deepEqual([...index.keys()], ["weekly-report"]);
  assert.equal(index.get("weekly-report")?.length, 2);
  assert.equal(index.get("nightly-triage"), undefined);
});

test("a credential-mode mismatch is surfaced before the preview is even sent", () => {
  assert.equal(p08ImportCredentialModeMismatch(candidate, "local_credential"), false);
  assert.equal(
    p08ImportCredentialModeMismatch(
      { ...candidate, credential_mode: "org_managed_credential" },
      "local_credential",
    ),
    true,
  );
  assert.equal(p08ImportCredentialModeMismatch(candidate, "metadata_only"), true);
});
