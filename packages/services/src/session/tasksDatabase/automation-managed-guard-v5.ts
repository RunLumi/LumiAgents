// 冻结本次新增对象：只追加，不改 0004。spec 07「Downgrade compatibility guard / Managed occurrence journal」。
//
// 触发器：被标记接管的原任务，running 0→1 的认领 UPDATE 变成静默 no-op（RAISE(IGNORE)）。
// 所有版本的 claimDue / claimManualRuns / runNow 都是「UPDATE … SET running=1 … WHERE running=0」
// 后检查 changes===1，所以忽略 marker 表的旧构建也认领不到。不写原任务的任何列，
// 删除 marker 即恢复原样；触发器在没有 marker 时是惰性的，释放后无需删除。
//
// 日志表：只记「这台设备对某个 occurrence 走到了哪一步」，不含 token / prompt / 路径 / fence。
// 重启后进程内租约令牌已丢失，非终态行只能标为 ambiguous，不能续跑。
export const AUTOMATION_MANAGED_GUARD_MIGRATION_SQL = `
CREATE TRIGGER IF NOT EXISTS trg_automations_managed_claim_guard
BEFORE UPDATE OF running ON automations
WHEN NEW.running > OLD.running
  AND EXISTS (
    SELECT 1 FROM automation_managed_adoptions m WHERE m.local_automation_id = NEW.automation_id
  )
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TABLE IF NOT EXISTS automation_managed_occurrences (
  occurrence_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  local_automation_id TEXT NOT NULL,
  managed_automation_id TEXT NOT NULL,
  run_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('starting', 'started', 'settled', 'ambiguous', 'released')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_managed_occurrences_open
ON automation_managed_occurrences (state)
WHERE state IN ('starting', 'started');
`;
