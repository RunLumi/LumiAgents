/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 本地任务接管的顺序编排（spec: docs/specs/lumi-agents/07-automation-adoption-scheduling.md）。
// 纯逻辑 + 端口：真实 Main/Host 装配只提供端口，不复制顺序。顺序即不变量：
//   preview 无写入 → 标记(本地停) → 服务端创建 → 记录托管 ID；归还时 暂停/删除并读回 → 才删标记。
// 任一崩溃窗口都只会出现「两边都不跑」，不会出现「两边都跑」。
// 端口/错误见 automationAdoptionPorts；attach（附加到既有托管任务）见 automationAttachOwner，二者共用同一组端口。
import { randomUUID } from "node:crypto";
import type { AutomationManagedAdoption } from "../session/automationManagedAdoption.js";
import { buildAutomationAdoptionCorrelation } from "../session/automationManagedAdoption.js";
import {
  buildImportCandidate,
  buildManagedAutomationCreateBody,
  classifyLocalAutomation,
  type AutomationAdoptionUnsupportedReason,
} from "./automationAdoptionMapping.js";
import {
  AutomationAdoptionError,
  type AutomationAdoptionOwnerPorts,
  type LocalAutomationMetadata,
} from "./automationAdoptionPorts.js";
import type { ManagedAutomationProjection } from "./automationAdoptionTransport.js";
import { createAutomationAttach } from "./automationAttachOwner.js";
import { LumiAccountError } from "./errors.js";

export {
  AutomationAdoptionError,
  type AdoptionContextPort,
  type AdoptionLocalPort,
  type AdoptionServerPort,
  type AdoptionWorkspaceContext,
  type AutomationAdoptionErrorCode,
  type AutomationAdoptionOwnerPorts,
  type AutomationAttachRefusal,
  type LocalAutomationMetadata,
} from "./automationAdoptionPorts.js";
export type {
  AutomationAttachCandidate,
  AutomationAttachPreview,
} from "./automationAttachOwner.js";

export type AutomationAdoptionPreviewRow =
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
      importable: boolean;
      conflicts: { code: string; subject: string }[];
      /** 预览时的原任务版本；确认必须原样带回。 */
      revision?: number;
    };

export interface AutomationAdoptionPreviewResult {
  rows: AutomationAdoptionPreviewRow[];
  commitReady: boolean;
  modelCapabilityCheck: string | null;
}

