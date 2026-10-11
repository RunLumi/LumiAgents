/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 附加到既有托管任务（spec 07「Attach to an existing managed automation」）。
// 与 adopt/release 共用同一组端口、同一个标记表和同一个所有者：这里只是把 attach 的编排拆成独立模块，
// 不新增状态所有者、队列或写入路径。
import { randomUUID } from "node:crypto";
import { classifyLocalAutomation, type AutomationAdoptionUnsupportedReason } from "./automationAdoptionMapping.js";
import {
  AutomationAdoptionError,
  type AdoptionWorkspaceContext,
  type AutomationAdoptionOwnerPorts,
  type AutomationAttachRefusal,
} from "./automationAdoptionPorts.js";
import type { ManagedAutomationProjection } from "./automationAdoptionTransport.js";

export interface AutomationAttachCandidate {
  managedAutomationId: string;
  name: string;
  status: string;
  /** The definition version the user is looking at; echoed on confirm. */
  version: number;
  scheduleKind: string | null;
  scheduleExpression: string | null;
  scheduleTimezone: string | null;
  attachable: boolean;
  refusal?: AutomationAttachRefusal;
}

export type AutomationAttachPreview =
  | {
      localAutomationId: string;
      title: string;
      adoptable: false;
      reason: AutomationAdoptionUnsupportedReason | "automation_adoption_not_found";
    }
  | {
      localAutomationId: string;
      title: string;
      adoptable: true;
      revision?: number;
      projectId: string;
      /** First `MAX_ATTACH_CANDIDATES` definitions; `truncated` says there were more. */
      candidates: AutomationAttachCandidate[];
      truncated: boolean;
    };

const MAX_ATTACH_CANDIDATES = 50;

/**
 * Whether THIS device could legitimately execute the shared definition. Every input is a server
 * fact or the Main-authorized workspace/user; the renderer contributes only the id it picked. The
 * server stays the authority at claim time, this only refuses what could never run here so the
 * local original is not suppressed for nothing.
 */
function attachRefusal(
  managed: ManagedAutomationProjection,
  workspace: AdoptionWorkspaceContext,
  userId: string,
  alreadyAttached: boolean,
): AutomationAttachRefusal | undefined {
  if (alreadyAttached) return "automation_attach_already_attached";
  if (managed.status !== "active") return "automation_attach_inactive";
  if (managed.projectId !== workspace.projectId) return "automation_attach_project_mismatch";
  if (managed.executionPrincipalKind !== "user" || managed.executionPrincipalId !== userId)
    return "automation_attach_principal_mismatch";
  if (managed.offPeak) return "automation_attach_off_peak";
  // Device-pinned targets need the enrolled device id, which this port does not carry: refuse
  // rather than guess. A binding-less definition resolves to the device's single live binding.
  if (managed.targetDeviceId !== null) return "automation_attach_device_pinned";
  if (
    managed.workspaceBindingId !== null &&
    managed.workspaceBindingId !== workspace.workspaceBindingId
  )
    return "automation_attach_binding_mismatch";
  return undefined;
}

