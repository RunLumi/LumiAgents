/**
 * Lumi Agents 产品遥测解析缝（self-hosted 遥测的启用/端点唯一来源）。
 *
 * 背景：上游通过闭源商业 SDK（@arms/rum-*）把产品遥测发送到 ZCode 产品服务。
 * Lumi 分发不继承该依赖；桌面端稳定性/资源/启动遥测改为应用自有实现
 * （packages/desktop/src/main/lumiTelemetry.ts），其启用与端点全部经由本模块解析：
 *
 * 1. 事件载荷类型沿用应用既有的 ARMS 线上格式（custom/event 两种），保证既有
 *    遥测调用点的字段与语义不变，替换只发生在传输层。
 * 2. 启用/端点解析唯一来源：桌面端此前在三处重复「总开关 && 端点非空」判定，
 *    现在收口到 resolveTelemetryDelivery。
 *
 * 兼容性约束：ZCODE_TELEMETRY_ENABLED、ZCODE_ARMS_RUM_ENDPOINT 等上游环境变量名
 * 保持原样并继续被读取；LUMI_TELEMETRY_ENDPOINT 是 Lumi 自有的新端点入口，优先于
 * 上游变量。不引入任何内嵌端点，未配置即不出网。
 */
import { resolveLumiTelemetryEnabled } from "./lumiDistribution.js";
import { ZCODE_ARMS_RUM_ENDPOINT, ZCODE_TELEMETRY_ENABLED } from "./env.js";

/** Lumi 自有的遥测端点入口。配置后优先于上游 ZCODE_ARMS_RUM_ENDPOINT。 */
export const LUMI_TELEMETRY_ENDPOINT_ENV = "LUMI_TELEMETRY_ENDPOINT" as const;

/**
 * 上游端点变量名。注意 env.ts 导出的 ZCODE_ARMS_RUM_ENDPOINT 是 import 时刻读取的
 * 值常量（供打包/define 场景），按变量名查 env 时必须用本字面量键。
 */
const UPSTREAM_TELEMETRY_ENDPOINT_ENV = "ZCODE_ARMS_RUM_ENDPOINT" as const;

/** custom 事件：计数/耗时/状态类指标，对应既有 sendCustom 调用点的线上载荷。 */
export interface TelemetryCustomEvent {
  name: string;
  type: string;
  group?: string;
  value?: number;
  properties?: Record<string, unknown>;
  timestamp?: number;
  [key: string]: unknown;
}

/** 通用事件：异常/崩溃等结构化事件，对应既有 sendEvent 调用点的线上载荷。 */
export type TelemetryEvent = Record<string, unknown>;

/** 启用判定 + 生效端点的唯一来源。端点必须是 https；http 收集器请由部署方自行前置代理。 */
export interface TelemetryDelivery {
  enabled: boolean;
  endpoint: string;
  /** 端点来源，便于诊断：lumi-env / upstream-env / none。 */
  endpointSource: "lumi-env" | "upstream-env" | "none";
}

function readTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 解析遥测投递配置。总开关沿用 ZCODE_TELEMETRY_ENABLED 的判定口径
 * （Lumi 默认关闭，见 lumiDistribution.resolveLumiTelemetryEnabled）；端点优先取
 * LUMI_TELEMETRY_ENDPOINT，其次上游 ZCODE_ARMS_RUM_ENDPOINT，且都必须是 https，
 * 否则视为未配置。
 */
export function resolveTelemetryDelivery(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): TelemetryDelivery {
  if (!resolveLumiTelemetryEnabled(env)) {
    return { enabled: false, endpoint: "", endpointSource: "none" };
  }
  const lumiEndpoint = readTrimmed(env[LUMI_TELEMETRY_ENDPOINT_ENV]);
  if (lumiEndpoint && isHttpsUrl(lumiEndpoint)) {
    return { enabled: true, endpoint: lumiEndpoint, endpointSource: "lumi-env" };
  }
  const upstreamEndpoint = readTrimmed(env[UPSTREAM_TELEMETRY_ENDPOINT_ENV]);
  if (upstreamEndpoint && isHttpsUrl(upstreamEndpoint)) {
    return { enabled: true, endpoint: upstreamEndpoint, endpointSource: "upstream-env" };
  }
  return { enabled: false, endpoint: "", endpointSource: "none" };
}

/**
 * 与上游 ZCODE_TELEMETRY_ENABLED/ZCODE_ARMS_RUM_ENDPOINT 常量对齐的便捷判定，
 * 供无法直接读取 process.env 的调用点（构建期 define 注入场景）复用。
 */
export function resolveTelemetryDeliveryFromConstants(): TelemetryDelivery {
  if (!ZCODE_TELEMETRY_ENABLED) {
    return { enabled: false, endpoint: "", endpointSource: "none" };
  }
  const endpoint = readTrimmed(ZCODE_ARMS_RUM_ENDPOINT);
  if (endpoint && isHttpsUrl(endpoint)) {
    return { enabled: true, endpoint, endpointSource: "upstream-env" };
  }
  return { enabled: false, endpoint: "", endpointSource: "none" };
}
