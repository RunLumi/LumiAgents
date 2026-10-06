/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { useEffect, useRef, useState } from "react";
import type {
  LumiAccountProjection,
  LumiDeviceStateProjection,
  LumiAccountCommand,
} from "@zcode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
export function LumiDeviceSection({ account }: { account: LumiAccountProjection }) {
  const { lumiAccount } = usePlatform(),
    { intl } = useZCodeIntl();
  const text = (id: string) => intl.formatMessage({ id: `lumiDevice.${id}` });
  const orgs = account.organizations.filter((o) => o.status === "active" && o.state === "active");
  const [selection, setSelection] = useState(""),
    [device, setDevice] = useState<LumiDeviceStateProjection>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const seq = useRef(0);
  const orgId = orgs.find((o) => o.id === selection)?.id ?? orgs[0]?.id;
  useEffect(() => {
    if (!orgId || !lumiAccount) return;
    const current = ++seq.current;
    setDevice(undefined);
    setError(false);
    setBusy(true);
    void lumiAccount
      .request({ action: "read-device", orgId })
      .then((r) => {
        if (current === seq.current) {
          if (r.ok) setDevice(r.device);
          else setError(true);
        }
      })
      .catch(() => {
        if (current === seq.current) setError(true);
      })
      .finally(() => {
        if (current === seq.current) setBusy(false);
      });
    return () => {
      seq.current++;
    };
  }, [orgId, lumiAccount]);
  if (!lumiAccount) return null;
  async function action(kind: "enroll-device" | "sync-device" | "refresh-device") {
    if (!orgId || !lumiAccount || busy) return;
    const current = ++seq.current;
    setBusy(true);
    setError(false);
    const command: LumiAccountCommand =
      kind === "enroll-device" ? { action: kind, orgId, confirm: true } : { action: kind, orgId };
    try {
      const result = await lumiAccount.request(command);
      if (current !== seq.current) return;
      if (result.ok) setDevice(result.device);
      else setError(true);
    } catch {
      if (current === seq.current) setError(true);
    } finally {
      if (current === seq.current) setBusy(false);
    }
  }
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4 text-ui-base">
      <h3 className="font-semibold">{text("title")}</h3>
      {orgs.length === 0 ? (
        <p>{text("noOrg")}</p>
      ) : (
        <>
          <label htmlFor="lumi-device-org">{text("org")}</label>
          <select
            id="lumi-device-org"
            value={orgId}
            disabled={busy}
            onChange={(e) => setSelection(e.target.value)}
            className="block w-full rounded-md border border-border bg-card p-2 focus-visible:ring-2"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}
              </option>
            ))}
          </select>
          <p className="text-foreground-subtle">{text("consent")}</p>
          {busy ? <p role="status">{text("busy")}</p> : null}
          {error ? (
            <p role="alert" className="text-destructive">
              {text("error")}
            </p>
          ) : null}
          {device?.device ? (
            <p>
              {text("deviceId")}: <span className="font-mono">{device.device.id}</span> ·{" "}
              {text("policyVersion")}: {device.device.policyVersion}
            </p>
          ) : null}
          {device?.status === "reauth_required" ? <p role="alert">{text("expired")}</p> : null}
          <div className="flex flex-wrap gap-2">
            {!device?.device ? (
              <Button disabled={busy} onClick={() => void action("enroll-device")}>
                {text(device?.status === "pending" ? "resume" : "enroll")}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={busy || device.status === "reauth_required"}
                  onClick={() => void action("sync-device")}
                >
                  {text("sync")}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || device.status === "reauth_required"}
                  onClick={() => void action("refresh-device")}
                >
                  {text("refresh")}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
