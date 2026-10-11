import { useState } from "react";
import {
  P08_CREDENTIAL_MODES,
  type LumiWorkspaceProjection,
  type P08CredentialMode,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * Label-only credential choice for an adopted workspace. The server row (projection) is the only
 * truth; this component keeps just the not-yet-confirmed selection. It has no secret field and
 * never reads a local key: provisioning an organization credential stays in the web console.
 * The parent remounts it (via `key`) whenever the server mode or version changes.
 */
export function LumiWorkspaceCredentialChoice(props: {
  workspace: LumiWorkspaceProjection;
  busy: boolean;
  onConfirm: (mode: P08CredentialMode) => void;
  onOpenConsole: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [pending, setPending] = useState<P08CredentialMode | null>(null);
  const text = (id: string) => intl.formatMessage({ id: `lumiWorkspace.credential.${id}` });
  const serverMode = props.workspace.credentialMode;
  const selected = pending ?? serverMode;
  const orgAllowed = props.workspace.ownership === "org_managed";
  const changed = pending !== null && pending !== serverMode;

  return (
    <fieldset
      className="min-w-0 space-y-2 rounded-md border border-border p-3"
      aria-describedby="lumi-credential-explainer"
      disabled={props.busy}
    >
      <legend className="px-1 font-semibold">{text("legend")}</legend>
      <p id="lumi-credential-explainer" className="text-foreground-subtle">
        {text("explainer")}
      </p>
      {P08_CREDENTIAL_MODES.map((mode) => {
        const available = mode !== "org_managed_credential" || orgAllowed;
        const inputId = `lumi-credential-${mode}`;
        return (
          <div key={mode} className="flex items-start gap-2">
            <input
              id={inputId}
              type="radio"
              name="lumi-credential-mode"
              value={mode}
              checked={selected === mode}
              disabled={!available}
              aria-describedby={`${inputId}-detail`}
              onChange={() => setPending(mode)}
              className="mt-1 size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div>
              <label htmlFor={inputId} className="font-medium">
                {text(mode)}
                {mode === serverMode ? (
                  <span className="ml-2 text-foreground-subtle">({text("current")})</span>
                ) : null}
              </label>
              <p id={`${inputId}-detail`} className="text-foreground-subtle">
                {available ? text(`${mode}.detail`) : text("orgUnavailable")}
              </p>
            </div>
          </div>
        );
      })}
      {selected === "org_managed_credential" && orgAllowed ? (
        <div className="space-y-1">
          <p className="text-foreground-subtle">{text("consoleHint")}</p>
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-8 w-full justify-start whitespace-normal py-1.5 text-left"
            onClick={props.onOpenConsole}
          >
            {text("console")}
          </Button>
        </div>
      ) : null}
      {changed ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => props.onConfirm(selected)}>
            {text("confirm")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setPending(null)}>
            {text("cancel")}
          </Button>
        </div>
      ) : null}
      {serverMode !== "local_credential" ? (
        <p className="text-foreground-subtle">{text("rollbackNote")}</p>
      ) : null}
    </fieldset>
  );
}
