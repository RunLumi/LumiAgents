// 本地原任务的「托管接管」可逆抑制标记（spec: docs/specs/lumi-agents/07-automation-adoption-scheduling.md）。
// 只存「谁在执行」：不含 prompt、凭据、token、租约。抑制是 claim 事务里的过滤条件，
// 从不改写 automations 行，所以删除标记即可原样恢复本地调度（含 next_run_at）。
import type { DatabaseSync } from "node:sqlite";

export type AutomationManagedAdoptionState = "suppressed" | "managed" | "releasing";
/** created = 本设备创建了托管定义；attached = 只挂接到已有的共享定义（归还不得改动它）。 */
export type AutomationManagedAdoptionOrigin = "created" | "attached";

export interface AutomationManagedAdoption {
  localAutomationId: string;
  orgId: string;
  managedAutomationId: string | null;
  state: AutomationManagedAdoptionState;
  origin: AutomationManagedAdoptionOrigin;
  idempotencyKey: string;
  correlation: string;
  createdAt: number;
  updatedAt: number;
}

export type AutomationManagedAdoptionErrorCode =
  | "automation_adoption_not_found"
  | "automation_adoption_busy"
  | "automation_adoption_conflict"
  | "automation_adoption_changed"
  | "automation_adoption_state_invalid";

/** 稳定错误码，调用方不得依赖 message 做流程判断。 */
export class AutomationManagedAdoptionError extends Error {
  readonly code: AutomationManagedAdoptionErrorCode;

  constructor(code: AutomationManagedAdoptionErrorCode) {
    super(code);
    this.name = "AutomationManagedAdoptionError";
    this.code = code;
  }
}

interface AdoptionRow {
  local_automation_id: string;
  org_id: string;
  managed_automation_id: string | null;
  state: string;
  origin: string;
  idempotency_key: string;
  correlation: string;
  created_at: number;
  updated_at: number;
}

/** 关联键只含不透明本地 ID，供服务端重放窗口过期后的恢复去重，不泄露任务内容。 */
export function buildAutomationAdoptionCorrelation(localAutomationId: string): string {
  return `lumi-local:${localAutomationId}`;
}

