/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type {
  LumiAccountResult,
  LumiAutomationAttachCandidate,
  LumiAutomationAttachPreviewProjection,
} from "@zcode/shared";

/**
 * Renderer state for attaching one local automation to an EXISTING managed definition (spec 07).
 * Pure: it holds only safe projections. Preview and cancel never issue a mutating command; the one
 * mutating command is sent by the component after `confirm` moves `ready → confirming`. The
 * renderer picks an id and echoes back the versions it displayed; Main re-validates everything.
 */
export type AttachPhase =
  | "closed"
  | "previewing"
  | "preview_failed"
  | "not_adoptable"
  | "choosing"
  | "ready"
  | "confirming"
  | "done"
  | "confirm_failed";

export interface AttachDialogState {
  phase: AttachPhase;
  seq: number;
  localAutomationId?: string;
  title?: string;
  /** The local original's version the user is looking at. */
  revision?: number;
  candidates: LumiAutomationAttachCandidate[];
  truncated: boolean;
  /** The definition (and its version) the user chose. Never authority: Main re-reads the server. */
  selected?: LumiAutomationAttachCandidate;
  /**
   * The user acknowledged that THIS device's own instructions run the shared schedule (the prompt
   * stays local and is never compared). Reset whenever the target changes; confirm requires it.
   */
  acknowledged: boolean;
  reason?: string;
  errorCode?: string;
}

export const initialAttachDialog: AttachDialogState = {
  phase: "closed",
  seq: 0,
  candidates: [],
  truncated: false,
  acknowledged: false,
};

export type AttachDialogEvent =
  | { type: "open"; localAutomationId: string; seq: number }
  | { type: "previewed"; seq: number; result: LumiAccountResult }
  | { type: "select"; managedAutomationId: string }
  | { type: "acknowledge"; value: boolean }
  | { type: "confirm"; seq: number }
  | { type: "confirmed"; seq: number; result: LumiAccountResult }
  | { type: "cancel" };

export function canConfirmAttach(state: AttachDialogState): boolean {
  return (
    state.phase === "ready" &&
    state.acknowledged &&
    typeof state.revision === "number" &&
    state.selected?.attachable === true
  );
}

function previewRow(
  preview: LumiAutomationAttachPreviewProjection | undefined,
  localAutomationId: string | undefined,
) {
  return preview && preview.localAutomationId === localAutomationId ? preview : undefined;
}

export function reduceAttachDialog(
  state: AttachDialogState,
  event: AttachDialogEvent,
): AttachDialogState {
  switch (event.type) {
    case "open":
      return {
        ...initialAttachDialog,
        phase: "previewing",
        seq: event.seq,
        localAutomationId: event.localAutomationId,
      };
    case "previewed": {
      // Late or foreign results (cancelled, reopened for another automation) are ignored.
      if (state.phase !== "previewing" || event.seq !== state.seq) return state;
      if (!event.result.ok) return { ...state, phase: "preview_failed", errorCode: event.result.code };
      const row = previewRow(event.result.automationAttachPreview, state.localAutomationId);
      if (!row) return { ...state, phase: "preview_failed", errorCode: "lumi_response_invalid" };
      if (!row.adoptable)
        return { ...state, phase: "not_adoptable", title: row.title, reason: row.reason };
      return {
        ...state,
        phase: "choosing",
        title: row.title,
        revision: row.revision,
        candidates: row.candidates,
        truncated: row.truncated,
      };
    }
    case "select": {
      if (state.phase !== "choosing" && state.phase !== "ready") return state;
      const selected = state.candidates.find(
        (candidate) => candidate.managedAutomationId === event.managedAutomationId,
      );
      // A refused candidate stays visible with its reason but can never become the confirm target.
      if (!selected?.attachable)
        return { ...state, phase: "choosing", selected: undefined, acknowledged: false };
      // A different target needs a fresh acknowledgement; re-picking the same one keeps it.
      const sameTarget = state.selected?.managedAutomationId === selected.managedAutomationId;
      return {
        ...state,
        phase: "ready",
        selected,
        acknowledged: sameTarget && state.acknowledged,
      };
    }
    case "acknowledge":
      return state.phase === "ready" ? { ...state, acknowledged: event.value } : state;
    case "confirm":
      return canConfirmAttach(state)
        ? { ...state, phase: "confirming", seq: event.seq, errorCode: undefined }
        : state;
    case "confirmed": {
      if (state.phase !== "confirming" || event.seq !== state.seq) return state;
      return event.result.ok && event.result.automationAdoption?.origin === "attached"
        ? { ...state, phase: "done" }
        : {
            ...state,
            phase: "confirm_failed",
            errorCode: event.result.ok ? "lumi_response_invalid" : event.result.code,
          };
    }
    case "cancel":
      // An in-flight confirm cannot be cancelled from the UI: the local write may already be done.
      return state.phase === "confirming" ? state : initialAttachDialog;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  automation_attach_changed: "lumiAutomation.attach.error.changed",
  automation_adoption_changed: "lumiAutomation.error.changed",
  lumi_account_changed: "lumiAutomation.error.accountChanged",
  automation_adoption_busy: "lumiAutomation.error.busy",
  automation_adoption_not_adoptable: "lumiAutomation.error.notAdoptable",
  lumi_managed_workspace_refused: "lumiAutomation.error.workspace",
  lumi_workspace_missing: "lumiAutomation.error.workspace",
  lumi_org_unavailable: "lumiAutomation.error.org",
};

/** Only closed, known stable codes get specific copy; anything else is the generic message. */
export function attachErrorMessageId(code: string | undefined): string {
  if (code?.startsWith("automation_attach_") && code !== "automation_attach_changed")
    return `lumiAutomation.attach.refusal.${code}`;
  return (code && ERROR_MESSAGES[code]) || "lumiAutomation.error.generic";
}

/** Copy id for a candidate row's refusal reason; undefined when it is attachable. */
export function attachRefusalMessageId(candidate: LumiAutomationAttachCandidate): string | undefined {
  return candidate.refusal ? `lumiAutomation.attach.refusal.${candidate.refusal}` : undefined;
}
