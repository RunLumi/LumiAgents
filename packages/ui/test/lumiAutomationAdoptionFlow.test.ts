/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import type { LumiAutomationPreviewRow } from "@zcode/shared";
import {
  adoptionBadge,
  adoptionErrorMessageId,
  canConfirmAdoption,
  initialAdoptionDialog,
  reduceAdoptionDialog,
  type AdoptionDialogState,
} from "../src/lumi/lumiAutomationAdoptionFlow.js";

const ID = "automation-1";
const row = (overrides: Partial<Extract<LumiAutomationPreviewRow, { adoptable: true }>> = {}) =>
  ({
    localAutomationId: ID,
    title: "Nightly review",
    adoptable: true,
    importable: true,
    conflicts: [],
    revision: 1_790_000_000_000,
    ...overrides,
  }) as LumiAutomationPreviewRow;

function ready(): AdoptionDialogState {
  let state = reduceAdoptionDialog(initialAdoptionDialog, {
    type: "open",
    localAutomationId: ID,
    seq: 1,
  });
  state = reduceAdoptionDialog(state, {
    type: "previewed",
    seq: 1,
    result: {
      ok: true,
      automationPreview: {
        rows: [row()],
        commitReady: true,
        modelCapabilityCheck: "deferred_to_dispatch",
      },
    },
  });
  return reduceAdoptionDialog(state, {
    type: "choose",
    agentDefinitionId: `agd_${"a".repeat(32)}`,
    modelAlias: "coding-default",
  });
}

test("opening previews only: the phase is previewing and nothing is chosen or confirmable", () => {
  const state = reduceAdoptionDialog(initialAdoptionDialog, {
    type: "open",
    localAutomationId: ID,
    seq: 1,
  });
  assert.equal(state.phase, "previewing");
  assert.equal(canConfirmAdoption(state), false);
});

test("a preview becomes ready only for an importable adoptable row, and exposes its revision", () => {
  const state = ready();
  assert.equal(state.phase, "ready");
  assert.equal(state.revision, 1_790_000_000_000);
  assert.equal(canConfirmAdoption(state), true);
});

test("conflicts, unsupported shapes and failures have no confirm path", () => {
  const open = reduceAdoptionDialog(initialAdoptionDialog, {
    type: "open",
    localAutomationId: ID,
    seq: 1,
  });
  const cases: [string, Parameters<typeof reduceAdoptionDialog>[1]][] = [
    [
      "blocked",
      {
        type: "previewed",
        seq: 1,
        result: {
          ok: true,
          automationPreview: {
            rows: [
              row({
                importable: false,
                conflicts: [{ code: "tool_not_permitted", subject: "shell" }],
              }),
            ],
            commitReady: false,
            modelCapabilityCheck: null,
          },
        },
      },
    ],
    [
      "not_adoptable",
      {
        type: "previewed",
        seq: 1,
        result: {
          ok: true,
          automationPreview: {
            rows: [
              {
                localAutomationId: ID,
                title: "t",
                adoptable: false,
                reason: "unsupported_external_delivery",
              },
            ],
            commitReady: false,
            modelCapabilityCheck: null,
          },
        },
      },
    ],
    [
      "preview_failed",
      { type: "previewed", seq: 1, result: { ok: false, code: "lumi_managed_workspace_refused" } },
    ],
  ];
  for (const [phase, event] of cases) {
    let state = reduceAdoptionDialog(open, event);
    assert.equal(state.phase, phase);
    state = reduceAdoptionDialog(state, {
      type: "choose",
      agentDefinitionId: `agd_${"a".repeat(32)}`,
      modelAlias: "m",
    });
    assert.equal(canConfirmAdoption(state), false, phase);
  }
});

test("confirm needs a chosen agent and model and the previewed revision", () => {
  let state = reduceAdoptionDialog(initialAdoptionDialog, {
    type: "open",
    localAutomationId: ID,
    seq: 1,
  });
  state = reduceAdoptionDialog(state, {
    type: "previewed",
    seq: 1,
    result: {
      ok: true,
      automationPreview: { rows: [row()], commitReady: true, modelCapabilityCheck: null },
    },
  });
  assert.equal(canConfirmAdoption(state), false, "nothing chosen yet");
  state = reduceAdoptionDialog(state, {
    type: "choose",
    agentDefinitionId: `agd_${"a".repeat(32)}`,
    modelAlias: "",
  });
  assert.equal(canConfirmAdoption(state), false, "model missing");
  state = reduceAdoptionDialog(state, {
    type: "choose",
    agentDefinitionId: `agd_${"a".repeat(32)}`,
    modelAlias: "coding-default",
  });
  assert.equal(canConfirmAdoption(state), true);
});

