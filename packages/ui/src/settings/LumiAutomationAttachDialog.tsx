/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { useEffect, useReducer, useRef, useState } from "react";
import {
  TID_LUMI_AUTOMATION_ATTACH_ACK,
  TID_LUMI_AUTOMATION_ATTACH_OPTION,
  TID_LUMI_AUTOMATION_CANCEL,
  TID_LUMI_AUTOMATION_CONFIRM,
  TID_LUMI_AUTOMATION_DIALOG,
  TID_LUMI_AUTOMATION_STATUS,
  type LumiAccountProjection,
  type LumiAutomationAttachCandidate,
  type ZCodeAutomation,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Spinner } from "@/components/ui/spinner.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import {
  attachErrorMessageId,
  attachRefusalMessageId,
  canConfirmAttach,
  initialAttachDialog,
  reduceAttachDialog,
} from "@/lumi/lumiAutomationAttachFlow.js";

const SELECT_CLASS =
  "block w-full rounded-md border border-border bg-card p-2 focus-visible:ring-2 focus-visible:ring-input-border-focused";

function lastSegments(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || path;
}

/**
 * Explicit attach of a local original to an existing Lumi automation (spec 07). Opening it only
 * reads; cancelling sends nothing; the single mutating request is the confirm button. It shows the
 * bounded destination and the definition being attached, and carries the versions the user saw so
 * a definition or original that moved is refused instead of attached.
 */
