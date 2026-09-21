/**
 * Lumi Agents 产品品牌字符串的唯一来源。
 *
 * 仅用于用户可见的产品名展示（logo alt、侧栏兜底、用量标签、更新提示）。
 * 不要在这里改内部标识：`@zcode/*` 包名、`ZCODE_*` 环境变量、`zcode://` scheme、
 * `zcode` CLI 命令与协议字段都必须保持上游兼容，见 docs/upstream/FORK-DIFFERENCES.md。
 *
 * 打包态应用名由 desktop 进程 `runtimeApplicationName`（app.setName）决定，
 * 这里只覆盖 renderer/web 直接渲染产品名文案的场景。
 */
export const PRODUCT_NAME = "Lumi Agents";

export const PRODUCT_NAME_PREVIEW = "Lumi Agents Preview";

export const PRODUCT_NAME_DEV = "Lumi Agents Dev";
