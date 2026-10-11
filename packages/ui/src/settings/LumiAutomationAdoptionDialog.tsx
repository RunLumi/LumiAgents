/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { useEffect, useReducer, useRef, useState } from "react";
import {
  TID_LUMI_AUTOMATION_CANCEL,
  TID_LUMI_AUTOMATION_CONFIRM,
  TID_LUMI_AUTOMATION_DIALOG,
  TID_LUMI_AUTOMATION_STATUS,
  type LumiAccountProjection,
  type LumiManagedAgentProjection,
  type LumiManagedModelProjection,
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
  adoptionErrorMessageId,
  canConfirmAdoption,
  initialAdoptionDialog,
  reduceAdoptionDialog,
} from "@/lumi/lumiAutomationAdoptionFlow.js";
import { describeAutomationCardSchedule } from "@/settings/automationCardSchedule.js";

type Options =
  | { status: "idle" | "loading" | "failed" }
  | { status: "ready"; agents: LumiManagedAgentProjection[]; models: LumiManagedModelProjection[] };

const SELECT_CLASS =
  "block w-full rounded-md border border-border bg-card p-2 focus-visible:ring-2 focus-visible:ring-input-border-focused";

function lastSegments(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || path;
}

/**
 * One explicit hand-over of a local automation to Lumi (spec 07). Opening it only previews
 * (reads); cancelling it sends nothing; the single mutating request is the confirm button, and it
 * carries the revision the user reviewed so a changed original is refused rather than adopted.
 */
