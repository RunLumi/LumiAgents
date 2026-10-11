/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { createLumiDeviceOwner } from "./lumiDeviceOwner.js";
import { createLumiDeviceVault } from "./lumiDeviceVault.js";
import { app, safeStorage } from "electron";
import { ZCODE_VERSION, type ZCodeManagedRunContext } from "@zcode/shared";
import { join } from "node:path";
import {
  AutomationRepo,
  LumiAccountHostTransport,
  type LumiRuntimeCapabilityReport,
} from "@zcode/services/node";
import {
  createManagedAutomationAssembly,
  type ManagedAutomationOptions,
} from "./lumiManagedAutomationAssembly.js";
import { cancelAndCloseManagedRuns } from "./lumiManagedRunTeardown.js";
import {
  admitCredentialChoice,
  admitWorkspaceMutation,
  admitWorkspaceRead,
  createLumiSessionFence,
  fencedLoginTransitions,
  fencedSignOut,
  withSessionGuard,
} from "./lumiSessionFence.js";
import { createLumiSessionVault } from "./lumiSessionVault.js";
import { createLumiWorkspaceVault } from "./lumiWorkspaceVault.js";
import { createLumiWorkspaceOwner } from "./lumiWorkspaceOwner.js";
import { createLumiManagedToolAdmission } from "./lumiManagedToolAdmission.js";
import { createLumiAutomationAssembly } from "./lumiAutomationOwner.js";
import {
  mergeLiveRuntimeCapabilities,
  publishLumiRuntimeCapabilities,
} from "./lumiRuntimeCapabilityPublication.js";
import {
  assertManagedRunLeaseMatch,
  assertManagedRunLeaseCurrent,
  type ManagedRunLeaseEntry,
} from "./lumiManagedRunAuthorization.js";

export type LumiAccountOwnerOptions = ManagedAutomationOptions;
type WorkspaceCommand<K extends "read" | "bind" | "advance" | "setCredentialMode" | "rollback"> =
  Parameters<ReturnType<typeof createLumiWorkspaceOwner>[K]>[0] & { orgId: string };

