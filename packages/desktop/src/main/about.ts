// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
import type { BrowserWindow, MessageBoxReturnValue } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { arch, hostname, platform, release, type, version as osVersion } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LOCALE,
  type Locale,
  ZCODE_BUILD_TIME,
  ZCODE_COMMIT,
  ZCODE_ENV,
  ZCODE_VERSION,
} from "@zcode/shared";
import { createCustomAboutDialogHtml } from "./aboutWindow.js";
import { showLicensesWindow } from "./licensesWindow.js";

interface DesktopBuildMetadata {
  appVersion?: string;
  buildCommitId?: string;
  buildTime?: string;
  electronBuilderVersion?: string;
}

interface AboutSnapshot {
  appVersion: string;
  buildCommitId: string;
  buildTime: string;
  environment: string;
  electronVersion: string;
  electronBuilderVersion: string;
  chromiumVersion: string;
  nodeVersion: string;
  v8Version: string;
  osType: string;
  osPlatform: string;
  osRelease: string;
  osVersion: string;
  osArch: string;
  hostname: string;
}

interface AboutSnapshotOptions {
  appVersion?: string;
  buildMetadata?: DesktopBuildMetadata | null;
  environment?: string;
  runtimeVersions?: Pick<NodeJS.ProcessVersions, "electron" | "chrome" | "node" | "v8">;
  osInfo?: {
    type: string;
    platform: string;
    release: string;
    version: string;
    arch: string;
    hostname: string;
  };
}

// 修改原因：About 面板是用户可见的产品身份面，必须显示 Lumi Agents，而不是上游 ZCode。
// 内部标识（@zcode/*、ZCODE_*、zcode:// scheme）不受影响，见 docs/upstream/FORK-DIFFERENCES.md。
const ABOUT_APPLICATION_NAME = "Lumi Agents";
// 自定义 About 内容本体是 256x280；原生窗口如果同尺寸会让内容贴满透明窗口边界。
// 这里给 BrowserWindow 额外留出背景呼吸空间，避免正式 About 看起来比 demo 更局促。
const ABOUT_WINDOW_WIDTH = 256;
const ABOUT_WINDOW_HEIGHT = 312;
const ABOUT_MESSAGES: Record<
  Locale,
  {
    aboutTitle: string;
    versionLabel: string;
    okButtonLabel: string;
    optimizedForAppleSilicon: string;
    copyright: (year: number) => string;
    /** 离线许可入口文案；见 packages/desktop/src/main/licensesWindow.ts。 */
    licensesButtonLabel: string;
  }
> = {
  "zh-CN": {
    aboutTitle: "关于 Lumi Agents",
    versionLabel: "版本",
    okButtonLabel: "确定",
    optimizedForAppleSilicon: "已针对 Apple Silicon 优化。",
    licensesButtonLabel: "开源许可",
    // 版权属上游权利人（LICENSE 的 “Copyright 2026 Z.AI Co., Ltd”）；
    // 这里只陈述分支关系，不新增或转移著作权声明。
    copyright: (year) => `版权所有 © ${year} Z.AI Co., Ltd — Lumi Agents 为独立维护分支。`,
  },
  "en-US": {
    aboutTitle: "About Lumi Agents",
    versionLabel: "version",
    okButtonLabel: "OK",
    optimizedForAppleSilicon: "Optimized for Apple Silicon.",
    licensesButtonLabel: "Licenses",
    // Upstream holds the copyright (LICENSE: “Copyright 2026 Z.AI Co., Ltd”).
    // This line states the fork relationship only; it adds no new ownership claim.
    copyright: (year) => `Copyright © ${year} Z.AI Co., Ltd — Lumi Agents independent fork.`,
  },
};