export function LumiAutomationAttachDialog(props: {
  automation: ZCodeAutomation | null;
  account: LumiAccountProjection;
  onClose(): void;
  /** Called after any confirm attempt so the card re-reads who runs the original. */
  onChanged(): void;
}) {
  const { automation, account } = props;
  const { lumiAccount } = usePlatform();
  const { intl } = useZCodeIntl();
  const text = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `lumiAutomation.attach.${id}` }, values);
  const [state, dispatch] = useReducer(reduceAttachDialog, initialAttachDialog);
  const orgs = account.organizations.filter(
    (org) => org.state === "active" && org.status === "active",
  );
  const [selectedOrg, setSelectedOrg] = useState("");
  const orgId = orgs.some((org) => org.id === selectedOrg) ? selectedOrg : (orgs[0]?.id ?? "");
  const sequence = useRef(0);
  const automationId = automation?.automationId;

  useEffect(() => {
    if (!automationId || !lumiAccount || !orgId) return;
    const current = ++sequence.current;
    dispatch({ type: "open", localAutomationId: automationId, seq: current });
    void (async () => {
      try {
        // Read only: a preview or a cancelled dialog changes nothing locally or remotely.
        const preview = await lumiAccount.request({
          action: "preview-automation-attach",
          orgId,
          localAutomationId: automationId,
        });
        dispatch({ type: "previewed", seq: current, result: preview });
      } catch {
        dispatch({
          type: "previewed",
          seq: current,
          result: { ok: false, code: "lumi_automation_action_failed" },
        });
      }
    })();
    return () => {
      sequence.current++;
    };
  }, [automationId, orgId, lumiAccount]);

  if (!automation) return null;
  const confirming = state.phase === "confirming";

  function close() {
    if (confirming) return;
    sequence.current++;
    dispatch({ type: "cancel" });
    props.onClose();
  }

  async function confirm() {
    const selected = state.selected;
    if (!canConfirmAttach(state) || !lumiAccount || !automation || !selected) return;
    if (state.revision === undefined) return;
    const current = ++sequence.current;
    dispatch({ type: "confirm", seq: current });
    try {
      const result = await lumiAccount.request({
        action: "attach-automation",
        orgId,
        localAutomationId: automation.automationId,
        managedAutomationId: selected.managedAutomationId,
        expectedRevision: state.revision,
        expectedVersion: selected.version,
        confirm: true,
        acknowledgeLocalInstructions: true,
      });
      dispatch({ type: "confirmed", seq: current, result });
    } catch {
      dispatch({
        type: "confirmed",
        seq: current,
        result: { ok: false, code: "lumi_automation_action_failed" },
      });
    } finally {
      // Whatever happened, the marker may exist now: re-read who runs the original.
      props.onChanged();
    }
  }

  const failure =
    state.phase === "preview_failed" || state.phase === "confirm_failed"
      ? state.errorCode
      : undefined;
  const choosing =
    state.phase === "choosing" ||
    state.phase === "ready" ||
    confirming ||
    state.phase === "confirm_failed";

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        data-testid={TID_LUMI_AUTOMATION_DIALOG}
        data-phase={state.phase}
        className="max-w-lg"
        onEscapeKeyDown={(event) => confirming && event.preventDefault()}
        onInteractOutside={(event) => confirming && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{text("title")}</DialogTitle>
          <DialogDescription>{text("description")}</DialogDescription>
        </DialogHeader>

        <div
          role="status"
          aria-live="polite"
          data-testid={TID_LUMI_AUTOMATION_STATUS}
          data-phase={state.phase}
          className="space-y-3 text-ui-base"
        >
          {state.phase === "previewing" ? (
            <p className="flex items-center gap-2 text-foreground-subtle">
              <Spinner className="size-3.5" />{" "}
              {intl.formatMessage({ id: "lumiAutomation.dialog.loading" })}
            </p>
          ) : null}

          {failure ? (
            <p role="alert" className="text-destructive">
              {intl.formatMessage({ id: attachErrorMessageId(failure) })}{" "}
              <span className="font-mono text-foreground-subtle">{failure}</span>
            </p>
          ) : null}

          {state.phase === "not_adoptable" ? (
            <div>
              <p className="font-medium text-foreground">
                {intl.formatMessage({ id: "lumiAutomation.dialog.notAdoptable" })}
              </p>
              <p className="mt-1 text-foreground-subtle">
                {state.reason
                  ? intl.formatMessage({ id: `lumiAutomation.reason.${state.reason}` })
                  : null}
              </p>
            </div>
          ) : null}

          {choosing ? (
            <>
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-foreground-subtle">
                  {intl.formatMessage({ id: "lumiAutomation.dialog.name" })}
                </dt>
                <dd className="truncate font-medium text-foreground">{state.title}</dd>
                <dt className="text-foreground-subtle">
                  {intl.formatMessage({ id: "lumiAutomation.dialog.workspace" })}
                </dt>
                <dd className="truncate" title={automation.workspacePath}>
                  {lastSegments(automation.workspacePath)}
                </dd>
                <dt className="text-foreground-subtle">{text("destination")}</dt>
                <dd>{text("destinationValue")}</dd>
              </dl>
              {orgs.length > 1 ? (
                <label className="block">
                  <span className="text-foreground-subtle">
                    {intl.formatMessage({ id: "lumiAutomation.dialog.org" })}
                  </span>
                  <select
                    className={SELECT_CLASS}
                    value={orgId}
                    disabled={confirming || state.phase === "confirm_failed"}
                    onChange={(event) => setSelectedOrg(event.target.value)}
                  >
                    {orgs.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <fieldset className="space-y-2" disabled={confirming}>
                <legend className="font-medium text-foreground">{text("choose")}</legend>
                {state.candidates.length === 0 ? (
                  <p className="text-foreground-subtle">{text("empty")}</p>
                ) : (
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {state.candidates.map((candidate) => (
                      <CandidateOption
                        key={candidate.managedAutomationId}
                        candidate={candidate}
                        checked={state.selected?.managedAutomationId === candidate.managedAutomationId}
                        onSelect={() =>
                          dispatch({ type: "select", managedAutomationId: candidate.managedAutomationId })
                        }
                      />
                    ))}
                  </ul>
                )}
                {state.truncated ? (
                  <p className="text-ui-sm text-foreground-subtle">{text("truncated")}</p>
                ) : null}
              </fieldset>

              <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
                <p className="font-medium text-foreground">{text("sentTitle")}</p>
                <p className="text-foreground-subtle">{text("sent")}</p>
                <p className="font-medium text-foreground">{text("localTitle")}</p>
                <p className="text-foreground-subtle">{text("local")}</p>
                <p className="text-foreground-subtle">
                  {intl.formatMessage({ id: "lumiAutomation.dialog.olderBuilds" })}
                </p>
              </div>

              <label className="flex items-start gap-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-input-border-focused">
                <input
                  type="checkbox"
                  className="mt-1"
                  data-testid={TID_LUMI_AUTOMATION_ATTACH_ACK}
                  checked={state.acknowledged}
                  disabled={state.phase !== "ready"}
                  onChange={(event) =>
                    dispatch({ type: "acknowledge", value: event.target.checked })
                  }
                />
                <span className="text-foreground">{text("acknowledge")}</span>
              </label>
            </>
          ) : null}

          {confirming ? (
            <p className="flex items-center gap-2 text-foreground-subtle">
              <Spinner className="size-3.5" /> {text("working")}
            </p>
          ) : null}
          {state.phase === "done" ? <p className="text-success">{text("done")}</p> : null}
        </div>

        <DialogFooter>
          {state.phase === "done" ? (
            <Button data-testid={TID_LUMI_AUTOMATION_CANCEL} onClick={close}>
              {intl.formatMessage({ id: "lumiAutomation.dialog.close" })}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                data-testid={TID_LUMI_AUTOMATION_CANCEL}
                disabled={confirming}
                onClick={close}
              >
                {intl.formatMessage({
                  id:
                    state.phase === "choosing" || state.phase === "ready" || confirming
                      ? "lumiAutomation.dialog.cancel"
                      : "lumiAutomation.dialog.close",
                })}
              </Button>
              {state.phase === "choosing" || state.phase === "ready" || confirming ? (
                <Button
                  data-testid={TID_LUMI_AUTOMATION_CONFIRM}
                  disabled={!canConfirmAttach(state) || confirming}
                  onClick={() => void confirm()}
                >
                  {text("confirm")}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CandidateOption(props: {
  candidate: LumiAutomationAttachCandidate;
  checked: boolean;
  onSelect(): void;
}) {
  const { intl } = useZCodeIntl();
  const { candidate } = props;
  const refusalId = attachRefusalMessageId(candidate);
  const schedule = candidate.scheduleExpression
    ? [candidate.scheduleExpression, candidate.scheduleTimezone].filter(Boolean).join(" · ")
    : intl.formatMessage({ id: "lumiAutomation.attach.unknownSchedule" });
  return (
    <li>
      <label
        className={`flex items-start gap-2 rounded-md border border-border p-2 ${
          candidate.attachable ? "cursor-pointer" : "opacity-70"
        } has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-input-border-focused`}
      >
        <input
          type="radio"
          name="lumi-attach-candidate"
          className="mt-1"
          data-testid={TID_LUMI_AUTOMATION_ATTACH_OPTION}
          data-attachable={candidate.attachable}
          checked={props.checked}
          disabled={!candidate.attachable}
          onChange={props.onSelect}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">
            {candidate.name || candidate.managedAutomationId}
          </span>
          <span className="block truncate font-mono text-ui-sm text-foreground-subtle">
            {schedule}
          </span>
          <span className="block text-ui-sm text-foreground-subtle">
            {intl.formatMessage(
              { id: "lumiAutomation.attach.version" },
              { version: candidate.version },
            )}
          </span>
          {refusalId ? (
            <span className="block text-ui-sm text-destructive">
              {intl.formatMessage({ id: refusalId })}
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );
}
