import { existsSync, readFileSync } from "node:fs";
import { applyConfiguredDataBaseDir, getBootstrapSettingsFile } from "@zcode/services/node";

function extractBootstrapDataBaseDir(rawValue: unknown): string | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const dataBaseDir = (rawValue as { dataBaseDir?: unknown }).dataBaseDir;
  if (typeof dataBaseDir !== "string") {
    return null;
  }

  const trimmed = dataBaseDir.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBootstrapDataBaseDirFromDisk(
  settingsFile: string = getBootstrapSettingsFile(),
): string | null {
  if (!existsSync(settingsFile)) {
    return null;
  }

  try {
    const raw = readFileSync(settingsFile, "utf-8");
    return extractBootstrapDataBaseDir(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function applyEarlyDataBaseDirBootstrap(
  settingsFile?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const dataBaseDir = readBootstrapDataBaseDirFromDisk(settingsFile ?? getBootstrapSettingsFile(env));
  // 启动早期就把 dataBaseDir 注入进来，避免 logger / crashReporter 先按默认 HOME 建目录，
  // 导致后续再切换到自定义目录时，日志和 crash dump 落在两套路径里。
  // 显式 ZCODE_DATA_BASE_DIR 优先：此时设置值被忽略，返回 null 表示未改写数据根。
  return applyConfiguredDataBaseDir(dataBaseDir, env) ? dataBaseDir : null;
}
