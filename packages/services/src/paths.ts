// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
/* path 规则集中维护：旧 task 快照与 provider 配置路径仍在这里收口。 */
import { lstatSync } from "node:fs";
import { cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, win32 } from "node:path";
import { homedir } from "node:os";
import {
  DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE,
  ZCODE_AGENT_RUNTIME,
} from "@zcode/shared";

let _dataBaseDir: string | null = null;
export const ZCODE_WINDOWS_APP_INSTALL_DIR_ENV = "ZCODE_WINDOWS_APP_INSTALL_DIR";
const envDataBaseDir = process.env.ZCODE_DATA_BASE_DIR?.trim() || null;
const defaultDataBaseDir = process.env.HOME?.trim() || homedir();

export interface DataBaseDirTargetValidationOptions {
  platform?: NodeJS.Platform | string;
  env?: Record<string, string | undefined>;
  appInstallDir?: string | null;
}

export type DataBaseDirTargetValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE;
      forbiddenDir: string;
    };

/** Set the base directory for app data (replaces homedir() prefix). */
export function setDataBaseDir(dir: string | null): void {
  _dataBaseDir = dir?.trim() || null;
}

/** Get the current base directory. Priority: setDataBaseDir() > env ZCODE_DATA_BASE_DIR > homedir(). */
export function getDataBaseDir(): string {
  if (_dataBaseDir) return _dataBaseDir;
  if (envDataBaseDir) return envDataBaseDir;
  // 服务实例会启动后台刷新任务；若每次调用都动态读取 HOME，
  // 测试或宿主切换环境变量后，旧实例可能把数据写到新实例目录。
  return defaultDataBaseDir;
}

type BootstrapEnv = Readonly<Record<string, string | undefined>>;

/** 调用方显式配置的数据根（ZCODE_DATA_BASE_DIR）；未配置返回 null。 */
function readExplicitDataBaseDir(env: BootstrapEnv): string | null {
  return env.ZCODE_DATA_BASE_DIR?.trim() || null;
}

/**
 * bootstrap 设置（setting.json）所在的 home。
 * 显式 ZCODE_DATA_BASE_DIR 的实例拥有自己的状态根，bootstrap 不得再读取 OS home 里的设置，
 * 否则 OS home 的 dataBaseDir 会把显式根改写到别处。未显式配置时保持安装版行为：
 * ZCODE_DESKTOP_HOME_DIR > HOME > USERPROFILE > homedir()。
 * 仅解析路径，不改变 Main 自身的 HOME（原生 keychain 依赖它）。
 */
export function getBootstrapHomeDir(env: BootstrapEnv = process.env): string {
  return (
    readExplicitDataBaseDir(env) ||
    env.ZCODE_DESKTOP_HOME_DIR?.trim() ||
    env.HOME?.trim() ||
    env.USERPROFILE?.trim() ||
    homedir()
  );
}

/** {bootstrapHome}/.zcode/v2/setting.json：early bootstrap、硬件加速、启动工作区与 SettingService 共用。 */
export function getBootstrapSettingsFile(env: BootstrapEnv = process.env): string {
  return join(getBootstrapHomeDir(env), ".zcode", "v2", "setting.json");
}

/**
 * 应用 setting.json 里的自定义数据根。显式 ZCODE_DATA_BASE_DIR 优先，
 * 此时忽略设置值并返回 false，保证配置根在 early bootstrap 与 whenReady 之后都不被改写。
 */
export function applyConfiguredDataBaseDir(
  dir: string | null | undefined,
  env: BootstrapEnv = process.env,
): boolean {
  if (readExplicitDataBaseDir(env)) return false;
  const trimmed = dir?.trim();
  if (!trimmed) return false;
  setDataBaseDir(trimmed);
  return true;
}

/** {dataBaseDir}/.zcode */
export function getZCodeDataRootDir(): string {
  return join(getDataBaseDir(), ".zcode");
}

/** 非项目对话共享的真实工作目录；默认 ~/.zcode/workspace/default。 */
export function getConversationWorkspaceDir(): string {
  return join(getZCodeDataRootDir(), "workspace", "default");
}

/** {dataBaseDir}/.zcode/v2 */
export function getAppConfigDir(): string {
  return join(getZCodeDataRootDir(), "v2");
}

