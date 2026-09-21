/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
 *
 * 上游版本从 @arms/rum-electron 初始化 ARMS RUM SDK。Lumi 分发以应用自有遥测
 * shim（./lumiTelemetry.ts）替换该闭源依赖：init 参数形状保持兼容，beforeReport
 * 过滤/富化/脱敏管线逐行保留；渲染进程浏览器采集不再注入（见 lumiTelemetry.ts
 * 头注）。事件只进入部署方显式配置的自有端点，不发送到任何上游产品服务。
 */
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
  ZCODE_AGENT_LIFECYCLE_LOG_MARKER,
  ZCODE_VERSION,
  mapZCodeEnvToArmsRumEnv,
} from "@zcode/shared";
import {
  addLumiTelemetryReporterRequestWrapper,
  isLumiTelemetryTransportEnabled,
  lumiTelemetryDisabledInit,
  lumiTelemetryInit,
} from "./lumiTelemetry.js";
import { wrapStartupReporterRequest } from "./startupTelemetryDelivery.js";
import { redactArmsEventBatch } from "./armsEventRedaction.js";
import { ensureDesktopDeviceMidSync } from "./desktopDeviceMid.js";
import { ingestArmsApiEventsFromBatch } from "./desktopNetworkTelemetry.js";
import { desktopRuntimeEnv, runtimeApplicationName } from "./desktopRuntimeEnv.js";
import { summarizeLongTaskAttribution } from "./longTaskAttributionSummary.js";
import { logger } from "./logger.js";

function enrichLongTaskAttribution(events: Array<Record<string, unknown>>): void {
  for (const event of events) {
    if (event.event_type !== "longTask") {
      continue;
    }
    const summary = summarizeLongTaskAttribution(event.snapshots, event.duration);
    if (!summary) {
      continue;
    }
    const existingProps =
      event.properties && typeof event.properties === "object"
        ? (event.properties as Record<string, unknown>)
        : {};
    event.properties = { ...existingProps, ...summary };
  }
}

function isCrashReporterEvent(event: Record<string, unknown>): boolean {
  return (
    event.event_type === "exception" && event.type === "crash" && event.source === "crashReporter"
  );
}

function normalizeExecutableName(value: unknown): string {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/\.exe$/i, "")
    : "";
}

function hasProductExecutable(
  event: Record<string, unknown>,
  applicationName: string,
  runtimeExecutableName?: string,
): boolean {
  // 修复原因：app name 不等于所有运行形态的真实二进制名；开发态使用 Electron，
  // Linux Preview 使用 zcode-preview。两者都必须精确匹配，不能放宽成前缀以免混入 helper dump。
  const expectedNames = new Set(
    [applicationName, runtimeExecutableName].map(normalizeExecutableName).filter(Boolean),
  );
  if (expectedNames.size === 0 || !Array.isArray(event.binary_images)) {
    return false;
  }
  return event.binary_images.some((image) => {
    if (!image || typeof image !== "object") {
      return false;
    }
    return expectedNames.has(normalizeExecutableName((image as Record<string, unknown>).name));
  });
}

type NativeDumpProcessRole = "main" | "renderer" | "utility" | "gpu" | "host" | "agent" | "unknown";

const nativeDumpProcessRoleAliases: Record<string, NativeDumpProcessRole> = {
  main: "main",
  browser: "main",
  main_process: "main",
  renderer: "renderer",
  utility: "utility",
  utility_host: "utility",
  gpu: "gpu",
  host: "host",
  agent: "agent",
};

function readNativeDumpProcessRole(event: Record<string, unknown>): NativeDumpProcessRole {
  const metadata =
    event.meta && typeof event.meta === "object"
      ? (event.meta as Record<string, unknown>)
      : undefined;
  // 修复原因：通用 process_role 可能由事件属性或中间件注入，并不证明来自 Crashpad dump。
  // 只信任依赖补丁从结构化 annotation RVA 提取并写入的 meta.process_type，避免 helper
  // dump 被非结构化 main 标记提升为 app_native_process，污染 Native Crash / Crash-Free。
  const processType = metadata?.process_type;
  if (typeof processType === "string") {
    return nativeDumpProcessRoleAliases[processType.trim().toLowerCase()] ?? "unknown";
  }
  return "unknown";
}

export function filterAndEnrichNativeCrashEvents(
  events: Array<Record<string, unknown>>,
  applicationName: string,
  runtimeExecutableName?: string,
): Array<Record<string, unknown>> {
  return events.filter((event) => {
    if (!isCrashReporterEvent(event)) {
      return true;
    }
    if (!hasProductExecutable(event, applicationName, runtimeExecutableName)) {
      return false;
    }
    const existingProperties =
      event.properties && typeof event.properties === "object"
        ? (event.properties as Record<string, unknown>)
        : {};
    const nativeDumpProcessRole = readNativeDumpProcessRole(event);
    // 根因：binary_images 只能证明 dump 来自产品二进制，不能区分 Linux/Windows 上
    // 共用同一 executable 的主进程、renderer、utility 或 host。未知角色继续保留原始
    // crashReporter 事件，但不得进入 app_native_process，否则会把 helper crash loop
    // 当成应用 native crash 并拉低 Crash-Free。只有明确标记为 main 的 dump 才进入产品 KPI。
    event.properties = {
      ...existingProperties,
      telemetry_schema_version: "2",
      // Bugfix: SDK 重试可能让同一事件再次经过 beforeReport，必须保留事故 ID 才能去重。
      crash_id:
        typeof existingProperties.crash_id === "string"
          ? existingProperties.crash_id
          : randomUUID(),
      crash_scope:
        nativeDumpProcessRole === "main" ? "app_native_process" : "native_dump_unattributed",
      crash_cause: "native_crash",
      crash_source: "crash_reporter_dump",
      native_dump_process_role: nativeDumpProcessRole,
    };
    return true;
  });
}

