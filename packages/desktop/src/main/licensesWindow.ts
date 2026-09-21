/**
 * Lumi Agents 许可与声明窗口（离线）。
 *
 * 用途：为桌面端提供一个**离线可用**的 About / Licenses 入口，内容直接读取随包分发的
 * 法务材料，不请求任何网络资源：
 *   - `THIRD-PARTY-NOTICES.md`（第三方许可与原始版权文本，由 scripts/licenses.mjs 生成）
 *   - `LICENSE`（本仓库第一方 Apache-2.0 原文，含 “Copyright 2026 Z.AI Co., Ltd”）
 *   - `NOTICE.md`（功能与第三方组件声明，含 Lumi 分支说明）
 *
 * 打包态从 `process.resourcesPath` 读取（electron-builder extraResources 已放入）；
 * 开发态回退到仓库根目录。文件缺失时给出明确的不可用状态，而不是编造内容。
 *
 * Apache-2.0 §4(a)/§4(d) 要求分发适用的许可与 NOTICE 材料；
 * 离线窗口是本产品的可发现性设计，不是许可证指定的唯一实现方式。
 */
import type { BrowserWindow as BrowserWindowType } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_LOCALE, type Locale } from "@zcode/shared";

/** 与 scripts/third-party-notices.mjs 的 noticesFileName 保持一致。 */
export const LEGAL_NOTICES_FILE_NAME = "THIRD-PARTY-NOTICES.md";

// Preserve the inherited notice exactly; do not advance its year at runtime.
const UPSTREAM_ZCODE_COPYRIGHT = "Copyright 2026 Z.AI Co., Ltd";

const LEGAL_FILES = [LEGAL_NOTICES_FILE_NAME, "LICENSE", "NOTICE.md"] as const;
export type LegalFileName = (typeof LEGAL_FILES)[number];

const LICENSES_MESSAGES: Record<
  Locale,
  { title: string; maintainerCredit: string; intro: string; unavailable: string; close: string }
> = {
  "zh-CN": {
    title: "致谢、开源许可与声明",
    maintainerCredit: "Lumi Agents 由 CLOUDJET SOLUTIONS PTE. LTD. 开发和维护。",
    intro:
      "本窗口完全离线渲染随应用分发的许可材料，不发起任何网络请求。Lumi Agents 是 ZCode 的独立维护分支，不是 ZCode 或 Z.AI 的官方发行版。下方材料保留 Z.AI Co., Ltd 及其他贡献者按各自许可提供的原始版权与许可文本。",
    unavailable:
      "该材料未包含在当前构建中。请使用包含法务材料（LICENSE / NOTICE.md / 第三方声明）的完整安装包。",
    close: "关闭",
  },
  "en-US": {
    title: "Credits, open-source licenses and notices",
    maintainerCredit: "Lumi Agents is developed and maintained by CLOUDJET SOLUTIONS PTE. LTD.",
    intro:
      "This window renders the license materials shipped with the application entirely offline and makes no network requests. Lumi Agents is an independent fork of ZCode, not an official ZCode or Z.AI distribution. The materials below retain the original copyright and license texts of Z.AI Co., Ltd and other contributors under their applicable licenses.",
    unavailable:
      "This material is not included in the current build. Use a complete installation package that ships the legal materials (LICENSE / NOTICE.md / third-party notices).",
    close: "Close",
  },
};

export function getLicensesMessages(locale: Locale) {
  return LICENSES_MESSAGES[locale] ?? LICENSES_MESSAGES[DEFAULT_LOCALE];
}

/** 打包态读 resources，开发态读仓库根。返回存在的候选目录（按优先级）。 */
export function resolveLegalMaterialDirs(input: {
  isPackaged: boolean;
  resourcesPath: string;
  moduleDir: string;
  workspaceRoot?: string;
}): string[] {
  const dirs: string[] = [];
  if (input.isPackaged) {
    dirs.push(input.resourcesPath);
  }
  // 开发态：tsup 产物位于 packages/desktop/out/main，仓库根在上三级。
  dirs.push(resolve(input.moduleDir, "../../.."));
  if (input.workspaceRoot) {
    dirs.push(input.workspaceRoot);
  }
  return dirs;
}

export interface LegalMaterial {
  fileName: LegalFileName;
  /** null 表示当前构建未包含该材料。 */
  content: string | null;
  path: string | null;
}