function readEnvValue(env: Record<string, string | undefined>, key: string): string | undefined {
  const direct = env[key]?.trim();
  if (direct) {
    return direct;
  }

  const lowerKey = key.toLowerCase();
  for (const [candidateKey, value] of Object.entries(env)) {
    if (candidateKey.toLowerCase() !== lowerKey) {
      continue;
    }
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function normalizeWindowsComparablePath(pathValue: string): string | null {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = win32.normalize(trimmed).replace(/[\\/]+$/, "");
  if (!normalized) {
    return null;
  }

  return win32
    .resolve(normalized)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function isWindowsPathEqualOrInside(pathValue: string, rootValue: string): boolean {
  const normalizedPath = normalizeWindowsComparablePath(pathValue);
  const normalizedRoot = normalizeWindowsComparablePath(rootValue);
  if (!normalizedPath || !normalizedRoot) {
    return false;
  }

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`);
}

function collectWindowsForbiddenAppInstallDirs(
  options: Required<Pick<DataBaseDirTargetValidationOptions, "env">> &
    Pick<DataBaseDirTargetValidationOptions, "appInstallDir">,
): string[] {
  const env = options.env;
  const programFiles = readEnvValue(env, "ProgramFiles");
  const programFilesX86 = readEnvValue(env, "ProgramFiles(x86)");
  const programW6432 = readEnvValue(env, "ProgramW6432");
  const localAppData = readEnvValue(env, "LOCALAPPDATA");
  const candidates = [
    options.appInstallDir,
    readEnvValue(env, ZCODE_WINDOWS_APP_INSTALL_DIR_ENV),
    programFiles ? win32.join(programFiles, "ZCode") : null,
    programFilesX86 ? win32.join(programFilesX86, "ZCode") : null,
    programW6432 ? win32.join(programW6432, "ZCode") : null,
    localAppData ? win32.join(localAppData, "Programs", "ZCode") : null,
  ];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    const normalized =
      typeof candidate === "string" ? normalizeWindowsComparablePath(candidate) : null;
    if (!candidate || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(candidate);
  }

  return result;
}

export function validateDataBaseDirTarget(
  targetBaseDir: string,
  options: DataBaseDirTargetValidationOptions = {},
): DataBaseDirTargetValidationResult {
  if ((options.platform ?? process.platform) !== "win32") {
    return { ok: true };
  }

  for (const forbiddenDir of collectWindowsForbiddenAppInstallDirs({
    env: options.env ?? process.env,
    appInstallDir: options.appInstallDir ?? null,
  })) {
    if (isWindowsPathEqualOrInside(targetBaseDir, forbiddenDir)) {
      return {
        ok: false,
        code: DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE,
        forbiddenDir,
      };
    }
  }

  return { ok: true };
}

export function getExportLogStageDir(): string {
  return join(getZCodeDataRootDir(), "export-log-stage");
}

export function getExportLogDir(): string {
  return join(getZCodeDataRootDir(), "export-log");
}

export function getFeedbackRootDir(): string {
  return join(getZCodeDataRootDir(), "feedback");
}

export function getFeedbackAttachmentDir(): string {
  return join(getFeedbackRootDir(), "attachments");
}

export function getFeedbackLogArchiveDir(): string {
  return join(getFeedbackRootDir(), "logs");
}

export function getGitCheckpointIndexRootDir(): string {
  return join(getZCodeDataRootDir(), "git-checkpoint-index");
}

/** ~/.zcode/v2/tasks-index.sqlite */
export function getTasksIndexDatabasePath(): string {
  return join(getAppConfigDir(), "tasks-index.sqlite");
}

/** workspace 级身份键：远程优先使用 workspaceIdentity，本地回退 workspacePath。 */
function getWorkspaceKey(workspacePath: string, workspaceIdentity?: string): string {
  return workspaceIdentity?.trim() || workspacePath;
}

/** 与 ZCode session 持久化一致：使用 workspaceKey 的 SHA-256 前 12 位 */
export function getWorkspaceHash(workspacePath: string, workspaceIdentity?: string): string {
  return createHash("sha256")
    .update(getWorkspaceKey(workspacePath, workspaceIdentity))
    .digest("hex")
    .slice(0, 12);
}

/** ~/.zcode/v2/sessions/{workspaceHash} */
function getTaskSessionDir(workspacePath: string, workspaceIdentity?: string): string {
  return join(getAppConfigDir(), "sessions", getWorkspaceHash(workspacePath, workspaceIdentity));
}

/** ~/.zcode/v2/sessions/{workspaceHash}/{taskId}.json */
export function getLegacyTaskSessionSnapshotPath(
  workspacePath: string,
  taskId: string,
  workspaceIdentity?: string,
): string {
  return join(getTaskSessionDir(workspacePath, workspaceIdentity), `${taskId}.json`);
}

/** ~/.zcode/v2/sessions/{workspaceHash}/{taskId}.deleted.json */
export function getLegacyDeletedTaskSessionSnapshotPath(
  workspacePath: string,
  taskId: string,
  workspaceIdentity?: string,
): string {
  return join(getTaskSessionDir(workspacePath, workspaceIdentity), `${taskId}.deleted.json`);
}

/**
 * GLM（唯一 agent provider）的配置目录：~/.zcode/cli。
 * Bugfix：GLM 配置改为直接读写新版 zcode-cli 的全局配置目录，不做 workspace 隔离，
 * 避免同机不同工作区配置漂移。
 */
export function getProviderWorkspaceConfigDir(): string {
  return ZCODE_AGENT_RUNTIME.nativeConfigDir
    ? join(getDataBaseDir(), ZCODE_AGENT_RUNTIME.nativeConfigDir)
    : join(getDataBaseDir(), ".zcode", "cli");
}

/**
 * Copy the .zcode/v2 data directory from one base dir to another.
 * Excludes setting.json and its transient atomic-write siblings — bootstrap
 * state must only live at the default homedir location.
 */
export async function copyDataDirectory(oldBaseDir: string, newBaseDir: string): Promise<void> {
  const oldDir = join(oldBaseDir, ".zcode", "v2");
  const newDir = join(newBaseDir, ".zcode", "v2");
  await cp(oldDir, newDir, {
    recursive: true,
    force: false,
    filter: (source) => {
      const sourceName = basename(source);
      if (sourceName === "setting.json" || sourceName.startsWith("setting.json.")) {
        // setting.json.lock 和 setting.json.*.tmp 由原子写入短暂创建/删除，
        // 复制过程中扫描到已消失的 lock 会触发 ENOENT，并让数据目录迁移失败。
        // 这些文件都属于 bootstrap 写入中间态，不能迁移到新数据根。
        return false;
      }
      // Windows 非提权环境下 fs.cp 无法复制符号链接（EPERM）。
      // 跳过符号链接可避免 Windows 非提权环境下 fs.cp 报 EPERM。
      try {
        if (lstatSync(source).isSymbolicLink()) return false;
      } catch {
        // lstat 失败时放行，让 cp 自行处理
      }
      return true;
    },
  });
}
