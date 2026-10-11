/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { Link2, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  TID_LUMI_AUTOMATION_ATTACH,
  TID_LUMI_AUTOMATION_BADGE,
  TID_LUMI_AUTOMATION_HANDOVER,
  TID_LUMI_AUTOMATION_RETURN,
  type LumiAutomationAdoptionProjection,
} from "@zcode/shared";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { adoptionBadge } from "@/lumi/lumiAutomationAdoptionFlow.js";

/**
 * Who runs the retained original, on the card. Text carries the meaning (not colour alone); the
 * review marker explains an unknown outcome and never invites an automatic retry (DESIGN.md
 * "Ambiguous effect": verify before replay).
 */
export function LumiAutomationBadge({
  marker,
}: {
  marker: LumiAutomationAdoptionProjection | undefined;
}) {
  const { intl } = useZCodeIntl();
  const badge = adoptionBadge(marker);
  if (!badge) return null;
  const label = intl.formatMessage({ id: `lumiAutomation.badge.${badge.kind}` });
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      data-testid={TID_LUMI_AUTOMATION_BADGE}
    >
      <span
        data-state={badge.kind}
        className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-ui-xs font-medium text-foreground ring-1 ring-inset ring-border"
      >
        <ShieldCheck className="size-3" strokeWidth={1.5} aria-hidden="true" />
        {label}
      </span>
      {badge.needsReview ? (
        <span
          title={intl.formatMessage({ id: "lumiAutomation.review.hint" })}
          className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-ui-xs font-medium text-destructive ring-1 ring-inset ring-border"
        >
          <TriangleAlert className="size-3" strokeWidth={1.5} aria-hidden="true" />
          {intl.formatMessage({ id: "lumiAutomation.badge.review" })}
        </span>
      ) : null}
    </span>
  );
}

/** Hand over / return actions; hidden entirely when there is no signed-in Lumi account. */
export function LumiAutomationMenuItems(props: {
  marker: LumiAutomationAdoptionProjection | undefined;
  canHandOver: boolean;
  busy: boolean;
  onHandOver(): void;
  onAttach(): void;
  onReturn(): void;
}) {
  const { intl } = useZCodeIntl();
  // A suppressed marker is an unfinished hand-over: both finishing it and returning it are valid.
  const canFinishOrStart =
    props.canHandOver && (!props.marker || props.marker.state === "suppressed");
  return (
    <>
      {canFinishOrStart ? (
        <DropdownMenuItem
          data-testid={TID_LUMI_AUTOMATION_HANDOVER}
          className="gap-1"
          disabled={props.busy}
          onSelect={props.onHandOver}
        >
          <span className="flex size-5 items-center justify-center">
            <ShieldCheck className="size-4" strokeWidth={1.33} aria-hidden="true" />
          </span>
          {intl.formatMessage({ id: "lumiAutomation.menu.handOver" })}
        </DropdownMenuItem>
      ) : null}
      {/* Attach only starts from an untouched original: a suppressed marker is a hand-over to finish. */}
      {props.canHandOver && !props.marker ? (
        <DropdownMenuItem
          data-testid={TID_LUMI_AUTOMATION_ATTACH}
          className="gap-1"
          disabled={props.busy}
          onSelect={props.onAttach}
        >
          <span className="flex size-5 items-center justify-center">
            <Link2 className="size-4" strokeWidth={1.33} aria-hidden="true" />
          </span>
          {intl.formatMessage({ id: "lumiAutomation.menu.attach" })}
        </DropdownMenuItem>
      ) : null}
      {props.marker ? (
        <DropdownMenuItem
          data-testid={TID_LUMI_AUTOMATION_RETURN}
          className="gap-1"
          disabled={props.busy}
          onSelect={props.onReturn}
        >
          <span className="flex size-5 items-center justify-center">
            <ShieldCheck className="size-4" strokeWidth={1.33} aria-hidden="true" />
          </span>
          {intl.formatMessage({ id: "lumiAutomation.menu.return" })}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
