// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { resolveSpawnRuntimeOptions } from "./spawn-command.mjs";

function parseInlineYamlList(value) {
  const match = /^\[([\s\S]*)\]$/u.exec(value.trim());
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/gu, ""))
    .filter(Boolean);
}

export function parseSupportedArchitectures(text, current = {}) {
  const result = { os: new Set(), cpu: new Set(), libc: new Set() };
  let inSection = false;
  let dimension = null;
  for (const line of text.split(/\r?\n/u)) {
    if (line === "supportedArchitectures:") {
      inSection = true;
      dimension = null;
      continue;
    }
    if (!inSection) continue;
    if (/^\S/u.test(line) && line.trim()) break;
    const header = /^  (os|cpu|libc):\s*$/u.exec(line);
    if (header) {
      dimension = header[1];
      continue;
    }
    const item = /^    -\s+(.+)\s*$/u.exec(line);
    if (!item || !dimension) continue;
    const value = item[1].replace(/^['"]|['"]$/gu, "");
    if (value === "current") {
      if (current[dimension]) result[dimension].add(current[dimension]);
    } else {
      result[dimension].add(value);
    }
  }
  return result;
}

export function parseLockfilePlatformConstraints(text) {
  const constraints = new Map();
  let inPackages = false;
  let currentKey = null;
  for (const line of text.split(/\r?\n/u)) {
    if (line === "packages:") {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^snapshots:\s*$/u.test(line)) break;
    const keyMatch = /^  (.+):\s*$/u.exec(line);
    if (keyMatch) {
      currentKey = keyMatch[1]
        .trim()
        .replace(/^['"]|['"]$/gu, "")
        .replace(/\(.+\)$/u, "");
      if (!constraints.has(currentKey)) constraints.set(currentKey, {});
      continue;
    }
    const property = /^    (os|cpu|libc):\s*(\[[^\]]*\])\s*$/u.exec(line);
    if (property && currentKey) {
      constraints.get(currentKey)[property[1]] = parseInlineYamlList(property[2]);
    }
  }
  return constraints;
}

function currentLibc() {
  if (process.platform !== "linux") return undefined;
  try {
    return process.report?.getReport()?.header?.glibcVersionRuntime ? "glibc" : "musl";
  } catch {
    return undefined;
  }
}

function dimensionCompatible(required, supported) {
  if (!required?.length) return true;
  const positives = required.filter((value) => !value.startsWith("!"));
  const excluded = new Set(
    required.filter((value) => value.startsWith("!")).map((value) => value.slice(1)),
  );
  const candidates = [...supported].filter((value) => !excluded.has(value));
  if (positives.length === 0) return candidates.length > 0;
  return candidates.some((value) => positives.includes(value));
}

export function platformUnsupportedPackageKeys(required, constraints, supported) {
  const unsupported = new Set();
  for (const [key] of required) {
    const rule = constraints.get(key);
    if (!rule) continue;
    if (
      !dimensionCompatible(rule.os, supported.os) ||
      !dimensionCompatible(rule.cpu, supported.cpu) ||
      !dimensionCompatible(rule.libc, supported.libc)
    ) {
      unsupported.add(key);
    }
  }
  return unsupported;
}

const exec = promisify(execFile);
export const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const noticeName =
  /(?:^|[._-])(?:licen[sc]es?|copying|notice|copyright|unlicense|third.party|ofl)(?:[._-]|$)/iu;

export async function readPackageNotices(directory) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (["node_modules", ".git", "test", "tests", "fixtures"].includes(entry.name)) continue;
      // Chromium 聚合许可由打包流程经 resources/licenses/electron 单独分发，不进 npm 通知。
      if (entry.isFile() && entry.name === "LICENSES.chromium.html") continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && noticeName.test(entry.name)) {
        const bytes = await readFile(full);
        if (bytes.includes(0) || bytes.length === 0) continue;
        files.push({ member: relative(directory, full).replaceAll("\\", "/"), bytes });
      } else if (entry.isFile() && /^readme(?:\.[^/]*)?$/iu.test(entry.name)) {
        const text = await readFile(full, "utf8");
        const match = /^(?:#{1,6}\s+licen[sc]e[^\n]*\n|licen[sc]e\s*\n[=-]+\n)/imu.exec(text);
        if (match) {
          const section = text.slice(match.index).split(/\n(?=#{1,6}\s)/u)[0];
          files.push({
            member: `${relative(directory, full).replaceAll("\\", "/")} (license section)`,
            bytes: Buffer.from(section),
          });
        }
      }
    }
  }
  await visit(directory);
  return files.sort((a, b) => a.member.localeCompare(b.member, "en"));
}

function productionPackages(projects) {
  const own = new Set(projects.map((project) => project.name));
  const required = new Map();

  function record(name, version, optional) {
    const key = `${name}@${version}`;
    const previous = required.get(key);
    // A package is optional only when every production path to it is optional.
    // If any mandatory path reaches the same exact package, missing it must fail.
    required.set(key, {
      name,
      version,
      optional: previous ? previous.optional && optional : optional,
    });
  }

  function dependencies(deps, edgeOptional = false, inheritedOptional = false) {
    for (const [alias, info] of Object.entries(deps ?? {})) {
      const name = info.name ?? alias;
      const optional = inheritedOptional || edgeOptional;
      if (!own.has(name) && !name.startsWith("@zcode/") && !info.version.startsWith("link:")) {
        record(name, info.version, optional);
      }
      // Dependencies below an optional parent are also optional because the
      // entire parent subtree may legitimately be absent on this platform.
      dependencies(info.dependencies, false, optional);
      dependencies(info.optionalDependencies, true, optional);
    }
  }

  for (const project of projects) {
    dependencies(project.dependencies);
    dependencies(project.optionalDependencies, true);
  }
  return required;
}

export function assertProductionGraphs(
  lockedProjects,
  installedProjects,
  platformUnsupported = new Set(),
) {
  const locked = productionPackages(lockedProjects);
  const installed = productionPackages(installedProjects);
  for (const [key, item] of locked) {
    if (platformUnsupported.has(key)) item.platformUnsupported = true;
  }
  const missing = [...locked].filter(
    ([key, item]) => !installed.has(key) && !item.optional && !item.platformUnsupported,
  );
  const stale = [...installed.keys()].filter((key) => !locked.has(key));
  if (missing.length || stale.length) {
    throw new Error(
      `Installed production graph differs from pnpm-lock.yaml. Run pnpm install --frozen-lockfile.\nMissing: ${missing.map(([key]) => key).join(", ")}\nStale: ${stale.join(", ")}`,
    );
  }
  return locked;
}

export async function readWorkspaceProductionGraph(root) {
  root = await realpath(root);
  // 修复：pnpm ls 默认读取安装快照，不能把旧图与当前锁文件哈希拼成有效声明。
  const [locked, actual] = await Promise.all(
    [true, false].map(async (lockfileOnly) => {
      const { stdout } = await exec(
        "pnpm",
        [
          "-r",
          "ls",
          "--prod",
          "--json",
          "--depth",
          "Infinity",
          ...(lockfileOnly ? ["--lockfile-only"] : []),
        ],
        {
          cwd: root,
          maxBuffer: 256 * 1024 * 1024,
          ...resolveSpawnRuntimeOptions("pnpm"),
        },
      );
      return JSON.parse(stdout);
    }),
  );
  // pnpm ls can flatten optional native subtrees and lose the optional edge on
  // platform-specific grandchildren. Use the repository's declared target matrix
  // plus lockfile os/cpu/libc constraints to identify packages that cannot ship on
  // any supported target. This is evidence-based and avoids package-name allowlists.
  const [workspaceText, lockfileText] = await Promise.all([
    readFile(join(root, "pnpm-workspace.yaml"), "utf8"),
    readFile(join(root, "pnpm-lock.yaml"), "utf8"),
  ]);
  const supported = parseSupportedArchitectures(workspaceText, {
    os: process.platform,
    cpu: process.arch,
    libc: currentLibc(),
  });
  const constraints = parseLockfilePlatformConstraints(lockfileText);
  const lockedGraph = productionPackages(locked);
  const unsupported = platformUnsupportedPackageKeys(lockedGraph, constraints, supported);
  const required = assertProductionGraphs(locked, actual, unsupported);
  return { required, projects: actual };
}

export async function scanInstalledPackages(root, projects) {
  // pnpm hoisted 布局的 ls.path 仍可能指向不存在的 .pnpm 路径；按真实安装目录和精确版本匹配。
  const installed = new Map();
  const visited = new Set();
  async function scanNodeModules(directory) {
    let actual;
    try {
      actual = await realpath(directory);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (visited.has(actual)) return;
    visited.add(actual);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.name.startsWith("@")) {
        for (const scoped of await readdir(path)) await scanPackage(join(path, scoped));
      } else await scanPackage(path);
    }
  }
  async function scanPackage(directory) {
    let pkg;
    try {
      pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) return;
      throw error;
    }
    if (pkg.name && pkg.version) installed.set(`${pkg.name}@${pkg.version}`, { pkg, directory });
    await scanNodeModules(join(directory, "node_modules"));
  }
  for (const project of projects) await scanNodeModules(join(project.path, "node_modules"));
  await scanNodeModules(join(root, "node_modules"));
  await scanNodeModules(join(root, "apps/zcode-cli/node_modules"));
  return installed;
}

