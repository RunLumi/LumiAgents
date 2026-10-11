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

- 这些是 Lumi 官方品牌图形（不再是过渡用原创标记）。商标边界见 `TRADEMARKS.md`；
  官方图形的版权许可状态以品牌所有者的决定为准（官方品牌仓库目前没有许可文件）。
- 生成脚本不引入新的许可义务：只使用已在生产依赖图中、且列在
  `THIRD-PARTY-NOTICES.md` 的 `@napi-rs/canvas`（SVG 光栅化）与 `@fiahfy/icns`（ICNS 容器）。
  `.ico` 由脚本内联编码（Windows Vista+ 支持 PNG 载荷）。
- 这些二进制产物的 Apache-2.0 §4(b) 声明机制见
  [`docs/licensing/MODIFICATIONS.md`](../docs/licensing/MODIFICATIONS.md) 第 3.2 节。
- `packages/desktop/build/dmg_background*.png` **仍是上游 DMG 背景图**，未在本目录内；
  属于发布阻塞项，见 [`docs/licensing/COMPLIANCE.md`](../docs/licensing/COMPLIANCE.md) 第 9 节。

## License and trademark boundary

The original Lumi artwork source files in this directory are published as covered
repository content under Apache-2.0 unless a file states otherwise. That copyright
license does not grant trademark permission to present a modified distribution as
an official Lumi Agents product or to imply Cloudjet sponsorship or endorsement.
See [TRADEMARKS.md](../TRADEMARKS.md) and [RIGHTS.md](../RIGHTS.md).
