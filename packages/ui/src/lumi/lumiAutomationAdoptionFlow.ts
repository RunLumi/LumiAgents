/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type {
  LumiAccountResult,
  LumiAutomationAdoptionProjection,
  LumiAutomationPreviewRow,
} from "@zcode/shared";

/**
 * Renderer state for handing one local automation to Lumi (spec 07). Pure: it holds only safe
 * projections (metadata, conflicts, revision). A preview or cancel never issues a mutating command;
 * the one mutating command is sent by the component after `confirm` moves `ready → confirming`.
 */
export type AdoptionPhase =
  | "closed"
  | "previewing"
  | "preview_failed"
  | "not_adoptable"
  | "blocked"
  | "ready"
  | "confirming"
  | "done"
  | "confirm_failed";

export interface AdoptionDialogState {
  phase: AdoptionPhase;
  seq: number;
  localAutomationId?: string;
  title?: string;
  /** The original's version the user is looking at; echoed on confirm (Main refuses if it moved). */
  revision?: number;
  conflicts: { code: string; subject: string }[];
  /** Stable machine reason for not_adoptable. */
  reason?: string;
  errorCode?: string;
  agentDefinitionId: string;
  modelAlias: string;
}

export const initialAdoptionDialog: AdoptionDialogState = {
  phase: "closed",
  seq: 0,
  conflicts: [],
  agentDefinitionId: "",
  modelAlias: "",
};

export type AdoptionDialogEvent =
  | { type: "open"; localAutomationId: string; seq: number }
  | { type: "previewed"; seq: number; result: LumiAccountResult }
  | { type: "choose"; agentDefinitionId: string; modelAlias: string }
  | { type: "confirm"; seq: number }
  | { type: "confirmed"; seq: number; result: LumiAccountResult }
  | { type: "cancel" };

const AGENT_ID = /^agd_[0-9a-f]{32}$/;
const MODEL_ALIAS = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export function canConfirmAdoption(state: AdoptionDialogState): boolean {
  return (
    state.phase === "ready" &&
    typeof state.revision === "number" &&
    AGENT_ID.test(state.agentDefinitionId) &&
    MODEL_ALIAS.test(state.modelAlias)
  );
}

function failedPreview(state: AdoptionDialogState, errorCode: string): AdoptionDialogState {
  return { ...state, phase: "preview_failed", errorCode };
}

export function reduceAdoptionDialog(
  state: AdoptionDialogState,
  event: AdoptionDialogEvent,
): AdoptionDialogState {
  switch (event.type) {
    case "open":
      return {
        ...initialAdoptionDialog,
        phase: "previewing",
        seq: event.seq,
        localAutomationId: event.localAutomationId,
      };
    case "previewed": {
      // Late or foreign results (cancelled, reopened for another automation) are ignored.
      if (state.phase !== "previewing" || event.seq !== state.seq) return state;
      const { result } = event;
      if (!result.ok) return failedPreview(state, result.code);
      const preview = result.automationPreview;
      const row: LumiAutomationPreviewRow | undefined = preview?.rows.find(
        (item) => item.localAutomationId === state.localAutomationId,
      );
      if (!preview || !row) return failedPreview(state, "lumi_response_invalid");
      if (!row.adoptable)
        return { ...state, phase: "not_adoptable", title: row.title, reason: row.reason };
      if (!row.importable || !preview.commitReady)
        return { ...state, phase: "blocked", title: row.title, conflicts: row.conflicts };
      return { ...state, phase: "ready", title: row.title, revision: row.revision };
    }
    case "choose":
      return state.phase === "ready"
        ? { ...state, agentDefinitionId: event.agentDefinitionId, modelAlias: event.modelAlias }
        : state;
    case "confirm":
      return canConfirmAdoption(state)
        ? { ...state, phase: "confirming", seq: event.seq, errorCode: undefined }
        : state;
    case "confirmed": {
      if (state.phase !== "confirming" || event.seq !== state.seq) return state;
      return event.result.ok && event.result.automationAdoption
        ? { ...state, phase: "done" }
        : {
            ...state,
            phase: "confirm_failed",
            errorCode: event.result.ok ? "lumi_response_invalid" : event.result.code,
          };
    }
    case "cancel":
      // An in-flight confirm cannot be cancelled from the UI: the server step may already have begun.
      return state.phase === "confirming" ? state : initialAdoptionDialog;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  automation_adoption_changed: "lumiAutomation.error.changed",
  lumi_account_changed: "lumiAutomation.error.accountChanged",
  automation_adoption_pending_recovery: "lumiAutomation.error.pendingRecovery",
  automation_adoption_blocked: "lumiAutomation.error.blocked",
  automation_adoption_not_adoptable: "lumiAutomation.error.notAdoptable",
  automation_adoption_busy: "lumiAutomation.error.busy",
  automation_adoption_release_pending: "lumiAutomation.error.releasePending",
  lumi_managed_workspace_refused: "lumiAutomation.error.workspace",
  lumi_workspace_missing: "lumiAutomation.error.workspace",
  lumi_org_unavailable: "lumiAutomation.error.org",
};

/** Only closed, known stable codes get specific copy; anything else is the generic message. */
export function adoptionErrorMessageId(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code]) || "lumiAutomation.error.generic";
}

export interface AdoptionBadge {
  kind: "managed" | "attached" | "finishing" | "returning";
  /** At least one occurrence ended with an unknown outcome and is not retried automatically. */
  needsReview: boolean;
}

export function adoptionBadge(
  marker: LumiAutomationAdoptionProjection | undefined,
): AdoptionBadge | undefined {
  if (!marker) return undefined;
  const kind =
    marker.state === "managed"
      ? marker.origin === "attached"
        ? "attached"
        : "managed"
      : marker.state === "suppressed"
        ? "finishing"
        : "returning";
  return { kind, needsReview: (marker.ambiguousOccurrences ?? 0) > 0 };
}
