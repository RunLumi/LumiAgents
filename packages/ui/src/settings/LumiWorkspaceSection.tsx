import { useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import type {
  LumiAccountCommand,
  LumiAccountProjection,
  LumiWorkspaceEnvironment,
  LumiWorkspaceProjection,
  LumiWorkspaceStage,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { isLumiErrorRetryable, lumiErrorCopyId } from "../lumi/lumiErrorCopy.js";
import { LumiManagedRunSection } from "./LumiManagedRunSection.js";
import { LumiWorkspaceCredentialChoice } from "./LumiWorkspaceCredentialChoice.js";

// Workspace buttons carry long labels; wrap them so a 320px layout never clips or overflows.
const WRAPPING_BUTTON = "h-auto min-h-8 w-full justify-start whitespace-normal py-1.5 text-left";
const nextStage: Partial<
  Record<LumiWorkspaceStage, Exclude<LumiWorkspaceStage, "local_unmanaged" | "history_sync">>
> = {
  local_unmanaged: "account_optional",
  account_optional: "device_enrolled",
  device_enrolled: "workspace_bound",
  workspace_bound: "managed_policy",
};

function defaultDisplayName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || "Workspace";
}

export function LumiWorkspaceSection(props: {
  account: LumiAccountProjection;
  workspacePath: string;
  workspaceIdentity?: string;
  environmentType: LumiWorkspaceEnvironment;
  refreshKey?: number;
  onManagedRunStarted?: () => void;
}) {
  const platform = usePlatform();
  const { lumiAccount } = platform;
  const { intl } = useZCodeIntl();
  const [orgId, setOrgId] = useState(
    props.account.organizations.find((org) => org.state === "active" && org.status === "active")
      ?.id ?? "",
  );
  const [projects, setProjects] = useState<
    { id: string; name: string; archived: boolean; visibility: "org" | "restricted" }[]
  >([]);
  const [projectId, setProjectId] = useState("");
  const [displayName, setDisplayName] = useState(() => defaultDisplayName(props.workspacePath));
  const [workspace, setWorkspace] = useState<LumiWorkspaceProjection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // True once a read for the selected org succeeded; separates "empty" from "not loaded yet".
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const sequence = useRef(0);
  const text = (id: string) => intl.formatMessage({ id: `lumiWorkspace.${id}` });
  const activeOrgs = props.account.organizations.filter(
    (org) => org.state === "active" && org.status === "active",
  );
  const selectedOrgId = activeOrgs.some((org) => org.id === orgId)
    ? orgId
    : (activeOrgs[0]?.id ?? "");

  useEffect(() => {
    if (!selectedOrgId || !lumiAccount || !props.workspacePath) return;
    const current = ++sequence.current;
    setBusy(true);
    setError(undefined);
    setLoaded(false);
    void (async () => {
      const projectResult = await lumiAccount.request({
        action: "list-projects",
        orgId: selectedOrgId,
      });
      if (!projectResult.ok || !projectResult.projects)
        throw new Error(projectResult.ok ? "lumi_projects_missing" : projectResult.code);
      const workspaceResult = await lumiAccount.request({
        action: "read-workspace",
        orgId: selectedOrgId,
        workspacePath: props.workspacePath,
        ...(props.workspaceIdentity ? { workspaceIdentity: props.workspaceIdentity } : {}),
        environmentType: props.environmentType,
      });
      if (!workspaceResult.ok || !workspaceResult.workspace)
        throw new Error(workspaceResult.ok ? "lumi_workspace_missing" : workspaceResult.code);
      return { projects: projectResult.projects, workspace: workspaceResult.workspace };
    })()
      .then((result) => {
        if (current !== sequence.current) return;
        setProjects(result.projects);
        setWorkspace(result.workspace);
        setLoaded(true);
        if (result.workspace.projectId) setProjectId(result.workspace.projectId);
        if (result.workspace.displayName) setDisplayName(result.workspace.displayName);
      })
      .catch((cause: unknown) => {
        if (current === sequence.current)
          setError(
            cause && typeof cause === "object" && "message" in cause
              ? String(cause.message)
              : "lumi_workspace_action_failed",
          );
      })
      .finally(() => {
        if (current === sequence.current) setBusy(false);
      });
    return () => {
      sequence.current++;
    };
  }, [
    lumiAccount,
    props.environmentType,
    props.workspaceIdentity,
    props.workspacePath,
    selectedOrgId,
    props.refreshKey,
    reloadKey,
  ]);

  if (!lumiAccount || !props.workspacePath || activeOrgs.length === 0) return null;

  /**
   * After any refused or failed command the server may or may not have committed, so the projection
   * on screen is untrusted. Re-read it; if that also fails the workspace is cleared, which keeps
   * bind/advance disabled until an explicit reload proves the state (no second binding by retry).
   */
  async function refreshAfterFailure(current: number) {
    if (!lumiAccount) return;
    try {
      const reread = await lumiAccount.request({
        action: "read-workspace",
        orgId: selectedOrgId,
        workspacePath: props.workspacePath,
        ...(props.workspaceIdentity ? { workspaceIdentity: props.workspaceIdentity } : {}),
        environmentType: props.environmentType,
      });
      if (current !== sequence.current) return;
      setWorkspace(reread.ok ? reread.workspace : undefined);
    } catch {
      if (current === sequence.current) setWorkspace(undefined);
    }
  }

  async function submit(command: LumiAccountCommand) {
    if (!lumiAccount || busy) return;
    const current = ++sequence.current;
    setBusy(true);
    setError(undefined);
    try {
      const result = await lumiAccount.request(command);
      if (current !== sequence.current) return;
      if (!result.ok) {
        setError(result.code);
        await refreshAfterFailure(current);
        return;
      }
      if (result.workspace) {
        setWorkspace(result.workspace);
      }
    } catch {
      if (current === sequence.current) {
        setError("lumi_workspace_action_failed");
        await refreshAfterFailure(current);
      }
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }

  const openProjects = projects.filter((project) => !project.archived);
  const stage = workspace?.stage ?? "local_unmanaged";
  const next = nextStage[stage];
  const needsBinding =
    !workspace ||
    (workspace.stage === "local_unmanaged" &&
      (!workspace.adoptionStateId || !workspace.workspaceBindingId));
  const canBind =
    selectedOrgId && projectId && displayName.trim() && workspace?.deviceUsable && !busy;
  const canAdvance =
    Boolean(
      workspace?.adoptionStateId && workspace.workspaceBindingId && workspace.deviceUsable && next,
    ) && !busy;

  return (
    <section
      aria-labelledby="lumi-workspace-heading"
      className="mt-4 space-y-3 border-t border-border pt-4 text-ui-base"
    >
      <h3 id="lumi-workspace-heading" className="font-semibold">
        {text("title")}
      </h3>
      <p className="text-foreground-subtle">{text("privacy")}</p>
      <label htmlFor="lumi-workspace-org">{text("org")}</label>
      <select
        id="lumi-workspace-org"
        value={selectedOrgId}
        disabled={busy}
        onChange={(event) => {
          setOrgId(event.target.value);
          setWorkspace(undefined);
          setLoaded(false);
          setProjectId("");
          setProjects([]);
        }}
        className="block w-full rounded-md border border-border bg-card p-2 focus-visible:ring-2"
      >
        {activeOrgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.displayName}
          </option>
        ))}
      </select>
      <label htmlFor="lumi-workspace-project">{text("project")}</label>
      <select
        id="lumi-workspace-project"
        value={projectId}
        disabled={busy || !projects.length}
        onChange={(event) => setProjectId(event.target.value)}
        className="block w-full rounded-md border border-border bg-card p-2 focus-visible:ring-2"
      >
        <option value="">
          {loaded && !openProjects.length ? text("noProjects") : text("chooseProject")}
        </option>
        {openProjects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <label htmlFor="lumi-workspace-name">{text("displayName")}</label>
      <input
        id="lumi-workspace-name"
        value={displayName}
        maxLength={120}
        disabled={busy || Boolean(workspace?.workspaceBindingId)}
        onChange={(event) => setDisplayName(event.target.value)}
        className="block w-full rounded-md border border-border bg-card p-2 focus-visible:ring-2"
      />
      {workspace && !workspace.deviceUsable ? (
        <p role="status" className="text-foreground-subtle">
          {text("deviceRequired")}
        </p>
      ) : null}
      {workspace ? (
        <div className="text-foreground-subtle">
          <p>
            {text("ownership")}: {text(`ownership.${workspace.ownership}`)}
          </p>
          <p>
            {text("stage")}: {text(`stage.${workspace.stage}`)}
          </p>
        </div>
      ) : null}
      {workspace?.adoptionStateId &&
      workspace.workspaceBindingId &&
      workspace.adoptionVersion !== null &&
      workspace.projectId &&
      workspace.stage !== "history_sync" ? (
        <LumiWorkspaceCredentialChoice
          // 服务端标签/版本变化（含晚到的投影）时重建，丢弃未确认的本地选择。
          key={`${workspace.adoptionStateId}:${workspace.adoptionVersion}:${workspace.credentialMode}`}
          workspace={workspace}
          busy={busy}
          onOpenConsole={() => platform.openExternal(workspace.credentialConsoleUrl)}
          onConfirm={(credentialMode) =>
            void submit({
              action: "set-workspace-credential-mode",
              orgId: selectedOrgId,
              projectId: workspace.projectId as string,
              workspacePath: props.workspacePath,
              ...(props.workspaceIdentity ? { workspaceIdentity: props.workspaceIdentity } : {}),
              environmentType: props.environmentType,
              credentialMode,
              expectedStage: workspace.stage as Exclude<LumiWorkspaceStage, "history_sync">,
              expectedVersion: workspace.adoptionVersion as number,
              confirm: true,
            })
          }
        />
      ) : null}
      {workspace?.stage === "managed_policy" && workspace.ownership === "org_managed" ? (
        <LumiManagedRunSection
          orgId={selectedOrgId}
          workspace={workspace}
          workspacePath={props.workspacePath}
          workspaceIdentity={props.workspaceIdentity}
          onRunStarted={props.onManagedRunStarted}
        />
      ) : null}
      {busy ? (
        <p role="status" className="flex items-center gap-2 text-foreground-subtle">
          <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {text("busy")}
        </p>
      ) : null}
      {loaded && !busy && !error && workspace && !openProjects.length ? (
        <p role="status" className="text-foreground-subtle">
          {text("noProjectsHint")}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-3">
          <p className="break-words text-destructive">
            {intl.formatMessage({ id: lumiErrorCopyId(error) })}{" "}
            <span className="font-mono">{error}</span>
          </p>
          {isLumiErrorRetryable(error) ? (
            <Button
              type="button"
              variant="outline"
              className={WRAPPING_BUTTON}
              disabled={busy}
              onClick={() => setReloadKey((key) => key + 1)}
            >
              {text("reload")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {needsBinding ? (
        <Button
          className={WRAPPING_BUTTON}
          disabled={!canBind}
          onClick={() =>
            void submit({
              action: "bind-workspace",
              orgId: selectedOrgId,
              projectId,
              workspacePath: props.workspacePath,
              ...(props.workspaceIdentity ? { workspaceIdentity: props.workspaceIdentity } : {}),
              environmentType: props.environmentType,
              displayName,
              confirm: true,
            })
          }
        >
          {text("bind")}
        </Button>
      ) : next ? (
        <Button
          className={WRAPPING_BUTTON}
          disabled={!canAdvance}
          onClick={() =>
            void submit({
              action: "advance-workspace",
              orgId: selectedOrgId,
              projectId: workspace?.projectId ?? projectId,
              workspacePath: props.workspacePath,
              ...(props.workspaceIdentity ? { workspaceIdentity: props.workspaceIdentity } : {}),
              environmentType: props.environmentType,
              stage: next,
              confirm: true,
            })
          }
        >
          {text(`next.${next}`)}
        </Button>
      ) : null}
      {workspace && (workspace.stage !== "local_unmanaged" || workspace.workspaceBindingId) ? (
        <Button
          variant="outline"
          className={WRAPPING_BUTTON}
          disabled={busy}
          onClick={() =>
            void submit({
              action: "rollback-workspace",
              orgId: selectedOrgId,
              workspacePath: props.workspacePath,
              ...(props.workspaceIdentity ? { workspaceIdentity: props.workspaceIdentity } : {}),
              environmentType: props.environmentType,
              confirm: true,
            })
          }
        >
          {text(workspace.stage === "local_unmanaged" ? "unbind" : "rollback")}
        </Button>
      ) : null}
    </section>
  );
}