// Bugfix: 产品后端可使用 production，但源码启动的 Desktop 仍是本地开发运行态；
// ARMS 环境必须优先按运行形态标记为 local，避免开发数据污染 prod。
const armsRumEnv = mapZCodeEnvToArmsRumEnv(desktopRuntimeEnv);

// device_mid 复用 telemetry-state.json 同一持久化 UUID（与数仓 / preload 注入同源，
// ensureDesktopDeviceMidSync 幂等且不重复写盘）。渲染进程事件经 ArmsEventBridge 转发
// 到主进程后，由主进程统一上报，故只需在主进程 init 设置一次即可覆盖全部上报。
const armsDeviceMid = ensureDesktopDeviceMidSync();

// 与上游 useReporter 注入点对齐：包装器把 reporter.request 包上启动遥测送达确认，
// shim 在批次进入传输前应用全部包装器（语义与上游对公开对象的就地改写一致）。
addLumiTelemetryReporterRequestWrapper((request) =>
  wrapStartupReporterRequest(request, {
    acknowledged: (eventIds, delivery) =>
      logger.info("[database-startup] telemetry delivery", { eventIds, delivery }),
  }),
);

function startArmsRum(): Promise<void> {
  return lumiTelemetryInit({
    enable: true,
    version: ZCODE_VERSION,
    env: armsRumEnv,
    app: {
      name: runtimeApplicationName,
      version: ZCODE_VERSION,
      env: armsRumEnv,
      type: "electron",
      framework: "react",
    },
    user: {
      name: armsDeviceMid,
    },
    // Lumi shim 不注入渲染进程浏览器采集；collectors/browserCollectors/autoInject/
    // sessionConfig/spaMode/tracing 均为上游 SDK 专用键，本实现不消费。
    collectors: {
      jsError: true,
      consoleError: true,
      crash: true,
      application: true,
      api: true,
      rpc: true,
    },
    // HTTP 全链路耗时来自 api 批次；生产/本地运行均 ingest，本地运行额外打印批次摘要
    beforeReport: (payload: { events?: Array<Record<string, unknown>> }) => {
      // Bugfix: crash collector 会扫描共享 dump 目录，外部后代进程的 dump 也可能混入。
      // 只保留包含当前产品可执行文件的原生 crash；过滤仅遍历现有批次元数据，不新增 IO。
      const events = filterAndEnrichNativeCrashEvents(
        // 已有结构化生命周期上报的本地 error 日志不再作为 console JS 异常重复采集。
        // 只按显式标记过滤包装事件，保留真正的 uncaughtException 和其他 console.error。
        (payload?.events ?? []).filter(
          (event) =>
            !(
              event.event_type === "exception" &&
              event.type === "error" &&
              event.source === "console.error" &&
              typeof event.message === "string" &&
              event.message.includes(ZCODE_AGENT_LIFECYCLE_LOG_MARKER)
            ),
        ),
        runtimeApplicationName,
        basename(process.execPath),
      );
      payload.events = events;
      ingestArmsApiEventsFromBatch(events);
      enrichLongTaskAttribution(events);
      // 隐私收口必须排在 ingest 与归因摘要之后：网络聚合沿用自己的 interface 归一规则，
      // longTask 摘要需要原始 snapshots；只有最终离开本机的副本才做脱敏。
      redactArmsEventBatch(events);
      if (desktopRuntimeEnv === "development") {
        const perfEvents = events.filter(
          (event) => String(event.type ?? "").toLowerCase() === "perf",
        );
        const summary = events
          .map((event) => {
            const eventType = String(event.event_type ?? "?");
            const subType = String(event.type ?? "");
            const name = String(event.name ?? "");
            if (subType === "perf") {
              return `${eventType}:perf`;
            }
            return `${eventType}:${name || subType || "?"}`;
          })
          .join(", ");
        logger.info(
          `[arms] beforeReport batch=${events.length} perf=${perfEvents.length}${summary ? ` [${summary}]` : ""}`,
        );
      }
      return payload;
    },
  }).then(() => {
    logger.info(`[arms] lumi telemetry initialized env=${armsRumEnv} version=${ZCODE_VERSION}`);
  });
}

// 总开关关闭或端点未配置时不初始化传输；shim 一律 no-op，不出网。
export const armsInitPromise: Promise<void> = isLumiTelemetryTransportEnabled()
  ? startArmsRum()
  : lumiTelemetryDisabledInit();
