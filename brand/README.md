# Lumi Agents 品牌资产源

本目录是 Lumi Agents **品牌图形的唯一来源**，内容取自 Lumi 官方品牌仓库 [RunLumi/brand.runlumi](https://github.com/RunLumi/brand.runlumi)（`cb8e83c`）。平台所需的位图与容器格式都由
[`scripts/build-lumi-brand-assets.mjs`](../scripts/build-lumi-brand-assets.mjs) 从这里确定性生成，
不手工导出、不复制上游 ZCode 资源。

```bash
node scripts/build-lumi-brand-assets.mjs   # 或 pnpm lumi:brand-assets
```

## 文件

| 文件                | 用途                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `lumi-mark.svg`     | 官方 Lumi 折叠 L 标记（`lumi-logo.svg` 原样几何与配色：竖直平面 `#019EDD`、水平平面 `#0162A4`）              |
| `lumi-app-icon.svg` | 应用图标：按官方启动图标（`adaptive/ic_launcher_foreground.png`）构图——`#0162A4`→`#00396C` 渐变底 + 白色标记 |

## 几何

几何不在本仓库重新设计：两个平面的路径原样复制自官方 `lumi-logo.svg`（500×500 画布，
`translate(91.5 51.5)`）。单色场景使用官方单色版的规则（两平面同色）。更换图形时先更新
官方品牌仓库，再同步本目录与 `LumiBrandMark.tsx`，并重新运行生成脚本。

## 生成产物

| 产物                                                                          | 用途                          |
| ----------------------------------------------------------------------------- | ----------------------------- |
| `packages/desktop/build/icons/<N>x<N>.png`                                    | 桌面打包图标集（16…1024）     |
| `packages/desktop/build/icon.png` / `icon_windows.png` / `icon_installer.png` | 应用 / Windows / 安装器图标源 |
| `packages/desktop/build/icon.icns` / `icon.ico` / `icon_installer.*`          | macOS / Windows 容器          |
| `public/logo/icons/*`、`public/icon_512@2x.png`                               | 仓库与 Web 文档用图标         |

## 重要说明

- 这些是 Lumi 官方品牌图形，是 **CLOUDJET SOLUTIONS PTE. LTD. 的财产，保留所有权利**，
  **不**按 Apache-2.0 授权（见下方英文说明与 `TRADEMARKS.md`）。
- 生成脚本不引入新的许可义务：只使用已在生产依赖图中、且列在
  `THIRD-PARTY-NOTICES.md` 的 `@napi-rs/canvas`（SVG 光栅化）与 `@fiahfy/icns`（ICNS 容器）。
  `.ico` 由脚本内联编码（Windows Vista+ 支持 PNG 载荷）。
- 这些二进制产物的 Apache-2.0 §4(b) 声明机制见
  [`docs/licensing/MODIFICATIONS.md`](../docs/licensing/MODIFICATIONS.md) 第 3.2 节。
- `packages/desktop/build/dmg_background*.png` **仍是上游 DMG 背景图**，未在本目录内；
  属于发布阻塞项，见 [`docs/licensing/COMPLIANCE.md`](../docs/licensing/COMPLIANCE.md) 第 9 节。

## License and trademark boundary

The official Lumi logo files in this directory (`lumi-mark.svg`, `lumi-app-icon.svg`)
and every icon generated from them (`packages/desktop/build/icon*`,
`packages/desktop/build/icons/*`, `public/logo/icons/*`, `public/icon_512@2x.png`) and the
inline copies of the mark in `LumiBrandMark.tsx`, `aboutWindow.ts` and the empty-state
watermark are the property of **CLOUDJET SOLUTIONS PTE. LTD.** All rights are reserved.
They are **not** licensed under Apache-2.0 or any other licence in this repository; the
"unless a file states otherwise" exception applies to them. They are included only so
official Lumi Agents builds carry the Lumi brand. A fork or modified distribution must
remove or replace them with its own artwork.

Artwork that was previously published here under Apache-2.0 (the interim folded-L mark in
earlier history) keeps the copyright permissions already granted for those files; this
change does not retract them. See [TRADEMARKS.md](../TRADEMARKS.md) and [RIGHTS.md](../RIGHTS.md).
