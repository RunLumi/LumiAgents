/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
 *
 * Lumi 产品遥测 shim：以应用自有实现替换闭源的 @arms/rum-electron SDK。
 *
 * 背景：上游通过 @arms/rum-electron（闭源、无仓库、无许可文本，见
 * docs/licensing/COMPLIANCE.md）把稳定性/资源/启动遥测发送到 ZCode 产品服务。
 * Lumi 分发不继承该依赖；既有遥测调用点（稳定性 / 资源 / 网络 / MCP / 数据库启动 /
 * 数据规模）继续使用与原 SDK 相同的 API 面（init / setConfig / getConfig /
 * sendCustom / sendEvent / client.useReporter），但事件进入本文件维护的传输层，
 * 不再依赖任何上游产品服务：
 *
 * - 启用/端点解析唯一来源是 resolveTelemetryDeliveryFromConstants
 *   （@zcode/shared/telemetrySourceRuntime）：LUMI_TELEMETRY_ENDPOINT 优先，其次上游
 *   变量，且都必须是 https；未配置即不出网、不排队（与 Lumi 分发默认遥测关闭一致）。
 * - 上报管线与上游一致地经过 reporter.request：sendCustom/sendEvent 构造批次后交给
 *   activeRequest；appARMSBootstrap 通过 addLumiTelemetryReporterRequestWrapper 安装
 *   wrapStartupReporterRequest，启动遥测的送达确认语义保持不变。
 * - beforeReport 钩子语义保留：native-crash 过滤、API 批次 ingest、长任务归因摘要、
 *   脱敏仍在批次进入传输前执行（见 appARMSBootstrap）。
 * - 渲染进程浏览器自动采集不再注入（原 SDK 的 autoInject 行为不存在于本实现）；
 *   preload 的 arms:rum-bridge 转发成为无操作，主进程不再注册该 IPC 通道。
 *
 * 未实现（显式列出，避免「看起来等价」的错觉）：ARMS 控制台专用的 PV/WebVitals
 * 浏览器自动采集、崩溃 dump 归集上报、tracing 采样、事件重试与本地持久化。
 * 部署方开启遥测后获得的是应用自有 custom/event 事件流的 https JSON 批量上报；
 * 传输尽力而为，失败即丢弃。
 */
import {
  ZCODE_VERSION,
  resolveTelemetryDeliveryFromConstants,
  type TelemetryCustomEvent,
  type TelemetryEvent,
} from "@zcode/shared";
import { logger } from "./logger.js";

/** init 可接受的上游配置形状（仅取本实现消费的键，未知键忽略）。 */
export interface LumiTelemetryInitOptions {
  enable?: boolean;
  version?: string;
  endpoint?: string;
  env?: string;
  app?: { name?: string; version?: string; env?: string };
  user?: { name?: string };
  /** 与上游 SDK 语义一致：批次离开本机前同步过滤/富化/脱敏，可原地改写 events。 */
  beforeReport?: (payload: { events?: Array<Record<string, unknown>> }) => unknown;
  [key: string]: unknown;
}

/** 渲染进程注入句柄；本实现不注入，恒为已完成（原 SDK 返回 pending Promise）。 */
export type LumiTelemetryInitResult = { injected?: Promise<void> };

/** 与上游 SDK reporter 形状对齐：request 消费上下文与事件批次，返回含 ok 的结果。 */
export interface LumiTelemetryReporterRequestContext {
  url: string;
}

export interface LumiTelemetryReporterBundle {
  events?: Array<Record<string, unknown>>;
}

export type LumiTelemetryReporterRequest = (
  context: LumiTelemetryReporterRequestContext,
  bundle: LumiTelemetryReporterBundle,
) => Promise<unknown>;

export interface LumiTelemetryReporter {
  request: LumiTelemetryReporterRequest;
}

export interface LumiTelemetryClient {
  useReporter(reporter: LumiTelemetryReporter): void;
}

const HTTPS_TRANSPORT_MAX_BATCH = 50;
const HTTPS_TRANSPORT_TIMEOUT_MS = 10_000;

/**
 * 自托管 https 传输：把事件批量 POST 到部署方端点。尽力而为——失败即丢弃并计数，
 * 绝不重试、绝不落盘用户数据；遥测故障绝不影响主流程。
 */
class HttpsTelemetryTransport {
  readonly endpoint: string;
  private readonly queue: Array<Record<string, unknown>> = [];
  droppedRecords = 0;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  enqueue(payload: Record<string, unknown>): void {
    if (this.queue.length >= HTTPS_TRANSPORT_MAX_QUEUE) {
      this.queue.shift();
      this.droppedRecords += 1;
    }
    this.queue.push(payload);
  }

  /** 发送当前队列；返回是否全部投递成功（含队列为空的平凡成功）。 */
  async flush(): Promise<boolean> {
    let allOk = true;
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, HTTPS_TRANSPORT_MAX_BATCH);
      const body = JSON.stringify(batch);
      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(HTTPS_TRANSPORT_TIMEOUT_MS),
        });
        if (!response.ok) {
          allOk = false;
          this.droppedRecords += batch.length;
        }
      } catch {
        allOk = false;
        this.droppedRecords += batch.length;
      }
    }
    return allOk;
  }
}

