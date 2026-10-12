/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 账号 owner 的托管 automation 装配：把纯编排（runtime / activation / 日志化租约端口）接到真实端口。
// 凭据、会话与 managedRuns 仍归账号 owner；这里只通过注入的窄端口访问，不持有任何令牌。
import {
  createJournaledLeasePort,
  createManagedOccurrenceDriver,
  type AutomationRepo,
  type LumiAccountHostTransport,
} from "@zcode/services/node";
import { createManagedAutomationActivation } from "./lumiManagedAutomationActivation.js";
import type { ManagedAutomationHostBridge } from "./lumiManagedAutomationHostBridge.js";
import { createManagedAutomationRuntime } from "./lumiManagedAutomationRuntime.js";
import type { createLumiDeviceOwner } from "./lumiDeviceOwner.js";
import type { ManagedRunLeaseEntry } from "./lumiManagedRunAuthorization.js";

type DeviceOwner = ReturnType<typeof createLumiDeviceOwner>;
type WorkspaceFacts = Awaited<
  ReturnType<
    ReturnType<
      typeof import("./lumiWorkspaceOwner.js").createLumiWorkspaceOwner
    >["authorizeManagedWorkspace"]
  >
>;

/** The slice of the Host bridge managed scheduling uses; `retire` frees a run's stop authority. */
export type ManagedAutomationHostPort = Pick<
  ManagedAutomationHostBridge,
  "available" | "dispatch" | "cancel" | "retire"
>;

/** What the account owner is given to enable managed scheduling; both optional. */
export interface ManagedAutomationOptions {
  /** Main→Host channel for managed automation occurrences; absent means no managed scheduling. */
  automationHost?: ManagedAutomationHostPort;
  log?: (level: "info" | "warn", message: string) => void;
}

export interface ManagedAutomationAssemblyDeps {
  transport: LumiAccountHostTransport;
  deviceFor(orgId: string): Promise<DeviceOwner>;
  authorizeWorkspace(orgId: string, workspaceIdentity: string): Promise<WorkspaceFacts>;
  /** The account owner's lease table; entries are Main memory only. */
  managedRuns: Map<string, ManagedRunLeaseEntry<DeviceOwner>>;
  repo(): AutomationRepo;
  host?: ManagedAutomationHostPort;
  log(level: "info" | "warn", message: string): void;
}

export function createManagedAutomationAssembly(deps: ManagedAutomationAssemblyDeps) {
  const { transport, repo } = deps;

  /**
   * P06 occurrence runs: validated, started and registered here; terminal order is P05 first,
   * then P06 settle (spec 07). Interactive runs never touch this object.
   */
  const activation = createManagedAutomationActivation<DeviceOwner>({
    deviceFor: deps.deviceFor,
    authorizeWorkspace: deps.authorizeWorkspace,
    lease: (runId) => {
      const entry = deps.managedRuns.get(runId);
      return entry?.automation ? { ...entry, automation: entry.automation } : undefined;
    },
    register: (runId, entry) => void deps.managedRuns.set(runId, entry),
    unregister: (runId) => void deps.managedRuns.delete(runId),
    closeSession: (orgId, agentSessionId) => transport.closeManagedSession(orgId, agentSessionId),
    onEnded: (entry) => {
      // Retract the ended runtime's availability claim; best effort, next sync also corrects it.
      void entry.deviceOwner.refreshRuntimeCapabilities().catch(() => undefined);
    },
    // Without a Host bridge no occurrence was ever dispatched, so there is nothing to stop.
    cancelHostRun: async (runId) => (deps.host ? deps.host.cancel(runId) : { ok: false }),
    retireHostRun: (runId) => deps.host?.retire(runId),
  });

  /** Due → claim → start for one org. Journaling and off-peak filtering wrap the lease port. */
  const driverFor = async (orgId: string) => {
    const device = await deps.deviceFor(orgId);
    const userId = (await transport.readAccount()).user.id;
    const journaled = createJournaledLeasePort({
      leases: await device.automationLeases(),
      orgId,
      journal: { record: (input) => repo().recordManagedOccurrence(input) },
      localIdFor: async (managedAutomationId) =>
        (await repo().getManagedAdoptionByManagedId(orgId, managedAutomationId))
          ?.localAutomationId ?? null,
    });
    const driver = createManagedOccurrenceDriver({
      orgId,
      leases: journaled,
      findMarkerByManagedId: (id, managedAutomationId) =>
        repo().getManagedAdoptionByManagedId(id, managedAutomationId),
      // The execution principal is the server's own record of who the automation runs as; it must
      // still be the human this device is enrolled for, and is never fabricated client-side.
      async principalFor(managedAutomationId) {
        const managed = await transport.automations().getManaged(orgId, managedAutomationId);
        if (managed.executionPrincipalKind !== "user" || managed.executionPrincipalId !== userId)
          throw Object.assign(new Error("automation_principal_mismatch"), {
            code: "automation_principal_mismatch",
          });
        return { kind: "user", id: userId };
      },
      currentPolicyVersion: async () => (await device.read()).device?.policyVersion,
    });
    return {
      async poll() {
        try {
          return await driver.poll();
        } catch (error) {
          // The due list is the first device-token call of a pass: an expired or revoked device is
          // recorded by the device owner, the same as on any other device route.
          await device.observeServerRefusal(error);
          throw error;
        } finally {
          // A start that never confirmed cannot be proven "not started": mark it, never retry it.
          await journaled.sweepUnconfirmed();
        }
      },
    };
  };

  const runtime = deps.host
    ? createManagedAutomationRuntime({
        recoverInterrupted: async () => {
          await repo().markInterruptedManagedOccurrences("process_restarted");
        },
        listOrgIds: async () => [
          ...new Set(
            (await repo().listManagedAdoptions({ state: "managed" })).map((marker) => marker.orgId),
          ),
        ],
        driverFor,
        // Only Main reads the retained original's prompt, and only at dispatch time.
        readOriginal: async (localAutomationId) => {
          const row = await repo().get(localAutomationId);
          return row
            ? {
                prompt: row.prompt,
                workspacePath: row.workspacePath,
                ...(row.workspaceIdentity ? { workspaceIdentity: row.workspaceIdentity } : {}),
                ...(row.mode ? { mode: row.mode } : {}),
              }
            : null;
        },
        activate: (input) => activation.activate(input),
        failRun: (runId, code) => activation.failDispatch(runId, code),
        revokeRun: (runId) => activation.revoke(runId),
        host: deps.host,
        journal: { record: (input) => repo().recordManagedOccurrence(input) },
        every: (ms, fn) => {
          const timer = setInterval(fn, ms);
          return () => clearInterval(timer);
        },
        log: deps.log,
      })
    : undefined;

  return {
    activation,
    /** scheduler → Main: one managed due/claim/start pass; undefined when managed scheduling is off. */
    poll: async () => (runtime ? runtime.poll() : undefined),
  };
}
