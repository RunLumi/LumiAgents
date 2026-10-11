// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
import { realpathSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

/**
 * Host/Agent 子进程的 HOME 覆盖。复用已有的 ZCODE_DESKTOP_HOME_DIR 显式根：
 * 设置后 Host（及其 Agent）的 HOME/USERPROFILE 指向该根，全局 hooks/settings/skills/session DB
 * 不会读到操作者个人 HOME；Main 自身 HOME 不变，原生 keychain 仍使用真实 OS 身份。
 * 未设置时返回空对象，生产行为保持不变；相对路径直接拒绝，不静默回退到个人 HOME。
 */
export function resolveHostProcessHomeEnv(
  explicitHomeDir: string | undefined,
): Record<string, string> {
  if (explicitHomeDir === undefined) {
    return {};
  }
  if (!isAbsolute(explicitHomeDir)) {
    throw new Error("ZCODE_DESKTOP_HOME_DIR must be an absolute path");
  }
  let home = normalize(explicitHomeDir);
  try {
    home = realpathSync(home);
  } catch (error) {
    // 目录尚未创建时保持规范化路径；其他错误（权限、循环链接）不能静默回退。
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return { HOME: home, USERPROFILE: home };
}
