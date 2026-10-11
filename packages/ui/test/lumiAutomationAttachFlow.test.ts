/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import type {
  LumiAccountResult,
  LumiAutomationAdoptionProjection,
  LumiAutomationAttachCandidate,
} from "@zcode/shared";
import { adoptionBadge } from "../src/lumi/lumiAutomationAdoptionFlow.js";
import {
  attachErrorMessageId,
  attachRefusalMessageId,
  canConfirmAttach,
  initialAttachDialog,
  reduceAttachDialog,
  type AttachDialogState,
} from "../src/lumi/lumiAutomationAttachFlow.js";

const ID = "automation-1";
const OK = `aut_${"a".repeat(32)}`;
const PAUSED = `aut_${"b".repeat(32)}`;
const OTHER = `aut_${"9".repeat(32)}`;
const candidate = (overrides: Partial<LumiAutomationAttachCandidate> = {}) => ({
  managedAutomationId: OK,
  name: "Shared nightly",
  status: "active",
  version: 4,
  scheduleKind: "cron",
  scheduleExpression: "0 9 * * 1-5",
  scheduleTimezone: "UTC",
  attachable: true,
  ...overrides,
});
const previewResult = (
  candidates: LumiAutomationAttachCandidate[],
  revision = 1_790_000_000_000,
): LumiAccountResult => ({
  ok: true,
  automationAttachPreview: {
    localAutomationId: ID,
    title: "Nightly review",
    adoptable: true,
    revision,
    projectId: `prj_${"c".repeat(32)}`,
    candidates,
    truncated: false,
  },
});

function choosing(candidates = [candidate(), candidate({ managedAutomationId: PAUSED, attachable: false, refusal: "automation_attach_inactive", status: "paused" })]) {
  const opened = reduceAttachDialog(initialAttachDialog, {
    type: "open",
    localAutomationId: ID,
    seq: 1,
  });
  return reduceAttachDialog(opened, { type: "previewed", seq: 1, result: previewResult(candidates) });
}

/** Choose OK and give the explicit local-instructions acknowledgement: the only confirmable state. */
function readyToConfirm() {
  return reduceAttachDialog(
    reduceAttachDialog(choosing(), { type: "select", managedAutomationId: OK }),
    { type: "acknowledge", value: true },
  );
}

test("opening only previews and nothing can be confirmed before an attachable choice", () => {
  const opened = reduceAttachDialog(initialAttachDialog, {
    type: "open",
    localAutomationId: ID,
    seq: 1,
  });
  assert.equal(opened.phase, "previewing");
  assert.equal(canConfirmAttach(opened), false);
  assert.equal(reduceAttachDialog(opened, { type: "confirm", seq: 2 }), opened);
  const listed = choosing();
  assert.equal(listed.phase, "choosing");
  assert.equal(canConfirmAttach(listed), false);
  assert.equal(reduceAttachDialog(listed, { type: "confirm", seq: 2 }), listed);
});

test("only an attachable candidate can be selected and confirmed, with the versions the user saw", () => {
  const listed = choosing();
  const refused = reduceAttachDialog(listed, { type: "select", managedAutomationId: PAUSED });
  assert.equal(refused.selected, undefined);
  assert.equal(canConfirmAttach(refused), false);
  const unknown = reduceAttachDialog(listed, {
    type: "select",
    managedAutomationId: `aut_${"f".repeat(32)}`,
  });
  assert.equal(canConfirmAttach(unknown), false, "an id outside the preview is never selectable");

  const picked = reduceAttachDialog(listed, { type: "select", managedAutomationId: OK });
  assert.equal(picked.phase, "ready");
  assert.equal(picked.selected?.version, 4);
  assert.equal(picked.revision, 1_790_000_000_000);
  assert.equal(canConfirmAttach(picked), false, "a choice alone is not consent");
  const acknowledged = reduceAttachDialog(picked, { type: "acknowledge", value: true });
  assert.equal(canConfirmAttach(acknowledged), true);
  const repicked = reduceAttachDialog(acknowledged, {
    type: "select",
    managedAutomationId: PAUSED,
  });
  assert.equal(repicked.phase, "choosing");
  assert.equal(canConfirmAttach(repicked), false, "choosing a refused row clears the old choice");
  assert.equal(repicked.acknowledged, false, "leaving a target drops the acknowledgement");
});

