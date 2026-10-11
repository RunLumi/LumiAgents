import { cn } from "@/components/lib/utils.js";

/**
 * Lumi 官方折叠 L 标记。
 *
 * 几何与配色原样取自 RunLumi/brand.runlumi 的 lumi-logo.svg（与 brand/lumi-mark.svg 同源）：
 * 竖直平面 #019EDD、水平平面 #0162A4。不要改比例或颜色；换图须先更新 brand/ 再同步这里。
 * `tone="mono"` 对应官方单色版（lumi-white-logo / lumi-black-logo）：两平面同色，取 currentColor，
 * 用于品牌蓝底等深色底上的白色标记。
 *
 * 替换原因：上游 ZCodeAboutLogo 使用的是 ZCode 图形，属于上游产品品牌，不能作为 Lumi 标识。
 */
export function LumiBrandMark({
  className,
  tone = "color",
}: {
  className?: string;
  tone?: "color" | "mono";
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="256"
      height="256"
      viewBox="0 0 500 500"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <g transform="translate(91.5 51.5)">
        <path
          d="M99.4558 0C99.4558 99.4558 99.3907 198.912 99.3257 298.302C66.2171 331.151 33.1086 363.934 0 396.782C0 297.327 0 197.871 0 98.4801C33.1086 65.6317 66.2822 32.8484 99.3907 0H99.4558Z"
          fill={tone === "mono" ? "currentColor" : "#019EDD"}
        />
        <path
          d="M126.71 298.302C189.935 298.302 253.16 298.302 316.45 298.302C283.406 331.086 250.363 363.934 217.385 396.717C154.355 396.717 91.3248 396.717 28.2949 396.717C61.1433 363.869 93.9266 331.086 126.775 298.237L126.71 298.302Z"
          fill={tone === "mono" ? "currentColor" : "#0162A4"}
        />
      </g>
    </svg>
  );
}
