import { LumiDeviceSection } from "./LumiDeviceSection.js";
/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { useEffect, useRef, useState } from "react";
import type {
  LumiAccountProjection,
  LumiSignInProjection,
  LumiAccountCommand,
} from "@zcode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";

/** Separate optional organization account; provider login stays in its existing owner. */
export function LumiAccountSection() {
  const platform = usePlatform();
  const { lumiAccount } = platform;
  const { intl } = useZCodeIntl();
  const [account, setAccount] = useState<LumiAccountProjection>();
  const [signIn, setSignIn] = useState<LumiSignInProjection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const sequence = useRef(0);
  const text = (id: string) => intl.formatMessage({ id: `lumiAccount.${id}` });
  useEffect(() => {
    if (!lumiAccount) return;
    const current = ++sequence.current;
    setBusy(true);
    void lumiAccount
      .request("restore")
      .then((result) => {
        if (current !== sequence.current) return;
        if (result.ok) setAccount(result.account);
        else setError(result.code);
      })
      .catch(() => {
        if (current === sequence.current) setError("lumi_account_failed");
      })
      .finally(() => {
        if (current === sequence.current) setBusy(false);
      });
    return () => {
      sequence.current++;
    };
  }, [lumiAccount]);
  if (!lumiAccount) return null;
  async function request(command: LumiAccountCommand) {
    if (!lumiAccount || busy) return;
    const current = ++sequence.current;
    setBusy(true);
    setError(undefined);
    try {
      const result = await lumiAccount.request(command);
      if (current !== sequence.current) return;
      if (!result.ok) {
        setError(result.code);
        return;
      }
      if (command === "begin") setSignIn(result.signIn);
      if (command === "complete") {
        setAccount(result.account);
        setSignIn(undefined);
      }
      if (command === "cancel") setSignIn(undefined);
      if (command === "logout") {
        setAccount(undefined);
        setSignIn(undefined);
      }
    } catch {
      if (current === sequence.current) setError("lumi_account_failed");
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }
  return (
    <section
      aria-labelledby="lumi-account-heading"
      className="mb-6 rounded-lg border border-border bg-card p-4"
    >
      <h2 id="lumi-account-heading" className="text-ui-base font-semibold text-foreground">
        {text("title")}
      </h2>
      <p className="mt-2 text-ui-base text-foreground-subtle">{text("scope")}</p>
      {busy ? (
        <p role="status" className="mt-3 text-ui-base">
          {text("busy")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-ui-base text-destructive">
          {text("error")} <span className="font-mono">{error}</span>
        </p>
      ) : null}
      {account ? (
        <div className="mt-4 space-y-3 text-ui-base">
          <p>
            {account.user.displayName} · {account.user.email}
          </p>
          <p>{text("noBinding")}</p>
          <LumiDeviceSection account={account} />
          <ul>
            {account.organizations.map((org) => (
              <li key={org.id}>
                {org.displayName} · {org.role}
              </li>
            ))}
          </ul>
          <Button variant="outline" disabled={busy} onClick={() => void request("logout")}>
            {text("logout")}
          </Button>
        </div>
      ) : signIn ? (
        <div className="mt-4 space-y-3 text-ui-base">
          <p>{text("matchCode")}</p>
          <p className="font-mono text-lg tracking-widest">{signIn.userCode}</p>
          <p>{text("return")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void platform.openExternal(signIn.verificationUrl)}
            >
              {text("openBrowser")}
            </Button>
            <Button disabled={busy} onClick={() => void request("complete")}>
              {text("complete")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void request("cancel")}>
              {text("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button className="mt-4" disabled={busy} onClick={() => void request("begin")}>
          {text("begin")}
        </Button>
      )}
    </section>
  );
}
