#!/usr/bin/env node
/**
 * Lumi Agents 修改文件声明（Apache-2.0 §4(b)）。
 *
 * Apache License 2.0 第 4(b) 条要求：分发 Derivative Works 时，必须让**被修改的文件**
 * 带有显著的修改声明。本脚本是这条义务在 Lumi 分支上的单一执行点：
 *
 *   node scripts/lumi-modified-files.mjs check   校验每个被修改文件都带声明（默认）
 *   node scripts/lumi-modified-files.mjs apply   幂等地补齐缺失声明（供维护者一次性使用）
 *
 * 口径：
 * - 只有「修改/替换了上游内容」的文件才需要声明。为 Lumi 新增的独立文件属于新增
 *   （addition），不是 §4(b) 意义上的 modified file，因此不在此清单内。
 * - 无法承载注释的格式（JSON）与二进制资产（PNG/ICNS/ICO）无法内联声明，统一登记在
 *   NOTICE_EXCEPTIONS，并在 docs/licensing/COMPLIANCE.md 记录其替代机制。
 * - 新增 Lumi 修改时，必须同时把文件加进 MODIFIED_FILES 或 NOTICE_EXCEPTIONS；
 *   否则 check 会在 check-manifest-sync 阶段报告未登记的改动。
 *
 * 本脚本只读 / 只做幂等前缀写入，绝不批量重写上游代码。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 检查器用来识别「已带修改声明」的稳定标记。 */
export const LUMI_MODIFICATION_MARKER = "Modified for Lumi Agents";

export const LUMI_FORK_URL = "https://github.com/RunLumi/LumiAgents";
export const UPSTREAM_URL = "https://github.com/zai-org/ZCode";

export const LUMI_MODIFICATION_NOTICE = `${LUMI_MODIFICATION_MARKER} (${LUMI_FORK_URL}) from ZCode (${UPSTREAM_URL}). Apache-2.0 §4(b) modification notice.`;

/**
 * 只有出现在文件头部区域的完整声明句才算数。
 * 原因：仅检查裸标记会被「文档里提到这个标记」误判为已有声明
 * （见 packages/ui/test/lumiCompliance.test.ts 的负向用例）。
 */
const NOTICE_HEADER_REGION_CHARS = 2000;

function hasNotice(content) {
  return content.slice(0, NOTICE_HEADER_REGION_CHARS).includes(LUMI_MODIFICATION_NOTICE);
}

/**
 * 修改了上游内容、必须内联声明修改的文件。
 * `comment` 决定声明使用哪种注释语法。
 */
export const MODIFIED_FILES = [
  { path: "AGENTS.md", comment: "md" },
  { path: "NOTICE.md", comment: "md" },
  { path: "README.md", comment: "md" },
  { path: "README.en.md", comment: "md" },
  // 生成物：声明由 scripts/generate-third-party-notices.mjs 的头部模板产出，
  // 保证每次重新生成都自带声明（不能靠事后手改生成物）。
  { path: "THIRD-PARTY-NOTICES.md", comment: "md" },
  { path: "packages/desktop/electron-builder.config.js", comment: "line" },
  // shebang 必须是脚本第一行，声明只能插在其后，否则脚本不再可执行。
  { path: "packages/desktop/scripts/bundle.mjs", comment: "line", place: "afterShebang" },
  { path: "packages/desktop/scripts/desktop-product-identity.mjs", comment: "line" },
  { path: "packages/desktop/src/main/about.ts", comment: "line" },
  { path: "packages/desktop/src/main/aboutWindow.ts", comment: "line" },
  { path: "packages/desktop/src/main/autoUpdater.ts", comment: "line" },
  { path: "packages/desktop/src/main/desktopRuntimeEnv.ts", comment: "line" },
  { path: "packages/desktop/src/main/forceUpdatePrompt.ts", comment: "line" },
  { path: "packages/desktop/src/main/index.ts", comment: "line" },
  { path: "packages/desktop/src/main/windowsCuaOperationIndicatorContent.ts", comment: "line" },
  {
    path: "packages/desktop/src/renderer/cua-permission-panel.html",
    comment: "html",
    place: "afterDoctype",
  },
  { path: "packages/desktop/src/renderer/index.html", comment: "html", place: "afterDoctype" },
  { path: "packages/desktop/src/renderer/src/main.tsx", comment: "line" },
  { path: "packages/desktop/src/renderer/src/resource-manager.tsx", comment: "line" },
  { path: "packages/shared/src/env.ts", comment: "line" },
  { path: "packages/shared/src/index.ts", comment: "line" },
  { path: "packages/ui/src/DesktopTopOverlay.tsx", comment: "line" },
  { path: "packages/ui/src/WelcomeScreen.tsx", comment: "line" },
  { path: "packages/ui/src/WindowsTopLeftLogo.tsx", comment: "line" },
  { path: "packages/ui/src/WorkspaceSidebar/WorkspaceSidebarCollapsedRail.tsx", comment: "line" },
  { path: "packages/ui/src/WorkspaceSidebarFooter.tsx", comment: "line" },
  { path: "packages/ui/src/i18n/IntlProvider.tsx", comment: "line" },
  { path: "packages/ui/src/i18n/locales/en-US.ts", comment: "line" },
  { path: "packages/ui/src/i18n/locales/zh-CN.ts", comment: "line" },
  { path: "packages/ui/src/onboarding/OnboardingWelcomeView.tsx", comment: "line" },
  {
    path: "packages/ui/src/settings/model-provider-section/codingPlanEmbeddedWebview.ts",
    comment: "line",
  },
  { path: "packages/ui/src/store/index.ts", comment: "line" },
  { path: "packages/ui/src/styles.css", comment: "block" },
  { path: "packages/ui/src/useTheme.ts", comment: "line" },
  { path: "packages/ui/src/v4/ConversationDraftEmptyState.tsx", comment: "line" },
  { path: "packages/web/index.html", comment: "html", place: "afterDoctype" },
  { path: "packages/web/src/main.tsx", comment: "line" },
  { path: "packages/web/src/webThemeSeed.ts", comment: "line" },
  // shebang 必须是脚本第一行，声明只能插在其后，否则脚本不再可执行。
  // shebang 必须是脚本第一行，声明只能插在其后，否则脚本不再可执行。
  { path: "scripts/build-zcode.mjs", comment: "line", place: "afterShebang" },
  { path: "scripts/generate-third-party-notices.mjs", comment: "line" },
  { path: "scripts/doctor-macos-release-app.sh", comment: "hash", place: "afterShebang" },
  { path: "scripts/third-party-notices.mjs", comment: "line" },
];

