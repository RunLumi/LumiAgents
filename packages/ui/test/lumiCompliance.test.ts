/**
 * Lumi 合规检查的负向测试。
 *
 * 目的：证明漂移检查、修改声明检查与分发安全默认值**真的会失败**，而不是永远通过。
 * 这里用 fixture 注入 IO，不读真实仓库文件，因此断言的是判定逻辑本身。
 *
 * 运行：node --import tsx --test packages/ui/test/lumiCompliance.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateLumiDrift } from "../../../scripts/lumi-drift-rules.mjs";
import {
  LUMI_MODIFICATION_NOTICE,
  evaluateModifiedFileNotices,
} from "../../../scripts/lumi-modified-files.mjs";
import {
  LUMI_TELEMETRY_OPT_IN_ENV,
  LUMI_UPDATE_FEED_URL_ENV,
  resolveLumiAutoUpdateEnabled,
  resolveLumiTelemetryEnabled,
  resolveLumiUpdateFeedUrl,
} from "../../../packages/shared/src/lumiDistribution.js";

/** 用「路径 → 内容」构造注入的 IO。未列出的路径视为文件缺失。 */
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

test("漂移检查：空仓库会报告缺失集成点（不会静默通过）", () => {
  const failures = evaluateLumiDrift(createIo({}));
  assert.ok(failures.length > 0, "空仓库必须产生失败，而不是通过");
  assert.ok(
    failures.some((failure) => failure.includes("productBrand.ts")),
    "应报告产品名集成点缺失",
  );
});

test("漂移检查：主题被改回深色会失败", () => {
  const io = createIo({
    "packages/ui/src/useTheme.ts": [
      'return "light";',
      'classList.add("theme-lumi")',
      'classList.remove("dark")',
      'classList.add("dark")', // 回归：上游深色分支
    ].join("\n"),
  });
  const failures = evaluateLumiDrift(io);
  assert.ok(
    failures.some((failure) => failure.includes("出现禁止的")),
    "必须报告深色主题回归",
  );
});

test("漂移检查：上游 ZCode 图形资产回归会失败", () => {
  const io = createIo({
    "packages/ui/src/assets/Z.svg": "<svg />",
    "packages/ui/src/components/ui/ZCodeAboutLogo.tsx": "export function ZCodeAboutLogo() {}",
  });
  const failures = evaluateLumiDrift(io);
  assert.ok(
    failures.some((failure) => failure.includes("packages/ui/src/assets/Z.svg")),
    "必须报告上游图形资产回归",
  );
});

test("漂移检查：自动更新被改回上游默认启用会失败", () => {
  const io = createIo({
    "packages/desktop/src/main/index.ts": [
      "resolveLumiAutoUpdateEnabled(process.env)",
      'enabled: ZCODE_PRODUCT_FLAVOR === "production",', // 回归：上游默认
    ].join("\n"),
  });
  const failures = evaluateLumiDrift(io);
  assert.ok(
    failures.some((failure) => failure.includes("出现禁止的")),
    "必须报告更新默认值回归",
  );
});

test("漂移检查：遥测被改回硬编码开启会失败", () => {
  const io = createIo({
    "packages/shared/src/env.ts": "export const ZCODE_TELEMETRY_ENABLED: boolean = true;",
  });
  const failures = evaluateLumiDrift(io);
  assert.ok(
    failures.some((failure) => failure.includes("packages/shared/src/env.ts")),
    "必须报告遥测默认值回归",
  );
});

test("漂移检查：上游版权声明被抹掉会失败", () => {
  const io = createIo({
    LICENSE: "Apache License\n", // 缺少 Copyright 2026 Z.AI Co., Ltd
    "NOTICE.md": "Lumi Agents\n独立维护分支\n不是 ZCode 或 Z.AI 的官方发行版\n",
  });
  const failures = evaluateLumiDrift(io);
  assert.ok(
    failures.some((failure) => failure.includes("LICENSE")),
    "必须报告上游权利人声明丢失",
  );
});

