/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 托管 occurrence 的本地进度日志（spec 07「Managed occurrence journal」）。
// 只回答「这台设备走到哪一步」：不含令牌、prompt、路径、围栏。状态只前进；终态不可再改。
import type { DatabaseSync } from "node:sqlite";

export type AutomationManagedOccurrenceState =
  | "starting"
  | "started"
  | "settled"
  | "ambiguous"
  | "released";

export interface AutomationManagedOccurrence {
  occurrenceId: string;
  orgId: string;
  localAutomationId: string;
  managedAutomationId: string;
  runId: string | null;
  state: AutomationManagedOccurrenceState;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
}

export class AutomationManagedOccurrenceError extends Error {
  readonly code = "automation_occurrence_state_invalid";
  constructor() {
    super("automation_occurrence_state_invalid");
    this.name = "AutomationManagedOccurrenceError";
  }
}

interface OccurrenceRow {
  occurrence_id: string;
  org_id: string;
  local_automation_id: string;
  managed_automation_id: string;
  run_id: string | null;
  state: string;
  reason: string | null;
  created_at: number;
  updated_at: number;
}

/** 前进顺序；终态同层，互相不可转换。 */
const RANK: Record<AutomationManagedOccurrenceState, number> = {
  starting: 0,
  started: 1,
  settled: 2,
  ambiguous: 2,
  released: 2,
};
const TERMINAL = new Set<AutomationManagedOccurrenceState>(["settled", "ambiguous", "released"]);
const ID = /^occ_[0-9a-f]{32}$/;
const RUN_ID = /^run_[0-9a-f]{32}$/;
/** reason 是封闭的稳定码，不是自由文本，所以不会夹带内容。 */
const REASON = /^[a-z][a-z0-9_]{0,63}$/;

function toOccurrence(row: OccurrenceRow): AutomationManagedOccurrence {
  return {
    occurrenceId: row.occurrence_id,
    orgId: row.org_id,
    localAutomationId: row.local_automation_id,
    managedAutomationId: row.managed_automation_id,
    runId: row.run_id,
    state: row.state as AutomationManagedOccurrenceState,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readRow(db: DatabaseSync, occurrenceId: string): OccurrenceRow | undefined {
  return db
    .prepare("SELECT * FROM automation_managed_occurrences WHERE occurrence_id = @id")
    .get({ id: occurrenceId }) as OccurrenceRow | undefined;
}

export function recordManagedOccurrence(
  db: DatabaseSync,
  input: {
    occurrenceId: string;
    orgId: string;
    localAutomationId: string;
    managedAutomationId: string;
    state: AutomationManagedOccurrenceState;
    runId?: string;
    reason?: string;
    now: number;
  },
): AutomationManagedOccurrence {
  if (
    !ID.test(input.occurrenceId) ||
    (input.runId !== undefined && !RUN_ID.test(input.runId)) ||
    (input.reason !== undefined && !REASON.test(input.reason))
  )
    throw new AutomationManagedOccurrenceError();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = readRow(db, input.occurrenceId);
    if (!existing) {
      // 日志必须从 starting 开始：在 start 请求之前先落盘，崩溃后才有「可能已开始」的证据。
      if (input.state !== "starting") throw new AutomationManagedOccurrenceError();
      db.prepare(
        `INSERT INTO automation_managed_occurrences (
          occurrence_id, org_id, local_automation_id, managed_automation_id,
          run_id, state, reason, created_at, updated_at
        ) VALUES (@id, @org, @local, @managed, NULL, 'starting', @reason, @now, @now)`,
      ).run({
        id: input.occurrenceId,
        org: input.orgId,
        local: input.localAutomationId,
        managed: input.managedAutomationId,
        reason: input.reason ?? null,
        now: input.now,
      });
    } else {
      const current = existing.state as AutomationManagedOccurrenceState;
      if (
        existing.org_id !== input.orgId ||
        existing.local_automation_id !== input.localAutomationId ||
        existing.managed_automation_id !== input.managedAutomationId ||
        (existing.run_id !== null && input.runId !== undefined && existing.run_id !== input.runId)
      )
        throw new AutomationManagedOccurrenceError();
      if (current !== input.state) {
        // 终态不可改；非终态只能前进。
        if (TERMINAL.has(current) || RANK[input.state] <= RANK[current])
          throw new AutomationManagedOccurrenceError();
        // started 才有服务端授予的 run；跳过 started 直接 settled 说明没有 start 授予。
        if (input.state === "settled" && current !== "started")
          throw new AutomationManagedOccurrenceError();
        // release 只在 start 之前合法；已 started 的绝不能被记成「已归还」。
        if (input.state === "released" && current !== "starting")
          throw new AutomationManagedOccurrenceError();
        db.prepare(
          `UPDATE automation_managed_occurrences
          SET state = @state, run_id = COALESCE(@run_id, run_id),
              reason = COALESCE(@reason, reason), updated_at = @now
          WHERE occurrence_id = @id`,
        ).run({
          id: input.occurrenceId,
          state: input.state,
          run_id: input.runId ?? null,
          reason: input.reason ?? null,
          now: input.now,
        });
      }
    }
    const next = readRow(db, input.occurrenceId)!;
    db.exec("COMMIT");
    return toOccurrence(next);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listManagedOccurrences(
  db: DatabaseSync,
  filter: { orgId?: string; state?: AutomationManagedOccurrenceState } = {},
): AutomationManagedOccurrence[] {
  const rows = db
    .prepare(
      `SELECT * FROM automation_managed_occurrences
      WHERE (@org IS NULL OR org_id = @org) AND (@state IS NULL OR state = @state)
      ORDER BY created_at ASC, occurrence_id ASC`,
    )
    .all({ org: filter.orgId ?? null, state: filter.state ?? null }) as unknown as OccurrenceRow[];
  return rows.map(toOccurrence);
}

/**
 * 进程重启：租约令牌只存在于上一个进程的内存，starting/started 行无法续跑，
 * 只能标为 ambiguous 并交给用户/服务端对账。绝不回到 pending，也不重新派发。
 */
export function markInterruptedManagedOccurrences(
  db: DatabaseSync,
  input: { reason: string; now: number },
): AutomationManagedOccurrence[] {
  if (!REASON.test(input.reason)) throw new AutomationManagedOccurrenceError();
  db.exec("BEGIN IMMEDIATE");
  try {
    const open = db
      .prepare(
        `SELECT * FROM automation_managed_occurrences
        WHERE state IN ('starting', 'started')
        ORDER BY created_at ASC, occurrence_id ASC`,
      )
      .all() as unknown as OccurrenceRow[];
    db.prepare(
      `UPDATE automation_managed_occurrences
      SET state = 'ambiguous', reason = @reason, updated_at = @now
      WHERE state IN ('starting', 'started')`,
    ).run({ reason: input.reason, now: input.now });
    db.exec("COMMIT");
    return open.map((row) =>
      toOccurrence({ ...row, state: "ambiguous", reason: input.reason, updated_at: input.now }),
    );
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