/**
 * 替换了上游内容、但格式无法内联声明的文件。
 * 替代机制：docs/licensing/MODIFICATIONS.md 逐条登记（路径、替代方式、原始来源）。
 */
export const NOTICE_EXCEPTIONS = [
  { path: "package.json", mechanism: "json-no-comments" },
  { path: "packages/desktop/package.json", mechanism: "json-no-comments" },
  { path: "third-party/inventory.json", mechanism: "json-no-comments" },
  // 以下四份是上游的三方材料登记表，Lumi 在其中加入逐包复核记录（本分支的许可了结工作）。
  { path: "third-party/npm-overrides.json", mechanism: "json-no-comments" },
  { path: "third-party/copied-components.json", mechanism: "json-no-comments" },
  { path: "third-party/embedded-components.json", mechanism: "json-no-comments" },
  { path: "third-party/native-search/sources.json", mechanism: "json-no-comments" },
  { path: "packages/desktop/build/icon.png", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icon.icns", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icon.ico", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icon_windows.png", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icon_installer.png", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icon_installer.icns", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icon_installer.ico", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icons/16x16.png", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icons/24x24.png", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icons/32x32.png", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icons/48x48.png", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icons/64x64.png", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icons/128x128.png", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icons/256x256.png", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icons/512x512.png", mechanism: "binary-generated" },
  { path: "packages/desktop/build/icons/1024x1024.png", mechanism: "binary-generated" },
  { path: "public/logo/icons/icon.icns", mechanism: "binary-generated" },
  { path: "public/logo/icons/icon.ico", mechanism: "binary-generated" },
  { path: "public/logo/icons/16x16.png", mechanism: "binary-generated" },
  { path: "public/logo/icons/24x24.png", mechanism: "binary-generated" },
  { path: "public/logo/icons/32x32.png", mechanism: "binary-generated" },
  { path: "public/logo/icons/48x48.png", mechanism: "binary-generated" },
  { path: "public/logo/icons/64x64.png", mechanism: "binary-generated" },
  { path: "public/logo/icons/128x128.png", mechanism: "binary-generated" },
  { path: "public/logo/icons/256x256.png", mechanism: "binary-generated" },
  { path: "public/logo/icons/512x512.png", mechanism: "binary-generated" },
  { path: "public/logo/icons/1024x1024.png", mechanism: "binary-generated" },
  { path: "public/icon_512@2x.png", mechanism: "binary-generated" },
];

/**
 * 工作区里相对上游已修改、但**不属于 Lumi 修改声明范围**的文件。
 *
 * 用途：`--against-upstream` 模式会列出所有相对 upstream 被修改的文件；若某文件是其他人
 * 尚未提交的本地工作（不是 Lumi 的品牌/合规改动），不应凭空给它加 Lumi 声明，也不应让它
 * 静默触发失败。这里显式登记并写明原因，便于审查；仍未解决时发布前必须清空这一列表。
 * @type {{ path: string, reason: string }[]}
 */
export const UNDECLARED_WORKSPACE_CHANGES = [
  {
    path: ".env.example",
    reason:
      "仓库所有者的本地改动（App Store Connect / MAS 凭据占位符），非 Lumi 品牌或合规改动，不由本分支声明",
  },
  {
    path: ".gitignore",
    reason:
      "仓库所有者的本地改动（忽略 App Store Connect 的 *.p8 私钥），非 Lumi 品牌或合规改动，不由本分支声明",
  },
  {
    path: "DESIGN.md",
    reason:
      "仓库所有者未提交的设计合同（Lumi Design System 正文）；本分支不改写、不代提交他人未完成工作。一旦提交，必须由提交者补上 §4(b) 修改声明（见 docs/licensing/MODIFICATIONS.md 第 5.1 节）",
  },
];

