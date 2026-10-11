/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */

export interface LumiWorkspaceEpoch {
  /** Bumped on every sign-in begin/complete and sign-out, so a replaced session (ABA) differs. */
  session: number;
  /** Bumped each time the selected organization for this workspace changes, including A→B→A. */
  org: number;
}

/** Same identity rule as the rest of the workspace code: identity wins, the path is the fallback. */
export function lumiWorkspaceFenceKey(input: {
  workspacePath: string;
  workspaceIdentity?: string;
}): string {
  return input.workspaceIdentity?.trim() || input.workspacePath;
}

/**
 * The single in-memory owner of "which session and which organization is current". It holds no
 * credentials and no session data: the account transport stays the session authority, and this
 * only lets an operation prove that the scope it was admitted under still holds when it finishes.
 */
export function createLumiSessionFence() {
  let session = 0;
  let orgEpoch = 0;
  const selected = new Map<string, { orgId: string; epoch: number }>();
  return {
    /** The account generation consumed by automation commands. */
    generation: (): number => session,
    /** Invalidates everything admitted earlier. Call at the start AND end of a login transition. */
    bump(): void {
      session += 1;
      selected.clear();
    },
    /** Admission of a `read-workspace`: the renderer's signal that this org is now selected. */
    selectOrg(key: string, orgId: string): void {
      if (selected.get(key)?.orgId === orgId) return;
      orgEpoch += 1;
      selected.set(key, { orgId, epoch: orgEpoch });
    },
    /** Refuses a command for an organization that is no longer the selected one. */
    assertOrgSelected(key: string, orgId: string): void {
      const current = selected.get(key);
      if (current && current.orgId !== orgId) throw new Error("lumi_workspace_org_changed");
    },
    epoch(key: string): LumiWorkspaceEpoch {
      return { session, org: selected.get(key)?.epoch ?? 0 };
    },
  };
}

export type LumiSessionFence = ReturnType<typeof createLumiSessionFence>;

interface WorkspaceScope {
  orgId: string;
  workspacePath: string;
  workspaceIdentity?: string;
}

/** Throws when the scope an operation was admitted under no longer holds. */
export function assertLumiEpoch(started: LumiWorkspaceEpoch, now: LumiWorkspaceEpoch): void {
  if (now.session !== started.session) throw new Error("lumi_account_changed");
  if (now.org !== started.org) throw new Error("lumi_workspace_org_changed");
}

type Admitted<C> = (command: C, admitted: LumiWorkspaceEpoch) => Promise<unknown>;
type Result<T, K extends keyof T> = T[K] extends (...args: never[]) => Promise<infer R> ? R : never;

/**
 * `read-workspace` admission: selecting happens synchronously, before any await, and the epoch
 * captured right after it is the scope the read must still hold when it completes.
 */
export async function admitWorkspaceRead<C extends WorkspaceScope, T extends { read: Admitted<C> }>(
  fence: LumiSessionFence,
  command: C,
  workspaceFor: (orgId: string) => Promise<T>,
): Promise<Result<T, "read">> {
  const key = lumiWorkspaceFenceKey(command);
  fence.selectOrg(key, command.orgId);
  const admitted = fence.epoch(key);
  return (await (await workspaceFor(command.orgId)).read(command, admitted)) as Result<T, "read">;
}

/**
 * Mutating-command admission (bind / advance / rollback / credential choice): refuse a
 * no-longer-selected org and capture the epoch BEFORE the first await, so the awaits inside
 * `workspaceFor` (account read, device owner) are covered. Scope is the command's own
 * org + workspace key: other workspaces' selections never interfere.
 */
export async function admitWorkspaceMutation<
  K extends "bind" | "advance" | "rollback" | "setCredentialMode",
  C extends WorkspaceScope,
  T extends Record<K, Admitted<C>>,
>(
  fence: LumiSessionFence,
  method: K,
  command: C,
  workspaceFor: (orgId: string) => Promise<T>,
): Promise<Result<T, K>> {
  const key = lumiWorkspaceFenceKey(command);
  fence.assertOrgSelected(key, command.orgId);
  const admitted = fence.epoch(key);
  return (await (await workspaceFor(command.orgId))[method](command, admitted)) as Result<T, K>;
}

/** Credential-choice admission (kept as the named entry for the credential lane and its tests). */
export function admitCredentialChoice<
  C extends WorkspaceScope,
  T extends { setCredentialMode: Admitted<C> },
>(
  fence: LumiSessionFence,
  command: C,
  workspaceFor: (orgId: string) => Promise<T>,
): Promise<Result<T, "setCredentialMode">> {
  return admitWorkspaceMutation(fence, "setCredentialMode", command, workspaceFor);
}

/**
 * A new login invalidates operations admitted under the old session when it STARTS, not only once
 * the exchange resolves: the transport may already hold the new session mid-flight.
 */
export function fencedLoginTransitions<A, B>(
  fence: LumiSessionFence,
  transport: { beginSignIn(deviceName: string): Promise<A>; completeSignIn(): Promise<B> },
) {
  return {
    beginSignIn: (deviceName: string): Promise<A> => {
      fence.bump();
      return transport.beginSignIn(deviceName);
    },
    completeSignIn: async (): Promise<B> => {
      fence.bump();
      try {
        return await transport.completeSignIn();
      } finally {
        fence.bump();
      }
    },
  };
}

/** Fence first (stop in-flight work), tear down, then fence again for anything admitted meanwhile. */
export async function fencedSignOut(
  fence: LumiSessionFence,
  teardown: () => Promise<void>,
  signOut: () => Promise<void>,
): Promise<void> {
  fence.bump();
  await teardown();
  try {
    await signOut();
  } finally {
    fence.bump();
  }
}
