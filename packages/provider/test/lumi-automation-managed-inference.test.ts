import assert from "node:assert/strict";
import test from "node:test";

import {
  LUMI_AUTOMATION_CORRELATION_HEADERS,
  createAutomationManagedRequestAuthSource,
  createAutomationManagedRunContext,
  createAutomationManagedRunContextFromGrant,
  createAutomationManagedRunHeaders,
  isServerMintedLumiRunId,
  serializeAutomationManagedRunContext,
  type AutomationManagedRunContextInput,
} from "../src/lumi-automation-managed-inference.js";
import {
  LUMI_MANAGED_CORRELATION_HEADERS,
  createManagedRunContext,
} from "../src/lumi-managed-inference.js";

const HEX = "0123456789abcdef0123456789abcdef";
const sessionToken = "runtime-only-session-token";

const input: AutomationManagedRunContextInput = {
  organizationId: `org_${HEX}`,
  projectId: `prj_${HEX}`,
  deviceId: `dvc_${HEX}`,
  agentSessionId: `rse_${HEX}`,
  runId: `run_${HEX}`,
  agentDefinitionId: `agd_${HEX}`,
  agentDefinitionVersion: 3,
  requestId: `req_${HEX}`,
  externalId: "zcode-session-123",
  executionMode: "managed",
  occurrenceId: `occ_${HEX}`,
  automationId: `aut_${HEX}`,
  occurrenceAttempt: 1,
  leaseId: `lse_${HEX}`,
  leaseVersion: 2,
  leaseFence: 7,
  offPeakMode: "normal",
  policySnapshotId: `pol_${HEX}`,
  policyVersion: 4,
};

const grant = {
  occurrence_id: `occ_${HEX}`,
  attempt: 1,
  run_id: `run_${HEX}`,
  agent_session_id: `rse_${HEX}`,
  lease_id: `lse_${HEX}`,
  lease_version: 2,
  lease_fence: 7,
};

const occurrence = {
  occurrence_id: `occ_${HEX}`,
  automation_id: `aut_${HEX}`,
  attempt: 1,
  off_peak_mode: "normal" as const,
  policy_snapshot_id: `pol_${HEX}`,
  policy_version: 4,
};

test("the automation context keeps every P05 field and adds the occurrence axis", () => {
  const context = createAutomationManagedRunContext(input);
  const base = createManagedRunContext(input);
  for (const key of Object.keys(base) as (keyof typeof base)[]) {
    assert.deepEqual(context[key], base[key], key);
  }
  assert.equal(context.occurrenceId, `occ_${HEX}`);
  assert.equal(context.automationId, `aut_${HEX}`);
  assert.equal(context.occurrenceAttempt, 1);
  assert.equal(context.leaseId, `lse_${HEX}`);
  assert.equal(context.leaseVersion, 2);
  assert.equal(context.leaseFence, 7);
  assert.equal(context.policySnapshotId, `pol_${HEX}`);
  assert.equal(context.policyVersion, 4);
});

test("a local colon-delimited run ID is refused as wire identity", () => {
  // packages/desktop/src/scheduler buildRunId → `${automationId}:${scheduledAt}`.
  const localRunId = `aut_${HEX}:1784000000000`;
  assert.equal(isServerMintedLumiRunId(localRunId), false);
  assert.throws(
    () => createAutomationManagedRunContext({ ...input, runId: localRunId }),
    /Lumi run ID is invalid/,
  );
  assert.equal(isServerMintedLumiRunId(`run_${HEX}`), true);
});

test("opaque prefixes are checked per axis, not just for shape", () => {
  assert.throws(
    () => createAutomationManagedRunContext({ ...input, occurrenceId: `aut_${HEX}` }),
    /Lumi occ ID is invalid/,
  );
  assert.throws(
    () => createAutomationManagedRunContext({ ...input, leaseId: `occ_${HEX}` }),
    /Lumi lse ID is invalid/,
  );
  assert.throws(
    () =>
      createAutomationManagedRunContext({
        ...input,
        // One hex character short of the required 32.
        policySnapshotId: `pol_${HEX}`.slice(0, 35),
      }),
    /Lumi pol ID is invalid/,
  );
  assert.throws(
    () => createAutomationManagedRunContext({ ...input, occurrenceAttempt: 0 }),
    /occurrence attempt is invalid/,
  );
  assert.throws(
    () => createAutomationManagedRunContext({ ...input, leaseFence: 0 }),
    /lease fence is invalid/,
  );
  assert.throws(
    () => createAutomationManagedRunContext({ ...input, offPeakMode: "idle" as "normal" }),
    /off-peak mode is invalid/,
  );
});

