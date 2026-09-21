/**
 * Lumi 三方材料复核（materialReview）的负向测试。
 *
 * 目的：证明 `licenses.mjs check --strict` 的「已了结」结论**不能靠写一句话拿到** ——
 * 复核记录缺字段、缺留存正文、或留存正文与声明的许可不符时，判定必须失败；
 * 新出现且没人复核过的缺口必须继续出现在 reviewRequired 里。
 *
 * 运行：node --import tsx --test packages/ui/test/lumiLicenseReview.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  MATERIAL_REVIEW_BASES,
  STANDARD_LICENSE_TEXTS,
  deriveReviewRequired,
  evaluateMaterialReview,
  reviewMaterialReviewRecords,
} from "../../../scripts/lumi-license-review.mjs";

const MIT_TEXT = readFileSync(
  fileURLToPath(new URL("../../../scripts/license-texts/MIT.txt", import.meta.url)),
  "utf8",
);
const ISC_TEXT = readFileSync(
  fileURLToPath(new URL("../../../scripts/license-texts/ISC.txt", import.meta.url)),
  "utf8",
);

/** 用「路径 → 内容」构造注入的 IO。未列出的路径视为文件缺失。 */
function io(files: Record<string, string>) {
  return { readText: (file: string) => files[file] };
}

/** 一份字段齐全、正文到位的基准记录，供各用例只破坏一个维度。 */
function validReview(overrides: Record<string, unknown> = {}) {
  return {
    status: "closed",
    basis: "publisher-supplied-notice-absent",
    reviewedOn: "2026-09-21",
    declaredLicense: "MIT",
    retainedTexts: ["snapshot/mit.txt"],
    searched: ["npm archive sha512-…: no license file inside the package"],
    residualUncertainty: "none",
    legalSignOff: true,
    ...overrides,
  };
}

const baseFiles = { "snapshot/mit.txt": MIT_TEXT };

test("复核判定：字段齐全且留存正文含条款时才通过", () => {
  assert.deepEqual(evaluateMaterialReview("pkg@1.0.0", validReview(), io(baseFiles)), []);
});

test("复核判定：缺少 materialReview 记录必须失败", () => {
  const failures = evaluateMaterialReview("pkg@1.0.0", undefined, io(baseFiles));
  assert.ok(failures.length > 0, "没有复核记录就不能算已了结");
  assert.ok(failures.some((f) => f.includes("缺少 materialReview")));
});

test("复核判定：status 不是 closed 必须失败", () => {
  const failures = evaluateMaterialReview(
    "pkg@1.0.0",
    validReview({ status: "open" }),
    io(baseFiles),
  );
  assert.ok(failures.some((f) => f.includes("status")));
});

test("复核判定：未登记的 basis 必须失败", () => {
  const failures = evaluateMaterialReview(
    "pkg@1.0.0",
    validReview({ basis: "trust-me" }),
    io(baseFiles),
  );
  assert.ok(failures.some((f) => f.includes("basis")));
});

test("复核判定：缺少检索证据必须失败", () => {
  for (const searched of [[], ["  "]]) {
    const failures = evaluateMaterialReview("pkg@1.0.0", validReview({ searched }), io(baseFiles));
    assert.ok(
      failures.some((f) => f.includes("searched")),
      `searched=${JSON.stringify(searched)} 必须被拒绝`,
    );
  }
});

test("复核判定：必须显式说明剩余不确定性", () => {
  const failures = evaluateMaterialReview(
    "pkg@1.0.0",
    validReview({ residualUncertainty: "" }),
    io(baseFiles),
  );
  assert.ok(failures.some((f) => f.includes("residualUncertainty")));
});

test("复核判定：legalSignOff 必须是布尔值", () => {
  const failures = evaluateMaterialReview(
    "pkg@1.0.0",
    validReview({ legalSignOff: undefined }),
    io(baseFiles),
  );
  assert.ok(failures.some((f) => f.includes("legalSignOff")));
});

test("复核判定：留存正文缺失或为空必须失败", () => {
  for (const retainedTexts of [[], ["snapshot/missing.txt"], ["snapshot/empty.txt"]]) {
    const failures = evaluateMaterialReview(
      "pkg@1.0.0",
      validReview({ retainedTexts }),
      io({ ...baseFiles, "snapshot/empty.txt": "\n" }),
    );
    assert.ok(failures.length > 0, `retainedTexts=${JSON.stringify(retainedTexts)} 必须被拒绝`);
  }
});

test("复核判定：留存正文不含所声明许可的条款必须失败", () => {
  // 声明 MIT，却只留了一份不含 MIT 条款的文本 —— 这正是「空口了结」的样子。
  const failures = evaluateMaterialReview(
    "pkg@1.0.0",
    validReview({ declaredLicense: "MIT", retainedTexts: ["snapshot/isc.txt"] }),
    io({ "snapshot/isc.txt": ISC_TEXT }),
  );
  assert.ok(
    failures.some((f) => f.includes("条款标记")),
    "留存正文与声明许可不符时必须失败",
  );
});

