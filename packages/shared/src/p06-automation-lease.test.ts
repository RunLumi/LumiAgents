import assert from "node:assert/strict";
import test from "node:test";

import {
  P06_DUE_WORK_MAX_ITEMS,
  decodeAutomationWire,
  isP06AutomationServerErrorCode,
  isP06OpaqueId,
  p06AutomationClaimRequestSchema,
  p06AutomationClaimResponseSchema,
  p06AutomationDueWorkResponseSchema,
  p06AutomationLeaseFenceRequestSchema,
  p06AutomationOccurrenceRefSchema,
  p06AutomationSettleRequestSchema,
  p06AutomationStartGrantSchema,
} from "./p06-automation-lease.js";
import {
  P06_AUTOMATION_MUTATION_TOOL_NAMES,
  P06_AUTOMATION_RESTRICTED_TOOL_NAMES,
  P06_OFF_PEAK_FAIL_CLOSED_CONSTRAINTS,
  acceptOffPeakTicketRenewal,
  buildAutomationOccurrenceToolDenylist,
  isOffPeakPolicyUsable,
  narrowOffPeakToolConstraints,
  p06OffPeakPolicySchema,
  resolveAutomationExecutionClass,
} from "./p06-off-peak-execution.js";

// Values mirror docs/implementation/fixtures/p06-contracts-v1.json.
const HEX = "0123456789abcdef0123456789abcdef";
const occurrence = {
  occurrence_id: `occ_${HEX}`,
  automation_id: `aut_${HEX}`,
  attempt: 0,
  scheduled_for: "2026-09-25T16:00:00.000Z",
  off_peak_mode: "normal" as const,
  policy_snapshot_id: `pol_${HEX}`,
  policy_version: 4,
  execution_principal: { kind: "user" as const, id: `usr_${HEX}` },
};

const offPeakPolicy = {
  schema_version: 1 as const,
  eligibility_source: "provider_ticket" as const,
  allowed_route_aliases: [],
  tool_constraints: {
    deny_automation_mutation: true,
    deny_recursive_off_peak: true,
    allow_background_processes: false,
  },
};

function claimResponse(overrides: Record<string, unknown> = {}) {
  return {
    occurrence,
    attempt: 1,
    device_id: `dvc_${HEX}`,
    lease: {
      lease_id: `lse_${HEX}`,
      lease_version: 1,
      lease_fence: 1,
      expires_at: "2026-09-25T16:05:00.000Z",
    },
    lease_token: "lease-token-value-0123456789",
    ...overrides,
  };
}

test("occurrence ref rejects a locally minted colon-delimited run identity", () => {
  // The local scheduler's buildRunId produces `${automationId}:${scheduledAt}`.
  // That is not wire identity and must never decode as an occurrence or run ID.
  assert.equal(isP06OpaqueId(`aut_${HEX}:1784000000000`, "aut"), false);
  assert.equal(isP06OpaqueId(`aut_${HEX}`, "occ"), false);
  assert.equal(isP06OpaqueId(`occ_${HEX}`.toUpperCase(), "occ"), false);
  assert.equal(isP06OpaqueId(`occ_${HEX.slice(0, 31)}`, "occ"), false);
  assert.equal(
    p06AutomationOccurrenceRefSchema.safeParse({
      ...occurrence,
      occurrence_id: `occ_${HEX}:extra`,
    }).success,
    false,
  );
});

test("occurrence ref rejects unknown fields and non-UTC instants", () => {
  assert.equal(
    p06AutomationOccurrenceRefSchema.safeParse({ ...occurrence, org_id: `org_${HEX}` }).success,
    false,
    "organization scope must be derived from the device token, not sent by the host",
  );
  assert.equal(
    p06AutomationOccurrenceRefSchema.safeParse({
      ...occurrence,
      scheduled_for: "2026-09-25T16:00:00Z",
    }).success,
    false,
  );
  assert.equal(
    p06AutomationOccurrenceRefSchema.safeParse({
      ...occurrence,
      scheduled_for: "2026-13-45T16:00:00.000Z",
    }).success,
    false,
  );
});