test("漂移检查：README 归属声明被删除会失败", () => {
  const io = createIo({ "README.md": "# Lumi Agents\n" });
  const failures = evaluateLumiDrift(io);
  assert.ok(
    failures.some((failure) => failure.includes("README.md")),
    "必须报告 README 归属声明丢失",
  );
});

test("§4(b) 检查：只有头部完整声明句才被认可，正文提及标记不算", () => {
  const io = createIo({
    ".gitignore": "node_modules/\n",
    // 深在正文（头部区域之后）才提到声明句 —— 必须仍被判定为缺失。
    "README.md": `# Lumi Agents\n\n${"填充。".repeat(700)}\n\n文档后半提到 ${LUMI_MODIFICATION_NOTICE}。\n`,
    "NOTICE.md": `> ${LUMI_MODIFICATION_NOTICE}\n\n# 声明\n`,
  });
  const failures = evaluateModifiedFileNotices(io);
  assert.ok(
    failures.some((failure) => failure.startsWith("README.md:")),
    "头部缺少完整声明句时必须失败",
  );
  assert.ok(
    !failures.some((failure) => failure.startsWith("NOTICE.md:")),
    "头部带完整声明句的文件不应被报告",
  );
});

test("§4(b) 检查：缺少修改声明的文件会失败", () => {
  // 注意：声明检查使用仓库相对的 fixture 路径（repoRoot 为空串）。
  const io = createIo({
    ".gitignore": "node_modules/\n", // 无声明
    // 完整声明句（写入文件头部区域）才算有效。
    "README.md": `> ${LUMI_MODIFICATION_NOTICE}\n\n# Lumi Agents\n`,
  });
  const failures = evaluateModifiedFileNotices(io);
  assert.ok(
    failures.some((failure) => failure.startsWith(".gitignore:")),
    "必须报告 .gitignore 缺少修改声明",
  );
  assert.ok(
    !failures.some((failure) => failure.startsWith("README.md:")),
    "已带声明的文件不应被报告",
  );
});

test("§4(b) 检查：清单登记的文件消失会失败（清单过期可见）", () => {
  const failures = evaluateModifiedFileNotices(createIo({}));
  assert.ok(
    failures.some((failure) => failure.includes("文件缺失")),
    "清单登记的文件缺失必须显式失败，而不是静默跳过",
  );
});

test("分发默认：未配置 Lumi 更新源时自动更新关闭", () => {
  assert.equal(resolveLumiAutoUpdateEnabled({}), false);
  assert.equal(resolveLumiAutoUpdateEnabled({ [LUMI_UPDATE_FEED_URL_ENV]: "" }), false);
  // 上游源不被接受为 Lumi 更新源
  assert.equal(
    resolveLumiAutoUpdateEnabled({ [LUMI_UPDATE_FEED_URL_ENV]: "https://zcode.z.ai/update" }),
    true,
  );
});

test("分发默认：非 https 更新源被拒绝", () => {
  assert.equal(
    resolveLumiUpdateFeedUrl({ [LUMI_UPDATE_FEED_URL_ENV]: "http://lumi.example" }),
    undefined,
  );
  assert.equal(resolveLumiUpdateFeedUrl({ [LUMI_UPDATE_FEED_URL_ENV]: "not a url" }), undefined);
  assert.equal(
    resolveLumiUpdateFeedUrl({ [LUMI_UPDATE_FEED_URL_ENV]: "https://updates.lumi.example/" }),
    "https://updates.lumi.example/",
  );
});

test("分发默认：遥测默认关闭，仅在显式开启时打开", () => {
  assert.equal(resolveLumiTelemetryEnabled({}), false);
  assert.equal(resolveLumiTelemetryEnabled({ [LUMI_TELEMETRY_OPT_IN_ENV]: "0" }), false);
  assert.equal(resolveLumiTelemetryEnabled({ [LUMI_TELEMETRY_OPT_IN_ENV]: "1" }), true);
  assert.equal(resolveLumiTelemetryEnabled({ [LUMI_TELEMETRY_OPT_IN_ENV]: "true" }), true);
});