test("复核判定：未登记标准文本的许可标识不能了结", () => {
  const failures = evaluateMaterialReview(
    "pkg@1.0.0",
    validReview({ declaredLicense: "LicenseRef-Proprietary" }),
    io(baseFiles),
  );
  assert.ok(failures.some((f) => f.includes("没有登记标准文本")));
});

test("复核判定：声明 ISC 且留存 ISC 正文时通过", () => {
  const failures = evaluateMaterialReview(
    "pkg@1.0.0",
    validReview({ declaredLicense: "ISC", retainedTexts: ["snapshot/isc.txt"] }),
    io({ "snapshot/isc.txt": ISC_TEXT }),
  );
  assert.deepEqual(failures, []);
});

test("reviewRequired：新增且没有复核记录的缺口必须继续失败", () => {
  const items = deriveReviewRequired({
    copied: [{ id: "新的复制来源", reviewRequired: "尚无原始版权声明" }],
    overrides: [{ package: "new-pkg@9.9.9", evidenceKind: "publisher-license-identifier" }],
    embedded: [{ id: "NewEngine", reviewRequired: "链接出处未建立" }],
    nativeComponents: [{ id: "new-tool", version: "1.0.0", notices: [] }],
  });
  assert.equal(items.length, 4, "四类未了结条目都必须被报告");
  assert.ok(items.some((item) => item.id === "new-pkg@9.9.9"));
  assert.ok(items.some((item) => item.id === "new-tool@1.0.0"));
});

test("reviewRequired：上游既有标记 + 完整复核记录才算已了结", () => {
  const resolved = validReview();
  const items = deriveReviewRequired({
    overrides: [
      {
        package: "closed-pkg@1.0.0",
        evidenceKind: "publisher-license-identifier",
        materialReview: resolved,
      },
      {
        package: "half-pkg@1.0.0",
        evidenceKind: "publisher-license-identifier",
        materialReview: { status: "open" },
      },
    ],
  });
  assert.deepEqual(
    items.map((item) => item.id),
    ["half-pkg@1.0.0"],
  );
});

test("reviewRequired：已有留存正文的 native 组件不再被报告", () => {
  const items = deriveReviewRequired({
    nativeComponents: [
      { id: "has-notices", version: "1.0.0", notices: [{ file: "x.txt" }] },
      { id: "no-notices", version: "1.0.0", notices: [] },
    ],
  });
  assert.deepEqual(
    items.map((item) => item.id),
    ["no-notices@1.0.0"],
  );
});

test("reviewMaterialReviewRecords：记录不完整时抛错而不是静默通过", () => {
  assert.throws(
    () =>
      reviewMaterialReviewRecords(
        { overrides: [{ package: "pkg@1.0.0", materialReview: validReview({ searched: [] }) }] },
        io(baseFiles),
      ),
    /Incomplete third-party material review records/,
  );
});

test("复核依据表：只登记了两类已复核依据", () => {
  assert.deepEqual([...MATERIAL_REVIEW_BASES].sort(), [
    "component-license-retained-provenance-residual",
    "publisher-supplied-notice-absent",
  ]);
  assert.equal(STANDARD_LICENSE_TEXTS.MIT.file, "scripts/license-texts/MIT.txt");
});

/**
 * 正向对照：真实仓库里的每条 materialReview 都必须仍然完整。
 * 删除留存正文、或把结论改成半成品，都会在这里失败 —— 这是防漂移的那一道。
 */
test("真实清单：所有 materialReview 记录仍然完整可核", () => {
  const inventory = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../third-party/inventory.json", import.meta.url)),
      "utf8",
    ),
  );
  const readText = (file: string) =>
    readFileSync(fileURLToPath(new URL(`../../../${file}`, import.meta.url)), "utf8");
  const { overrides, copied, embedded, nativeComponents } = realSources();
  assert.doesNotThrow(() =>
    reviewMaterialReviewRecords({ overrides, copied, embedded, nativeComponents }, { readText }),
  );
  assert.equal(inventory.reviewRequired.length, 0, "仓库当前不应存在未了结条目");
  assert.ok(inventory.materialReviews.length >= 18, "复核记录数量不应减少");
});

/** 从真实数据文件读出四类条目（与生成器使用同一口径）。 */
function realSources() {
  const read = (file: string) =>
    JSON.parse(readFileSync(fileURLToPath(new URL(`../../../${file}`, import.meta.url)), "utf8"));
  return {
    overrides: read("third-party/npm-overrides.json"),
    copied: read("third-party/copied-components.json"),
    embedded: read("third-party/embedded-components.json"),
    nativeComponents: read("third-party/native-search/sources.json").components,
  };
}