test("claim request carries no device or tenant scope", () => {
  assert.deepEqual(
    p06AutomationClaimRequestSchema.parse({ occurrence_id: occurrence.occurrence_id }),
    {
      occurrence_id: occurrence.occurrence_id,
    },
  );
  assert.equal(
    p06AutomationClaimRequestSchema.safeParse({
      occurrence_id: occurrence.occurrence_id,
      device_id: `dvc_${HEX}`,
    }).success,
    false,
  );
  assert.equal(
    p06AutomationClaimRequestSchema.safeParse({
      occurrence_id: occurrence.occurrence_id,
      lease_id: `lse_${HEX}`,
    }).success,
    false,
  );
});

test("claim response returns the raw lease token exactly once and never in a projection", () => {
  const decoded = decodeAutomationWire(p06AutomationClaimResponseSchema, claimResponse());
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.lease_token, "lease-token-value-0123456789");
  assert.equal(
    "lease_token" in decoded.value.lease,
    false,
    "the lease projection must never repeat the credential",
  );
  // A short/blank/control-character token is refused rather than forwarded.
  assert.equal(
    p06AutomationClaimResponseSchema.safeParse(claimResponse({ lease_token: "short" })).success,
    false,
  );
  assert.equal(
    p06AutomationClaimResponseSchema.safeParse(
      claimResponse({ lease_token: "with space 123456789" }),
    ).success,
    false,
  );
});

test("fence request requires the token, version, and fence together", () => {
  const valid = {
    lease_id: `lse_${HEX}`,
    lease_version: 1,
    lease_fence: 1,
    lease_token: "lease-token-value-0123456789",
  };
  assert.equal(p06AutomationLeaseFenceRequestSchema.safeParse(valid).success, true);
  const { lease_token: _omitted, ...withoutToken } = valid;
  assert.equal(p06AutomationLeaseFenceRequestSchema.safeParse(withoutToken).success, false);
  assert.equal(
    p06AutomationLeaseFenceRequestSchema.safeParse({ ...valid, lease_fence: 0 }).success,
    false,
  );
});

test("start grant binds the occurrence attempt to one P05 run and session", () => {
  const grant = {
    occurrence_id: occurrence.occurrence_id,
    attempt: 1,
    run_id: `run_${HEX}`,
    agent_session_id: `rse_${HEX}`,
    lease_id: `lse_${HEX}`,
    lease_version: 1,
    lease_fence: 1,
  };
  assert.equal(p06AutomationStartGrantSchema.safeParse(grant).success, true);
  assert.equal(p06AutomationStartGrantSchema.safeParse({ ...grant, attempt: 0 }).success, false);
  assert.equal(
    p06AutomationStartGrantSchema.safeParse({ ...grant, run_id: `aut_${HEX}:1784000000000` })
      .success,
    false,
  );
});

test("settle accepts only succeeded/failed and requires a reason code for failure", () => {
  const fence = {
    lease_id: `lse_${HEX}`,
    lease_version: 1,
    lease_fence: 1,
    lease_token: "lease-token-value-0123456789",
  };
  assert.equal(
    p06AutomationSettleRequestSchema.safeParse({
      outcome: "succeeded",
      run_id: `run_${HEX}`,
      ...fence,
    }).success,
    true,
  );
  assert.equal(
    p06AutomationSettleRequestSchema.safeParse({
      outcome: "failed",
      reason_code: "automation_run_failed",
      run_id: `run_${HEX}`,
      ...fence,
    }).success,
    true,
  );
  // A host may never claim to have skipped, missed, cancelled, or gone ambiguous.
  for (const outcome of ["skipped", "missed", "cancelled", "ambiguous"]) {
    assert.equal(
      p06AutomationSettleRequestSchema.safeParse({
        outcome,
        reason_code: "automation_run_failed",
        run_id: `run_${HEX}`,
        ...fence,
      }).success,
      false,
      `host settle must not accept ${outcome}`,
    );
  }
  assert.equal(
    p06AutomationSettleRequestSchema.safeParse({
      outcome: "failed",
      run_id: `run_${HEX}`,
      ...fence,
    }).success,
    false,
  );
  assert.equal(
    p06AutomationSettleRequestSchema.safeParse({
      outcome: "failed",
      reason_code: "free text describing the crash and the prompt",
      run_id: `run_${HEX}`,
      ...fence,
    }).success,
    false,
  );
});

