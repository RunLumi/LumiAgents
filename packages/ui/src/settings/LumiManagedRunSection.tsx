import { useEffect, useRef, useState } from "react";
import type {
  LumiManagedAgentProjection,
  LumiManagedModelProjection,
  LumiWorkspaceProjection,
} from "@zcode/shared";
import { generateTraceId } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";

export function LumiManagedRunSection(props: {
  orgId: string;
  workspace: LumiWorkspaceProjection;
  workspacePath: string;
  workspaceIdentity?: string;
  onRunStarted?: () => void;
}) {
  const { lumiAccount } = usePlatform();
  const { zcodeAgentService, zcodeTaskService } = useServices();
  const { intl } = useZCodeIntl();
  const [agents, setAgents] = useState<LumiManagedAgentProjection[]>([]);
  const [models, setModels] = useState<LumiManagedModelProjection[]>([]);
  const [agentDefinitionId, setAgentDefinitionId] = useState("");
  const [modelAlias, setModelAlias] = useState("");
  const [prompt, setPrompt] = useState("");
  const [taskId, setTaskId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const requestSequence = useRef(0);
  const text = (id: string) => intl.formatMessage({ id: `lumiWorkspace.managedRun.${id}` });

  useEffect(() => {
    if (!lumiAccount || !props.workspace.projectId) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    void lumiAccount
      .request({
        action: "list-managed-options",
        orgId: props.orgId,
        projectId: props.workspace.projectId,
      })
      .then((result) => {
        if (sequence !== requestSequence.current) return;
        if (!result.ok) throw new Error(result.code);
        const nextAgents = result.agents ?? [];
        const nextModels = result.models ?? [];
        setAgents(nextAgents);
        setModels(nextModels);
        const firstAgent = nextAgents.find((agent) => agent.lifecycle === "active");
        setAgentDefinitionId(firstAgent?.id ?? "");
        const preferredAlias = firstAgent?.defaultModelAlias;
        setModelAlias(
          preferredAlias &&
            nextModels.some(
              (model) =>
                model.alias === preferredAlias && model.available && model.lifecycle === "active",
            )
            ? preferredAlias
            : (nextModels.find((model) => model.available && model.lifecycle === "active")?.alias ??
                ""),
        );
      })
      .catch((cause: unknown) => {
        if (sequence === requestSequence.current)
          setError(
            cause &&
              typeof cause === "object" &&
              "message" in cause &&
              typeof cause.message === "string" &&
              /^lumi_[a-z_]{1,80}$/.test(cause.message)
              ? cause.message
              : "lumi_managed_options_failed",
          );
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false);
      });
    return () => {
      requestSequence.current++;
    };
  }, [lumiAccount, props.orgId, props.workspace.projectId]);

  async function startManagedPrompt() {
    if (!lumiAccount || busy || loading || !agentDefinitionId || !modelAlias || !prompt.trim())
      return;
    setBusy(true);
    setError(undefined);
    let runId: string | undefined;
    try {
      const started = await lumiAccount.request({
        action: "begin-managed-run",
        orgId: props.orgId,
        workspaceIdentity: props.workspaceIdentity ?? props.workspacePath,
        agentDefinitionId,
        modelAlias,
        confirm: true,
      });
      if (!started.ok || !started.managedContext)
        throw new Error(started.ok ? "lumi_managed_context_missing" : started.code);
      runId = started.managedContext.runId;
      const modelSelection = await zcodeAgentService.prepareManagedProviderAlias({
        modelAlias,
        managedContext: started.managedContext,
        workspace: {
          workspacePath: props.workspacePath,
          ...(props.workspaceIdentity ? { workspaceIdentity: props.workspaceIdentity } : {}),
        },
      });
      const task = await zcodeTaskService.createTask({
        workspacePath: props.workspacePath,
        ...(props.workspaceIdentity ? { workspaceIdentity: props.workspaceIdentity } : {}),
        mode: "build",
        modelSelection,
        deferPersistenceUntilFirstPrompt: true,
      });
      try {
        await zcodeTaskService.sendPrompt({
          taskId: task.taskId,
          traceId: generateTraceId(task.taskId),
          content: prompt.trim(),
          clientMode: "desktop-continuous",
          modelSelection,
          modelExecution: {
            selectionScope: "execution",
            managedContext: started.managedContext,
          },
        });
      } catch (cause) {
        await lumiAccount.request({ action: "abort-managed-run", runId, confirm: true });
        runId = undefined;
        throw cause;
      }
      useZCodeSessionStore
        .getState()
        .setActiveTaskId(props.workspacePath, task.taskId, props.workspaceIdentity);
      setTaskId(task.taskId);
      props.onRunStarted?.();
    } catch (cause) {
      setError(
        cause &&
          typeof cause === "object" &&
          "message" in cause &&
          typeof cause.message === "string" &&
          /^lumi_[a-z_]{1,80}$/.test(cause.message)
          ? cause.message
          : "lumi_managed_run_failed",
      );
      if (runId) {
        await lumiAccount
          .request({ action: "abort-managed-run", runId, confirm: true })
          .catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-foreground-subtle">{text("disclosure")}</p>
      <label htmlFor="lumi-managed-agent">{text("agent")}</label>
      <select
        id="lumi-managed-agent"
        value={agentDefinitionId}
        disabled={busy || loading || agents.length === 0}
        onChange={(event) => {
          const nextAgent = agents.find((agent) => agent.id === event.target.value);
          setAgentDefinitionId(event.target.value);
          const alias = nextAgent?.defaultModelAlias;
          if (
            alias &&
            models.some(
              (model) => model.alias === alias && model.available && model.lifecycle === "active",
            )
          )
            setModelAlias(alias);
        }}
        className="block w-full rounded-md border border-border bg-card p-2 focus-visible:ring-2"
      >
        <option value="">{text("chooseAgent")}</option>
        {agents
          .filter((agent) => agent.lifecycle === "active")
          .map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
      </select>
      <label htmlFor="lumi-managed-model">{text("model")}</label>
      <select
        id="lumi-managed-model"
        value={modelAlias}
        disabled={busy || loading || models.every((model) => !model.available)}
        onChange={(event) => setModelAlias(event.target.value)}
        className="block w-full rounded-md border border-border bg-card p-2 focus-visible:ring-2"
      >
        <option value="">{text("chooseModel")}</option>
        {models
          .filter((model) => model.available && model.lifecycle === "active")
          .map((model) => (
            <option key={model.alias} value={model.alias}>
              {model.displayName}
            </option>
          ))}
      </select>
      <label htmlFor="lumi-managed-prompt">{text("prompt")}</label>
      <textarea
        id="lumi-managed-prompt"
        value={prompt}
        maxLength={8000}
        rows={4}
        disabled={busy}
        onChange={(event) => setPrompt(event.target.value)}
        className="block w-full resize-y rounded-md border border-border bg-card p-2 focus-visible:ring-2"
      />
      <Button
        disabled={busy || loading || !agentDefinitionId || !modelAlias || !prompt.trim()}
        onClick={() => void startManagedPrompt()}
      >
        {loading ? text("loading") : text("start")}
      </Button>
      {taskId ? (
        <p role="status" className="text-foreground-subtle">
          {text("started")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {text("error")} <span className="font-mono">{error}</span>
        </p>
      ) : null}
    </div>
  );
}
