#!/usr/bin/env node
// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
/**
 * DCO (Developer Certificate of Origin 1.1) check for Lumi Agents.
 *
 * 政策：公共贡献走 DCO + Apache-2.0（见 CONTRIBUTING.md 与 ADR 0001）。
 * 本检查只做**溯源**。正常路径要求每个新提交的作者出现在该提交的 Signed-off-by 列表中。
 * 对门禁启用前已经存在的历史提交，只有冻结的 exact-SHA legacy exception；对门禁启用后却
 * 已误合入 main 的 unsigned commit，只接受原作者在后续 signed non-merge commit 中对 exact SHA
 * 作 retrospective DCO 1.1 attestation。两者都不是版权转让，也不能由第三方代签。
 *
 * 边界（刻意设计，防止两类作弊）：
 * - **不代签**：本脚本绝不添加、修补或"纠正"任何 Signed-off-by；缺失的人证就是
 *   阻塞项，如实在报错中列出。维护者不得在作者未认证的情况下补签——那等于伪造
 *   证据，本脚本的存在就是为了防这个。
 * - **导入例外收口**：upstream 导入历史（Lumi 分叉之前）没有 DCO 是已知事实，
 *   但不伪造历史签名。检查区间永远是 `<base>..<head>`（或显式 range），base 及
 *   其祖先天然不在区间内；例外只覆盖已记录的导入基线
 *   （872ad960de7ec172591f7e1952f7849229f94521，见 COMPLIANCE.md §2），绝不后移。
 * - **post-cutoff remediation 收口**：不得后移 legacy cutoff。已误 merge 的 unsigned commit
 *   只能由原作者在后续 signed non-merge commit 的提交正文中加入
 *   `DCO-Attests: <exact-40-char-sha>`；checker 会核对 target ancestry、same-author、
 *   target 本身确实 unsigned，以及 attestation commit 自身的 Signed-off-by。
 * - **邮箱一致性**：sign-off / attestation 邮箱与作者邮箱按 GitHub noreply 规则归一后必须一致，
 *   防止拿别人的名字凑签名。
 *
 * 用法：
 *   node scripts/check-dco.mjs --base <import-base-sha>
 *   node scripts/check-dco.mjs origin/main..HEAD
 * CI（PR 场景）：node scripts/check-dco.mjs origin/${{ base }}..HEAD
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DCO_MARKER = "Signed-off-by:";
/** 已记录的上游导入基线（Lumi 分叉点）。见 docs/licensing/COMPLIANCE.md §2。 */
export const KNOWN_IMPORT_BASES = ["872ad960de7ec172591f7e1952f7849229f94521"];
// Historical fork commits merged before DCO became merge-blocking. This cutoff is
// immutable policy state: entries may only be exact ancestors of this commit.
// They are exceptions to the CI gate, NOT retroactive DCO certifications.
export const LEGACY_DCO_CUTOFF = "b0d31a1e3ae29c2afcb08d8eb04db34d5fdbc42d";
const LEGACY_DCO_FILE = new URL("../docs/licensing/dco-legacy-exceptions.json", import.meta.url);
export const DCO_ATTESTATION_MARKER = "DCO-Attests:";

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

