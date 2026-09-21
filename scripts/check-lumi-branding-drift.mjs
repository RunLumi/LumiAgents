#!/usr/bin/env node
/**
 * Lumi Agents 品牌 / 主题 / 许可 / 分发安全 漂移检查（统一入口）。
 *
 * 用途：upstream 同步或重构后，确认唯一的集成点仍然存在、归属声明没有被抹掉、
 * 分发安全默认值没有被改回上游。本脚本只读文件、只报告，不会改写源码；
 * 发现问题时以非 0 退出码显式失败。
 *
 * 检查项：
 *  1. 品牌 / 主题集成缝（scripts/lumi-drift-rules.mjs）
 *  2. Apache-2.0 §4(b) 修改声明（scripts/lumi-modified-files.mjs）
 *  3. 与上游清单的一致性（--against-upstream，需要本地 upstream 远端）
 *
 * 用法：
 *   node scripts/check-lumi-branding-drift.mjs
 *   node scripts/check-lumi-branding-drift.mjs --against-upstream
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EXPECTATIONS, evaluateLumiDrift } from "./lumi-drift-rules.mjs";
import {
  MODIFIED_FILES,
  NOTICE_EXCEPTIONS,
  UNDECLARED_WORKSPACE_CHANGES,
  evaluateModifiedFileNotices,
} from "./lumi-modified-files.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

// 两个规则模块都自行拼接 repoRoot，这里传裸 readFileSync/existsSync，避免双重拼接。

// 1. 品牌 / 主题 / 归属 / 分发安全
failures.push(...evaluateLumiDrift({ readFileSync, existsSync, repoRoot }));

// 2. §4(b) 修改声明
failures.push(...evaluateModifiedFileNotices({ readFileSync, existsSync }));

// 3. 可选的清单一致性检查：确认没有「改了上游文件却没登记声明」的情况。
if (process.argv.includes("--against-upstream")) {
  try {
    const changed = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=M", "upstream/main"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const registered = new Set([
      ...MODIFIED_FILES.map((entry) => entry.path),
      ...NOTICE_EXCEPTIONS.map((entry) => entry.path),
      ...UNDECLARED_WORKSPACE_CHANGES.map((entry) => entry.path),
    ]);
    for (const file of changed) {
      if (!registered.has(file)) {
        failures.push(
          `${file}: 修改了上游文件但没有登记 $4(b) 声明或例外（scripts/lumi-modified-files.mjs）`,
        );
      }
    }
  } catch {
    console.warn(
      "[lumi-drift] 跳过 --against-upstream：本地不存在 upstream/main（先运行 git fetch upstream）。",
    );
  }
}

if (failures.length > 0) {
  console.error("[lumi-drift] 检测到品牌 / 主题 / 许可 / 分发安全漂移：");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    "\n根据 docs/upstream/FORK-DIFFERENCES.md 与 docs/licensing/COMPLIANCE.md 恢复集成点，或在有意变更时同步更新本脚本与清单。",
  );
  process.exit(1);
}

console.log(
  `[lumi-drift] 集成点完好：品牌/主题/归属/分发安全 ${EXPECTATIONS.length} 项，§4(b) 修改声明 ${MODIFIED_FILES.length} 项 + ${NOTICE_EXCEPTIONS.length} 例。`,
);