const HTTPS_TRANSPORT_MAX_QUEUE = 1_000;

let transport: HttpsTelemetryTransport | undefined;
let initialized = false;
let envLabel: "prod" | "local" = "local";
/** 诊断计数：因总开关/端点未配置或未初始化而被丢弃的事件数（不出网）。 */
let suppressedEvents = 0;

function stampTimestamp(event: Record<string, unknown>): Record<string, unknown> {
  return {
    ...event,
    timestamp: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
  };
}

/** 基础请求：批次入队并立即投递，返回真实送达结果。 */
function createBaseReporterRequest(): LumiTelemetryReporterRequest {
  return async (context, bundle) => {
    const events = bundle.events ?? [];
    if (!transport) {
      suppressedEvents += events.length;
      return { ok: false };
    }
    for (const event of events) {
      transport.enqueue(stampTimestamp(event));
    }
    const ok = await transport.flush();
    return { ok, url: context.url };
  };
}

type ReporterRequestWrapper = (
  request: LumiTelemetryReporterRequest,
) => LumiTelemetryReporterRequest;

let baseReporterRequest = createBaseReporterRequest();
const reporterRequestWrappers: ReporterRequestWrapper[] = [];
let activeReporterRequest = baseReporterRequest;
let beforeReportHook: LumiTelemetryInitOptions["beforeReport"] | undefined;

function rebuildActiveReporterRequest(): void {
  let request = baseReporterRequest;
  for (const wrapper of reporterRequestWrappers) {
    request = wrapper(request);
  }
  activeReporterRequest = request;
}

async function deliver(events: Array<Record<string, unknown>>): Promise<void> {
  if (!initialized) {
    suppressedEvents += events.length;
    return;
  }
  if (!transport) {
    suppressedEvents += events.length;
    return;
  }
  const payload = { events };
  try {
    beforeReportHook?.(payload);
  } catch (error) {
    logger.debug?.("[lumi-telemetry] beforeReport failed; batch continues", error);
  }
  const finalEvents = payload.events ?? events;
  try {
    await activeReporterRequest({ url: transport.endpoint }, { events: finalEvents });
  } catch (error) {
    logger.debug?.("[lumi-telemetry] delivery dropped", error);
  }
}

export async function lumiTelemetryInit(
  options: LumiTelemetryInitOptions = {},
): Promise<LumiTelemetryInitResult> {
  initialized = true;
  envLabel = options.env === "prod" ? "prod" : "local";
  const delivery = resolveTelemetryDeliveryFromConstants();
  const endpoint = options.endpoint?.trim() || delivery.endpoint;
  const enabled = (options.enable ?? true) && delivery.enabled && endpoint.length > 0;
  transport = enabled ? new HttpsTelemetryTransport(endpoint) : undefined;
  beforeReportHook = options.beforeReport;
  logger.info(
    `[lumi-telemetry] init enabled=${enabled} endpointSource=${delivery.endpointSource} env=${envLabel} version=${options.version ?? ZCODE_VERSION}`,
  );
  // 原实现返回 injected Promise 供等待渲染进程注入；本实现无注入步骤，立即完成。
  return { injected: Promise.resolve() };
}

/** 遥测总开关关闭或端点未配置时使用：所有调用均为无操作。 */
export function lumiTelemetryDisabledInit(): Promise<LumiTelemetryInitResult> {
  initialized = true;
  transport = undefined;
  return Promise.resolve({});
}

/**
 * 兼容保留：既有调用点用 setConfig 注入 user/properties。本实现的事件 properties
 * 已由调用方携带 device_mid 等上下文，逐键配置不再被消费。
 */
export function lumiTelemetrySetConfig(_key: string, _value: unknown): void {}

export interface LumiTelemetryConfig {
  env: string;
  version: string;
}

/** 兼容保留：databaseStartupTelemetry 读取 env 区分 prod/local。 */
export function lumiTelemetryGetConfig(): LumiTelemetryConfig {
  return { env: envLabel, version: ZCODE_VERSION };
}

export function lumiTelemetrySendCustom(event: TelemetryCustomEvent): void {
  void deliver([event as unknown as Record<string, unknown>]);
}

export function lumiTelemetrySendEvent(event: TelemetryEvent): void {
  void deliver([event]);
}

/**
 * 与原 SDK 的 client.useReporter 兼容：注册的外部报告器 request 替代基础请求
 * （当前代码库不再注册自定义报告器；保留入口以维持 API 面）。
 */
export const lumiTelemetryClient: LumiTelemetryClient = {
  useReporter(reporter: LumiTelemetryReporter): void {
    baseReporterRequest = reporter.request ?? createBaseReporterRequest();
    rebuildActiveReporterRequest();
  },
};

/** 供 appARMSBootstrap 安装 request 包装器（替代对 SDK 公开对象的就地改写）。 */
export function addLumiTelemetryReporterRequestWrapper(wrapper: ReporterRequestWrapper): void {
  reporterRequestWrappers.push(wrapper);
  rebuildActiveReporterRequest();
}

export function isLumiTelemetryTransportEnabled(): boolean {
  const delivery = resolveTelemetryDeliveryFromConstants();
  return delivery.enabled && delivery.endpoint.length > 0;
}