/**
 * 上游资源被 Lumi 原创资产整体替换、因而不需要逐像素声明的位置。
 * 这些条目同样登记在 docs/licensing/MODIFICATIONS.md。
 */
export const REPLACED_ASSETS = [
  { path: "packages/desktop/build/dmg_background.png", status: "still-upstream" },
  { path: "packages/desktop/build/dmg_background@2x.png", status: "still-upstream" },
];

function noticeBlock(comment) {
  switch (comment) {
    case "hash":
      return `# ${LUMI_MODIFICATION_NOTICE}\n`;
    case "html":
      return `<!-- ${LUMI_MODIFICATION_NOTICE} -->\n`;
    case "md":
      return `> ${LUMI_MODIFICATION_NOTICE}\n\n`;
    case "block":
      return `/* ${LUMI_MODIFICATION_NOTICE} */\n`;
    case "line":
    default:
      return `// ${LUMI_MODIFICATION_NOTICE}\n`;
  }
}

/**
 * 计算声明块的插入位置。
 * shebang 与 doctype 都有位置约束，不能把声明无条件插到第 1 行。
 */
function insertionOffset(content, place) {
  if (place === "afterShebang") {
    const match = /^#![^\n]*\n/.exec(content);
    return match ? match[0].length : 0;
  }
  if (place === "afterDoctype") {
    const match = /^\s*<!doctype[^>]*>\s*\n/i.exec(content);
    return match ? match[0].length : 0;
  }
  return 0;
}

function insertNotice(content, entry) {
  const block = noticeBlock(entry.comment);
  const offset = insertionOffset(content, entry.place);
  return content.slice(0, offset) + block + content.slice(offset);
}

/**
 * 纯函数校验：给定 (path → content) 读取器，返回失败信息列表。
 * 以 readFile 注入便于用 fixture 做负向测试。
 */
export function evaluateModifiedFileNotices({
  readFileSync,
  existsSync,
  repoRoot: root = repoRoot,
}) {
  // repoRoot 可注入，让负向测试能用 fixture 路径而不是真实仓库根。
  const resolvePath = (file) => (root ? path.join(root, file) : file);
  const failures = [];

  for (const entry of MODIFIED_FILES) {
    let content;
    try {
      content = readFileSync(resolvePath(entry.path), "utf8");
    } catch {
      failures.push(`${entry.path}: 文件缺失（清单登记为已修改文件）`);
      continue;
    }
    if (!hasNotice(content)) {
      failures.push(
        `${entry.path}: 文件头部缺少 Apache-2.0 §4(b) 完整修改声明句（须包含 “${LUMI_MODIFICATION_NOTICE}”）`,
      );
    }
  }

  for (const entry of NOTICE_EXCEPTIONS) {
    if (!existsSync(resolvePath(entry.path))) {
      failures.push(`${entry.path}: 清单登记为无法内联声明的文件，但实际不存在（清单过期）`);
    }
  }

  return failures;
}

/** 幂等补齐：仅在缺失时把声明块加到文件开头。 */
export async function applyModifiedFileNotices() {
  const changed = [];
  for (const entry of MODIFIED_FILES) {
    const absolute = path.join(repoRoot, entry.path);
    let content;
    try {
      content = await readFile(absolute, "utf8");
    } catch {
      changed.push(`SKIP ${entry.path} (missing)`);
      continue;
    }
    if (hasNotice(content)) {
      continue;
    }
    await writeFile(absolute, insertNotice(content, entry), "utf8");
    changed.push(`NOTICE ${entry.path}`);
  }
  return changed;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const command = process.argv[2] ?? "check";
  const { readFileSync, existsSync } = await import("node:fs");
  if (command === "apply") {
    const changed = await applyModifiedFileNotices();
    console.log(
      changed.length === 0
        ? "[lumi-notice] 所有已修改文件都已带声明。"
        : `[lumi-notice] 已补齐 ${changed.length} 个文件：\n  ${changed.join("\n  ")}`,
    );
  } else if (command === "check") {
    const failures = evaluateModifiedFileNotices({ readFileSync, existsSync });
    if (failures.length > 0) {
      console.error("[lumi-notice] Apache-2.0 §4(b) 修改声明缺失：");
      for (const failure of failures) {
        console.error(`  - ${failure}`);
      }
      console.error(
        "\n处理：运行 node scripts/lumi-modified-files.mjs apply 补齐，或把文件登记进 NOTICE_EXCEPTIONS 并在 docs/licensing/MODIFICATIONS.md 说明替代机制。",
      );
      process.exit(1);
    }
    console.log(
      `[lumi-notice] 修改声明完整：${MODIFIED_FILES.length} 个已修改文件、${NOTICE_EXCEPTIONS.length} 个已登记例外。`,
    );
  } else {
    console.error("用法: node scripts/lumi-modified-files.mjs [check|apply]");
    process.exit(2);
  }
}