export function missingProductionPackages(required, installed) {
  const missing = [...required].filter(([key]) => !installed.has(key)).map(([, item]) => item);
  const blocking = missing.filter((item) => !item.optional && !item.platformUnsupported);
  if (blocking.length) {
    throw new Error(
      `Missing installed production dependencies: ${blocking
        .map((item) => `${item.name}@${item.version}`)
        .join(", ")}`,
    );
  }
  return missing;
}

export function assertNoticeInventoryProductionSet(manifest, required, installed) {
  const inventorySet = new Set(
    (manifest.packages ?? []).map((item) => `${item.name}@${item.version}`),
  );
  const installedSet = new Set([...installed.keys()].filter((key) => required.has(key)));
  const missing = [...installedSet].filter((key) => !inventorySet.has(key)).sort();
  // 跨平台声明是生产并集：macOS 上安装的 musl 包在 glibc CI 中可缺席，
  // 但清单不能遗漏当前实际安装的包，也不能混入锁文件以外的包。
  const stale = [...inventorySet]
    .filter((key) => {
      if (installedSet.has(key)) return false;
      const item = required.get(key);
      return !item || (!item.optional && !item.platformUnsupported);
    })
    .sort();
  if (missing.length || stale.length) {
    throw new Error(
      "Third-party production package set changed. Run node scripts/licenses.mjs notices." +
        `\nMissing from inventory: ${missing.join(", ")}` +
        `\nStale in inventory: ${stale.join(", ")}`,
    );
  }
}