export function createAutomationAdoptionOwner(ports: AutomationAdoptionOwnerPorts) {
  const { local, server, context } = ports;

  async function workspaceFor(meta: LocalAutomationMetadata) {
    return context.resolveWorkspace(meta.workspaceIdentity?.trim() || meta.workspacePath);
  }

  /** 只读：本地元数据 + 服务端 preview。任何失败或取消都没有需要撤销的副作用。 */
  async function preview(input: {
    orgId: string;
    localAutomationIds: string[];
  }): Promise<AutomationAdoptionPreviewResult> {
    const byId = new Map<string, AutomationAdoptionPreviewRow>();
    const inInputOrder = () =>
      input.localAutomationIds.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
    const candidates: ReturnType<typeof buildImportCandidate>[] = [];
    const adoptionStateIds = new Set<string>();
    const sent: { localAutomationId: string; title: string; revision?: number }[] = [];
    for (const localAutomationId of input.localAutomationIds) {
      const meta = await local.readMetadata(localAutomationId);
      if (!meta) {
        byId.set(localAutomationId, {
          localAutomationId,
          title: "",
          adoptable: false,
          reason: "automation_adoption_not_found",
        });
        continue;
      }
      const classification = classifyLocalAutomation(meta, context.now());
      if (!classification.adoptable) {
        byId.set(localAutomationId, {
          localAutomationId,
          title: meta.title,
          adoptable: false,
          reason: classification.reason,
        });
        continue;
      }
      // 工作区未绑定/策略阶段不足时直接抛出：这是用户需要先完成的步骤，不是 preview 的冲突项。
      adoptionStateIds.add((await workspaceFor(meta)).adoptionStateId);
      candidates.push(buildImportCandidate(meta, classification.scheduleKind));
      sent.push({
        localAutomationId,
        title: meta.title,
        ...(meta.revision === undefined ? {} : { revision: meta.revision }),
      });
    }
    if (candidates.length === 0)
      return { rows: inInputOrder(), commitReady: false, modelCapabilityCheck: null };
    const verdict = await server.previewImport(input.orgId, {
      candidates,
      adoptionStateIds: [...adoptionStateIds],
    });
    for (const [index, entry] of sent.entries()) {
      const item = verdict.items.find((value) => value.localKey === candidates[index]!.local_key);
      if (!item) throw new LumiAccountError("lumi_response_invalid");
      byId.set(entry.localAutomationId, {
        localAutomationId: entry.localAutomationId,
        title: entry.title,
        adoptable: true,
        importable: item.importable,
        conflicts: item.conflicts,
        ...(entry.revision === undefined ? {} : { revision: entry.revision }),
      });
    }
    const rows = inInputOrder();
    return {
      rows,
      commitReady: rows.every((row) => !row.adoptable || row.importable) && verdict.commitReady,
      modelCapabilityCheck: verdict.modelCapabilityCheck,
    };
  }

  async function findOrCreate(
    orgId: string,
    marker: AutomationManagedAdoption,
    meta: LocalAutomationMetadata,
    choice: { agentDefinitionId: string; modelAlias: string } | undefined,
    scheduleKind: "cron" | "one_time" | undefined,
  ): Promise<ManagedAutomationProjection | null> {
    const workspace = await workspaceFor(meta);
    // 幂等窗口过期后重放可能重复创建：先按 correlation 去重，找不到才创建。
    const found = await server.findManagedByCorrelation(
      orgId,
      workspace.projectId,
      marker.correlation,
    );
    if (found) return found;
    if (!choice || !scheduleKind) return null;
    return server.createManaged(
      orgId,
      buildManagedAutomationCreateBody({
        automation: meta,
        scheduleKind,
        projectId: workspace.projectId,
        agentDefinitionId: choice.agentDefinitionId,
        workspaceBindingId: workspace.workspaceBindingId,
        modelAlias: choice.modelAlias,
        principalUserId: await context.userId(),
        timezone: context.timezone(),
        nowMs: context.now(),
      }),
      marker.idempotencyKey,
    );
  }

  /** 显式确认后的接管。重复调用安全：已有标记则从断点继续。 */
  async function adopt(input: {
    orgId: string;
    localAutomationId: string;
    agentDefinitionId: string;
    modelAlias: string;
    confirm: boolean;
    /** 用户在预览中看到的版本；缺省仅用于恢复/重试已有标记的续跑。 */
    expectedRevision?: number;
  }): Promise<{ state: "managed"; managedAutomationId: string }> {
    if (input.confirm !== true)
      throw new AutomationAdoptionError("automation_adoption_confirm_required");
    const meta = await local.readMetadata(input.localAutomationId);
    if (!meta) throw new AutomationAdoptionError("automation_adoption_not_found");
    const existing = await local.getMarker(input.localAutomationId);
    // 新接管必须是用户看到的那个版本；已有标记的续跑沿用标记写入时的版本，不再比较。
    if (
      !existing &&
      input.expectedRevision !== undefined &&
      meta.revision !== input.expectedRevision
    )
      throw new AutomationAdoptionError("automation_adoption_changed");
    let scheduleKind: "cron" | "one_time" | undefined;
    if (!existing) {
      const classification = classifyLocalAutomation(meta, context.now());
      if (!classification.adoptable)
        throw new AutomationAdoptionError("automation_adoption_not_adoptable", {
          reason: classification.reason,
        });
      scheduleKind = classification.scheduleKind;
      // 确认前再取一次新鲜 preview：确认那一刻仍必须可导入，用户看到的结果不是授权。
      const workspace = await workspaceFor(meta);
      const verdict = await server.previewImport(input.orgId, {
        candidates: [buildImportCandidate(meta, scheduleKind)],
        adoptionStateIds: [workspace.adoptionStateId],
      });
      const item = verdict.items[0];
      if (!item?.importable || !verdict.commitReady)
        throw new AutomationAdoptionError("automation_adoption_blocked", {
          conflicts: item?.conflicts.map((conflict) => conflict.code) ?? [],
        });
    } else if (existing.orgId !== input.orgId || existing.origin === "attached") {
      // An attached original is released, never "re-adopted" into a created definition.
      throw new AutomationAdoptionError("automation_adoption_not_adoptable");
    }
    // 步骤 A：先停本地。此后任何失败都保持抑制，绝不回滚成「本地又开始跑」。
    const marker =
      existing ??
      (await local.beginAdoption({
        localAutomationId: input.localAutomationId,
        orgId: input.orgId,
        idempotencyKey: randomUUID(),
        ...(meta.revision === undefined ? {} : { expectedRevision: meta.revision }),
      }));
    if (marker.state === "releasing")
      throw new AutomationAdoptionError("automation_adoption_release_pending");
    try {
      const managed = marker.managedAutomationId
        ? await server.getManaged(input.orgId, marker.managedAutomationId)
        : await findOrCreate(
            input.orgId,
            marker,
            meta,
            { agentDefinitionId: input.agentDefinitionId, modelAlias: input.modelAlias },
            scheduleKind ?? classifyKind(meta, context.now()),
          );
      if (!managed) throw new LumiAccountError("lumi_automation_invalid");
      await local.recordCreated({
        localAutomationId: input.localAutomationId,
        managedAutomationId: managed.automationId,
      });
      return { state: "managed", managedAutomationId: managed.automationId };
    } catch (cause) {
      throw new AutomationAdoptionError("automation_adoption_pending_recovery", undefined, {
        cause,
      });
    }
  }

  function classifyKind(meta: LocalAutomationMetadata, now: number) {
    const classification = classifyLocalAutomation(meta, now);
    return classification.adoptable ? classification.scheduleKind : undefined;
  }

  /**
   * 启动/重试时只补完「服务端已创建、本地未记录」。没有用户选择（agent/model）就不创建，
   * 避免恢复流程替用户做决定；仍保持抑制，等待用户重试接管或归还本地。
   */
  async function recoverOne(
    orgId: string,
    localAutomationId: string,
  ): Promise<"managed" | "pending"> {
    const marker = await local.getMarker(localAutomationId);
    if (!marker || marker.orgId !== orgId)
      throw new AutomationAdoptionError("automation_adoption_not_found");
    if (marker.state === "managed") return "managed";
    const meta = await local.readMetadata(localAutomationId);
    if (!meta || marker.state !== "suppressed") return "pending";
    const found = await findOrCreate(orgId, marker, meta, undefined, undefined);
    if (!found) return "pending";
    await local.recordCreated({ localAutomationId, managedAutomationId: found.automationId });
    return "managed";
  }

  /** 归还本地：服务端确认暂停+删除（读回）后才删标记；失败保持抑制并可重试。 */
  async function release(input: {
    orgId: string;
    localAutomationId: string;
  }): Promise<{ state: "local" }> {
    const marker = await local.getMarker(input.localAutomationId);
    if (!marker) return { state: "local" };
    if (marker.orgId !== input.orgId)
      throw new AutomationAdoptionError("automation_adoption_not_found");
    const releasing =
      marker.state === "releasing" ? marker : await local.beginRelease(input.localAutomationId);
    try {
      // An attached definition is shared with other devices: returning THIS original never
      // pauses or deletes it. Only the local suppression is removed.
      if (releasing.origin === "attached") {
        await local.completeRelease(input.localAutomationId);
        return { state: "local" };
      }
      let managedId = releasing.managedAutomationId;
      if (!managedId) {
        const meta = await local.readMetadata(input.localAutomationId);
        if (meta) {
          const workspace = await workspaceFor(meta);
          managedId =
            (
              await server.findManagedByCorrelation(
                input.orgId,
                workspace.projectId,
                releasing.correlation,
              )
            )?.automationId ?? null;
        }
      }
      if (managedId) {
        const current = await readIfPresent(input.orgId, managedId);
        if (current) {
          const paused =
            current.status === "paused"
              ? current
              : await server.pauseManaged(input.orgId, managedId, current.version);
          await server.deleteManaged(input.orgId, managedId, paused.version);
        }
      }
      await local.completeRelease(input.localAutomationId);
      return { state: "local" };
    } catch (cause) {
      throw new AutomationAdoptionError("automation_adoption_release_pending", undefined, {
        cause,
      });
    }
  }

  async function readIfPresent(orgId: string, automationId: string) {
    try {
      return await server.getManaged(orgId, automationId);
    } catch (error) {
      if (error instanceof LumiAccountError && error.status === 404) return null;
      throw error;
    }
  }

  return {
    preview,
    adopt,
    ...createAutomationAttach(ports),
    recoverOne,
    release,
    correlationFor: buildAutomationAdoptionCorrelation,
  };
}

export type AutomationAdoptionOwner = ReturnType<typeof createAutomationAdoptionOwner>;
