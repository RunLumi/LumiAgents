#!/usr/bin/env node
/**
 * Lumi Agents 品牌资源生成管线（可复现）。
 *
 * 用途：从 brand/ 下的原始 SVG 生成各平台所需的位图与容器格式，避免手工导出、
 * 也避免复制上游 ZCode 的品牌资源。输入只有 brand/ 目录，输出是固定路径集合，
 * 重复运行产生相同字节（除 SVG 输入变化外）。
 *
 * 输出：
 *   packages/desktop/build/icons/<N>x<N>.png      桌面打包图标集
 *   packages/desktop/build/icon.png               应用图标（512）
 *   packages/desktop/build/icon_windows.png       Windows 图标源
 *   packages/desktop/build/icon_installer.png     安装器图标源
 *   packages/desktop/build/icon.icns / .ico       macOS / Windows 容器
 *   packages/desktop/build/icon_installer.icns/.ico
 *   public/logo/icons/<N>x<N>.png                 仓库/Web 文档图标集
 *   public/logo/icons/icon.icns / icon.ico
 *   public/icon_512@2x.png
 *
 * 用法：node scripts/build-lumi-brand-assets.mjs
 *
 * 依赖：@napi-rs/canvas（SVG 光栅化）、@fiahfy/icns（ICNS 容器）。两者都已在
 * workspace 生产依赖图中，不引入新的许可义务。
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Icns, IcnsImage } from "@fiahfy/icns";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_ICON_SVG = path.join(repoRoot, "brand/lumi-app-icon.svg");

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

/** ICNS 容器需要 osType → 尺寸映射（见 @fiahfy/icns supportedIconTypes）。 */
const ICNS_TYPES = [
  { osType: "icp4", size: 16 },
  { osType: "icp5", size: 32 },
  { osType: "icp6", size: 64 },
  { osType: "ic07", size: 128 },
  { osType: "ic08", size: 256 },
  { osType: "ic09", size: 512 },
  { osType: "ic10", size: 1024 },
  { osType: "ic11", size: 32 },
  { osType: "ic12", size: 64 },
  { osType: "ic13", size: 256 },
  { osType: "ic14", size: 512 },
];

/** ICO 里包含的尺寸。全部使用 PNG 载荷（Windows Vista+ 支持）。 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function rasterize(svgBuffer, size) {
  const image = await loadImage(svgBuffer);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);
  return canvas.toBuffer("image/png");
}

/**
 * 生成 Windows ICO 容器。
 * 结构与 electron-builder 期望一致：ICONDIR + ICONDIRENTRY[] + PNG 载荷。
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach((entry, index) => {
    const base = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 0); // width (0 = 256)
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1); // height
    directory.writeUInt8(0, base + 2); // palette colors
    directory.writeUInt8(0, base + 3); // reserved
    directory.writeUInt16LE(1, base + 4); // color planes
    directory.writeUInt16LE(32, base + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

function buildIcns(pngBySize) {
  const icns = new Icns();
  for (const { osType, size } of ICNS_TYPES) {
    const png = pngBySize.get(size);
    if (png) {
      icns.append(IcnsImage.fromPNG(png, osType));
    }
  }
  return icns.data;
}

async function main() {
  const appIconSvg = await readFile(APP_ICON_SVG);
  const pngBySize = new Map();
  for (const size of PNG_SIZES) {
    pngBySize.set(size, await rasterize(appIconSvg, size));
  }

  const buildDir = path.join(repoRoot, "packages/desktop/build");
  const buildIconsDir = path.join(buildDir, "icons");
  const publicIconsDir = path.join(repoRoot, "public/logo/icons");
  await mkdir(buildIconsDir, { recursive: true });
  await mkdir(publicIconsDir, { recursive: true });

  for (const size of PNG_SIZES) {
    const png = pngBySize.get(size);
    await writeFile(path.join(buildIconsDir, `${size}x${size}.png`), png);
    await writeFile(path.join(publicIconsDir, `${size}x${size}.png`), png);
  }

  await writeFile(path.join(buildDir, "icon.png"), pngBySize.get(512));
  await writeFile(path.join(buildDir, "icon_windows.png"), pngBySize.get(256));
  await writeFile(path.join(buildDir, "icon_installer.png"), pngBySize.get(256));
  await writeFile(path.join(repoRoot, "public/icon_512@2x.png"), pngBySize.get(1024));

  const icns = buildIcns(pngBySize);
  const ico = buildIco(
    ICO_SIZES.map((size) => ({ size, png: pngBySize.get(size) })).filter((entry) => entry.png),
  );
  for (const dir of [buildDir, publicIconsDir]) {
    await writeFile(path.join(dir, "icon.icns"), icns);
    await writeFile(path.join(dir, "icon.ico"), ico);
  }
  await writeFile(path.join(buildDir, "icon_installer.icns"), icns);
  await writeFile(path.join(buildDir, "icon_installer.ico"), ico);

  console.log(
    `[lumi-brand] 已生成 ${PNG_SIZES.length} 个 PNG 尺寸、icns(${ICNS_TYPES.length})、ico(${ICO_SIZES.length})；输出到 packages/desktop/build、public/logo/icons。`,
  );
}

await main();
