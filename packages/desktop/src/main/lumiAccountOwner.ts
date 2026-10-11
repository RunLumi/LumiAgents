/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { createLumiDeviceOwner } from "./lumiDeviceOwner.js";
import { createLumiDeviceVault } from "./lumiDeviceVault.js";
import { app, safeStorage } from "electron";
import { ZCODE_VERSION } from "@zcode/shared";
import { join } from "node:path";
import { LumiAccountHostTransport } from "@zcode/services/node";
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

type WorkspaceCommand<K extends "read" | "bind" | "advance" | "setCredentialMode" | "rollback"> =
  Parameters<ReturnType<typeof createLumiWorkspaceOwner>[K]>[0] & { orgId: string };

/** Main-only assembly, created after app.ready; never expose transport/vault getters. */
export function createLumiAccountOwner(origin: string) {
  if (!app.isReady()) throw new Error("lumi_main_not_ready");
  const vault = createLumiSessionVault({
    directory: join(app.getPath("userData"), "lumi-account"),
    origin,
    encryption: safeStorage,
  });
  const transport = new LumiAccountHostTransport(origin, fetch, vault);
  const devices = new Map<string, ReturnType<typeof createLumiDeviceOwner>>();
  const workspaces = new Map<string, ReturnType<typeof createLumiWorkspaceOwner>>();
  /**
   * Bumped on sign-out and on every sign-in begin/complete. Workspace commands capture it at
   * admission and re-check before each server call or local write, so a session replaced
   * mid-confirm (even by the same user) cannot finish what the previous session started.
   */
  const fence = createLumiSessionFence();
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
  return {
    // Restoring the persisted session replaces nothing in memory, so it must not fence a command
    // the user is confirming right now (the renderer may refresh the projection at any time).
    restoreSession: () => transport.restoreSession(),
    // A new login invalidates operations admitted under the old session at admission, not only
    // once the exchange resolves: the transport may already hold the new session mid-flight.
    ...fencedLoginTransitions(fence, transport),
    cancelSignIn: () => transport.cancelSignIn(),
    readAccount: () => transport.readAccount(),
    // Fence first (any workspace command in flight must stop before its next step), tear down,
    // then fence again for anything admitted while the session was ending.
    signOut: () =>
      fencedSignOut(
        fence,
        async () => {
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
  };
}
