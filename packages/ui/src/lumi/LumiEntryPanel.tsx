/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { useEffect, useRef } from "react";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { TID_LUMI_ENTRY_SIGN_IN } from "@zcode/shared";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { lumiErrorCopyId } from "./lumiErrorCopy.js";
import { useLumiAccountFlow } from "./useLumiAccountFlow.js";

interface LumiEntryPanelProps {
  /** Called after a Lumi session exists and the user chose to continue. */
  onSignedIn: () => void;
}

/**
 * Primary entry action: Lumi sign-in through the host-owned `platform.lumiAccount` session.
 * Sign-in here never enrolls the device or adopts a workspace (spec 04).
 */
export function LumiEntryPanel({ onSignedIn }: LumiEntryPanelProps) {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const { available, state, run } = useLumiAccountFlow();
  const { account, signIn, busy, error, errorCommand, restored, slow } = state;
  const completing = useRef(false);
  const t = (id: string, values?: Record<string, string>) =>
    intl.formatMessage({ id: `lumiEntry.${id}` }, values);
  const account_t = (id: string) => intl.formatMessage({ id: `lumiAccount.${id}` });
  const restoreFailed = Boolean(error) && errorCommand === "restore";
  // Sign-in oriented guidance stays the fallback for codes without dedicated copy.
  const errorText = restoreFailed
    ? t("restoreFailed")
    : error && lumiErrorCopyId(error) !== "lumiError.generic"
      ? intl.formatMessage({ id: lumiErrorCopyId(error) })
      : account_t("error");

  useEffect(() => {
    // An explicit "I approved" completes the entry; a merely restored account asks for Continue.
    if (account && completing.current) {
      completing.current = false;
      onSignedIn();
    }
  }, [account, onSignedIn]);

  if (!available) return null;

  if (!restored && busy) {
    return (
      <div
        role="status"
        className="space-y-1 rounded-xl border border-border bg-surface px-4 py-6 text-center text-ui-base text-foreground-subtle"
      >
        <p className="flex items-center justify-center gap-2">
          <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {t("restoring")}
        </p>
        {slow ? <p className="text-ui-sm">{t("restoringSlow")}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ring [&_button:focus-visible]:ring-offset-2 [&_button:focus-visible]:ring-offset-background">
      {error ? (
        <Alert variant="warning" role="alert" className="flex items-center gap-2 text-center">
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
          <AlertDescription className="min-w-0 break-words text-center">
            {errorText} <span className="font-mono">{error}</span>
          </AlertDescription>
        </Alert>
      ) : null}
      {account ? (
        <>
          <p className="text-center text-ui-base text-foreground-subtle">
            {t("signedInAs", { name: account.user.displayName || account.user.email })}
          </p>
          <Button className="h-10 w-full text-ui-base" size="lg" autoFocus onClick={onSignedIn}>
            {t("continue")}
          </Button>
        </>
      ) : signIn ? (
        <div className="space-y-3">
          <p className="text-center text-ui-base text-foreground-subtle">
            {account_t("matchCode")}
          </p>
          <p
            className="text-center font-mono text-xl tracking-widest"
            aria-label={signIn.userCode.split("").join(" ")}
          >
            {signIn.userCode}
          </p>
          <p className="text-center text-ui-sm text-foreground-subtle">{account_t("return")}</p>
          <Button
            variant="outline"
            className="h-10 w-full text-ui-base"
            size="lg"
            autoFocus
            disabled={busy}
            onClick={() => void platform.openExternal(signIn.verificationUrl)}
          >
            {account_t("openBrowser")}
          </Button>
          <Button
            className="h-10 w-full text-ui-base"
            size="lg"
            disabled={busy}
            onClick={() => {
              completing.current = true;
              void run("complete");
            }}
          >
            {busy ? (
              <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : null}
            {account_t("complete")}
          </Button>
          <Button
            variant="outline"
            className="h-10 w-full text-ui-base"
            size="lg"
            onClick={() => void run("cancel")}
          >
            {account_t("cancel")}
          </Button>
        </div>
      ) : (
        <>
          {restoreFailed ? (
            // Explicit, user-initiated re-check of the saved session; never starts a sign-in.
            <Button
              className="h-10 w-full text-ui-base"
              size="lg"
              autoFocus
              disabled={busy}
              onClick={() => void run("restore")}
            >
              {busy ? (
                <Loader2Icon
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : null}
              {t("checkAgain")}
            </Button>
          ) : null}
          <Button
            variant={restoreFailed ? "outline" : "default"}
            className="h-10 w-full text-ui-base"
            size="lg"
            autoFocus={!restoreFailed}
            disabled={busy}
            data-testid={TID_LUMI_ENTRY_SIGN_IN}
            onClick={() => void run("begin")}
          >
            {busy && !restoreFailed ? (
              <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : null}
            {error && !restoreFailed ? t("retry") : account_t("begin")}
          </Button>
        </>
      )}
    </div>
  );
}
