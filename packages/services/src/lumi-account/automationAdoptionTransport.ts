/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 人类会话侧的 P08 preview / P06 定义 CRUD（固定路由，请求端口只在 Main 内）。
// 设备令牌路由（claim/start/…）在 automationLeaseTransport.ts，两者凭据永不混用。
import { randomUUID } from "node:crypto";
import { LumiAccountError } from "./errors.js";
import type {
  AutomationImportCandidate,
  buildManagedAutomationCreateBody,
} from "./automationAdoptionMapping.js";

type SessionRequest = (
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  extraHeaders?: Record<string, string>,
) => Promise<Response>;

const ORG_PATTERN = /^org_[0-9a-f]{32}$/;
const AUTOMATION_PATTERN = /^aut_[0-9a-f]{32}$/;
const PROJECT_PATTERN = /^prj_[0-9a-f]{32}$/;
const ADOPTION_STATE_PATTERN = /^wst_[0-9a-f]{32}$/;
const USER_PATTERN = /^usr_[0-9a-f]{32}$/;
const LIST_LIMIT = 100;
/** preview 上报 stage：用户正在确认的是接管 P06 之前的托管策略阶段，服务端只校验不授权。 */
const PREVIEW_STAGE = "managed_policy";

export interface AutomationImportPreviewItem {
  localKey: string;
  importable: boolean;
  conflicts: { code: string; subject: string }[];
}

export interface AutomationImportPreview {
  items: AutomationImportPreviewItem[];
  commitReady: boolean;
  modelCapabilityCheck: string;
  /** 服务端对「本地任务未被改动」的结构性声明；只用于展示，不当作本地保护的证据。 */
  localAutomationsModified: boolean;
}

export interface ManagedAutomationProjection {
  automationId: string;
  orgId: string;
  projectId: string;
  description: string | null;
  status: string;
  version: number;
  executionPrincipalKind: string;
  executionPrincipalId: string;
  workspaceBindingId: string | null;
  /** Bounded display facts for the attach confirm dialog; never authority. */
  name: string;
  scheduleKind: string | null;
  scheduleExpression: string | null;
  scheduleTimezone: string | null;
  targetKind: string | null;
  targetDeviceId: string | null;
  /** Off-peak definitions are never claimed by this client, so they are not attachable. */
  offPeak: boolean;
}

const DISPLAY_MAX = 120;

function bounded(value: unknown): string | null {
  return typeof value === "string" && value ? value.slice(0, DISPLAY_MAX) : null;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value || value.length > max)
    throw new LumiAccountError("lumi_response_invalid");
  return value;
}

function projection(value: unknown, orgId: string): ManagedAutomationProjection {
  if (!value || typeof value !== "object") throw new LumiAccountError("lumi_response_invalid");
  const row = value as Record<string, unknown>;
  const principal = row.execution_principal as Record<string, unknown> | undefined;
  const target = row.target as Record<string, unknown> | undefined;
  const schedule = row.schedule as Record<string, unknown> | null | undefined;
  if (
    typeof row.automation_id !== "string" ||
    !AUTOMATION_PATTERN.test(row.automation_id) ||
    row.org_id !== orgId ||
    typeof row.project_id !== "string" ||
    !PROJECT_PATTERN.test(row.project_id) ||
    !principal ||
    typeof principal.id !== "string" ||
    !USER_PATTERN.test(principal.id) ||
    !Number.isSafeInteger(row.version) ||
    (row.description !== null && typeof row.description !== "string")
  )
    throw new LumiAccountError("lumi_response_invalid");
  return {
    automationId: row.automation_id,
    orgId,
    projectId: row.project_id,
    description: row.description as string | null,
    status: text(row.status, 32),
    version: row.version as number,
    executionPrincipalKind: text(principal.kind, 32),
    executionPrincipalId: principal.id,
    workspaceBindingId:
      typeof target?.workspace_binding_id === "string" ? target.workspace_binding_id : null,
    name: bounded(row.name) ?? "",
    scheduleKind: bounded(schedule?.kind),
    scheduleExpression: bounded(schedule?.expression),
    scheduleTimezone: bounded(schedule?.timezone),
    targetKind: bounded(target?.kind),
    targetDeviceId: bounded(target?.device_id),
    offPeak: row.off_peak_policy !== null && row.off_peak_policy !== undefined,
  };
}