export function createAutomationAttach({ local, server, context }: AutomationAdoptionOwnerPorts) {
  /** Read-only: lists the project's definitions with a per-row attachability verdict. */
  async function previewAttach(input: {
    orgId: string;
    localAutomationId: string;
  }): Promise<AutomationAttachPreview> {
    const meta = await local.readMetadata(input.localAutomationId);
    if (!meta)
      return {
        localAutomationId: input.localAutomationId,
        title: "",
        adoptable: false,
        reason: "automation_adoption_not_found",
      };
    const classification = classifyLocalAutomation(meta, context.now());
    if (!classification.adoptable)
      return {
        localAutomationId: input.localAutomationId,
        title: meta.title,
        adoptable: false,
        reason: classification.reason,
      };
    const workspace = await context.resolveWorkspace(meta.workspaceIdentity?.trim() || meta.workspacePath);
    const [userId, listed] = await Promise.all([
      context.userId(),
      server.listManagedForProject(input.orgId, workspace.projectId),
    ]);
    const candidates: AutomationAttachCandidate[] = [];
    for (const managed of listed.slice(0, MAX_ATTACH_CANDIDATES)) {
      const refusal = attachRefusal(
        managed,
        workspace,
        userId,
        (await local.getMarkerByManagedId(input.orgId, managed.automationId)) !== null,
      );
      candidates.push({
        managedAutomationId: managed.automationId,
        name: managed.name,
        status: managed.status,
        version: managed.version,
        scheduleKind: managed.scheduleKind,
        scheduleExpression: managed.scheduleExpression,
        scheduleTimezone: managed.scheduleTimezone,
        attachable: refusal === undefined,
        ...(refusal ? { refusal } : {}),
      });
    }
    return {
      localAutomationId: input.localAutomationId,
      title: meta.title,
      adoptable: true,
      ...(meta.revision === undefined ? {} : { revision: meta.revision }),
      projectId: workspace.projectId,
      candidates,
      truncated: listed.length > MAX_ATTACH_CANDIDATES,
    };
  }

  /**
   * Explicit attach of the local original to an EXISTING managed definition. Nothing is created,
   * edited, uploaded or paused on the server: it is a fresh read-back, then one local transaction.
   * Ordering is the invariant: the local original is suppressed only after the definition was
   * re-read from the server and validated against the Main-authorized project/binding/user.
   *
   * The prompt never leaves this device: attach points the managed schedule at THIS device's
   * original, so the user must acknowledge that these local instructions are what run here.
   */
  async function attach(input: {
    orgId: string;
    localAutomationId: string;
    managedAutomationId: string;
    confirm: boolean;
    /** Explicit consent that this device's own instructions execute the shared schedule. */
    acknowledgeLocalInstructions: boolean;
    expectedRevision?: number;
    /** The definition version the user confirmed. */
    expectedVersion: number;
  }): Promise<{ state: "managed"; managedAutomationId: string }> {
    if (input.confirm !== true || input.acknowledgeLocalInstructions !== true)
      throw new AutomationAdoptionError("automation_adoption_confirm_required");
    const meta = await local.readMetadata(input.localAutomationId);
    if (!meta) throw new AutomationAdoptionError("automation_adoption_not_found");
    const existing = await local.getMarker(input.localAutomationId);
    if (existing) {
      // Replay of the same confirmed attach is idempotent; anything else never re-routes ownership.
      if (
        existing.orgId === input.orgId &&
        existing.origin === "attached" &&
        existing.state === "managed" &&
        existing.managedAutomationId === input.managedAutomationId
      )
        return { state: "managed", managedAutomationId: input.managedAutomationId };
      throw new AutomationAdoptionError("automation_adoption_not_adoptable");
    }
    if (input.expectedRevision !== undefined && meta.revision !== input.expectedRevision)
      throw new AutomationAdoptionError("automation_adoption_changed");
    const classification = classifyLocalAutomation(meta, context.now());
    if (!classification.adoptable)
      throw new AutomationAdoptionError("automation_adoption_not_adoptable", {
        reason: classification.reason,
      });
    const workspace = await context.resolveWorkspace(meta.workspaceIdentity?.trim() || meta.workspacePath);
    const managed = await server.getManaged(input.orgId, input.managedAutomationId);
    if (managed.version !== input.expectedVersion)
      throw new AutomationAdoptionError("automation_attach_changed");
    const refusal = attachRefusal(
      managed,
      workspace,
      await context.userId(),
      (await local.getMarkerByManagedId(input.orgId, managed.automationId)) !== null,
    );
    if (refusal) throw new AutomationAdoptionError(refusal);
    await local.beginAttach({
      localAutomationId: input.localAutomationId,
      orgId: input.orgId,
      managedAutomationId: managed.automationId,
      idempotencyKey: randomUUID(),
      ...(meta.revision === undefined ? {} : { expectedRevision: meta.revision }),
    });
    return { state: "managed", managedAutomationId: managed.automationId };
  }

  return { previewAttach, attach };
}
