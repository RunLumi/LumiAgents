# Lumi Agents 品牌资产源

本目录是 Lumi Agents **原创品牌图形的唯一来源**。平台所需的位图与容器格式都由
[`scripts/build-lumi-brand-assets.mjs`](../scripts/build-lumi-brand-assets.mjs) 从这里确定性生成，
不手工导出、不复制上游 ZCode 资源。

```bash
node scripts/build-lumi-brand-assets.mjs   # 或 pnpm lumi:brand-assets
```

## 文件

| 文件                | 用途                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| `lumi-mark.svg`     | 单色折叠 L 标记（`currentColor`，两平面用不透明度区分），用于 UI 内联图形           |
| `lumi-app-icon.svg` | 应用图标版：暖纸圆角方底 + 双色折叠 L（Lumi Blue `#006093` / Civic Navy `#102A43`） |

## 几何

折叠 L 由**两个多边形平面**组成，之间是一道精确的 45° 通道（对应 `DESIGN.md` §2
「two planes divided by a precise diagonal channel」）：

```
Plane A（竖直平面）: M56 32 H120 V160 L56 224 Z         区域 x+y <= 280
Plane B（水平平面）: M120 176 L128 168 H232 V232 H64 Z  区域 x+y >= 296
```

通道位于 `x+y = 280` 与 `x+y = 296` 之间，从内角延伸到左下外沿。图标版给标记留出
约 1.2× 的四周留白（`DESIGN.md` §2.3 要求清空区至少等于通道宽度）。

## 生成产物

| 产物                                                                          | 用途                          |
| ----------------------------------------------------------------------------- | ----------------------------- |
| `packages/desktop/build/icons/<N>x<N>.png`                                    | 桌面打包图标集（16…1024）     |
| `packages/desktop/build/icon.png` / `icon_windows.png` / `icon_installer.png` | 应用 / Windows / 安装器图标源 |
| `packages/desktop/build/icon.icns` / `icon.ico` / `icon_installer.*`          | macOS / Windows 容器          |
| `public/logo/icons/*`、`public/icon_512@2x.png`                               | 仓库与 Web 文档用图标         |

## 重要说明

- **这是过渡用原创标记，不是已批准的最终品牌资产。** 取得官方 folded-L 原图后，替换
  本目录的 SVG 并重新运行生成脚本即可，无需改动 `packages/ui/src/components/ui/LumiBrandMark.tsx`
  以外的代码（该组件需要同步内联路径）。
- 生成脚本不引入新的许可义务：只使用已在生产依赖图中、且列在
  `THIRD-PARTY-NOTICES.md` 的 `@napi-rs/canvas`（SVG 光栅化）与 `@fiahfy/icns`（ICNS 容器）。
  `.ico` 由脚本内联编码（Windows Vista+ 支持 PNG 载荷）。
- 这些二进制产物的 Apache-2.0 §4(b) 声明机制见
  [`docs/licensing/MODIFICATIONS.md`](../docs/licensing/MODIFICATIONS.md) 第 3.2 节。
- `packages/desktop/build/dmg_background*.png` **仍是上游 DMG 背景图**，未在本目录内；
  属于发布阻塞项，见 [`docs/licensing/COMPLIANCE.md`](../docs/licensing/COMPLIANCE.md) 第 9 节。
