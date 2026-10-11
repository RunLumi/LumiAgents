/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 冻结本次新增列：只追加，不改 0004/0005。spec 07「Attach to an existing managed automation」。
// origin 记录托管定义由谁创建：`created` = 本设备接管时创建（归还时由本设备暂停并删除），
// `attached` = 本设备只挂接到已有的共享托管定义（归还只撤销本地抑制，绝不改动服务端定义）。
// 既有行与旧构建写入的行取默认值 `created`，与原行为一致。
export const AUTOMATION_MANAGED_ATTACH_MIGRATION_SQL = `
ALTER TABLE automation_managed_adoptions
ADD COLUMN origin TEXT NOT NULL DEFAULT 'created' CHECK (origin IN ('created', 'attached'));
`;