/** Fixed-route adoption/automation operations over the private human-session port. */
export class LumiAutomationAdoptionHostTransport {
  readonly #request: SessionRequest;

  constructor(request: SessionRequest) {
    this.#request = request;
  }

  /** 纯读：服务端 preview 没有写入对应物。取消 = 丢弃返回值，没有任何需要撤销的东西。 */
  async previewImport(
    orgId: string,
    input: { candidates: AutomationImportCandidate[]; adoptionStateIds: string[] },
  ): Promise<AutomationImportPreview> {
    if (
      !ORG_PATTERN.test(orgId) ||
      input.candidates.length === 0 ||
      input.candidates.length > 32 ||
      input.adoptionStateIds.length > 32 ||
      input.adoptionStateIds.some((id) => !ADOPTION_STATE_PATTERN.test(id))
    )
      throw new LumiAccountError("lumi_automation_invalid");
    const response = await this.#request(
      `/api/v1/orgs/${orgId}/adoption/automation-imports/preview`,
      "POST",
      {
        candidates: input.candidates,
        adoption_state_ids: input.adoptionStateIds,
        stage: PREVIEW_STAGE,
      },
    );
    const row = (await response.json()) as Record<string, unknown>;
    if (
      row.org_id !== orgId ||
      !Array.isArray(row.items) ||
      row.items.length !== input.candidates.length ||
      typeof row.commit_ready !== "boolean" ||
      typeof row.local_automations_modified !== "boolean"
    )
      throw new LumiAccountError("lumi_response_invalid");
    const expected = new Set(input.candidates.map((candidate) => candidate.local_key));
    const items = row.items.map((item: Record<string, unknown>) => {
      if (
        !item ||
        typeof item.local_key !== "string" ||
        !expected.delete(item.local_key) ||
        typeof item.importable !== "boolean" ||
        !Array.isArray(item.conflicts) ||
        item.conflicts.length > 16
      )
        throw new LumiAccountError("lumi_response_invalid");
      const conflicts = item.conflicts.map((conflict: Record<string, unknown>) => ({
        code: text(conflict?.code, 64),
        // 修复：Worker 的整项冲突 subject 为 null；保留拒绝码，不把合法冲突误报为坏响应。
        subject: conflict?.subject === null ? "" : text(conflict?.subject, 128),
      }));
      // 不可导入 ⇔ 有冲突；矛盾的服务端回答按无效处理，绝不当作可确认。
      if (item.importable !== (conflicts.length === 0))
        throw new LumiAccountError("lumi_response_invalid");
      return { localKey: item.local_key, importable: item.importable, conflicts };
    });
    return {
      items,
      commitReady: row.commit_ready,
      modelCapabilityCheck: text(row.model_capability_check, 64),
      localAutomationsModified: row.local_automations_modified,
    };
  }

  async createManaged(
    orgId: string,
    body: ReturnType<typeof buildManagedAutomationCreateBody>,
    idempotencyKey: string,
  ): Promise<ManagedAutomationProjection> {
    if (!ORG_PATTERN.test(orgId) || !idempotencyKey || idempotencyKey.length > 128)
      throw new LumiAccountError("lumi_automation_invalid");
    const response = await this.#request(`/api/v1/orgs/${orgId}/automations`, "POST", body, {
      "Idempotency-Key": idempotencyKey,
    });
    return projection(await response.json(), orgId);
  }

  async getManaged(orgId: string, automationId: string): Promise<ManagedAutomationProjection> {
    if (!ORG_PATTERN.test(orgId) || !AUTOMATION_PATTERN.test(automationId))
      throw new LumiAccountError("lumi_automation_invalid");
    const response = await this.#request(
      `/api/v1/orgs/${orgId}/automations/${automationId}`,
      "GET",
    );
    const value = projection(await response.json(), orgId);
    if (value.automationId !== automationId) throw new LumiAccountError("lumi_response_invalid");
    return value;
  }

  /** 幂等重放窗口过期后的恢复去重：只比较 correlation，不比较标题等内容。 */
  async findManagedByCorrelation(
    orgId: string,
    projectId: string,
    correlation: string,
  ): Promise<ManagedAutomationProjection | null> {
    let match: ManagedAutomationProjection | null = null;
    for (const item of await this.listManagedForProject(orgId, projectId)) {
      if (item.description !== correlation) continue;
      if (match) throw new LumiAccountError("lumi_automation_conflict");
      match = item;
    }
    return match;
  }

  /**
   * Every definition of one project the human session may read, validated row by row (exact
   * org/project, no duplicate id, no cursor cycle, at most ten 100-row pages). An incomplete or
   * malformed listing throws: a partial list can never authorize create, adoption or attach.
   */
  async listManagedForProject(
    orgId: string,
    projectId: string,
  ): Promise<ManagedAutomationProjection[]> {
    if (!ORG_PATTERN.test(orgId) || !PROJECT_PATTERN.test(projectId))
      throw new LumiAccountError("lumi_automation_invalid");
    let cursor: string | undefined;
    const items: ManagedAutomationProjection[] = [];
    const cursors = new Set<string>();
    const ids = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const response = await this.#request(
        `/api/v1/orgs/${orgId}/automations?project_id=${encodeURIComponent(projectId)}&limit=${LIST_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        "GET",
      );
      const row = (await response.json()) as Record<string, unknown>;
      if (
        !Array.isArray(row.items) ||
        row.items.length > LIST_LIMIT ||
        typeof row.has_more !== "boolean"
      )
        throw new LumiAccountError("lumi_response_invalid");
      for (const raw of row.items) {
        const item = projection(raw, orgId);
        if (item.projectId !== projectId || ids.has(item.automationId))
          throw new LumiAccountError("lumi_response_invalid");
        ids.add(item.automationId);
        items.push(item);
      }
      if (!row.has_more) return items;
      if (
        typeof row.next_cursor !== "string" ||
        !row.next_cursor ||
        row.next_cursor.length > 512 ||
        cursors.has(row.next_cursor)
      )
        throw new LumiAccountError("lumi_response_invalid");
      cursor = row.next_cursor;
      cursors.add(cursor);
    }
    throw new LumiAccountError("lumi_response_invalid");
  }

  /** 响应体不当作证据：暂停后读回，只有服务端状态确为 paused 才返回。 */
  async pauseManaged(
    orgId: string,
    automationId: string,
    version: number,
  ): Promise<ManagedAutomationProjection> {
    if (!ORG_PATTERN.test(orgId) || !AUTOMATION_PATTERN.test(automationId) || version < 1)
      throw new LumiAccountError("lumi_automation_invalid");
    await this.#request(
      `/api/v1/orgs/${orgId}/automations/${automationId}/pause`,
      "POST",
      { version },
      { "Idempotency-Key": randomUUID() },
    );
    const current = await this.getManaged(orgId, automationId);
    if (current.status !== "paused")
      throw new LumiAccountError("lumi_automation_release_unconfirmed");
    return current;
  }

  /** 删除后必须读回 404：归还本地只在服务端确认不会再派发后才允许继续。 */
  async deleteManaged(orgId: string, automationId: string, version: number): Promise<void> {
    if (!ORG_PATTERN.test(orgId) || !AUTOMATION_PATTERN.test(automationId) || version < 1)
      throw new LumiAccountError("lumi_automation_invalid");
    await this.#request(
      `/api/v1/orgs/${orgId}/automations/${automationId}`,
      "DELETE",
      { version },
      { "Idempotency-Key": randomUUID() },
    );
    try {
      await this.getManaged(orgId, automationId);
    } catch (error) {
      if (error instanceof LumiAccountError && error.status === 404) return;
      throw error;
    }
    throw new LumiAccountError("lumi_automation_release_unconfirmed");
  }
}
