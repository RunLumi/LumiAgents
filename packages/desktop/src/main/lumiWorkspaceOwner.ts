/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { randomBytes, randomUUID } from "node:crypto";
import type {
  LumiAccountProjection,
  LumiDeviceStateProjection,
  LumiWorkspaceProjection,
  LumiWorkspaceStage,
} from "@zcode/shared";
import type {
  LumiAccountHostTransport,
  LumiAdoptionRecord,
  LumiWorkspaceBinding,
} from "@zcode/services/node";
import { authorizeManagedWorkspaceScope } from "./lumiWorkspaceAuthorization.js";
import {
  assertLumiEpoch,
  lumiWorkspaceFenceKey,
  type LumiWorkspaceEpoch,
} from "./lumiSessionFence.js";
import { changeWorkspaceCredentialMode } from "./lumiWorkspaceCredentialMode.js";
import { readWorkspaceServerState } from "./lumiWorkspaceServerState.js";
import {
  projectWorkspace,
  type DeviceOwner,
  type WorkspaceAdvance,
  type WorkspaceBind,
  type WorkspaceCredentialMode,
  type WorkspaceInput,
  type WorkspaceRead,
  type WorkspaceRollback,
  type WorkspaceVault,
} from "./lumiWorkspaceOwnerTypes.js";
import {
  isLumiResourceId,
  isNextWorkspaceStage,
  resolveLocalWorkspaceIdentity,
} from "./lumiWorkspaceValidation.js";
import type { LumiWorkspaceMapping, LumiWorkspaceVaultRecord } from "./lumiWorkspaceVault.js";

