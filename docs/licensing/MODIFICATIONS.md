# Lumi Agents 修改记录与声明机制

本文件登记 **Lumi Agents 分支对上游 ZCode 内容的修改**，以及每一处修改的声明方式。
机器可读清单在 [`scripts/lumi-modified-files.mjs`](../../scripts/lumi-modified-files.mjs)，
校验命令：

```bash
node scripts/lumi-modified-files.mjs check
```

> 修改 for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode
> (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.

---

## 1. 声明义务与口径

Apache License 2.0 第 4(b) 条要求：分发 Derivative Works 时，必须让**被修改的文件**带有显著的
修改声明。本条只约束「修改/替换了上游内容」的文件：

| 类别                   | 是否属于 §4(b) 的 modified file | 处理                        |
| ---------------------- | ------------------------------- | --------------------------- |
| 修改了上游已有文件     | 是                              | 文件内联声明（见第 2 节）   |
| 替换了上游已有资产     | 是                              | 无法内联 → 第 3 节登记      |
| 为 Lumi 新增的独立文件 | 否（属于新增，不是修改）        | 无需声明                    |
| 删除上游文件           | 否（不产生被修改文件）          | 第 4 节登记删除项，便于审计 |

## 2. 可以内联声明的格式

声明标记固定为 `Modified for Lumi Agents`，按文件格式使用合法注释语法，且遵守位置约束：

| 格式                    | 注释语法     | 位置约束                                  |
| ----------------------- | ------------ | ----------------------------------------- |
| `.ts` / `.tsx` / `.mjs` | `// …`       | 第 1 行                                   |
| `.css`                  | `/* … */`    | 第 1 行（`@import` 之前，合法）           |
| `.md`                   | `> …`        | 第 1 行（渲染后可见，故不用 HTML 注释）   |
| `.html`                 | `<!-- … -->` | `<!doctype>` **之后**（避免解析歧义）     |
| `.sh`                   | `# …`        | **shebang 之后**（shebang 必须是第 1 行） |
| `.gitignore` 等配置     | `# …`        | 第 1 行                                   |

`scripts/lumi-modified-files.mjs apply` 是幂等的：已带标记的文件不会被重复写入。

## 3. 无法内联声明的文件（替代机制）

### 3.1 JSON（`json-no-comments`）

JSON 标准不允许注释，内联声明会破坏文件。替代机制：

- 仓库级声明：本文件 + 根 `NOTICE.md` 第一节；
- 下列文件在 `scripts/lumi-modified-files.mjs` 的 `NOTICE_EXCEPTIONS` 中登记，缺失即校验失败；
  未登记的改动会被 `--against-upstream` 报告（不是静默放过）。

| 文件                                     | 修改内容                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json`                           | 新增 `lumi:drift` / `lumi:notice` 等维护命令                                                                                                           |
| `packages/desktop/package.json`          | `productName`、`description`、`author` 改为 Lumi                                                                                                       |
| `third-party/npm-overrides.json`         | 逐包许可材料：新增 `materialReview` 复核记录；`keyv@4.5.4` 曾换成真实版本适用 LICENSE，2026-09-21 随 `@arms/rum-*` 遥测替换整体移除（连同 rrweb 家族） |
| `third-party/copied-components.json`     | 复制来源（React Best Practices skill）新增 `materialReview`                                                                                            |
| `third-party/embedded-components.json`   | Skia / QuickJS-NG 的未决标记改为带证据的 `materialReview`                                                                                              |
| `third-party/native-search/sources.json` | `rust-standard-library` 删除不可验证的 revision，改用真实许可正文                                                                                      |

### 3.1b 生成物（由生成器保证声明）

| 文件                         | 机制                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `THIRD-PARTY-NOTICES.md`     | 声明写在生成器 `scripts/generate-third-party-notices.mjs` 的头部模板里，每次 `licenses.mjs notices` 重新生成都自带，不靠事后手改生成物 |
| `third-party/inventory.json` | `json-no-comments`：生成物的输入哈希、`reviewRequired` 与 `materialReviews` 本身即修改证据；声明由 `THIRD-PARTY-NOTICES.md` 与本节承担 |

### 3.2 二进制 / 生成资产（`binary-generated`）

位图与容器格式（PNG / ICNS / ICO）无法承载文本声明。替代机制：

- 这些文件**全部由** [`scripts/build-lumi-brand-assets.mjs`](../../scripts/build-lumi-brand-assets.mjs)
  从 `brand/` 下的原创 SVG **确定性生成**，不包含任何上游字节；
- 每个路径都在 `NOTICE_EXCEPTIONS` 中逐条登记；
- 生成脚本本身自带 Lumi 署名与 DESIGN.md 依据，并在本文件说明。

覆盖范围：`packages/desktop/build/icon*`、`packages/desktop/build/icons/*`、
`public/logo/icons/*`、`public/icon_512@2x.png`。

## 4. 删除与替换的上游资产

| 上游文件                                           | 处理                                                  |
| -------------------------------------------------- | ----------------------------------------------------- |
| `packages/ui/src/assets/Z.svg`                     | 删除（上游 ZCode 标识）；水印改用 Lumi 折叠 L 几何    |
| `packages/ui/src/components/ui/ZCodeAboutLogo.tsx` | 删除（上游 ZCode 图形）；由 `LumiBrandMark.tsx` 取代  |
| `packages/desktop/build/*`、`public/logo/icons/*`  | 被第 3.2 节的 Lumi 原创资产整体替换                   |
| `packages/desktop/build/dmg_background*.png`       | **仍是上游图片，尚未替换** —— 见第 5 节，发布前需处理 |

## 5. 待处理 / 需法务复核

以下项目不能由工程侧单方面判定，**在解决前视为发布阻塞项**：

1. **`packages/desktop/build/dmg_background.png` / `dmg_background@2x.png`**
   是上游 DMG 安装背景图，可能包含上游品牌元素，且尺寸与 DMG 窗口布局绑定（不可随意重绘）。
   当前**未替换**。需要设计提供符合 DESIGN.md 的同尺寸替换图后才能移除该阻塞项。
   处理方式参见 [COMPLIANCE.md](./COMPLIANCE.md) 的发布阻塞清单。
   _This item is flagged for legal/design review; the engineering side cannot verify or clear it._
2. **12 条第三方材料复核结论**（Skia、QuickJS-NG、`rust-standard-library`、`boolbase`、
   `semaphore`、`ansi-to-react`、`is-node-process` 等；原 18 条，其中 `@arms/rum-*` 与
   rrweb 家族已于 2026-09-21 随闭源遥测 SDK 整体移除）：权利人只声明了 SPDX 标识，
   从未随包或随仓库提供版权/许可声明，证据不存在，因此记录为有据可查的结论并留存许可正文。
   这类处置是否可以接受属于**法律判断**，逐条证据见 [COMPLIANCE.md](./COMPLIANCE.md) 第 5.1 节与
   `third-party/inventory.json` 的 `materialReviews`。
   _This item is flagged for legal review; the engineering side records evidence only._
3. **已知无法内联声明的第三方资产**：：仓库内没有需要 Lumi 单方声明的第三方品牌资源；
   `third-party/` 下的材料属于第三方许可原文，不再叠加 Lumi 声明（叠加会篡改第三方文本）。

## 5.1 工作区内不属于 Lumi 声明的改动

`node scripts/check-lumi-branding-drift.mjs --against-upstream` 会列出所有相对 upstream 被修改的文件。
其中有些是**仓库所有者尚未提交的本地工作**，不是 Lumi 的品牌或合规改动。这类文件登记在
`scripts/lumi-modified-files.mjs` 的 `UNDECLARED_WORKSPACE_CHANGES`，写明原因：

| 文件 | 原因 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- || `.env.example` | 所有者的本地改动（App Store Connect / MAS 凭据占位符）；不由本分支声明，也不应凭空加 Lumi 声明 |
| `.gitignore` | 所有者的本地改动（忽略 `*.p8` 私钥）；不由本分支声明 |
| `DESIGN.md` | 所有者**未提交**的设计合同（Lumi Design System 正文）。本分支不改写、不代提交他人未完成的工作；一旦该文件被提交，提交者必须同时补上 §4(b) 修改声明（标记 `Modified for Lumi Agents`） |

这两项在发布前必须清空（清空方式：所有者提交自己的改动并补声明，或同步本分支说明）。
注意：`DESIGN.md` 在 `HEAD` 中已存在，工作区版本是所有者尚未提交的更新；
未提交内容不构成分发，因此 §4(b) 尚未被触发，但合入后必须补。

## 6. 不在本文件范围

本文件只处理 §4(b) 的**修改声明**。许可证原文保留、第三方材料、NOTICE 归属等问题见
[COMPLIANCE.md](./COMPLIANCE.md)。