test("the local-instructions acknowledgement gates confirm and resets for a different target", () => {
  const listed = choosing([candidate(), candidate({ managedAutomationId: OTHER, version: 2 })]);
  const picked = reduceAttachDialog(listed, { type: "select", managedAutomationId: OK });
  // Not yet chosen: the acknowledgement is inert, and confirm is refused without it.
  assert.equal(reduceAttachDialog(listed, { type: "acknowledge", value: true }), listed);
  assert.equal(reduceAttachDialog(picked, { type: "confirm", seq: 2 }), picked);
  const acknowledged = reduceAttachDialog(picked, { type: "acknowledge", value: true });
  assert.equal(
    reduceAttachDialog(acknowledged, { type: "select", managedAutomationId: OK }).acknowledged,
    true,
    "re-picking the same target keeps it",
  );
  const other = reduceAttachDialog(acknowledged, { type: "select", managedAutomationId: OTHER });
  assert.equal(other.selected?.managedAutomationId, OTHER);
  assert.equal(canConfirmAttach(other), false, "a different target needs a fresh acknowledgement");
  assert.equal(
    canConfirmAttach(reduceAttachDialog(acknowledged, { type: "acknowledge", value: false })),
    false,
  );
});

test("cancel and stale results are inert; a confirm in flight cannot be cancelled", () => {
  const picked = readyToConfirm();
  assert.deepEqual(reduceAttachDialog(picked, { type: "cancel" }), initialAttachDialog);
  const confirming = reduceAttachDialog(picked, { type: "confirm", seq: 5 });
  assert.equal(confirming.phase, "confirming");
  assert.equal(reduceAttachDialog(confirming, { type: "cancel" }), confirming);
  const late = reduceAttachDialog(confirming, {
    type: "confirmed",
    seq: 4,
    result: { ok: false, code: "automation_attach_changed" },
  });
  assert.equal(late, confirming, "a result from an older request is ignored");
  const stalePreview = reduceAttachDialog(
    reduceAttachDialog(initialAttachDialog, { type: "open", localAutomationId: ID, seq: 9 }),
    { type: "previewed", seq: 8, result: previewResult([candidate()]) },
  );
  assert.equal(stalePreview.phase, "previewing");
});

test("done requires an attached projection; refusals map to specific, stable copy", () => {
  const confirming = reduceAttachDialog(readyToConfirm(), { type: "confirm", seq: 3 });
  const attached: LumiAutomationAdoptionProjection = {
    localAutomationId: ID,
    state: "managed",
    origin: "attached",
    managedAutomationId: OK,
  };
  assert.equal(
    reduceAttachDialog(confirming, {
      type: "confirmed",
      seq: 3,
      result: { ok: true, automationAdoption: attached },
    }).phase,
    "done",
  );
  const created = reduceAttachDialog(confirming, {
    type: "confirmed",
    seq: 3,
    result: { ok: true, automationAdoption: { ...attached, origin: "created" } },
  });
  assert.equal(created.phase, "confirm_failed", "a created projection is not an attach success");
  const failed: AttachDialogState = reduceAttachDialog(confirming, {
    type: "confirmed",
    seq: 3,
    result: { ok: false, code: "automation_attach_principal_mismatch" },
  });
  assert.equal(failed.phase, "confirm_failed");
  assert.equal(
    attachErrorMessageId(failed.errorCode),
    "lumiAutomation.attach.refusal.automation_attach_principal_mismatch",
  );
  assert.equal(
    attachErrorMessageId("automation_attach_changed"),
    "lumiAutomation.attach.error.changed",
  );
  assert.equal(attachErrorMessageId("sqlite: /Users/me"), "lumiAutomation.error.generic");
  assert.equal(attachRefusalMessageId(candidate()), undefined);
  assert.equal(
    attachRefusalMessageId(candidate({ refusal: "automation_attach_off_peak", attachable: false })),
    "lumiAutomation.attach.refusal.automation_attach_off_peak",
  );
});

test("a not-adoptable original offers no choices", () => {
  const opened = reduceAttachDialog(initialAttachDialog, {
    type: "open",
    localAutomationId: ID,
    seq: 1,
  });
  const state = reduceAttachDialog(opened, {
    type: "previewed",
    seq: 1,
    result: {
      ok: true,
      automationAttachPreview: {
        localAutomationId: ID,
        title: "Bounded",
        adoptable: false,
        reason: "unsupported_bounded_runs",
      },
    },
  });
  assert.equal(state.phase, "not_adoptable");
  assert.equal(state.candidates.length, 0);
});

test("the badge distinguishes an attached original from one Lumi created", () => {
  const marker = (origin: "created" | "attached"): LumiAutomationAdoptionProjection => ({
    localAutomationId: ID,
    state: "managed",
    origin,
    managedAutomationId: OK,
  });
  assert.equal(adoptionBadge(marker("attached"))?.kind, "attached");
  assert.equal(adoptionBadge(marker("created"))?.kind, "managed");
});