function normalizeValue(value: string | undefined | null): string {
  if (typeof value !== "string") {
    return "unknown";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

function normalizePackageVersion(version: string | undefined): string {
  const normalized = normalizeValue(version);
  return normalized === "unknown" ? normalized : normalized.replace(/^[^\d]*/, "") || normalized;
}

function getAboutMessages(locale: Locale): (typeof ABOUT_MESSAGES)[Locale] {
  return ABOUT_MESSAGES[locale] ?? ABOUT_MESSAGES[DEFAULT_LOCALE];
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function resolveBuildMetadataPath(): string {
  return join(import.meta.dirname, "../metadata/build-meta.json");
}

export function readBuildMetadata(
  filePath = resolveBuildMetadataPath(),
): DesktopBuildMetadata | null {
  // 之前 About 直接读取编译时注入的常量，commit/time 只能代表 tsup 那一刻。
  // 问题原因：构建和打包是分步执行的，安装包里的 about 需要的是“最终产物”的统一元数据，而不是某个编译子步骤的快照。
  // 这里优先读打包前生成的 build-meta.json；只有缺文件时才回退到编译时常量。
  return readJsonFile<DesktopBuildMetadata>(filePath);
}

function resolveElectronBuilderVersion(buildMetadata: DesktopBuildMetadata | null): string {
  if (buildMetadata?.electronBuilderVersion) {
    return normalizeValue(buildMetadata.electronBuilderVersion);
  }

  const packageJson = readJsonFile<{ devDependencies?: Record<string, string> }>(
    join(import.meta.dirname, "../../package.json"),
  );
  return normalizePackageVersion(packageJson?.devDependencies?.["electron-builder"]);
}

export function createAboutSnapshot(options: AboutSnapshotOptions = {}): AboutSnapshot {
  const buildMetadata = options.buildMetadata ?? null;
  const runtimeVersions = options.runtimeVersions ?? process.versions;
  const osInfo = options.osInfo ?? {
    type: type(),
    platform: platform(),
    release: release(),
    version: osVersion(),
    arch: arch(),
    hostname: hostname(),
  };

  return {
    appVersion: normalizeValue(options.appVersion ?? buildMetadata?.appVersion ?? ZCODE_VERSION),
    buildCommitId: normalizeValue(buildMetadata?.buildCommitId ?? ZCODE_COMMIT),
    buildTime: normalizeValue(buildMetadata?.buildTime ?? ZCODE_BUILD_TIME),
    environment: normalizeValue(options.environment ?? ZCODE_ENV),
    electronVersion: normalizeValue(runtimeVersions.electron),
    electronBuilderVersion: resolveElectronBuilderVersion(buildMetadata),
    chromiumVersion: normalizeValue(runtimeVersions.chrome),
    nodeVersion: normalizeValue(runtimeVersions.node),
    v8Version: normalizeValue(runtimeVersions.v8),
    osType: normalizeValue(osInfo.type),
    osPlatform: normalizeValue(osInfo.platform),
    osRelease: normalizeValue(osInfo.release),
    osVersion: normalizeValue(osInfo.version),
    osArch: normalizeValue(osInfo.arch),
    hostname: normalizeValue(osInfo.hostname),
  };
}

export function formatAboutDetail(snapshot: AboutSnapshot): string {
  return [
    `Version: ${snapshot.appVersion}`,
    `Commit: ${snapshot.buildCommitId}`,
    `Build Time: ${snapshot.buildTime}`,
    `Environment: ${snapshot.environment}`,
    "",
    `Electron: ${snapshot.electronVersion}`,
    `Electron Builder: ${snapshot.electronBuilderVersion}`,
    `Chromium: ${snapshot.chromiumVersion}`,
    `Node.js: ${snapshot.nodeVersion}`,
    `V8: ${snapshot.v8Version}`,
    "",
    `OS Type: ${snapshot.osType}`,
    `OS Platform: ${snapshot.osPlatform}`,
    `OS Release: ${snapshot.osRelease}`,
    `OS Version: ${snapshot.osVersion}`,
    `OS Arch: ${snapshot.osArch}`,
    `Hostname: ${snapshot.hostname}`,
  ].join("\n");
}

function formatAboutCopyright(
  year = new Date().getFullYear(),
  locale: Locale = DEFAULT_LOCALE,
): string {
  return getAboutMessages(locale).copyright(year);
}

function formatAboutOptimizationLine(
  snapshot: Pick<AboutSnapshot, "osPlatform" | "osArch">,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (snapshot.osPlatform === "darwin" && snapshot.osArch === "arm64") {
    return getAboutMessages(locale).optimizedForAppleSilicon;
  }

  return "";
}

function resolveAboutIconPath(isPackaged: boolean): string {
  return isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(import.meta.dirname, "../../build/icon.png");
}

export async function showAboutDialog(
  parentWindow?: BrowserWindow,
  locale: Locale = DEFAULT_LOCALE,
): Promise<MessageBoxReturnValue> {
  const { app, BrowserWindow } = await import("electron");
  const snapshot = createAboutSnapshot({
    appVersion: app.getVersion(),
    buildMetadata: readBuildMetadata(),
  });
  const aboutMessages = getAboutMessages(locale);
  // 之前只有 macOS 使用自绘 About，Windows/Linux 仍走原生 message box。
  // 问题原因：各平台原生消息框的排版、图标和按钮样式差异很大，无法复用 macOS 参考样式。
  // 这里统一使用自绘 modal，保证 About 的品牌展示和多语言文案在三端一致。
  const iconPath = resolveAboutIconPath(app.isPackaged);
  const aboutWindow = new BrowserWindow({
    width: ABOUT_WINDOW_WIDTH,
    height: ABOUT_WINDOW_HEIGHT,
    parent: parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined,
    modal: Boolean(parentWindow && !parentWindow.isDestroyed()),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: aboutMessages.aboutTitle,
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  aboutWindow.setMenuBarVisibility(false);
  // 自绘 About 是 sandbox + contextIsolation + 无 preload 的纯 data: 页面，
  // 因此“开源许可”按钮走 window.open，由主进程在这里接管并打开离线许可窗口。
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("zcode-about://licenses")) {
      void showLicensesWindow(aboutWindow, locale, ABOUT_APPLICATION_NAME);
    }
    return { action: "deny" };
  });
  aboutWindow.once("ready-to-show", () => {
    aboutWindow.show();
  });
  void aboutWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      createCustomAboutDialogHtml({
        applicationName: ABOUT_APPLICATION_NAME,
        appVersion: snapshot.appVersion,
        copyright: formatAboutCopyright(undefined, locale),
        optimizationLine: formatAboutOptimizationLine(snapshot, locale),
        versionLabel: aboutMessages.versionLabel,
        okButtonLabel: aboutMessages.okButtonLabel,
        licensesButtonLabel: aboutMessages.licensesButtonLabel,
      }),
    )}`,
  );
  return { response: 0, checkboxChecked: false };
}
