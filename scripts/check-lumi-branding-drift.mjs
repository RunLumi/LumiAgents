#!/usr/bin/env node
/**
 * Lumi Agents 品牌 / 主题集成漂移检查。
 *
 * 用途：upstream 同步或重构后，确认唯一的集成点仍然存在且指向 Lumi 品牌。
 * 本脚本只读文件、只报告，不会改写源码；发现问题时以非 0 退出码显式失败。
 *
 * 检查的是「集成缝是否还在」，不是像素级设计验收（那是 docs/upstream/UPSTREAM-SYNC.md
 * 里的验证步骤）。新增集成点时同步扩展 EXPECTATIONS。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {{ file: string; description: string; mustInclude: RegExp[]; mustExclude?: RegExp[] }[]} */
const EXPECTATIONS = [
  {
    file: "packages/desktop/scripts/desktop-product-identity.mjs",
    description: "打包态应用身份仍是 Lumi Agents / app.lumi.agents",
    mustInclude: [
      /appId:\s*"app\.lumi\.agents"/,
      /appId:\s*"app\.lumi\.agents\.preview"/,
      /productName:\s*"Lumi Agents"/,
      /productName:\s*"Lumi Agents Preview"/,
      /linuxExecutableName:\s*"lumi-agents"/,
    ],
  },
  {
    file: "packages/desktop/src/main/desktopRuntimeEnv.ts",
    description: "运行时展示名是 Lumi Agents，且 userData 目录名与展示名解耦",
    mustInclude: [/runtimeApplicationName/, /"Lumi Agents"/, /runtimeUserDataDirName/, /"ZCode"/],
  },
  {
    file: "packages/ui/src/lib/productBrand.ts",
    description: "UI 产品名单一来源仍是 Lumi Agents",
    mustInclude: [/export const PRODUCT_NAME = "Lumi Agents"/],
  },
  {
    file: "packages/ui/src/i18n/IntlProvider.tsx",
    description: "locale 文案仍经过 Lumi 品牌覆盖层",
    mustInclude: [/applyLumiBranding\(msg\)/, /lumiBrandingOverlay\.js/],
  },
  {
    file: "packages/ui/src/i18n/lumiBrandingOverlay.ts",
    description: "品牌覆盖层保护 agent / 内部术语不被改写",
    mustInclude: [/ZCode Agent/, /ZCode CDN/, /ZCode CLI/, /PRODUCT_NAME/],
  },
  {
    file: "packages/ui/src/useTheme.ts",
    description: "主题解析收口为 light-only 且应用 theme-lumi",
    mustInclude: [/return "light";/, /classList\.add\("theme-lumi"\)/, /classList\.remove\("dark"/],
    mustExclude: [/classList\.add\("dark"\)/],
  },
  {
    file: "packages/ui/src/styles.css",
    description: "存在 Lumi 主题 token 层且使用 DESIGN.md 关键色值",
    mustInclude: [
      /\.theme-lumi \{/,
      /--color-background: #f4f0e8;/,
      /--color-brand: #006093;/,
      /--color-foreground: #102a43;/,
      /--color-card: #ffffff;/,
    ],
  },
  {
    file: "packages/web/index.html",
    description: "Web 首屏固定 light 且不再默认 dark",
    mustInclude: [/content="light"/, /data-zcode-bootstrap-theme", "light"/],
    mustExclude: [/classList\.add\("dark"\)/],
  },
];

const failures = [];

for (const expectation of EXPECTATIONS) {
  let content;
  try {
    content = readFileSync(join(repoRoot, expectation.file), "utf8");
  } catch {
    failures.push(`${expectation.file}: 文件缺失（${expectation.description}）`);
    continue;
  }

  for (const pattern of expectation.mustInclude) {
    if (!pattern.test(content)) {
      failures.push(`${expectation.file}: 缺少 ${pattern}（${expectation.description}）`);
    }
  }
  for (const pattern of expectation.mustExclude ?? []) {
    if (pattern.test(content)) {
      failures.push(`${expectation.file}: 出现禁止的 ${pattern}（${expectation.description}）`);
    }
  }
}

if (failures.length > 0) {
  console.error("[lumi-drift] 检测到品牌 / 主题集成漂移：");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    "\n根据 docs/upstream/FORK-DIFFERENCES.md 恢复集成点，或在有意变更时同步更新本脚本。",
  );
  process.exit(1);
}

console.log(`[lumi-drift] 集成点完好：已校验 ${EXPECTATIONS.length} 个文件。`);