test("the serialized context is protocol-shaped and carries no credential", () => {
  const serialized = serializeAutomationManagedRunContext(input);
  assert.equal(serialized.occurrence_id, `occ_${HEX}`);
  assert.equal(serialized.occurrence_attempt, 1);
  assert.equal(serialized.lease_fence, 7);
  assert.equal(serialized.off_peak_mode, "normal");
  assert.equal(serialized.policy_version, 4);
  assert.equal(serialized.run_id, `run_${HEX}`);
  assert.equal(
    Object.keys(serialized).some((key) => /token|secret|credential/i.test(key)),
    false,
    "the serialized context must never carry a lease credential",
  );
});

test("correlation headers expose the fence but never a lease token", async () => {
  const headers = createAutomationManagedRunHeaders(input);
  assert.equal(headers[LUMI_AUTOMATION_CORRELATION_HEADERS.occurrenceId], `occ_${HEX}`);
  assert.equal(headers[LUMI_AUTOMATION_CORRELATION_HEADERS.automationId], `aut_${HEX}`);
  assert.equal(headers[LUMI_AUTOMATION_CORRELATION_HEADERS.occurrenceAttempt], "1");
  assert.equal(headers[LUMI_AUTOMATION_CORRELATION_HEADERS.leaseVersion], "2");
  assert.equal(headers[LUMI_AUTOMATION_CORRELATION_HEADERS.leaseFence], "7");
  assert.equal(headers[LUMI_AUTOMATION_CORRELATION_HEADERS.offPeakMode], "normal");
  assert.equal(headers[LUMI_AUTOMATION_CORRELATION_HEADERS.policyVersion], "4");
  // The P05 axes are still present so a managed request is fully attributable.
  assert.equal(headers[LUMI_MANAGED_CORRELATION_HEADERS.runId], `run_${HEX}`);
  assert.equal(headers[LUMI_MANAGED_CORRELATION_HEADERS.organizationId], `org_${HEX}`);

  const source = createAutomationManagedRequestAuthSource({
    context: input,
    sessionToken,
  });
  const auth = await source.resolve();
  assert.equal(auth.apiKey, sessionToken);
  assert.equal(JSON.stringify(auth.headers).includes("lease_token"), false);
  assert.equal(JSON.stringify(source).includes(sessionToken), false);
  assert.equal(
    Object.values(auth.headers).some((value) => value.includes(sessionToken)),
    false,
  );
});

test("the run link may only come from a matching server start grant", () => {
  const context = {
    organizationId: `org_${HEX}`,
    projectId: `prj_${HEX}`,
    deviceId: `dvc_${HEX}`,
    agentDefinitionId: `agd_${HEX}`,
    agentDefinitionVersion: 3,
    requestId: `req_${HEX}`,
    executionMode: "managed" as const,
  };
  const derived = createAutomationManagedRunContextFromGrant({
    grant,
    occurrence,
    managed: context,
    deviceId: `dvc_${HEX}`,
  });
  assert.equal(derived.runId, `run_${HEX}`);
  assert.equal(derived.agentSessionId, `rse_${HEX}`);
  assert.equal(derived.occurrenceId, `occ_${HEX}`);
  assert.equal(derived.leaseFence, 7);

  assert.throws(
    () =>
      createAutomationManagedRunContextFromGrant({
        grant: { ...grant, occurrence_id: `occ_${"b".repeat(32)}` },
        occurrence,
        managed: context,
        deviceId: `dvc_${HEX}`,
      }),
    /another occurrence/,
  );
  assert.throws(
    () =>
      createAutomationManagedRunContextFromGrant({
        grant: { ...grant, attempt: 2 },
        occurrence,
        managed: context,
        deviceId: `dvc_${HEX}`,
      }),
    /another attempt/,
  );
  // A grant whose own run/session IDs are not opaque wire IDs is refused.
  assert.throws(
    () =>
      createAutomationManagedRunContextFromGrant({
        grant: { ...grant, run_id: `aut_${HEX}:1784000000000` },
        occurrence,
        managed: context,
        deviceId: `dvc_${HEX}`,
      }),
    /Lumi run ID is invalid/,
  );
  assert.throws(
    () =>
      createAutomationManagedRunContextFromGrant({
        grant: { ...grant, lease_fence: 0 },
        occurrence,
        managed: context,
        deviceId: `dvc_${HEX}`,
      }),
    /fence is invalid/,
  );
});

test("a local-only automation run cannot mint a managed credential", () => {
  assert.throws(
    () =>
      createAutomationManagedRequestAuthSource({
        context: { ...input, executionMode: "local_only" },
        sessionToken,
      }),
    /managed run context/,
  );
});
