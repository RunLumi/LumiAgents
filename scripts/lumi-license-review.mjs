/**
 * Lumi Agents 三方材料复核（material review）模型：判定 + 校验，全部为纯函数。
 *
 * 背景：`node scripts/licenses.mjs check --strict` 的语义是「所有材料义务都已了结」。
 * 上游把两类完全不同的情况都记成同一句 reviewRequired：
 *
 *   1. 材料存在、只是还没登记 —— 可以通过补证据了结；
 *   2. 权利人从未提供版权/许可声明 —— 证据**永远补不出来**，只能由人作出书面结论。
 *
 * 本模块把第 2 类建模为结构化的 materialReview，要求逐项写明依据、检索范围、留存文本
 * 与剩余不确定性，并保留 legalSignOff 标记。它**不是**白名单：没有（或没写全）复核记录
 * 的条目仍然会进入 reviewRequired，从而继续让 --strict 失败。每条依据都要能追溯到具体
 * 证据字符串，避免用自由文本一句话绕过门禁。
 *
 * IO 由调用方注入（readText），因此负向用例可以用 fixture 断言判定逻辑本身。
 */

/** 复核结论被接受时的唯一 status 值。 */
export const RESOLVING_STATUS = "closed";

/**
 * 允许的复核依据。新增依据必须在代码、docs/licensing/COMPLIANCE.md 与
 * docs/licensing/MODIFICATIONS.md 同时登记。
 */
export const MATERIAL_REVIEW_BASES = new Set([
  /** 权利人只声明了 SPDX 标识，从未随包或随仓库提供完整的版权/许可正文。 */
  "publisher-supplied-notice-absent",
  /** 组件许可正文已留存，但上游未记录精确构建/链接出处（残余不确定性写在记录里）。 */
  "component-license-retained-provenance-residual",
]);

/**
 * 与分发许可标识绑定的标准许可全文，用于第 1 类情况下「至少留存许可条款本身」。
 * markers 用来证明留存的确是该许可的正文，而不是空文件或占位符。
 */
export const STANDARD_LICENSE_TEXTS = {
  MIT: {
    file: "scripts/license-texts/MIT.txt",
    markers: ["Permission is hereby granted, free of charge"],
  },
  ISC: {
    file: "scripts/license-texts/ISC.txt",
    markers: ["Permission to use, copy, modify"],
  },
  "BSD-2-Clause": {
    file: "scripts/license-texts/BSD-2-Clause.txt",
    markers: ["Redistributions of source code must retain"],
  },
  "BSD-3-Clause": {
    file: "scripts/license-texts/BSD-3-Clause.txt",
    markers: ["Redistributions of source code must retain"],
  },
  "Apache-2.0": {
    file: "scripts/license-texts/Apache-2.0.txt",
    markers: ["Apache License", "Version 2.0"],
  },
};

/** 复核记录被判定为「已了结」的唯一条件。 */
export function isReviewResolved(review) {
  return review?.status === RESOLVING_STATUS;
}

/**
 * 单条复核记录的完整性校验。
 * @param {string} id 条目标识（包名@版本 / 组件 id）
 * @param {unknown} review materialReview 记录
 * @param {{ readText: (file: string) => string | undefined }} io
 * @returns {string[]} 失败信息（空数组表示该条目已了结且证据完整）
 */
