import { LumiDeviceSection } from "./LumiDeviceSection.js";
import { LumiWorkspaceSection } from "./LumiWorkspaceSection.js";
/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { useState } from "react";
import type { LumiWorkspaceEnvironment } from "@zcode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import type { LumiFlowCommand } from "@/lumi/lumiAccountFlow.js";
import { useLumiAccountFlow } from "@/lumi/useLumiAccountFlow.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";

/** Separate optional organization account; provider login stays in its existing owner. */
export function LumiAccountSection({
  workspace,
  onManagedRunStarted,
}: {
  workspace?: {
    workspacePath: string;
    workspaceIdentity?: string;
    environmentType: LumiWorkspaceEnvironment;
  };
  onManagedRunStarted?: () => void;
}) {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const { available, state, run } = useLumiAccountFlow();
  const { account, signIn, busy, error } = state;
  const [workspaceRefresh, setWorkspaceRefresh] = useState(0);
  const text = (id: string) => intl.formatMessage({ id: `lumiAccount.${id}` });
  if (!available) return null;
  const request = (command: LumiFlowCommand) => void run(command);
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
          <LumiDeviceSection
            account={account}
            onDeviceChanged={() => setWorkspaceRefresh((value) => value + 1)}
          />
          {workspace ? (
            <LumiWorkspaceSection
              account={account}
              refreshKey={workspaceRefresh}
              onManagedRunStarted={onManagedRunStarted}
              {...workspace}
            />
          ) : null}
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
            <Button variant="outline" onClick={() => void request("cancel")}>
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