test("cancel closes from every phase except an in-flight confirm, and drops late results", () => {
  const states: AdoptionDialogState[] = [
    reduceAdoptionDialog(initialAdoptionDialog, { type: "open", localAutomationId: ID, seq: 1 }),
    ready(),
  ];
  for (const state of states) {
    const closed = reduceAdoptionDialog(state, { type: "cancel" });
    assert.equal(closed.phase, "closed");
    const late = reduceAdoptionDialog(closed, {
      type: "previewed",
      seq: 1,
      result: {
        ok: true,
        automationPreview: { rows: [row()], commitReady: true, modelCapabilityCheck: null },
      },
    });
    assert.equal(late.phase, "closed", "a result after cancel is ignored");
  }
  const confirming = reduceAdoptionDialog(ready(), { type: "confirm", seq: 2 });
  assert.equal(confirming.phase, "confirming");
  assert.equal(reduceAdoptionDialog(confirming, { type: "cancel" }).phase, "confirming");
});

test("confirm is a no-op unless the dialog is ready, and results for another request are ignored", () => {
  const notReady = reduceAdoptionDialog(initialAdoptionDialog, { type: "confirm", seq: 2 });
  assert.equal(notReady.phase, "closed");
  const confirming = reduceAdoptionDialog(ready(), { type: "confirm", seq: 2 });
  const stale = reduceAdoptionDialog(confirming, {
    type: "confirmed",
    seq: 99,
    result: {
      ok: true,
      automationAdoption: {
        localAutomationId: ID,
        state: "managed",
        managedAutomationId: `aut_${"b".repeat(32)}`,
      },
    },
  });
  assert.equal(stale.phase, "confirming");
  const done = reduceAdoptionDialog(confirming, {
    type: "confirmed",
    seq: 2,
    result: {
      ok: true,
      automationAdoption: {
        localAutomationId: ID,
        state: "managed",
        managedAutomationId: `aut_${"b".repeat(32)}`,
      },
    },
  });
  assert.equal(done.phase, "done");
});

test("a refused confirm reports a stable code and allows closing, never a silent success", () => {
  const confirming = reduceAdoptionDialog(ready(), { type: "confirm", seq: 2 });
  const failed = reduceAdoptionDialog(confirming, {
    type: "confirmed",
    seq: 2,
    result: { ok: false, code: "automation_adoption_changed" },
  });
  assert.equal(failed.phase, "confirm_failed");
  assert.equal(failed.errorCode, "automation_adoption_changed");
  assert.equal(reduceAdoptionDialog(failed, { type: "cancel" }).phase, "closed");
});

test("known codes map to specific messages and anything else to the generic one", () => {
  assert.equal(
    adoptionErrorMessageId("automation_adoption_changed"),
    "lumiAutomation.error.changed",
  );
  assert.equal(
    adoptionErrorMessageId("lumi_account_changed"),
    "lumiAutomation.error.accountChanged",
  );
  assert.equal(
    adoptionErrorMessageId("automation_adoption_pending_recovery"),
    "lumiAutomation.error.pendingRecovery",
  );
  assert.equal(adoptionErrorMessageId("sqlite: /Users/me/secret"), "lumiAutomation.error.generic");
  assert.equal(adoptionErrorMessageId(undefined), "lumiAutomation.error.generic");
});

test("the card badge reflects who runs the original and flags ambiguous occurrences", () => {
  assert.deepEqual(adoptionBadge(undefined), undefined);
  assert.deepEqual(
    adoptionBadge({ localAutomationId: ID, state: "managed", managedAutomationId: "aut_x" }),
    {
      kind: "managed",
      needsReview: false,
    },
  );
  assert.deepEqual(
    adoptionBadge({ localAutomationId: ID, state: "suppressed", managedAutomationId: null }),
    {
      kind: "finishing",
      needsReview: false,
    },
  );
  assert.deepEqual(
    adoptionBadge({ localAutomationId: ID, state: "releasing", managedAutomationId: "aut_x" }),
    {
      kind: "returning",
      needsReview: false,
    },
  );
  assert.deepEqual(
    adoptionBadge({
      localAutomationId: ID,
      state: "managed",
      managedAutomationId: "aut_x",
      ambiguousOccurrences: 2,
    }),
    { kind: "managed", needsReview: true },
  );
});