export function LumiAutomationAdoptionDialog(props: {
  automation: ZCodeAutomation | null;
  account: LumiAccountProjection;
  onClose(): void;
  /** Called after any confirm attempt so the card re-reads who runs the original. */
  onChanged(): void;
}) {
  const { automation, account } = props;
  const { lumiAccount } = usePlatform();
  const { intl } = useZCodeIntl();
  const text = (id: string) => intl.formatMessage({ id: `lumiAutomation.${id}` });
  const [state, dispatch] = useReducer(reduceAdoptionDialog, initialAdoptionDialog);
  const orgs = account.organizations.filter(
    (org) => org.state === "active" && org.status === "active",
  );
  const [selectedOrg, setSelectedOrg] = useState("");
  const orgId = orgs.some((org) => org.id === selectedOrg) ? selectedOrg : (orgs[0]?.id ?? "");
  const [options, setOptions] = useState<Options>({ status: "idle" });
  const sequence = useRef(0);
  const automationId = automation?.automationId;

  useEffect(() => {
    if (!automation || !lumiAccount || !orgId) return;
    const current = ++sequence.current;
    dispatch({ type: "open", localAutomationId: automation.automationId, seq: current });
    setOptions({ status: "idle" });
    void (async () => {
      try {
        // Reads only: a preview or a cancelled dialog changes nothing locally or remotely.
        const preview = await lumiAccount.request({
          action: "preview-automation-adoption",
          orgId,
          localAutomationIds: [automation.automationId],
        });
        if (current !== sequence.current) return;
        dispatch({ type: "previewed", seq: current, result: preview });
        if (!preview.ok) return;
        setOptions({ status: "loading" });
        const workspace = await lumiAccount.request({
          action: "read-workspace",
          orgId,
          workspacePath: automation.workspacePath,
          ...(automation.workspaceIdentity
            ? { workspaceIdentity: automation.workspaceIdentity }
            : {}),
          environmentType: "local",
        });
        const projectId = workspace.ok ? workspace.workspace?.projectId : null;
        if (!projectId) {
          if (current === sequence.current) setOptions({ status: "failed" });
          return;
        }
        const listed = await lumiAccount.request({
          action: "list-managed-options",
          orgId,
          projectId,
        });
        if (current !== sequence.current) return;
        if (!listed.ok || !listed.agents || !listed.models) return setOptions({ status: "failed" });
        setOptions({ status: "ready", agents: listed.agents, models: listed.models });
      } catch {
        if (current === sequence.current)
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
    // The automation object identity changes on every list refresh; the id is the real trigger.
  }, [automationId, orgId, lumiAccount]);

  if (!automation) return null;
  const confirming = state.phase === "confirming";
  const agents =
    options.status === "ready"
      ? options.agents.filter((agent) => agent.lifecycle === "active")
      : [];
  const models =
    options.status === "ready"
      ? options.models.filter((model) => model.available && model.lifecycle === "active")
      : [];

  function close() {
    if (confirming) return;
    sequence.current++;
    dispatch({ type: "cancel" });
    props.onClose();
  }

  async function confirm() {
    if (!canConfirmAdoption(state) || !lumiAccount || !automation || state.revision === undefined)
      return;
    const current = ++sequence.current;
    dispatch({ type: "confirm", seq: current });
    try {
      const result = await lumiAccount.request({
        action: "adopt-automation",
        orgId,
        localAutomationId: automation.automationId,
        agentDefinitionId: state.agentDefinitionId,
        modelAlias: state.modelAlias,
        expectedRevision: state.revision,
        confirm: true,
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
          <DialogTitle>{text("dialog.title")}</DialogTitle>
          <DialogDescription>{text("dialog.description")}</DialogDescription>
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
              <Spinner className="size-3.5" /> {text("dialog.loading")}
            </p>
          ) : null}

          {failure ? (
            <p role="alert" className="text-destructive">
              {intl.formatMessage({ id: adoptionErrorMessageId(failure) })}{" "}
              <span className="font-mono text-foreground-subtle">{failure}</span>
            </p>
          ) : null}

          {state.phase === "not_adoptable" ? (
            <div>
              <p className="font-medium text-foreground">{text("dialog.notAdoptable")}</p>
              <p className="mt-1 text-foreground-subtle">
                {state.reason
                  ? intl.formatMessage({ id: `lumiAutomation.reason.${state.reason}` })
                  : null}
              </p>
            </div>
          ) : null}

          {state.phase === "blocked" ? (
            <div>
              <p className="font-medium text-foreground">{text("dialog.conflicts")}</p>
              <ul className="mt-1 space-y-1">
                {state.conflicts.map((conflict) => (
                  <li key={`${conflict.code}:${conflict.subject}`} className="font-mono text-ui-sm">
                    {conflict.code}
                    {conflict.subject ? ` · ${conflict.subject}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {state.phase === "ready" || confirming || state.phase === "confirm_failed" ? (
            <>
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-foreground-subtle">{text("dialog.name")}</dt>
                <dd className="truncate font-medium text-foreground">{state.title}</dd>
                <dt className="text-foreground-subtle">{text("dialog.schedule")}</dt>
                <dd>{describeAutomationCardSchedule(automation, intl)}</dd>
                <dt className="text-foreground-subtle">{text("dialog.workspace")}</dt>
                <dd className="truncate" title={automation.workspacePath}>
                  {lastSegments(automation.workspacePath)}
                </dd>
              </dl>
              {orgs.length > 1 ? (
                <label className="block">
                  <span className="text-foreground-subtle">{text("dialog.org")}</span>
                  <select
                    className={SELECT_CLASS}
                    value={orgId}
                    disabled={confirming || state.phase !== "ready"}
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
              {options.status === "loading" ? (
                <p className="flex items-center gap-2 text-foreground-subtle">
                  <Spinner className="size-3.5" /> {text("dialog.optionsLoading")}
                </p>
              ) : null}
              {options.status === "ready" ? (
                <>
                  <label className="block">
                    <span className="text-foreground-subtle">{text("dialog.agent")}</span>
                    <select
                      className={SELECT_CLASS}
                      value={state.agentDefinitionId}
                      disabled={confirming || state.phase !== "ready"}
                      onChange={(event) => {
                        const agent = agents.find((item) => item.id === event.target.value);
                        const alias = agent?.defaultModelAlias;
                        dispatch({
                          type: "choose",
                          agentDefinitionId: event.target.value,
                          modelAlias:
                            alias && models.some((model) => model.alias === alias)
                              ? alias
                              : state.modelAlias,
                        });
                      }}
                    >
                      <option value="">{text("dialog.chooseAgent")}</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-foreground-subtle">{text("dialog.model")}</span>
                    <select
                      className={SELECT_CLASS}
                      value={state.modelAlias}
                      disabled={confirming || state.phase !== "ready"}
                      onChange={(event) =>
                        dispatch({
                          type: "choose",
                          agentDefinitionId: state.agentDefinitionId,
                          modelAlias: event.target.value,
                        })
                      }
                    >
                      <option value="">{text("dialog.chooseModel")}</option>
                      {models.map((model) => (
                        <option key={model.alias} value={model.alias}>
                          {model.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
                <p className="font-medium text-foreground">{text("dialog.sentTitle")}</p>
                <p className="text-foreground-subtle">{text("dialog.sent")}</p>
                <p className="font-medium text-foreground">{text("dialog.localTitle")}</p>
                <p className="text-foreground-subtle">{text("dialog.local")}</p>
                <p className="text-foreground-subtle">{text("dialog.olderBuilds")}</p>
              </div>
            </>
          ) : null}

          {confirming ? (
            <p className="flex items-center gap-2 text-foreground-subtle">
              <Spinner className="size-3.5" /> {text("dialog.working")}
            </p>
          ) : null}
          {state.phase === "done" ? <p className="text-success">{text("dialog.done")}</p> : null}
        </div>

        <DialogFooter>
          {state.phase === "done" ? (
            <Button data-testid={TID_LUMI_AUTOMATION_CANCEL} onClick={close}>
              {text("dialog.close")}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                data-testid={TID_LUMI_AUTOMATION_CANCEL}
                disabled={confirming}
                onClick={close}
              >
                {state.phase === "ready" || confirming
                  ? text("dialog.cancel")
                  : text("dialog.close")}
                {/* confirm_failed keeps Close only: reopening re-previews with a fresh revision. */}
              </Button>
              {state.phase === "ready" || confirming ? (
                <Button
                  data-testid={TID_LUMI_AUTOMATION_CONFIRM}
                  disabled={!canConfirmAdoption(state) || confirming}
                  onClick={() => void confirm()}
                >
                  {text("dialog.confirm")}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
