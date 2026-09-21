/**
 * Lumi Agents 漂移规则（纯函数，便于负向测试）。
 *
 * 用途：upstream 同步或重构后，确认品牌、许可归属与分发安全默认值都没有被静默改回上游。
 * 本模块只做判定，不读盘、不写盘；IO 由调用方注入，因此可以用 fixture 构造负向用例。
 *
 * 检查的是「集成缝是否还在」，不是像素级设计验收。新增集成点时同步扩展 EXPECTATIONS。
 */

/**
 * @typedef {Object} Expectation
 * @property {string} file
 * @property {string} description
 * @property {RegExp[]} [mustInclude]     文件必须匹配的正则
 * @property {RegExp[]} [mustExclude]     文件不得匹配的正则
 * @property {string[]} [mustNotExist]    同目录下不得存在的路径（相对 repo 根）
 * @property {boolean} [allowMissing]     文件缺失本身不算失败（用于 not-exist 断言文件）
 */

/** @type {Expectation[]} */
export const EXPECTATIONS = [
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
  // ── 品牌资产：上游 ZCode 图形不得回归 ──
  {
    file: "packages/ui/src/components/ui/LumiBrandMark.tsx",
    description: "UI 使用原创 Lumi 折叠 L 标记",
    mustInclude: [/M56 32H120V160L56 224Z/, /M120 176L128 168H232V232H64Z/],
  },
  {
    file: "packages/desktop/src/main/aboutWindow.ts",
    description: "About 自绘窗口使用 Lumi 折叠 L，而不是上游 ZCode 图形",
    mustInclude: [/M56 32H120V160L56 224Z/],
    mustExclude: [/M134\.4 0\.130152L116\.48 25\.6022/, /color-scheme: light dark/],
  },
  {
    file: "packages/ui/src/components/ui/ZCodeAboutLogo.tsx",
    description: "上游 About 图形组件已删除",
    mustNotExist: ["packages/ui/src/components/ui/ZCodeAboutLogo.tsx"],
    allowMissing: true,
  },
  {
    file: "packages/ui/src/assets/Z.svg",
    description: "上游 ZCode 单色图形资产已删除",
    mustNotExist: ["packages/ui/src/assets/Z.svg"],
    allowMissing: true,
  },
  // ── 许可归属：上游版权与分支声明不得被抹掉 ──
  {
    file: "LICENSE",
    description: "根许可证仍保留上游权利人与 Apache-2.0 原文",
    mustInclude: [/Apache License/, /Copyright 2026 Z\.AI Co\., Ltd/],
  },
  {
    file: "NOTICE.md",
    description: "NOTICE 保留上游原文并明确 Lumi 分支关系与声明适用范围",
    mustInclude: [
      /Lumi Agents/,
      /独立维护分支/,
      /不是 ZCode 或 Z\.AI 的官方发行版/,
      // 上游原文段落必须仍在（未被 Lumi 重写或删除）。
      /## 四、第三方许可与版权声明/,
    ],
  },
  {
    file: "README.md",
    description: "README 提供可发现的分支归属声明与合规入口",
    mustInclude: [/独立维护分支/, /Apache-2\.0/, /docs\/licensing\/COMPLIANCE\.md/],
  },
  {
    file: "README.en.md",
    description: "英文 README 提供同等归属声明",
    mustInclude: [
      /independently maintained fork/,
      /Apache-2\.0/,
      /docs\/licensing\/COMPLIANCE\.md/,
    ],
  },
  {
    file: "docs/licensing/COMPLIANCE.md",
    description: "存在许可与分发合规说明",
    mustInclude: [
      /Apache-2\.0/,
      /872ad960de7ec172591f7e1952f7849229f94521/,
      /RETAINED-UPSTREAM-REFERENCES/,
    ],
  },
  // ── 分发安全默认值 ──
  {
    file: "packages/shared/src/lumiDistribution.ts",
    description: "Lumi 分发策略单一来源存在且默认关闭上游更新源与遥测",
    mustInclude: [
      /LUMI_UPDATE_FEED_URL/,
      /LUMI_TELEMETRY_OPT_IN_ENV/,
      /export function resolveLumiAutoUpdateEnabled/,
      /export function resolveLumiTelemetryEnabled/,
    ],
  },
  {
    file: "packages/shared/src/env.ts",
    description: "产品遥测默认关闭（不再硬编码 true）",
    mustInclude: [/resolveLumiTelemetryEnabled\(/],
    mustExclude: [/ZCODE_TELEMETRY_ENABLED: boolean = true;/],
  },
  {
    file: "packages/desktop/src/main/index.ts",
    description: "自动更新默认关闭，仅在配置 Lumi 自有更新源时启用",
    mustInclude: [/resolveLumiAutoUpdateEnabled\(process\.env\)/],
    mustExclude: [/enabled: ZCODE_PRODUCT_FLAVOR === "production",/],
  },
  {
    file: "packages/desktop/src/main/autoUpdater.ts",
    description: "打包态只接受 Lumi 自有更新源，不忽略它",
    mustInclude: [/resolveLumiUpdateFeedUrl\(env\)/],
  },
  // ── 遥测替换：闭源 @arms/rum-* SDK 不得回归 ──
  {
    file: "packages/desktop/src/main/lumiTelemetry.ts",
    description: "产品遥测由应用自有 shim 承载，事件只进入部署方显式配置的 https 端点",
    mustInclude: [
      /resolveTelemetryDeliveryFromConstants/,
      /lumiTelemetrySendCustom/,
      /lumiTelemetrySendEvent/,
    ],
    mustExclude: [/from "@arms\//],
  },
  {
    file: "packages/shared/src/telemetrySourceRuntime.ts",
    description: "遥测启用/端点解析单一来源存在且要求 https",
    mustInclude: [
      /LUMI_TELEMETRY_ENDPOINT_ENV/,
      /export function resolveTelemetryDelivery/,
      /protocol === "https:"/,
    ],
  },
  {
    file: "packages/desktop/package.json",
    description: "闭源 @arms/rum-* 依赖已从生产依赖移除",
    mustExclude: [/@arms\//],
  },
  {
    file: "package.json",
    description: "@arms/rum-electron 的 pnpm 补丁配置已移除",
    mustExclude: [/@arms\//],
  },
  {
    file: "packages/desktop/src/main/appARMSBootstrap.ts",
    description: "遥测引导走 Lumi shim 且 beforeReport 过滤/脱敏管线保留",
    mustInclude: [
      /lumiTelemetryInit/,
      /beforeReport/,
      /redactArmsEventBatch/,
      /filterAndEnrichNativeCrashEvents/,
    ],
    mustExclude: [/from "@arms\//],
  },
  {
    file: "packages/desktop/src/preload/index.ts",
    description: "preload 不再安装 ARMS 桥接转发（无 SDK 注入后是死代码）",
    mustExclude: [
      /installArmsRumBridgeIpcForward/,
      /scheduleArmsEventBridgePatch/,
      /armsRumBridgeForward/,
    ],
  },
  {
    file: "packages/desktop/src/main/desktopStabilityTelemetry.ts",
    description: "稳定性遥测调用点已切换到 Lumi shim",
    mustInclude: [/lumiTelemetrySendCustom/],
    mustExclude: [/from "@arms\//],
  },
  // ── 法务材料可访问 ──
  {
    file: "packages/desktop/src/main/licensesWindow.ts",
    description: "桌面端提供离线许可/声明窗口，并读取随包材料",
    mustInclude: [
      /THIRD-PARTY-NOTICES\.md/,
      /readLegalMaterials/,
      /process\.resourcesPath/,
      /该材料未包含在当前构建中|not included in the current build/,
    ],
  },
  {
    file: "packages/desktop/src/main/about.ts",
    description: "About 面板接入离线许可入口",
    mustInclude: [/showLicensesWindow/, /licensesButtonLabel/, /Lumi Agents/],
    mustExclude: [/关于 ZCode/, /About ZCode/],
  },
];

/**
 * 纯函数求值。IO 注入，便于负向测试。
 * @param {{ readFileSync: (path: string, encoding: string) => string, existsSync: (path: string) => boolean, repoRoot?: string }} io
 * @returns {string[]} 失败信息列表（空数组表示通过）
 */
export function evaluateLumiDrift({ readFileSync, existsSync, repoRoot = "" }) {
  const join = (file) => (repoRoot ? `${repoRoot}/${file}` : file);
  const failures = [];

  for (const expectation of EXPECTATIONS) {
    const absolute = join(expectation.file);
    let content = null;
    if (existsSync(absolute)) {
      try {
        content = readFileSync(absolute, "utf8");
      } catch {
        content = null;
      }
    }

    if (content === null) {
      if (!expectation.allowMissing) {
        failures.push(`${expectation.file}: 文件缺失（${expectation.description}）`);
      }
    } else {
      for (const pattern of expectation.mustInclude ?? []) {
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

    for (const forbidden of expectation.mustNotExist ?? []) {
      if (existsSync(join(forbidden))) {
        failures.push(`${forbidden}: 该上游资产应已删除（${expectation.description}）`);
      }
    }
  }

  return failures;
}