function toAdoption(row: AdoptionRow): AutomationManagedAdoption {
  return {
    localAutomationId: row.local_automation_id,
    orgId: row.org_id,
    managedAutomationId: row.managed_automation_id,
    state: row.state as AutomationManagedAdoptionState,
    origin: row.origin === "attached" ? "attached" : "created",
    idempotencyKey: row.idempotency_key,
    correlation: row.correlation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readRow(db: DatabaseSync, localAutomationId: string): AdoptionRow | undefined {
  return db
    .prepare("SELECT * FROM automation_managed_adoptions WHERE local_automation_id = @id")
    .get({ id: localAutomationId }) as AdoptionRow | undefined;
}

export function getManagedAdoption(
  db: DatabaseSync,
  localAutomationId: string,
): AutomationManagedAdoption | null {
  const row = readRow(db, localAutomationId);
  return row ? toAdoption(row) : null;
}

export function listManagedAdoptions(
  db: DatabaseSync,
  filter: { orgId?: string; state?: AutomationManagedAdoptionState } = {},
): AutomationManagedAdoption[] {
  const rows = db
    .prepare(
      `SELECT * FROM automation_managed_adoptions
      WHERE (@org_id IS NULL OR org_id = @org_id) AND (@state IS NULL OR state = @state)
      ORDER BY created_at ASC`,
    )
    .all({ org_id: filter.orgId ?? null, state: filter.state ?? null }) as unknown as AdoptionRow[];
  return rows.map(toAdoption);
}

export function getManagedAdoptionByManagedId(
  db: DatabaseSync,
  orgId: string,
  managedAutomationId: string,
): AutomationManagedAdoption | null {
  const row = db
    .prepare(
      `SELECT * FROM automation_managed_adoptions
      WHERE org_id = @org_id AND managed_automation_id = @managed_id`,
    )
    .get({ org_id: orgId, managed_id: managedAutomationId }) as AdoptionRow | undefined;
  return row ? toAdoption(row) : null;
}

/**
 * 步骤 A：先落抑制标记，再允许任何服务端创建。幂等：同一本地任务重复调用返回同一行
 * （同组织）；不同组织已占用则冲突，绝不静默改归属。只读 automations，不改写原任务。
 */
export function beginManagedAdoption(
  db: DatabaseSync,
  input: {
    localAutomationId: string;
    orgId: string;
    idempotencyKey: string;
    /** 用户确认时看到的原任务版本（automations.updated_at）；与库内不一致说明预览已过期。 */
    expectedRevision?: number;
    now: number;
  },
): AutomationManagedAdoption {
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = readRow(db, input.localAutomationId);
    if (existing) {
      if (existing.org_id !== input.orgId)
        throw new AutomationManagedAdoptionError("automation_adoption_conflict");
      db.exec("COMMIT");
      return toAdoption(existing);
    }
    const automation = db
      .prepare("SELECT running, updated_at FROM automations WHERE automation_id = @id")
      .get({ id: input.localAutomationId }) as { running: number; updated_at: number } | undefined;
    if (!automation) throw new AutomationManagedAdoptionError("automation_adoption_not_found");
    // 与写标记同处一个 BEGIN IMMEDIATE：预览之后原任务被改过，就不能再按旧元数据去服务端创建。
    if (input.expectedRevision !== undefined && automation.updated_at !== input.expectedRevision)
      throw new AutomationManagedAdoptionError("automation_adoption_changed");
    // 本地派发在途时接管会让同一原任务在途执行与托管首次触发重叠，先拒绝，由用户稍后重试。
    if (automation.running === 1)
      throw new AutomationManagedAdoptionError("automation_adoption_busy");
    db.prepare(
      `INSERT INTO automation_managed_adoptions (
        local_automation_id, org_id, managed_automation_id, state,
        idempotency_key, correlation, created_at, updated_at
      ) VALUES (@id, @org_id, NULL, 'suppressed', @key, @correlation, @now, @now)`,
    ).run({
      id: input.localAutomationId,
      org_id: input.orgId,
      key: input.idempotencyKey,
      correlation: buildAutomationAdoptionCorrelation(input.localAutomationId),
      now: input.now,
    });
    const created = readRow(db, input.localAutomationId)!;
    db.exec("COMMIT");
    return toAdoption(created);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * 挂接到已有的共享托管定义：没有服务端创建，所以只有一个本地事务（不存在「标记已写、服务端未建」的崩溃窗口）。
 * 调用方必须已经在服务端读回并校验过该定义；本函数只负责在同一 BEGIN IMMEDIATE 内
 * 比较原任务版本、拒绝在途本地派发、并让唯一索引拒绝「同一托管定义挂两个本地原任务」。
 * 幂等：同一本地任务重复挂接同一定义返回已有行；挂向不同定义/组织/来源一律冲突，绝不静默改归属。
 */
export function beginManagedAttach(
  db: DatabaseSync,
  input: {
    localAutomationId: string;
    orgId: string;
    managedAutomationId: string;
    idempotencyKey: string;
    expectedRevision?: number;
    now: number;
  },
): AutomationManagedAdoption {
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = readRow(db, input.localAutomationId);
    if (existing) {
      if (
        existing.org_id !== input.orgId ||
        existing.origin !== "attached" ||
        existing.managed_automation_id !== input.managedAutomationId ||
        existing.state !== "managed"
      )
        throw new AutomationManagedAdoptionError("automation_adoption_conflict");
      db.exec("COMMIT");
      return toAdoption(existing);
    }
    const automation = db
      .prepare("SELECT running, updated_at FROM automations WHERE automation_id = @id")
      .get({ id: input.localAutomationId }) as { running: number; updated_at: number } | undefined;
    if (!automation) throw new AutomationManagedAdoptionError("automation_adoption_not_found");
    if (input.expectedRevision !== undefined && automation.updated_at !== input.expectedRevision)
      throw new AutomationManagedAdoptionError("automation_adoption_changed");
    if (automation.running === 1)
      throw new AutomationManagedAdoptionError("automation_adoption_busy");
    if (getManagedAdoptionByManagedId(db, input.orgId, input.managedAutomationId))
      throw new AutomationManagedAdoptionError("automation_adoption_conflict");
    db.prepare(
      `INSERT INTO automation_managed_adoptions (
        local_automation_id, org_id, managed_automation_id, state, origin,
        idempotency_key, correlation, created_at, updated_at
      ) VALUES (@id, @org_id, @managed_id, 'managed', 'attached', @key, @correlation, @now, @now)`,
    ).run({
      id: input.localAutomationId,
      org_id: input.orgId,
      managed_id: input.managedAutomationId,
      key: input.idempotencyKey,
      correlation: buildAutomationAdoptionCorrelation(input.localAutomationId),
      now: input.now,
    });
    const created = readRow(db, input.localAutomationId)!;
    db.exec("COMMIT");
    return toAdoption(created);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 步骤 B：服务端创建已确认。幂等；已绑定到不同托管 ID 时冲突。 */
export function recordManagedAutomationCreated(
  db: DatabaseSync,
  input: { localAutomationId: string; managedAutomationId: string; now: number },
): AutomationManagedAdoption {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = readRow(db, input.localAutomationId);
    if (!row) throw new AutomationManagedAdoptionError("automation_adoption_not_found");
    if (row.managed_automation_id && row.managed_automation_id !== input.managedAutomationId)
      throw new AutomationManagedAdoptionError("automation_adoption_conflict");
    if (row.state === "releasing")
      throw new AutomationManagedAdoptionError("automation_adoption_state_invalid");
    db.prepare(
      `UPDATE automation_managed_adoptions
      SET managed_automation_id = @managed_id, state = 'managed', updated_at = @now
      WHERE local_automation_id = @id`,
    ).run({ id: input.localAutomationId, managed_id: input.managedAutomationId, now: input.now });
    const next = readRow(db, input.localAutomationId)!;
    db.exec("COMMIT");
    return toAdoption(next);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 释放第一步：仍保持抑制，只表示「正在归还本地」；服务端确认停用后才能 complete。 */
export function beginManagedRelease(
  db: DatabaseSync,
  input: { localAutomationId: string; now: number },
): AutomationManagedAdoption {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = readRow(db, input.localAutomationId);
    if (!row) throw new AutomationManagedAdoptionError("automation_adoption_not_found");
    db.prepare(
      `UPDATE automation_managed_adoptions SET state = 'releasing', updated_at = @now
      WHERE local_automation_id = @id`,
    ).run({ id: input.localAutomationId, now: input.now });
    const next = readRow(db, input.localAutomationId)!;
    db.exec("COMMIT");
    return toAdoption(next);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 释放第二步：仅 releasing 可删除标记；原任务从未被改动，删除即恢复本地调度。 */
export function completeManagedRelease(db: DatabaseSync, localAutomationId: string): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = readRow(db, localAutomationId);
    if (!row) {
      db.exec("COMMIT");
      return false;
    }
    if (row.state !== "releasing")
      throw new AutomationManagedAdoptionError("automation_adoption_state_invalid");
    db.prepare("DELETE FROM automation_managed_adoptions WHERE local_automation_id = @id").run({
      id: localAutomationId,
    });
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** claim 事务共享的过滤片段：任何状态的标记都使原任务不可由本地认领。 */
export const NOT_MANAGED_ADOPTED_SQL = `NOT EXISTS (
  SELECT 1 FROM automation_managed_adoptions m WHERE m.local_automation_id = automations.automation_id
)`;