export function evaluateMaterialReview(id, review, { readText }) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return [`${id}: 缺少 materialReview 记录，条目仍未了结`];
  }
  const failures = [];
  if (review.status !== RESOLVING_STATUS) {
    failures.push(
      `${id}: materialReview.status 必须是 "${RESOLVING_STATUS}"，当前为 ${JSON.stringify(review.status)}`,
    );
  }
  if (!MATERIAL_REVIEW_BASES.has(review.basis)) {
    failures.push(`${id}: materialReview.basis 未登记：${JSON.stringify(review.basis)}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(review.reviewedOn ?? "")) {
    failures.push(`${id}: materialReview.reviewedOn 必须是 YYYY-MM-DD`);
  }
  if (typeof review.declaredLicense !== "string" || review.declaredLicense.trim() === "") {
    failures.push(`${id}: materialReview.declaredLicense 缺失（无法核对留存文本）`);
  }
  if (
    !Array.isArray(review.searched) ||
    review.searched.length === 0 ||
    review.searched.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    failures.push(`${id}: materialReview.searched 必须至少登记一条实际检索证据`);
  }
  if (typeof review.residualUncertainty !== "string" || review.residualUncertainty.trim() === "") {
    failures.push(`${id}: materialReview.residualUncertainty 必须显式说明（无残余写 "none"）`);
  }
  if (typeof review.legalSignOff !== "boolean") {
    failures.push(`${id}: materialReview.legalSignOff 必须是布尔值`);
  }

  const retainedTexts = Array.isArray(review.retainedTexts) ? review.retainedTexts : [];
  if (retainedTexts.length === 0) {
    failures.push(`${id}: materialReview.retainedTexts 必须至少留存一份许可正文`);
  }
  for (const file of retainedTexts) {
    if (typeof file !== "string" || file.trim() === "") {
      failures.push(`${id}: materialReview.retainedTexts 含非法路径`);
      continue;
    }
    const text = readText(file);
    if (text === undefined || text.trim() === "") {
      failures.push(`${id}: 留存文本缺失或为空：${file}`);
    }
  }

  // 第 1 类依据：权利人未提供声明，则必须证明留存的正文确实含有该许可条款。
  // 不要求路径等于标准文本文件：逐包快照（标准正文 + 声明缺位的说明）同样满足，
  // 但必须至少有一份留存正文包含全部标记，否则「已留存条款」就是空话。
  if (review.basis === "publisher-supplied-notice-absent") {
    const standard = STANDARD_LICENSE_TEXTS[review.declaredLicense];
    if (!standard) {
      failures.push(
        `${id}: declaredLicense=${JSON.stringify(review.declaredLicense)} 没有登记标准文本，无法证明留存了许可条款`,
      );
    } else {
      const retainedCopy = retainedTexts
        .map((file) => (typeof file === "string" ? (readText(file) ?? "") : ""))
        .find((text) => standard.markers.every((marker) => text.includes(marker)));
      if (retainedCopy === undefined) {
        failures.push(
          `${id}: 留存正文中没有包含 ${review.declaredLicense} 全部条款标记的文本（需包含：${standard.markers.join(" / ")}）`,
        );
      }
    }
  }

  return failures;
}

/**
 * 汇总所有未了结条目。**只看复核记录是否完整，不看它写了什么结论** ——
 * 因此新增的、没人复核过的缺口仍会出现在这里并让 --strict 失败。
 *
 * @param {{ copied?: object[], overrides?: object[], embedded?: object[], nativeComponents?: object[] }} inventory
 * @returns {{ id: string, reason: string }[]}
 */
export function deriveReviewRequired({
  copied = [],
  overrides = [],
  embedded = [],
  nativeComponents = [],
} = {}) {
  const items = [];
  const push = (id, reason) => items.push({ id, reason });

  for (const item of copied) {
    if (item.reviewRequired && !isReviewResolved(item.materialReview)) {
      push(item.id, item.reviewRequired);
    }
  }
  for (const item of overrides) {
    // acceptedMissingNotice / evidenceKind 是上游原有的「材料不完整」标记；
    // 只有配了完整复核记录才算了结。
    if (!(item.acceptedMissingNotice || item.evidenceKind)) continue;
    if (isReviewResolved(item.materialReview)) continue;
    push(
      item.package,
      item.acceptedMissingNotice ??
        "Original version-specific publisher copyright/license material remains incomplete.",
    );
  }
  for (const item of embedded) {
    if (item.reviewRequired && !isReviewResolved(item.materialReview)) {
      push(item.id, item.reviewRequired);
    }
  }
  for (const item of nativeComponents) {
    if (item.notices?.length) continue;
    if (isReviewResolved(item.materialReview)) continue;
    push(
      `${item.id}@${item.version}`,
      "No original notice snapshot for this recorded native component.",
    );
  }
  return items;
}

/** 取出所有已登记的复核记录（含未了结的），供生成器校验与渲染。 */
export function collectMaterialReviews({
  copied = [],
  overrides = [],
  embedded = [],
  nativeComponents = [],
} = {}) {
  const records = [];
  for (const item of copied) records.push({ id: item.id, review: item.materialReview });
  for (const item of overrides) records.push({ id: item.package, review: item.materialReview });
  for (const item of embedded) records.push({ id: item.id, review: item.materialReview });
  for (const item of nativeComponents) {
    records.push({ id: `${item.id}@${item.version}`, review: item.materialReview });
  }
  return records.filter((record) => record.review !== undefined);
}

/**
 * 校验全部已登记复核记录，并返回去重后的留存文本路径。
 * 记录不完整时**抛错**，避免把半成品结论当成合规完成。
 */
export function reviewMaterialReviewRecords(inventory, { readText }) {
  const failures = [];
  const retainedTexts = new Set();
  for (const { id, review } of collectMaterialReviews(inventory)) {
    failures.push(...evaluateMaterialReview(id, review, { readText }));
    for (const file of review?.retainedTexts ?? []) retainedTexts.add(file);
  }
  if (failures.length > 0) {
    throw new Error(
      `Incomplete third-party material review records:\n${failures.map((line) => `  ${line}`).join("\n")}`,
    );
  }
  return [...retainedTexts].sort((a, b) => a.localeCompare(b, "en"));
}
