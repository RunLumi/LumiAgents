/**
 * Lumi 遥测替换（@arms/rum-* → 自有 shim）的负向测试。
 *
 * 目的：证明闭源 @arms/rum-* SDK 一旦从任何方向回归 —— 依赖、补丁、接线、
 * preload 桥接 —— 漂移检查都会失败；且解析缝在总开关/端点未配置时不出网。
 *
 * 运行：node --import tsx --test packages/ui/test/lumiTelemetryShim.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { evaluateLumiDrift } from "../../../scripts/lumi-drift-rules.mjs";
import {
  LUMI_TELEMETRY_ENDPOINT_ENV,
  resolveTelemetryDelivery,
} from "../../../packages/shared/src/telemetrySourceRuntime.js";

function createIo(files: Record<string, string>) {
  return {
    repoRoot: "",
    existsSync: (file: string) => Object.hasOwn(files, file),
    readFileSync: (file: string) => {
      if (!Object.hasOwn(files, file)) {
        throw new Error(`ENOENT: ${file}`);
      }
      return files[file];
    },
  };
}

test("漂移检查：@arms 依赖回到 package.json 会失败", () => {
  const io = createIo({
    "packages/desktop/package.json": JSON.stringify({
      dependencies: { "@arms/rum-electron": "^0.0.3" },
    }),
  });
  const failures = evaluateLumiDrift(io);
  assert.ok(
    failures.some((failure) => failure.includes("packages/desktop/package.json")),
    "必须报告 @arms 依赖回归",
  );
});

test("漂移检查：@arms pnpm 补丁配置回归会失败", () => {
  const io = createIo({
    "package.json": JSON.stringify({
      pnpm: {
        patchedDependencies: {
          "@arms/rum-electron@0.0.3": "patches/@arms__rum-electron@0.0.3.patch",
        },
      },
    }),
  });
  const failures = evaluateLumiDrift(io);
  assert.ok(
    failures.some((failure) => failure.includes("package.json")),
    "必须报告补丁配置回归",
  );
});

test("漂移检查：shim 接线被改回 @arms SDK import 会失败", () => {
  const io = createIo({
    // lumiTelemetry.ts 内出现 SDK import（回归）—— mustExclude 命中
    "packages/desktop/src/main/lumiTelemetry.ts": `import armsRum from "@arms/rum-electron";
lumiTelemetrySendCustom({});
lumiTelemetrySendEvent({});
resolveTelemetryDeliveryFromConstants();`,
    // appARMSBootstrap 保留管线但改回 SDK —— mustExclude 命中
    "packages/desktop/src/main/appARMSBootstrap.ts": `lumiTelemetryInit({});
beforeReport
redactArmsEventBatch
filterAndEnrichNativeCrashEvents
import armsRum from "@arms/rum-electron";`,
  });
  const failures = evaluateLumiDrift(io);
  assert.ok(
    failures.some((failure) => failure.includes("lumiTelemetry.ts")),
    "必须报告 shim 内 SDK import 回归",
  );
  assert.ok(
    failures.some((failure) => failure.includes("appARMSBootstrap.ts")),
    "必须报告引导文件 SDK import 回归",
  );
});

test("漂移检查：preload 桥接转发回归会失败", () => {
  const io = createIo({
    "packages/desktop/src/preload/index.ts": [
      "installArmsRumBridgeIpcForward(ipcRenderer);",
      "scheduleArmsEventBridgePatch();",
      'from "../shared/armsRumBridgeForward.js";',
    ].join("\n"),
  });
  const failures = evaluateLumiDrift(io);
  assert.ok(
    failures.some((failure) => failure.includes("preload/index.ts")),
    "必须报告 preload ARMS 桥接回归",
  );
});

test("漂移检查：shim 或解析缝缺失会失败（不会静默通过）", () => {
  const failures = evaluateLumiDrift(createIo({}));
  assert.ok(
    failures.some((failure) => failure.includes("lumiTelemetry.ts")),
    "必须报告 shim 缺失",
  );
  assert.ok(
    failures.some((failure) => failure.includes("telemetrySourceRuntime.ts")),
    "必须报告解析缝缺失",
  );
});

// ── 解析缝行为（不发网络请求的纯函数测试） ──

test("解析缝：总开关关闭时不出网（enabled=false，无端点）", () => {
  const delivery = resolveTelemetryDelivery({
    LUMI_TELEMETRY: "",
    LUMI_TELEMETRY_ENDPOINT: "https://collector.example.com/v1/events",
  });
  assert.equal(delivery.enabled, false);
  assert.equal(delivery.endpoint, "");
  assert.equal(delivery.endpointSource, "none");
});

test("解析缝：开关开启但端点未配置时不出网", () => {
  const delivery = resolveTelemetryDelivery({ LUMI_TELEMETRY: "1" });
  assert.equal(delivery.enabled, false);
  assert.equal(delivery.endpoint, "");
});

test("解析缝：LUMI_TELEMETRY_ENDPOINT 优先且必须是 https", () => {
  const https = resolveTelemetryDelivery({
    LUMI_TELEMETRY: "1",
    [LUMI_TELEMETRY_ENDPOINT_ENV]: "https://collector.example.com/v1/events",
    ZCODE_ARMS_RUM_ENDPOINT: "https://upstream.example.com/arms",
  });
  assert.equal(https.enabled, true);
  assert.equal(https.endpoint, "https://collector.example.com/v1/events");
  assert.equal(https.endpointSource, "lumi-env");

  const insecure = resolveTelemetryDelivery({
    LUMI_TELEMETRY: "1",
    [LUMI_TELEMETRY_ENDPOINT_ENV]: "http://collector.example.com/v1/events",
  });
  assert.equal(insecure.enabled, false, "明文 http 端点必须被视为未配置");
});

test("解析缝：上游端点变量仅在显式开启且为 https 时生效", () => {
  const upstream = resolveTelemetryDelivery({
    LUMI_TELEMETRY: "1",
    ZCODE_ARMS_RUM_ENDPOINT: "https://upstream.example.com/arms",
  });
  assert.equal(upstream.enabled, true);
  assert.equal(upstream.endpointSource, "upstream-env");
});

test("真实仓库：@arms 已从锁文件与第三方登记中移除", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const lock = readFileSync(`${repoRoot}pnpm-lock.yaml`, "utf8");
  assert.ok(!lock.includes("@arms/"), "pnpm-lock.yaml 不得再引用 @arms");
  const overrides = readFileSync(`${repoRoot}third-party/npm-overrides.json`, "utf8");
  assert.ok(!overrides.includes("@arms/"), "npm-overrides.json 不得再登记 @arms");
});
