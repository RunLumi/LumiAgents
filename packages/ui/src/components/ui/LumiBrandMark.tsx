import { cn } from "@/components/lib/utils.js";

/**
 * Lumi Agents 折叠 L 标记（自定义原创图形）。
 *
 * 几何：竖直平面 + 水平平面，由一道精确的 45° 通道分开，通道从内角延伸到左下外沿。
 * 与 brand/lumi-mark.svg、brand/lumi-app-icon.svg 同源，见 DESIGN.md §2。
 *
 * 这是**过渡用原创标记**，不是已批准的最终品牌资产；取得官方 folded-L 原图后整体替换
 * （含 scripts/build-lumi-brand-assets.mjs 生成的平台图标）。
 *
 * 替换原因：上游 ZCodeAboutLogo 使用的是 ZCode 图形，属于上游产品品牌，不能作为 Lumi 标识。
 */
export function LumiBrandMark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="256"
      height="256"
      viewBox="0 0 256 256"
      fill="none"
      className={cn("shrink-0 text-current", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M56 32H120V160L56 224Z" fill="currentColor" />
      <path d="M120 176L128 168H232V232H64Z" fill="currentColor" fillOpacity="0.55" />
    </svg>
  );
}