test("due work is bounded to the gate's maximum of 20 items", () => {
  assert.equal(P06_DUE_WORK_MAX_ITEMS, 20);
  const overLimit = {
    items: Array.from({ length: P06_DUE_WORK_MAX_ITEMS + 1 }, () => occurrence),
  };
  assert.equal(p06AutomationDueWorkResponseSchema.safeParse(overLimit).success, false);
  assert.equal(p06AutomationDueWorkResponseSchema.safeParse({ items: [occurrence] }).success, true);
});

test("frozen server reasons are a closed set and never include local codes", () => {
  for (const code of [
    "occurrence_already_claimed",
    "occurrence_lease_expired",
    "occurrence_ambiguous",
    "lease_fence_invalid",
    "device_not_eligible",
    "execution_principal_unavailable",
    "off_peak_not_allowed",
  ]) {
    assert.equal(isP06AutomationServerErrorCode(code), true, code);
  }
  for (const code of [
    "automation_lease_fence_stale",
    "automation_start_grant_required",
    "automation_occurrence_reconciliation_required",
  ]) {
    assert.equal(isP06AutomationServerErrorCode(code), false, code);
  }
});

test("off-peak policy decoding is strict and fails closed on an unknown version", () => {
  assert.equal(isOffPeakPolicyUsable(offPeakPolicy), true);
  assert.equal(isOffPeakPolicyUsable({ ...offPeakPolicy, schema_version: 2 }), false);
  assert.equal(
    p06OffPeakPolicySchema.safeParse({
      ...offPeakPolicy,
      allowed_route_aliases: ["../../etc/passwd"],
    }).success,
    false,
  );
  assert.equal(
    p06OffPeakPolicySchema.safeParse({
      ...offPeakPolicy,
      tool_constraints: { ...offPeakPolicy.tool_constraints, allow_screenshots: true },
    }).success,
    false,
  );
});

test("the server may narrow host restrictions but never broaden them", () => {
  const permissiveHost = {
    deny_automation_mutation: false,
    deny_recursive_off_peak: false,
    allow_background_processes: true,
  };
  const permissiveServer = {
    deny_automation_mutation: false,
    deny_recursive_off_peak: false,
    allow_background_processes: true,
  };
  // Nothing to narrow: the result equals the host baseline.
  assert.deepEqual(
    narrowOffPeakToolConstraints(permissiveHost, {
      ...offPeakPolicy,
      tool_constraints: permissiveServer,
    }),
    permissiveHost,
  );

  // A server that wants to relax the host is ignored.
  assert.deepEqual(
    narrowOffPeakToolConstraints(P06_OFF_PEAK_FAIL_CLOSED_CONSTRAINTS, {
      ...offPeakPolicy,
      tool_constraints: permissiveServer,
    }),
    P06_OFF_PEAK_FAIL_CLOSED_CONSTRAINTS,
  );
  assert.equal(
    narrowOffPeakToolConstraints(permissiveHost, undefined).allow_background_processes,
    false,
    "a missing policy must not unlock background processes",
  );
  assert.equal(
    narrowOffPeakToolConstraints(permissiveHost, undefined).deny_recursive_off_peak,
    true,
  );
});