/** Main-only assembly, created after app.ready; never expose transport/vault getters. */
export function createLumiAccountOwner(origin: string, options: LumiAccountOwnerOptions = {}) {
  if (!app.isReady()) throw new Error("lumi_main_not_ready");
  const vault = createLumiSessionVault({
    directory: join(app.getPath("userData"), "lumi-account"),
    origin,
    encryption: safeStorage,
  });
  const transport = new LumiAccountHostTransport(origin, fetch, vault);
  const devices = new Map<string, ReturnType<typeof createLumiDeviceOwner>>();
  const workspaces = new Map<string, ReturnType<typeof createLumiWorkspaceOwner>>();
  const managedRuns = new Map<
    string,
    ManagedRunLeaseEntry<Awaited<ReturnType<typeof deviceFor>>>
  >();
  /**
   * Bumped on sign-out and on every sign-in begin/complete/restore. Workspace, device and
   * automation commands capture it at admission and re-check before each server call or local
   * write, so a session replaced mid-confirm (even by the same user) cannot finish what the
   * previous session started.
   */
  const fence = createLumiSessionFence();
  let sharedAutomationRepo: AutomationRepo | undefined;
  const automationRepo = () => (sharedAutomationRepo ??= new AutomationRepo());
  const readLiveRuntimeCapabilities = (owner: unknown): LumiRuntimeCapabilityReport =>
    mergeLiveRuntimeCapabilities(managedRuns.values(), owner);
  const deviceFor = async (orgId: string) => {
    if (!/^org_[0-9a-f]{32}$/.test(orgId)) throw new Error("lumi_org_invalid");
    const account = await transport.readAccount();
    const userId = account.user.id;
    const identity = `${orgId}:${userId}`;
    let owner = devices.get(identity);
    if (!owner) {
      owner = createLumiDeviceOwner({
        origin,
        orgId,
        userId,
        account: transport,
        appVersion: ZCODE_VERSION || app.getVersion(),
        readRuntimeCapabilities: async () => readLiveRuntimeCapabilities(owner),
        vault: createLumiDeviceVault({
          directory: join(app.getPath("userData"), "lumi-account"),
          origin,
          orgId,
          userId,
          encryption: safeStorage,
        }),
      });
      devices.set(identity, owner);
    }
    return owner;
  };
  const workspaceFor = async (orgId: string) => {
    if (!/^org_[0-9a-f]{32}$/.test(orgId)) throw new Error("lumi_org_invalid");
    const account = await transport.readAccount();
    const userId = account.user.id;
    const identity = `${orgId}:${userId}`;
    // Resolve the device owner before the cache check: a concurrent call must not build a second
    // workspace owner (separate queue and installation id) for the same org and user.
    const device = await deviceFor(orgId);
    let owner = workspaces.get(identity);
    if (!owner) {
      owner = createLumiWorkspaceOwner({
        origin,
        orgId,
        userId,
        appVersion: ZCODE_VERSION || app.getVersion(),
        account: transport,
        device,
        epoch: (workspaceKey) => fence.epoch(workspaceKey),
        vault: createLumiWorkspaceVault({
          directory: join(app.getPath("userData"), "lumi-workspaces"),
          origin,
          orgId,
          userId,
          encryption: safeStorage,
        }),
      });
      workspaces.set(identity, owner);
    }
    return owner;
  };
  const beginManagedRun = async (input: {
    orgId: string;
    workspaceIdentity: string;
    agentDefinitionId: string;
    modelAlias: string;
  }): Promise<ZCodeManagedRunContext> => {
    const workspace = await workspaceFor(input.orgId);
    const authorized = await workspace.authorizeManagedWorkspace(input.workspaceIdentity);
    const [device, agents, models] = await Promise.all([
      deviceFor(input.orgId),
      transport.listAgents(input.orgId, authorized.projectId),
      transport.listManagedModels(input.orgId),
    ]);
    const agent = agents.find(
      (item) => item.id === input.agentDefinitionId && item.lifecycle === "active",
    );
    const model = models.find(
      (item) => item.alias === input.modelAlias && item.lifecycle === "active" && item.available,
    );
    if (!agent || !model) throw new Error("lumi_managed_selection_refused");
    const session = await device.createManagedSession({
      projectId: authorized.projectId,
      agentDefinitionId: agent.id,
      workspaceBindingId: authorized.workspaceBindingId,
      title: agent.name,
    });
    if (
      session.lifecycle !== "active" ||
      session.projectId !== authorized.projectId ||
      session.deviceId !== authorized.deviceId ||
      session.agentDefinitionId !== agent.id ||
      session.agentDefinitionVersion !== agent.version
    ) {
      await transport
        .closeManagedSession(input.orgId, session.agentSessionId)
        .catch(() => undefined);
      throw new Error("lumi_managed_session_refused");
    }
    let runId: string | undefined;
    try {
      const run = await device.createManagedRun(session.agentSessionId, model.alias);
      runId = run.runId;
      if (
        run.state !== "queued" ||
        run.projectId !== authorized.projectId ||
        run.deviceId !== authorized.deviceId ||
        run.agentSessionId !== session.agentSessionId ||
        run.agentDefinitionId !== agent.id ||
        run.agentDefinitionVersion !== agent.version ||
        run.workspaceBindingId !== authorized.workspaceBindingId ||
        run.modelAlias !== model.alias ||
        run.policySnapshotId !== null ||
        run.policyVersion !== null
      )
        throw new Error("lumi_managed_run_refused");
      const started = await device.startManagedRun(run);
      if (started.state !== "running" || started.runId !== run.runId || started.requestId === null)
        throw new Error("lumi_managed_run_start_refused");
      const context: ZCodeManagedRunContext = {
        organizationId: input.orgId,
        projectId: authorized.projectId,
        deviceId: authorized.deviceId,
        agentSessionId: session.agentSessionId,
        runId: started.runId,
        agentDefinitionId: agent.id,
        agentDefinitionVersion: agent.version,
        requestId: started.requestId,
        ...(session.externalId ? { externalId: session.externalId } : {}),
        executionMode: "managed",
        policySnapshotId: authorized.policySnapshotId,
        policyVersion: authorized.policyVersion,
      };
      managedRuns.set(started.runId, {
        context,
        workspaceIdentity: input.workspaceIdentity,
        modelAlias: model.alias,
        deviceOwner: device,
      });
      return context;
    } catch (error) {
      if (runId) {
        const latest = await device.getManagedRun(runId).catch(() => undefined);
        if (latest && ["queued", "dispatching", "running"].includes(latest.state))
          await device.cancelManagedRun(latest).catch(() => undefined);
      }
      await transport
        .closeManagedSession(input.orgId, session.agentSessionId)
        .catch(() => undefined);
      throw error;
    }
  };
  const authorizeManagedRequest = async (request: {
    sessionId: string;
    workspaceIdentity: string;
    providerId: string;
    modelId: string;
    managedContext: ZCodeManagedRunContext;
  }) => {
    const context = request.managedContext;
    const lease = context ? managedRuns.get(context.runId) : undefined;
    assertManagedRunLeaseMatch(lease, request);
    const workspace = await workspaceFor(context.organizationId);
    const authorized = await workspace.authorizeManagedWorkspace(lease.workspaceIdentity);
    if (
      authorized.projectId !== context.projectId ||
      authorized.deviceId !== context.deviceId ||
      authorized.policySnapshotId !== context.policySnapshotId ||
      authorized.policyVersion !== context.policyVersion
    )
      throw new Error("lumi_managed_policy_stale");
    const run = await lease.deviceOwner.getManagedRun(context.runId);
    if (
      run.state !== "running" ||
      run.orgId !== context.organizationId ||
      run.projectId !== context.projectId ||
      run.deviceId !== context.deviceId ||
      run.agentSessionId !== context.agentSessionId ||
      run.agentDefinitionId !== context.agentDefinitionId ||
      run.agentDefinitionVersion !== context.agentDefinitionVersion ||
      run.modelAlias !== lease.modelAlias ||
      (run.policySnapshotId !== null && run.policySnapshotId !== context.policySnapshotId) ||
      (run.policyVersion !== null && run.policyVersion !== context.policyVersion) ||
      (run.requestId !== null && run.requestId !== context.requestId)
    )
      throw new Error("lumi_managed_run_refused");
    if (lease.hostSessionId !== undefined && lease.hostSessionId !== request.sessionId)
      throw new Error("lumi_managed_auth_refused");
    assertManagedRunLeaseCurrent(lease, managedRuns.get(context.runId));
    return lease;
  };
  const resolveManagedRequestAuth = async (
    request: Parameters<typeof authorizeManagedRequest>[0],
  ) => {
    const lease = await authorizeManagedRequest(request);
    const apiKey = await transport.readManagedInferenceBearer(
      request.managedContext.organizationId,
      (await transport.readAccount()).user.id,
    );
    assertManagedRunLeaseCurrent(lease, managedRuns.get(request.managedContext.runId));
    assertManagedRunLeaseMatch(lease, request);
    lease.hostSessionId ??= request.sessionId;
    return { apiKey };
  };
  const toolAdmission = createLumiManagedToolAdmission({
    lease: (runId) => managedRuns.get(runId),
    authorize: authorizeManagedRequest,
    resolveIdentity: (orgId, tool) => transport.resolveReviewedToolIdentity(orgId, tool),
  });
  const reportRuntimeCapabilities = async (input: {
    workspaceIdentity: string;
    params: import("@zcode/shared").ZCodeManagedRuntimeCapabilitiesRequest;
  }) => {
    const params = input.params,
      lease = managedRuns.get(params.context.runId);
    // Only the exact lease already bound to this Host session may publish a snapshot.
    if (!lease?.hostSessionId || lease.hostSessionId !== params.sessionId)
      throw new Error("lumi_runtime_capabilities_refused");
    await publishLumiRuntimeCapabilities(lease, params.capabilities, {
      isCurrent: () => managedRuns.get(params.context.runId) === lease,
      authorize: async () => {
        await authorizeManagedRequest({
          sessionId: params.sessionId,
          workspaceIdentity: input.workspaceIdentity,
          providerId: "lumi-managed",
          modelId: lease.modelAlias,
          managedContext: params.context,
        });
      },
      publish: () => lease.deviceOwner.refreshRuntimeCapabilities(),
    });
    return { runId: params.context.runId, recorded: true as const };
  };
  /** P06 occurrence runs (activation, due/claim/start, terminal order): see spec 07. */
  const automation = createManagedAutomationAssembly({
    transport,
    deviceFor,
    authorizeWorkspace: async (orgId, workspaceIdentity) =>
      (await workspaceFor(orgId)).authorizeManagedWorkspace(workspaceIdentity),
    managedRuns,
    repo: automationRepo,
    ...(options.automationHost ? { host: options.automationHost } : {}),
    log: options.log ?? (() => undefined),
  });
  const settleManagedRun = async (
    runId: string,
    outcome: "complete" | "fail" | "cancel",
    failureCode = "agent_failed",
  ): Promise<void> => {
    const lease = managedRuns.get(runId);
    if (!lease) throw new Error("lumi_managed_run_missing");
    if (lease.automation) return automation.activation.settle(runId, outcome, failureCode);
    const run = await lease.deviceOwner.getManagedRun(runId);
    if (run.state !== "running") throw new Error("lumi_managed_run_refused");
    if (outcome === "complete") await lease.deviceOwner.completeManagedRun(run);
    else if (outcome === "fail") await lease.deviceOwner.failManagedRun(run, failureCode);
    else await lease.deviceOwner.cancelManagedRun(run);
    await transport.closeManagedSession(lease.context.organizationId, lease.context.agentSessionId);
    managedRuns.delete(runId);
    // Retract the ended runtime's availability claim; best effort, next sync also corrects it.
    void lease.deviceOwner.refreshRuntimeCapabilities().catch(() => undefined);
  };
  const abortManagedRunBeforeAuth = async (runId: string): Promise<void> => {
    const lease = managedRuns.get(runId);
    // A P06 occurrence run belongs to Main's lease/fence; a renderer command can never end it.
    if (!lease || lease.automation || lease.hostSessionId !== undefined)
      throw new Error("lumi_managed_run_refused");
    const run = await lease.deviceOwner.getManagedRun(runId);
    if (run.state !== "running") throw new Error("lumi_managed_run_refused");
    await lease.deviceOwner.cancelManagedRun(run);
    await transport.closeManagedSession(lease.context.organizationId, lease.context.agentSessionId);
    managedRuns.delete(runId);
  };

  return {
    // Restoring the persisted session replaces nothing in memory, so it must not fence a command
    // the user is confirming right now (the renderer may refresh the projection at any time).
    restoreSession: () => transport.restoreSession(),
    // A new login invalidates operations admitted under the old session at admission, not only
    // once the exchange resolves: the transport may already hold the new session mid-flight.
    ...fencedLoginTransitions(fence, transport),
    /** scheduler → Main: one managed due/claim/start pass; false when managed scheduling is off. */
    pollManagedAutomations: () => automation.poll(),
    cancelSignIn: () => transport.cancelSignIn(),
    readAccount: () => transport.readAccount(),
    // Fence first (any workspace, automation or credential command in flight must stop before its
    // next step), tear down, then fence again for anything admitted while the session was ending.
    signOut: () =>
      fencedSignOut(
        fence,
        async () => {
          await cancelAndCloseManagedRuns(managedRuns.entries(), transport);
          managedRuns.clear();
          devices.clear();
          workspaces.clear();
        },
        () => transport.signOut(),
      ),
    // Device commands run under the session fence too: enroll and recover span several server
    // calls and vault writes, and a sign-out or replaced session must stop the next step.
    enrollDevice: (orgId: string) =>
      withSessionGuard(fence, async (guard) => (await deviceFor(orgId)).enroll(guard)),
    readDevice: (orgId: string) =>
      withSessionGuard(fence, async (guard) => (await deviceFor(orgId)).read(guard)),
    syncDevicePolicy: (orgId: string) =>
      withSessionGuard(fence, async (guard) => (await deviceFor(orgId)).syncPolicy(guard)),
    refreshDevice: (orgId: string) =>
      withSessionGuard(fence, async (guard) => (await deviceFor(orgId)).refresh(guard)),
    recoverDevice: (orgId: string) =>
      withSessionGuard(fence, async (guard) => (await deviceFor(orgId)).recover(guard)),
    listProjects: (orgId: string) =>
      withSessionGuard(fence, async () => (await workspaceFor(orgId)).listProjects(orgId)),
    listManagedOptions: async (orgId: string, projectId: string) => {
      const account = await transport.readAccount();
      if (
        !account.organizations.some(
          (organization) =>
            organization.id === orgId &&
            organization.state === "active" &&
            organization.status === "active",
        ) ||
        !/^prj_[0-9a-f]{32}$/.test(projectId)
      )
        throw new Error("lumi_managed_options_refused");
      const [agents, models] = await Promise.all([
        transport.listAgents(orgId, projectId),
        transport.listManagedModels(orgId),
      ]);
      return { agents, models };
    },
    // The renderer reads the workspace for an org exactly when that org becomes selected.
    readWorkspace: (command: WorkspaceCommand<"read">) =>
      admitWorkspaceRead(fence, command, workspaceFor),
    bindWorkspace: (command: WorkspaceCommand<"bind">) =>
      admitWorkspaceMutation(fence, "bind", command, workspaceFor),
    advanceWorkspace: (command: WorkspaceCommand<"advance">) =>
      admitWorkspaceMutation(fence, "advance", command, workspaceFor),
    setWorkspaceCredentialMode: (command: WorkspaceCommand<"setCredentialMode">) =>
      admitCredentialChoice(fence, command, workspaceFor),
    rollbackWorkspace: (command: WorkspaceCommand<"rollback">) =>
      admitWorkspaceMutation(fence, "rollback", command, workspaceFor),
    beginManagedRun,
    resolveManagedRequestAuth,
    ...createLumiAutomationAssembly({
      transport,
      repo: automationRepo,
      generation: fence.generation,
      authorizeWorkspace: async (orgId, workspaceIdentity) =>
        (await workspaceFor(orgId)).authorizeManagedWorkspace(workspaceIdentity),
    }),
    ...toolAdmission,
    reportRuntimeCapabilities,
    settleManagedRun,
    abortManagedRunBeforeAuth,
  };
}