/** Coordinates one opaque local mapping; server records remain the ownership authority. */
export function createLumiWorkspaceOwner(options: {
  origin: string;
  orgId: string;
  userId: string;
  appVersion: string;
  account: LumiAccountHostTransport;
  device: DeviceOwner;
  vault: WorkspaceVault;
  /**
   * The account owner's session fence (`lumiSessionFence`): session generation plus the selected
   * organization epoch for this workspace. Absent only in isolated tests; production wiring
   * passes it so a replaced session or a switched organization is detected even when the same
   * user and org are back in place (ABA).
   */
  epoch?: (workspaceKey: string) => LumiWorkspaceEpoch;
}) {
  if (!isLumiResourceId(options.orgId, "org") || !isLumiResourceId(options.userId, "usr"))
    throw new Error("lumi_workspace_invalid");

  let record: LumiWorkspaceVaultRecord | null = null;
  let loaded = false;
  let queue: Promise<void> = Promise.resolve();

  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  async function load(): Promise<LumiWorkspaceVaultRecord> {
    if (loaded && record) return record;
    record = await options.vault.load();
    if (!record) record = await options.vault.createEmpty();
    if (
      record.origin !== new URL(options.origin).origin ||
      record.orgId !== options.orgId ||
      record.userId !== options.userId
    )
      throw new Error("lumi_workspace_invalid");
    loaded = true;
    return record;
  }

  async function account(): Promise<LumiAccountProjection> {
    const value = await options.account.readAccount();
    if (value.user.id !== options.userId) throw new Error("lumi_account_changed");
    const org = value.organizations.find(
      (item) => item.id === options.orgId && item.state === "active" && item.status === "active",
    );
    if (!org) throw new Error("lumi_workspace_org_unavailable");
    return value;
  }

  async function mapping(input: WorkspaceInput): Promise<LumiWorkspaceMapping> {
    const workspaceIdentity = resolveLocalWorkspaceIdentity(input);
    const current = await load();
    const found = current.mappings.find((item) => item.workspaceIdentity === workspaceIdentity);
    if (found) return found;
    const created: LumiWorkspaceMapping = {
      workspaceIdentity,
      workspaceKey: randomBytes(32).toString("hex"),
      adoptionStateId: null,
      deviceBindingId: null,
      projectId: null,
      displayName: null,
      environmentType: null,
    };
    record = { ...current, mappings: [...current.mappings, created] };
    await options.vault.save(record);
    return created;
  }

  async function saveMapping(next: LumiWorkspaceMapping): Promise<void> {
    const current = await load();
    record = {
      ...current,
      mappings: current.mappings.map((item) =>
        item.workspaceIdentity === next.workspaceIdentity ? next : item,
      ),
    };
    await options.vault.save(record);
  }

  const readServerState = (current: LumiWorkspaceMapping, allowMissingBinding = false) =>
    readWorkspaceServerState(
      {
        device: options.device,
        account: options.account,
        orgId: options.orgId,
        installationId: record?.installationId ?? "",
      },
      current.workspaceKey,
      allowMissingBinding,
    );

  const projection = (
    orgId: string,
    current: LumiWorkspaceMapping,
    device: LumiDeviceStateProjection,
    binding: LumiWorkspaceBinding | null,
    adoption: LumiAdoptionRecord | null,
  ): LumiWorkspaceProjection =>
    projectWorkspace(options.origin, orgId, current, device, binding, adoption);

  /**
   * One scope for every command on this workspace. The epoch is captured synchronously (the
   * caller's `admitted` wins: it was taken before the awaits inside `workspaceFor()`), before the
   * serialization queue, so waiting in the queue counts as "before". `assertCurrent` is called
   * before every server write, before every local mapping save and before the projection is
   * returned. A write that already happened stays: it is never undone or retried, only its stale
   * completion (mapping save, projection, authority) is refused; the next read re-derives state.
   */
  const fenced = <T>(
    input: { workspacePath: string; workspaceIdentity?: string },
    admitted: LumiWorkspaceEpoch | undefined,
    work: (assertCurrent: () => Promise<void>) => Promise<T>,
  ): Promise<T> => {
    const key = lumiWorkspaceFenceKey(input);
    const read = (): LumiWorkspaceEpoch => options.epoch?.(key) ?? { session: 0, org: 0 };
    const started = admitted ?? read();
    const assertCurrent = async () => {
      assertLumiEpoch(started, read());
      await account();
      assertLumiEpoch(started, read());
    };
    return serialized(() => work(assertCurrent));
  };

  return {
    /**
     * Read-only, but its result is authority for a later import: the scope it was read under must
     * still hold when it is returned, so a stale answer is refused rather than handed out.
     */
    authorizeManagedWorkspace: (workspaceIdentity: string, admitted?: LumiWorkspaceEpoch) =>
      fenced(
        { workspacePath: workspaceIdentity, workspaceIdentity },
        admitted,
        async (assertCurrent) => {
          await assertCurrent();
          const vaultRecord = await load();
          const current = vaultRecord.mappings.find(
            (item) => item.workspaceIdentity === workspaceIdentity,
          );
          if (!current) throw new Error("lumi_workspace_missing");
          const authorized = await authorizeManagedWorkspaceScope({
            orgId: options.orgId,
            current,
            readServerState: () => readServerState(current),
            readCurrentPolicy: () => options.device.readCurrentPolicy(),
          });
          await assertCurrent();
          return authorized;
        },
      ),

    listProjects: (orgId: string) =>
      serialized(async () => {
        if (orgId !== options.orgId) throw new Error("lumi_workspace_org_unavailable");
        await account();
        return options.account.listProjects(orgId);
      }),

    read: (input: WorkspaceRead, admitted?: LumiWorkspaceEpoch) =>
      fenced(input, admitted, async (assertCurrent) => {
        if (input.orgId !== options.orgId) throw new Error("lumi_workspace_org_unavailable");
        await assertCurrent();
        const current = await mapping(input);
        const server = await readServerState(current);
        const next: LumiWorkspaceMapping = {
          ...current,
          adoptionStateId: server.adoption?.adoptionStateId ?? current.adoptionStateId,
          deviceBindingId: server.deviceBinding?.id ?? null,
          projectId:
            server.adoption?.projectId ?? server.deviceBinding?.projectId ?? current.projectId,
          displayName:
            server.adoption?.displayName ??
            server.deviceBinding?.displayName ??
            current.displayName,
          environmentType: input.environmentType,
        };
        await assertCurrent();
        await saveMapping(next);
        await assertCurrent();
        return projection(
          options.orgId,
          next,
          server.device,
          server.deviceBinding,
          server.adoption,
        );
      }),

    bind: (input: WorkspaceBind, admitted?: LumiWorkspaceEpoch) =>
      fenced(input, admitted, async (assertCurrent) => {
        if (
          input.orgId !== options.orgId ||
          !isLumiResourceId(input.projectId, "prj") ||
          !input.displayName.trim() ||
          input.displayName.length > 120
        )
          throw new Error("lumi_workspace_invalid");
        await assertCurrent();
        const current = await mapping(input);
        const server = await readServerState(current);
        const localUnbound =
          server.adoption?.stage === "local_unmanaged" &&
          server.adoption.ownership === "local_unmanaged" &&
          server.adoption.projectId === null &&
          server.adoption.deviceId === null;
        if (server.adoption && !localUnbound && server.adoption.projectId !== input.projectId)
          throw new Error("lumi_workspace_project_immutable");
        if (
          server.deviceBinding &&
          (server.deviceBinding.projectId !== input.projectId ||
            server.deviceBinding.displayName !== input.displayName.trim() ||
            server.deviceBinding.environmentType !== input.environmentType)
        )
          throw new Error("lumi_workspace_project_immutable");
        const deviceId = server.device.device?.id;
        if (server.device.status !== "active" || !deviceId) throw new Error("lumi_device_required");
        let binding = server.deviceBinding;
        if (!binding) {
          await assertCurrent();
          binding = await options.device.createWorkspaceBinding({
            projectId: input.projectId,
            workspaceIdentity: current.workspaceKey,
            displayName: input.displayName.trim(),
            environmentType: input.environmentType,
          });
        }
        let adoption = server.adoption;
        if (!adoption || localUnbound) {
          await assertCurrent();
          adoption = await options.account.createAdoptionRecord(
            {
              orgId: options.orgId,
              installationId: (await load()).installationId,
              workspaceKey: current.workspaceKey,
              displayName: input.displayName.trim(),
              projectId: input.projectId,
              deviceId,
              clientAppVersion: options.appVersion,
              ...(adoption ? { rebindVersion: adoption.version } : {}),
            },
            randomUUID(),
          );
        }
        if (
          adoption.orgId !== options.orgId ||
          adoption.projectId !== input.projectId ||
          adoption.deviceId !== deviceId ||
          adoption.workspaceKey !== current.workspaceKey
        )
          throw new Error("lumi_workspace_mismatch");
        await assertCurrent();
        await saveMapping({
          ...current,
          adoptionStateId: adoption.adoptionStateId,
          deviceBindingId: binding.id,
          projectId: input.projectId,
          displayName: input.displayName.trim(),
          environmentType: input.environmentType,
        });
        await assertCurrent();
        await options.device.syncPolicy();
        await assertCurrent();
        return projection(options.orgId, current, server.device, binding, adoption);
      }),

    advance: (input: WorkspaceAdvance, admitted?: LumiWorkspaceEpoch) =>
      fenced(input, admitted, async (assertCurrent) => {
        if (input.orgId !== options.orgId || !isLumiResourceId(input.projectId, "prj"))
          throw new Error("lumi_workspace_invalid");
        await assertCurrent();
        const current = await mapping(input);
        const server = await readServerState(current);
        const adoption = server.adoption;
        if (!server.deviceBinding || server.deviceBinding.projectId !== input.projectId)
          throw new Error("lumi_workspace_binding_missing");
        if (!adoption || adoption.projectId !== input.projectId)
          throw new Error("lumi_workspace_binding_missing");
        if (!isNextWorkspaceStage(adoption.stage, input.stage))
          throw new Error("lumi_workspace_stage_invalid");
        if (input.stage === "workspace_bound" || input.stage === "managed_policy") {
          if (
            !server.deviceBinding ||
            server.deviceBinding.projectId !== input.projectId ||
            server.deviceBinding.deviceId !== adoption.deviceId
          )
            throw new Error("lumi_workspace_binding_missing");
          await assertCurrent();
          await options.device.syncPolicy();
        }
        await assertCurrent();
        const next = await options.account.advanceAdoptionRecord(
          {
            orgId: options.orgId,
            adoptionStateId: adoption.adoptionStateId,
            stage: input.stage,
            // 修复降级缺陷：沿用本次操作刚从服务端读到的标签，而不是写死 local_credential。
            credentialMode: adoption.credentialMode,
            version: adoption.version,
            clientAppVersion: options.appVersion,
          },
          randomUUID(),
        );
        const updated = {
          ...current,
          adoptionStateId: next.adoptionStateId,
          deviceBindingId: server.deviceBinding?.id ?? current.deviceBindingId,
          projectId: next.projectId,
          displayName: next.displayName,
          environmentType: input.environmentType,
        };
        await assertCurrent();
        await saveMapping(updated);
        await assertCurrent();
        return projection(options.orgId, updated, server.device, server.deviceBinding, next);
      }),

    /** Label only. Nothing is provisioned, uploaded or bound; the server row stays the authority. */
    setCredentialMode: (input: WorkspaceCredentialMode, admitted?: LumiWorkspaceEpoch) =>
      fenced(input, admitted, async (assertCurrent) => {
        if (input.orgId !== options.orgId) throw new Error("lumi_workspace_org_unavailable");
        await assertCurrent();
        const current = await mapping(input);
        const state = await changeWorkspaceCredentialMode({
          input,
          assertCurrent,
          readState: () => readServerState(current),
          send: (adoption, credentialMode) =>
            options.account.changeAdoptionCredentialMode(
              {
                orgId: options.orgId,
                adoptionStateId: adoption.adoptionStateId,
                // 第 5 阶段已在 helper 中拒绝，此处只会是可发送的阶段。
                stage: adoption.stage as Exclude<LumiWorkspaceStage, "history_sync">,
                credentialMode,
                version: adoption.version,
                clientAppVersion: options.appVersion,
              },
              randomUUID(),
            ),
        });
        return projection(
          options.orgId,
          current,
          state.device,
          state.deviceBinding,
          state.adoption,
        );
      }),

    rollback: (input: WorkspaceRollback, admitted?: LumiWorkspaceEpoch) =>
      fenced(input, admitted, async (assertCurrent) => {
        if (input.orgId !== options.orgId) throw new Error("lumi_workspace_org_unavailable");
        await assertCurrent();
        const current = await mapping(input);
        const server = await readServerState(current, true);
        if (server.deviceBinding) {
          await assertCurrent();
          await options.device.deleteWorkspaceBinding(server.deviceBinding.id);
        }
        let adoption = server.adoption;
        if (
          adoption &&
          (adoption.stage !== "local_unmanaged" || adoption.projectId || adoption.deviceId)
        ) {
          await assertCurrent();
          adoption = await options.account.rollbackAdoptionRecord(
            {
              orgId: options.orgId,
              adoptionStateId: adoption.adoptionStateId,
              version: adoption.version,
            },
            randomUUID(),
          );
        }
        const updated = {
          ...current,
          adoptionStateId: adoption?.adoptionStateId ?? current.adoptionStateId,
          deviceBindingId: null,
          projectId: adoption?.projectId ?? current.projectId,
          displayName: adoption?.displayName ?? current.displayName,
          environmentType: input.environmentType,
        };
        await assertCurrent();
        await saveMapping(updated);
        await assertCurrent();
        return projection(options.orgId, updated, server.device, null, adoption);
      }),
  };
}