test("an off-peak occurrence without a usable policy is refused, not downgraded", () => {
  const offPeakOccurrence = { ...occurrence, off_peak_mode: "off_peak" as const };
  const asUser = { isExecutablePrincipal: (kind: string) => kind === "user" };

  const scheduled = resolveAutomationExecutionClass(occurrence, offPeakPolicy, asUser);
  assert.deepEqual(scheduled, { ok: true, executionClass: { kind: "scheduled" } });

  const offPeak = resolveAutomationExecutionClass(offPeakOccurrence, offPeakPolicy, asUser);
  assert.equal(offPeak.ok, true);
  if (!offPeak.ok || offPeak.executionClass.kind !== "off_peak") {
    assert.fail("expected an off_peak execution class");
  }
  assert.equal(offPeak.executionClass.scheduled_by, "provider_ticket");

  assert.deepEqual(resolveAutomationExecutionClass(offPeakOccurrence, undefined, asUser), {
    ok: false,
    code: "off_peak_not_allowed",
  });

  const serviceAccount = {
    ...occurrence,
    execution_principal: { kind: "service_account" as const, id: `usr_${HEX}` },
  };
  assert.deepEqual(resolveAutomationExecutionClass(serviceAccount, offPeakPolicy, asUser), {
    ok: false,
    code: "execution_principal_unavailable",
  });
});

test("off-peak runs deny recursive derivation; scheduled automations keep OffPeakCreate", () => {
  const scheduled = buildAutomationOccurrenceToolDenylist(
    { kind: "scheduled" },
    {
      deny_automation_mutation: false,
      deny_recursive_off_peak: false,
      allow_background_processes: true,
    },
  );
  assert.equal(scheduled.includes("OffPeakCreate"), false);
  assert.equal(scheduled.includes("CronCreate"), true);
  assert.equal(scheduled.includes("CronUpdate"), true);
  assert.equal(scheduled.includes("CronDelete"), true);

  const offPeak = buildAutomationOccurrenceToolDenylist(
    { kind: "off_peak", policy: offPeakPolicy, scheduled_by: "provider_ticket" },
    offPeakPolicy.tool_constraints,
  );
  for (const name of [
    ...P06_AUTOMATION_MUTATION_TOOL_NAMES,
    ...P06_AUTOMATION_RESTRICTED_TOOL_NAMES,
  ]) {
    assert.equal(offPeak.includes(name), true, name);
  }
  // The canonical list is the three-way divergent value the local copies must
  // converge on: OffPeakCreate + SendMessage + Workflow.
  assert.deepEqual(
    [...P06_AUTOMATION_RESTRICTED_TOOL_NAMES],
    ["OffPeakCreate", "SendMessage", "Workflow"],
  );
});

test("a provider-ticket renewal never mints a second logical occurrence", () => {
  const offPeakOccurrence = { ...occurrence, off_peak_mode: "off_peak" as const, attempt: 1 };
  const renewed = {
    ...offPeakOccurrence,
    scheduled_for: "2026-09-26T16:00:00.000Z",
  };
  assert.deepEqual(acceptOffPeakTicketRenewal(offPeakOccurrence, renewed), {
    ok: true,
    occurrence: renewed,
  });

  // A different occurrence ID, automation, policy snapshot, or attempt is a new
  // logical occurrence, not a renewal.
  const otherOccurrence = { ...renewed, occurrence_id: `occ_${"f".repeat(32)}` };
  assert.deepEqual(acceptOffPeakTicketRenewal(offPeakOccurrence, otherOccurrence), {
    ok: false,
    code: "automation_occurrence_mismatch",
  });
  assert.equal(
    acceptOffPeakTicketRenewal(offPeakOccurrence, {
      ...renewed,
      policy_snapshot_id: `pol_${"a".repeat(32)}`,
    }).ok,
    false,
  );
  assert.equal(acceptOffPeakTicketRenewal(offPeakOccurrence, { ...renewed, attempt: 2 }).ok, false);
  // A ticket cannot silently convert an off-peak occurrence into a normal one.
  assert.equal(
    acceptOffPeakTicketRenewal(offPeakOccurrence, { ...renewed, off_peak_mode: "normal" }).ok,
    false,
  );
  assert.equal(
    acceptOffPeakTicketRenewal(offPeakOccurrence, { occurrence_id: "not-an-id" }).ok,
    false,
  );
});
