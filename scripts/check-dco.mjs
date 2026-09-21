#!/usr/bin/env node
// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
/**
 * DCO (Developer Certificate of Origin 1.1) check for Lumi Agents.
 *
 * 政策：公共贡献走 DCO + Apache-2.0（见 CONTRIBUTING.md 与 ADR 0001）。
 * 本检查只做**溯源**：每个提交的作者必须出现在该提交的 Signed-off-by 列表中
 * （与 GitHub 官方 DCO App 同口径；rebase 后由 committer 额外自签是有效形态之一，
 * 但**作者**本人的签名永远必需）。
 *
 * 边界（刻意设计，防止两类作弊）：
 * - **不代签**：本脚本绝不添加、修补或"纠正"任何 Signed-off-by；缺失的人证就是
 *   阻塞项，如实在报错中列出。维护者不得在作者未认证的情况下补签——那等于伪造
 *   证据，本脚本的存在就是为了防这个。
 * - **导入例外收口**：upstream 导入历史（Lumi 分叉之前）没有 DCO 是已知事实，
 *   但不伪造历史签名。检查区间永远是 `<base>..<head>`（或显式 range），base 及
 *   其祖先天然不在区间内；例外只覆盖已记录的导入基线
 *   （872ad960de7ec172591f7e1952f7849229f94521，见 COMPLIANCE.md §2），绝不后移。
 * - **邮箱一致性**：sign-off 邮箱与作者邮箱按 GitHub noreply 规则归一后必须一致，
 *   防止拿别人的名字凑签名。
 *
 * 用法：
 *   node scripts/check-dco.mjs --base <import-base-sha>
 *   node scripts/check-dco.mjs origin/main..HEAD
 * CI（PR 场景）：node scripts/check-dco.mjs origin/${{ base }}..HEAD
 */
import { execFileSync } from "node:child_process";

const DCO_MARKER = "Signed-off-by:";
/** 已记录的上游导入基线（Lumi 分叉点）。见 docs/licensing/COMPLIANCE.md §2。 */
export const KNOWN_IMPORT_BASES = ["872ad960de7ec172591f7e1952f7849229f94521"];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** 归一化邮箱：小写 + 折叠 GitHub noreply 的数字前缀形态。 */
export function normalizeEmail(value) {
  const v = (value ?? "").trim().toLowerCase();
  const noreply = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/;
  const m = noreply.exec(v);
  return m ? `${m[1]}@users.noreply.github.com` : v;
}

/** 从提交正文提取全部 Signed-off-by 邮箱（归一化后）。 */
export function extractSignOffEmails(body) {
  return (body ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(DCO_MARKER))
    .map((line) => line.slice(DCO_MARKER.length).trim())
    .map((rest) => {
      // "Name <mail>" 与裸 "mail" 两种形态都接受；提取 <> 内地址或整段。
      const bracket = /<([^>]+)>/.exec(rest);
      return normalizeEmail(bracket ? bracket[1] : rest);
    })
    .filter((email) => email.includes("@"));
}

/**
 * 纯函数判定：commits 是 {hash, authorEmail, body} 列表，exemptHashes 是豁免的
 * 提交哈希集合（导入基线祖先）。返回失败列表（空 = 通过）。
 */
export function evaluateDco({ commits, exemptHashes = new Set() }) {
  const failures = [];
  for (const commit of commits) {
    if (exemptHashes.has(commit.hash)) continue;
    const author = normalizeEmail(commit.authorEmail);
    const signOffs = extractSignOffEmails(commit.body);
    if (!signOffs.includes(author)) {
      failures.push({
        hash: commit.hash,
        reason: signOffs.length
          ? `Signed-off-by 存在但不含作者 <${commit.authorEmail}>`
          : `缺少 Signed-off-by（作者 <${commit.authorEmail}>）`,
      });
    }
  }
  return failures;
}

function listCommits(range) {
  const out = git(["log", "--no-merges", "--pretty=format:%H%x00%ae%x00%b%x01", range]);
  return out
    .split("\u0001")
    .map((record) => record.replace(/\n$/, ""))
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [hash, authorEmail, body] = record.split("\u0000");
      // git log 每条记录后补一个换行；%b 末尾的换行才是正文的一部分。
      // 处理：正文里的独立换行保留，仅去掉 split 时挂在 hash 前的换行。
      return { hash: hash.trim(), authorEmail, body: body ?? "" };
      // 记录 1..n 的 hash 前带一个 git 补的 "\n"（每条记录一条），trim 掉即可；
      // 最后一条空记录（%x01 结尾无内容）已由 filter 丢弃。
    });
}

function main() {
  const argv = process.argv.slice(2);
  let range = null;
  const baseFlag = argv.indexOf("--base");
  if (baseFlag !== -1 && argv[baseFlag + 1]) {
    const base = argv[baseFlag + 1];
    if (!KNOWN_IMPORT_BASES.includes(base)) {
      console.error(
        `[dco] --base 必须是已记录的导入基线之一：\n  ${KNOWN_IMPORT_BASES.join("\n  ")}\n` +
          "例外不得扩大到未记录的提交；如需新基线，先更新 COMPLIANCE.md 并提交依据。",
      );
      process.exit(2);
    }
    range = `${base}..HEAD`;
  } else {
    range = argv.find((arg) => arg.includes(".."));
  }
  if (!range) {
    console.error(
      "[dco] 用法: node scripts/check-dco.mjs --base <import-base-sha> | <range>\n" +
        "  例: node scripts/check-dco.mjs --base 872ad960de7ec172591f7e1952f7849229f94521\n" +
        "  例: node scripts/check-dco.mjs origin/main..HEAD",
    );
    process.exit(2);
  }
  const commits = listCommits(range);
  // 导入例外：显式 --base 时豁免 base 自身（不在区间内，无需处理祖先）。
  const exemptHashes = new Set();
  const failures = evaluateDco({ commits, exemptHashes });
  if (failures.length > 0) {
    console.error(
      `[dco] ${failures.length} 个提交缺少有效 DCO 签名（DCO 1.1，见 CONTRIBUTING.md）：`,
    );
    for (const failure of failures) {
      console.error(`  - ${failure.hash.slice(0, 10)}: ${failure.reason}`);
    }
    console.error(
      "\n处理：git commit --amend -s（或 rebase 每个提交 -s）后重推；" +
        "DCO 是溯源认证，不是版权转让，维护者不会代签。",
    );
    process.exit(1);
  }
  console.log(`[dco] ✓ ${commits.length} 个提交全部带有效 Signed-off-by（区间 ${range}）。`);
}

const invokedDirectly =
  process.argv[1] &&
  (process.argv[1].endsWith("check-dco.mjs") || process.argv[1].endsWith("check-dco"));

if (invokedDirectly) main();