/** 从提交正文提取 retrospective DCO exact-SHA trailers。 */
export function extractDcoAttestedHashes(body) {
  return (body ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(DCO_ATTESTATION_MARKER))
    .map((line) => line.slice(DCO_ATTESTATION_MARKER.length).trim().toLowerCase())
    .filter(Boolean);
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

export function readLegacyDcoExceptions() {
  const document = JSON.parse(readFileSync(LEGACY_DCO_FILE, "utf8"));
  if (document.cutoffMain !== LEGACY_DCO_CUTOFF) {
    throw new Error(
      `[dco] legacy exception cutoff changed: expected ${LEGACY_DCO_CUTOFF}, got ${String(document.cutoffMain)}`,
    );
  }
  if (document.upstreamImportBase !== KNOWN_IMPORT_BASES[0]) {
    throw new Error("[dco] legacy exception import base does not match the recorded upstream baseline");
  }
  const entries = Array.isArray(document.exceptions) ? document.exceptions : [];
  const hashes = new Set();
  for (const entry of entries) {
    if (!/^[0-9a-f]{40}$/u.test(entry.sha ?? "")) {
      throw new Error(`[dco] invalid legacy exception SHA: ${String(entry.sha)}`);
    }
    if (hashes.has(entry.sha)) throw new Error(`[dco] duplicate legacy exception: ${entry.sha}`);
    hashes.add(entry.sha);
  }
  return { document, hashes };
}

function assertLegacyExceptionsAreHistorical(document, hashes) {
  for (const entry of document.exceptions) {
    const hash = entry.sha;
    try {
      git(["merge-base", "--is-ancestor", hash, LEGACY_DCO_CUTOFF]);
    } catch {
      throw new Error(
        `[dco] legacy exception ${hash} is not an ancestor of immutable cutoff ${LEGACY_DCO_CUTOFF}`,
      );
    }

    const parents = git(["rev-list", "--parents", "-n", "1", hash]).trim().split(/\s+/u);
    if (parents.length !== 2) {
      throw new Error(`[dco] legacy exception must be a non-merge commit: ${hash}`);
    }

    const [authorEmail, subject] = git(["show", "-s", "--format=%ae%x00%s", hash])
      .trimEnd()
      .split("\u0000");
    if (authorEmail !== entry.authorEmail || subject !== entry.subject) {
      throw new Error(
        `[dco] legacy exception metadata drift for ${hash}: expected ${entry.authorEmail} / ${entry.subject}`,
      );
    }
  }

  // The exception document must equal the complete unsigned non-merge history
  // between the imported upstream base and the immutable cutoff. This prevents
  // both silent omission and expansion to unrelated historical commits.
  const historical = listCommits(`${KNOWN_IMPORT_BASES[0]}..${LEGACY_DCO_CUTOFF}`);
  const unsigned = new Set(
    evaluateDco({ commits: historical, exemptHashes: new Set() }).map((item) => item.hash),
  );
  const missing = [...unsigned].filter((hash) => !hashes.has(hash)).sort();
  const extra = [...hashes].filter((hash) => !unsigned.has(hash)).sort();
  if (missing.length || extra.length) {
    throw new Error(
      "[dco] legacy exception set does not exactly match pre-cutoff unsigned history." +
        `\nMissing exceptions: ${missing.join(", ")}` +
        `\nUnexpected exceptions: ${extra.join(", ")}`,
    );
  }
}

function collectRetrospectiveDcoAttestations() {
  const history = listCommits(`${KNOWN_IMPORT_BASES[0]}..HEAD`);
  const hashes = new Set();

  for (const attestor of history) {
    const targets = extractDcoAttestedHashes(attestor.body);
    if (targets.length === 0) continue;

    const attestorFailures = evaluateDco({
      commits: [attestor],
      exemptHashes: new Set(),
    });
    if (attestorFailures.length > 0) {
      throw new Error(
        `[dco] retrospective attestation commit ${attestor.hash} lacks the attestor's valid Signed-off-by`,
      );
    }

    const attestorParents = git(["rev-list", "--parents", "-n", "1", attestor.hash])
      .trim()
      .split(/\s+/u);
    if (attestorParents.length !== 2) {
      throw new Error(
        `[dco] retrospective attestation must be a non-merge commit: ${attestor.hash}`,
      );
    }

    for (const targetSha of targets) {
      if (!/^[0-9a-f]{40}$/u.test(targetSha)) {
        throw new Error(
          `[dco] invalid retrospective attestation target SHA in ${attestor.hash}: ${targetSha}`,
        );
      }
      if (targetSha === attestor.hash) {
        throw new Error(`[dco] a commit cannot retrospectively attest itself: ${targetSha}`);
      }
      if (hashes.has(targetSha)) {
        throw new Error(`[dco] duplicate retrospective attestation target: ${targetSha}`);
      }

      const [targetAuthorEmail, targetBody] = git([
        "show",
        "-s",
        "--format=%ae%x00%b",
        targetSha,
      ])
        .trimEnd()
        .split("\u0000");

      const targetParents = git(["rev-list", "--parents", "-n", "1", targetSha])
        .trim()
        .split(/\s+/u);
      if (targetParents.length !== 2) {
        throw new Error(
          `[dco] retrospective attestation target must be a non-merge commit: ${targetSha}`,
        );
      }

      try {
        git(["merge-base", "--is-ancestor", LEGACY_DCO_CUTOFF, targetSha]);
        git(["merge-base", "--is-ancestor", targetSha, attestor.hash]);
      } catch {
        throw new Error(
          `[dco] retrospective attestation target must be post-cutoff and an ancestor of attestor: ${targetSha}`,
        );
      }

      if (normalizeEmail(targetAuthorEmail) !== normalizeEmail(attestor.authorEmail)) {
        throw new Error(
          `[dco] attestor ${attestor.authorEmail} does not match target author ${targetAuthorEmail} for ${targetSha}`,
        );
      }

      if (
        evaluateDco({
          commits: [{ hash: targetSha, authorEmail: targetAuthorEmail, body: targetBody ?? "" }],
          exemptHashes: new Set(),
        }).length === 0
      ) {
        throw new Error(
          `[dco] retrospective attestation target is already directly signed: ${targetSha}`,
        );
      }

      hashes.add(targetSha);
    }
  }

  return hashes;
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
  // Historical exceptions are exact pre-cutoff commits that were already merged
  // before enforcement. They are never treated as signed or as ownership evidence.
  const { document: legacyDocument, hashes: legacyHashes } = readLegacyDcoExceptions();
  assertLegacyExceptionsAreHistorical(legacyDocument, legacyHashes);
  const attestedHashes = collectRetrospectiveDcoAttestations();
  const acceptedHashes = new Set([...legacyHashes, ...attestedHashes]);
  const failures = evaluateDco({ commits, exemptHashes: acceptedHashes });
  if (failures.length > 0) {
    console.error(
      `[dco] ${failures.length} 个提交缺少有效 DCO 签名（DCO 1.1，见 CONTRIBUTING.md）：`,
    );
    for (const failure of failures) {
      console.error(`  - ${failure.hash.slice(0, 10)}: ${failure.reason}`);
    }
    console.error(
      "\n处理：未合并提交用 git commit --amend -s（或 rebase 每个提交 -s）后重推；" +
        "若 post-cutoff unsigned commit 已误合入 main，由原作者在后续 signed non-merge commit 中加入 " +
        "DCO-Attests: <exact-sha>。DCO 是溯源认证，不是版权转让，维护者不会代签。",
    );
    process.exit(1);
  }
  const directlySigned = commits.filter(
    (commit) =>
      !legacyHashes.has(commit.hash) &&
      !attestedHashes.has(commit.hash) &&
      evaluateDco({ commits: [commit], exemptHashes: new Set() }).length === 0,
  ).length;
  console.log(
    `[dco] ✓ 区间 ${range} 满足 DCO policy：${directlySigned} 个 direct sign-off，` +
      `${[...legacyHashes].filter((hash) => commits.some((commit) => commit.hash === hash)).length} 个 frozen legacy exception，` +
      `${[...attestedHashes].filter((hash) => commits.some((commit) => commit.hash === hash)).length} 个 verified retrospective attestation。`,
  );
}

const invokedDirectly =
  process.argv[1] &&
  (process.argv[1].endsWith("check-dco.mjs") || process.argv[1].endsWith("check-dco"));

if (invokedDirectly) main();
