/**
 * 许可/贡献政策（ADR 0001）的可执行验证。
 *
 * 目的：证明政策不是"多几个法务样子的文件"——
 * 1. DCO 检查真实地拒绝缺失/伪造/错配的签名，且 --base 例外不可扩大；
 * 2. LICENSING/CONTRIBUTING/TRADEMARKS 的关键承诺（永久授权、竞争边界、
 *    DCO≠转让、品牌≠许可）在文档里真实存在，删掉会红灯。
 *
 * 运行：node --import tsx --test packages/ui/test/lumiLicensingPolicy.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  DCO_ATTESTATION_STATEMENT,
  KNOWN_IMPORT_BASES,
  LEGACY_DCO_CUTOFF,
  VERIFIED_UPSTREAM_IMPORTS,
  evaluateDco,
  extractSignOffEmails,
  normalizeEmail,
  readLegacyDcoExceptions,
} from "../../../scripts/check-dco.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (file) => readFileSync(`${repoRoot}${file}`, "utf8");

function commit(hash, authorEmail, body) {
  return { hash, authorEmail, body };
}

test("DCO：作者自签通过", () => {
  const failures = evaluateDco({
    commits: [commit("a1", "dev@example.com", "Change\n\nSigned-off-by: Dev <dev@example.com>")],
  });
  assert.equal(failures.length, 0);
});

test("DCO：缺少签名 → 失败（不会静默通过）", () => {
  const failures = evaluateDco({
    commits: [commit("a2", "dev@example.com", "Change without sign-off")],
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].reason, /缺少 Signed-off-by/);
});

test("DCO：第三方代签（既非作者也非提交者授权形态）→ 失败", () => {
  const failures = evaluateDco({
    commits: [
      commit("a3", "dev@example.com", "Change\n\nSigned-off-by: Someone Else <else@example.com>"),
    ],
  });
  assert.equal(failures.length, 1, "拿别人的名字凑签名必须被拒绝");
});

test("DCO：邮箱归一（GitHub noreply 数字前缀）后匹配", () => {
  assert.equal(
    normalizeEmail("978862+dev@users.noreply.github.com"),
    normalizeEmail("dev@users.noreply.github.com"),
  );
  const failures = evaluateDco({
    commits: [
      commit(
        "a4",
        "978862+dev@users.noreply.github.com",
        "Change\n\nSigned-off-by: Dev <dev@users.noreply.github.com>",
      ),
    ],
  });
  assert.equal(failures.length, 0);
});

test("DCO：签名提取只认 Signed-off-by 行", () => {
  const emails = extractSignOffEmails("Signed-off-by: A <a@x.com>\nCo-authored-by: B <b@x.com>");
  assert.deepEqual(emails, ["a@x.com"]);
});

test("DCO：导入基线白名单只含已记录的上游基点", () => {
  assert.deepEqual(KNOWN_IMPORT_BASES, ["872ad960de7ec172591f7e1952f7849229f94521"]);
});

test("DCO：历史例外固定在不可移动 cutoff，且不是新提交通配符", () => {
  const { document, hashes } = readLegacyDcoExceptions();
  assert.equal(document.cutoffMain, LEGACY_DCO_CUTOFF);
  assert.match(document.policy, /do not certify DCO/);
  assert.match(document.policy, /New commits require genuine author Signed-off-by/);
  assert.ok(document.exceptions.every((entry) => entry.status === "legacy-no-dco"));
  assert.equal(hashes.size, document.exceptions.length);
  assert.ok(hashes.size > 0);
});

test("DCO：retrospective remediation 仅针对审定的 exact SHAs，声明不可漂移", () => {
  const doc = JSON.parse(read("docs/licensing/dco-attestations.json"));
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.canonicalStatement, DCO_ATTESTATION_STATEMENT);
  assert.deepEqual(
    doc.attestations.map((entry) => entry.targetSha).sort(),
    [
      "fa48dd3ec9e4cda8363b7bd1e2f819c23afe7493",
      "9840eec019b527fc37c9f1202a135f6d5cd9d617",
      "df76e64fd2cd536d36c89313a4c0f2b774155f49",
      "f9af8846d5662167d14651316706bb83bd2bad6a",
      "f3e3e1d4c36c1d4e8a230c36a74b9c6d1a8c0d69",
    ].sort(),
  );
  assert.ok(doc.attestations.every((entry) => entry.statement === DCO_ATTESTATION_STATEMENT));
  assert.match(doc.policy, /same normalized email/);
  assert.match(doc.policy, /Signed-off-by and DCO-Attests/);
  assert.match(doc.policy, /not a copyright assignment/);
});

test("DCO：上游导入只接受精确 release commit", () => {
  assert.deepEqual(
    [...VERIFIED_UPSTREAM_IMPORTS.keys()],
    ["29628c9acdb81b703bbd4080c207a0e7ce5e276e"],
  );
});

test("DCO：豁免集合精确豁免（历史提交不误报，新提交不豁免）", () => {
  const exempt = new Set(["base0", "base1"]);
  const failures = evaluateDco({
    commits: [
      commit("base0", "upstream@example.com", "import"),
      commit("new1", "dev@example.com", "unsigned new work"),
    ],
    exemptHashes: exempt,
  });
  assert.equal(failures.length, 1, "只有导入历史被豁免，新提交必须失败");
  assert.equal(failures[0].hash, "new1");
});

// ── 文档锚点：政策文件的关键承诺不可被悄悄删掉 ──

test("LICENSING.md：永久授权 + 竞争边界 + FAQ 存在", () => {
  const doc = read("LICENSING.md");
  assert.match(doc, /perpetual and irrevocable/);
  assert.match(doc, /Competitors may lawfully build/);
  assert.match(doc, /Can a business use Lumi Agents for free/);
  assert.match(doc, /Does Apache grant trademark rights to the Lumi name or mark/);
  assert.match(doc, /What can't this licensing model protect/);
  assert.match(doc, /Must ordinary contributors assign copyright\?/);
});

test("CONTRIBUTING.md：DCO 1.1 官方原文存在且未被改写", () => {
  const doc = read("CONTRIBUTING.md");
  assert.match(doc, /Developer Certificate of Origin\nVersion 1\.1/);
  assert.match(doc, /Copyright \(C\) 2004, 2006 The Linux Foundation and its contributors\./);
  assert.match(doc, /\(d\) I understand and agree/);
  assert.match(doc, /not a copyright assignment/);
  assert.match(doc, /AI-assisted/);
  assert.match(doc, /Retrospective attestation for an accidentally merged unsigned commit/);
  assert.match(doc, /same normalized author email/);
});

test("TRADEMARKS.md：许可与品牌分离、无注册/排他声明", () => {
  const doc = read("TRADEMARKS.md").replace(/\n/g, " ");
  assert.match(doc, /does \*\*not\*\*.*grant trademark permission/);
  assert.match(doc, /does \*\*not\*\* retract copyright permissions/);
  assert.match(doc, /Nothing here claims trademark registration/);
  assert.match(doc, /independent fork/);
  assert.match(doc, /ZCode/);
});

test("ADR 0001：记录了备选方案与局限（不是只写结论）", () => {
  const doc = read("docs/specs/lumi-agents/adr/0001-licensing-and-contribution-model.md");
  for (const anchor of ["AGPL", "FSL", "CLA", "Limitations", "not legal advice"]) {
    assert.ok(doc.includes(anchor), `ADR 缺少锚点: ${anchor}`);
  }
});

test("上游义务：LICENSE 原文与上游版权行未被触碰", () => {
  const license = read("LICENSE");
  assert.match(license, /Apache License/);
  assert.match(license, /Version 2\.0, January 2004/);
  assert.match(license, /Copyright 2026 Z\.AI Co\., Ltd/);
});
