/**
 * Lumi Agents 独立分发策略（单一集成点）。
 *
 * 背景：本仓库是 ZCode 的独立维护分支（见 docs/upstream/FORK-DIFFERENCES.md）。
 * 上游默认把桌面自动更新指向 ZCode 产品服务、把产品遥测默认打开。Lumi 没有
 * 自己的更新源、遥测后端、签名与凭证体系，因此不能沿用这些上游默认值：
 *
 * - 自动更新：默认关闭。只有显式配置 Lumi 自有的更新源（LUMI_UPDATE_FEED_URL）
 *   时才允许启动。绝不能从上游 ZCode 的更新源安装更新，也不能用上游发布凭证。
 * - 遥测：默认关闭。Lumi 不向任何上游产品服务发送用量/活跃/崩溃遥测；需要时由
 *   部署方显式开启并自备后端端点。
 *
 * 兼容性约束：本模块不改变任何既有标识符。`ZCODE_UPDATE_FEED_URL`、
 * `--zcode-update-feed-url`、`ZCODE_TELEMETRY_*` 环境变量名、`ZCODE_ENV`、
 * `@zcode/*` 包名、`zcode://` scheme 全部保持上游原样；本模块只决定这些入口
 * 在 Lumi 默认配置下是否生效。
 */

/** Lumi 自有更新源。未配置即视为「无可用更新服务」，自动更新保持关闭。 */
export const LUMI_UPDATE_FEED_URL_ENV = "LUMI_UPDATE_FEED_URL" as const;

/** 显式开启 Lumi 遥测的开关。默认关闭。 */
export const LUMI_TELEMETRY_OPT_IN_ENV = "LUMI_TELEMETRY" as const;

/** 上游 ZCode 产品服务源。仅作为文档/审计事实记录，Lumi 不会向其上报或更新。 */
export const UPSTREAM_ZCODE_PRODUCT_ORIGIN = "https://zcode.z.ai" as const;

function readTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isTruthyFlag(value: string | undefined): boolean {
  const normalized = readTrimmed(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/**
 * 解析 Lumi 更新源。只接受 https 地址；http/localhost 等非 https 来源视为未配置，
 * 避免把更新通道指向不可信来源。
 */
export function resolveLumiUpdateFeedUrl(
  env: Record<string, string | undefined> = {},
): string | undefined {
  const raw = readTrimmed(env[LUMI_UPDATE_FEED_URL_ENV]);
  if (!raw) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 打包态是否允许启用自动更新。
 *
 * 规则：只有显式配置了 Lumi 自有 https 更新源时才允许。否则返回 false，桌面端
 * 走「更新服务未配置」的不可用状态，而不是静默回退到上游 ZCode 更新源。
 */
export function resolveLumiAutoUpdateEnabled(
  env: Record<string, string | undefined> = {},
): boolean {
  return resolveLumiUpdateFeedUrl(env) !== undefined;
}

/**
 * 解析产品遥测总开关。
 *
 * 默认 false（上游默认 true）。只在部署方显式开启并自备后端端点时上报。
 */
export function resolveLumiTelemetryEnabled(env: Record<string, string | undefined> = {}): boolean {
  return isTruthyFlag(env[LUMI_TELEMETRY_OPT_IN_ENV]);
}