export function readLegalMaterials(dirs: readonly string[]): LegalMaterial[] {
  return LEGAL_FILES.map((fileName) => {
    for (const dir of dirs) {
      const candidate = join(dir, fileName);
      if (existsSync(candidate)) {
        try {
          return { fileName, content: readFileSync(candidate, "utf8"), path: candidate };
        } catch {
          // 继续尝试下一个目录，最终返回不可用状态。
        }
      }
    }
    return { fileName, content: null, path: null };
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createLicensesWindowHtml(input: {
  applicationName: string;
  materials: readonly LegalMaterial[];
  locale?: Locale;
}): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const messages = getLicensesMessages(locale);
  const sections = input.materials
    .map((material) => {
      const body =
        material.content === null
          ? `<p class="unavailable">${escapeHtml(messages.unavailable)}</p>`
          : `<pre>${escapeHtml(material.content)}</pre>`;
      return `<section id="${escapeHtml(material.fileName)}">
        <h2>${escapeHtml(material.fileName)}</h2>
        ${body}
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    />
    <title>${escapeHtml(input.applicationName)} — ${escapeHtml(messages.title)}</title>
    <style>
      /* DESIGN.md §5：warm paper、light-only、Geist/Geist Mono（缺失时回退系统字体）。 */
      :root {
        color-scheme: light;
        font-family: Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --paper: #f4f0e8;
        --card: #ffffff;
        --ink: #102a43;
        --ink-subtle: #3d5266;
        --rule: rgba(16, 42, 67, 0.12);
        --brand: #006093;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--paper);
        color: var(--ink);
        font-size: 13px;
        line-height: 1.5;
      }
      header {
        position: sticky;
        top: 0;
        padding: 16px 20px;
        background: var(--paper);
        border-bottom: 1px solid var(--rule);
      }
      h1 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
      .intro { margin: 0; color: var(--ink-subtle); }
      main { padding: 16px 20px 32px; }
      section {
        background: var(--card);
        border: 1px solid var(--rule);
        border-radius: 12px;
        padding: 12px 14px;
        margin-bottom: 16px;
      }
      h2 {
        margin: 0 0 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--brand);
        font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11.5px;
        line-height: 1.45;
        color: var(--ink-subtle);
      }
      .unavailable { margin: 0; color: #8a3b1f; }
      footer { padding: 0 20px 24px; }
      button {
        border: 1px solid var(--rule);
        border-radius: 999px;
        padding: 7px 18px;
        background: var(--brand);
        color: #ffffff;
        font: inherit;
        font-weight: 500;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(input.applicationName)} — ${escapeHtml(messages.title)}</h1>
      <p class="intro">${escapeHtml(messages.maintainerCredit)}</p>
      <p class="intro">${escapeHtml(messages.intro)}</p>
      <p class="intro">${escapeHtml(UPSTREAM_ZCODE_COPYRIGHT)}</p>
    </header>
    <main>
      ${sections}
    </main>
    <footer>
      <button type="button" id="close-button">${escapeHtml(messages.close)}</button>
    </footer>
    <script>
      const closeWindow = () => window.close();
      document.getElementById("close-button")?.addEventListener("click", closeWindow);
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeWindow();
      });
    </script>
  </body>
</html>`;
}

/**
 * 打开许可窗口。返回窗口实例便于测试与生命周期管理。
 */
export async function showLicensesWindow(
  parentWindow?: BrowserWindowType,
  locale: Locale = DEFAULT_LOCALE,
  applicationName = "Lumi Agents",
): Promise<BrowserWindowType> {
  const { app, BrowserWindow } = await import("electron");
  const materials = readLegalMaterials(
    resolveLegalMaterialDirs({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      moduleDir: import.meta.dirname,
    }),
  );

  const licensesWindow = new BrowserWindow({
    width: 720,
    height: 640,
    parent: parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined,
    modal: false,
    show: false,
    title: `${applicationName} — ${getLicensesMessages(locale).title}`,
    backgroundColor: "#f4f0e8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  licensesWindow.setMenuBarVisibility(false);
  licensesWindow.once("ready-to-show", () => {
    licensesWindow.show();
  });
  void licensesWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      createLicensesWindowHtml({ applicationName, materials, locale }),
    )}`,
  );
  return licensesWindow;
}