export async function collectNpmNotices(root, overrides) {
  root = await realpath(root);
  const { required, projects } = await readWorkspaceProductionGraph(root);
  // 修复：标识门禁和声明生成必须扫描同一安装集合，避免嵌套版本只进声明、不进门禁。
  const installed = await scanInstalledPackages(root, projects);
  const packages = [];
  const missing = [];
  const notInstalled = missingProductionPackages(required, installed);
  for (const [key, item] of [...required].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const installedPackage = installed.get(key);
    if (!installedPackage) {
      continue;
    }
    const { pkg, directory } = installedPackage;
    const notices = await readPackageNotices(directory);
    const override = overrides.find((record) => record.package === key);
    if (override?.file) {
      const bytes = await readFile(join(root, override.file));
      if (hashBytes(bytes) !== override.sha256) throw new Error(`Changed upstream notice: ${key}`);
      notices.push({ member: override.source, bytes });
    }
    // README 中仅有 MIT 等标签不能冒充完整许可文件；这种包仍需要版本固定的补充材料。
    if (
      !notices.some(({ member }) => !member.endsWith(" (license section)")) &&
      !override?.acceptedMissingNotice
    )
      missing.push(key);
    packages.push({
      ...item,
      license:
        pkg.license ??
        pkg.licenses?.map((item) => (typeof item === "string" ? item : item.type)).join(" OR ") ??
        override?.license ??
        "(not declared)",
      repository: typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url,
      ...(override?.acceptedMissingNotice
        ? { acceptedMissingNotice: override.acceptedMissingNotice }
        : {}),
      notices,
    });
  }
  if (missing.length) throw new Error(`Missing complete upstream notices:\n${missing.join("\n")}`);
  return {
    packages,
    notInstalled,
    workspaceManifests: projects.map((project) =>
      relative(root, join(project.path, "package.json")).replaceAll("\\", "/"),
    ),
  };
}
