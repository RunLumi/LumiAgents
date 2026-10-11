// 冻结本次新增表：只追加，不改旧 migration。
// 该表是「本地原任务已被托管版本接管」的可逆抑制标记，spec: docs/specs/lumi-agents/07-automation-adoption-scheduling.md。
// 刻意不含 prompt、凭据、token、租约：标记只说明「谁在执行」，不承载任何任务内容或服务端权限。
// 没有对 automations 的外键：用户删除原任务不能被标记阻塞，也不能因此复活本地调度。
export const AUTOMATION_MANAGED_ADOPTION_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS automation_managed_adoptions (
  local_automation_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  managed_automation_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('suppressed', 'managed', 'releasing')),
  idempotency_key TEXT NOT NULL,
  correlation TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_managed_adoptions_managed
ON automation_managed_adoptions (org_id, managed_automation_id)
WHERE managed_automation_id IS NOT NULL;
`;
