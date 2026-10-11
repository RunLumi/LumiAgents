// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
// 上游 v3.15.1 的锁文件平台过滤工具。Lumi 的声明生成仍按 platformUnsupported 记录（见 third-party-npm.mjs），
// 这些工具从 third-party-npm.mjs 重新导出，供上游回归测试与按需过滤使用。
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// 解析锁文件（v9）packages 段的平台约束：`  'name@version':` 下的 `    os/cpu/libc: [..]` 行。
export function readLockfilePlatformConstraints(lockfileText) {
  const constraints = new Map();
  let inPackages = false;
  let key = null;
  for (const line of lockfileText.split(/\r?\n/u)) {
    if (/^\S/u.test(line)) {
      inPackages = line === "packages:";
      key = null;
      continue;
    }
    if (!inPackages) continue;
    const header = /^ {2}(?:'([^']+)'|([^\s'][^:]*)):$/u.exec(line);
    if (header) {
      key = header[1] ?? header[2];
      continue;
    }
    const field = key && /^ {4}(os|cpu|libc): \[(.*)\]$/u.exec(line);
    if (field) {
      const values = field[2]
        .split(",")
        .map((value) => value.trim().replace(/^'(.*)'$/u, "$1"))
        .filter(Boolean);
      constraints.set(key, { ...constraints.get(key), [field[1]]: values });
    }
  }
  return constraints;
}

// 照搬 pnpm package-is-installable 的 checkList，保证与实际安装结果一致（含否定项语义）。
function pnpmCheckList(values, list) {
  if (list.length === 1 && list[0] === "any") return true;
  let match = false;
  let blc = 0;
  for (const value of values) {
    for (const item of list) {
      if (item[0] === "!") {
        if (item.slice(1) === value) return false;
        ++blc;
      } else {
        match = match || item === value;
      }
    }
  }
  return match || blc === list.length;
}

// targets.libc 为 null 表示宿主 libc 未知（非 Linux），pnpm 此时不检查 libc。
export function createInstallablePackageFilter(constraints, targets) {
  return (name, version) => {
    const wanted = constraints.get(`${name}@${version.split("(")[0]}`);
    if (!wanted) return true;
    if (wanted.os && !pnpmCheckList(targets.os, wanted.os)) return false;
    if (wanted.cpu && !pnpmCheckList(targets.cpu, wanted.cpu)) return false;
    if (wanted.libc && targets.libc && !pnpmCheckList(targets.libc, wanted.libc)) return false;
    return true;
  };
}

function hostLibc() {
  if (process.platform !== "linux") return null;
  return process.report?.getReport?.()?.header?.glibcVersionRuntime ? "glibc" : "musl";
}

// 与 pnpm checkPlatform 相同：supportedArchitectures 未配置时只取宿主，`current` 替换为宿主值。
export async function readInstallTargets(root) {
  const { parse } = await import("yaml");
  const workspace = parse(await readFile(join(root, "pnpm-workspace.yaml"), "utf8")) ?? {};
  const supported = workspace.supportedArchitectures ?? {};
  const resolveCurrent = (list, current) =>
    (list ?? ["current"]).map((value) => (value === "current" ? current : value));
  const libc = hostLibc();
  return {
    os: resolveCurrent(supported.os, process.platform),
    cpu: resolveCurrent(supported.cpu, process.arch),
    libc: libc ? resolveCurrent(supported.libc, libc) : null,
  };
}
