// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
import { useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark" | "zai-light" | "zai-dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "zcode-theme";
const BROWSER_THEME_SURFACE_ATTRIBUTE = "data-zcode-browser-theme-surface";

/**
 * Lumi Agents 是 light-only 品牌：DESIGN.md §5 明确没有暗色主题，也没有
 * `prefers-color-scheme` 分支。这里把所有主题偏好都解析为 light，因此代码预览、
 * 终端、diff、编辑器等按明暗分流的组件会一致走浅色路径。
 *
 * 上游的暗色 token（`.dark` / `.theme-zai-dark`）仍保留在 styles.css 中，但不再可达；
 * 保留它们是为了让上游主题实现可对照、可回退，而不是移除上游能力。
 */
export function resolveTheme(_theme: Theme): ResolvedTheme {
  return "light";
}

/**
 * 已保存的深色偏好会被收敛到 light，避免设置页下拉框显示「深色」但界面仍是浅色。
 * `system` 保留为用户可选值，但 resolveTheme 会把它解析成 light。
 */
export function normalizeThemePreference(theme: Theme): Theme {
  if (theme === "dark" || theme === "zai-dark" || theme === "zai-light") {
    return "light";
  }
  return theme;
}

function setThemeMetaContent(name: "theme-color" | "color-scheme", content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.append(meta);
  }
  meta.content = content;
}

function syncBrowserThemeSurface(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (
    typeof root.hasAttribute !== "function" ||
    !root.hasAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE)
  ) {
    return;
  }

  // Electron 为 vibrancy 保持透明根背景，但普通浏览器需要从文档根和标准 meta
  // 获得页面主题。只切换 React 的 dark class 会让浏览器工具栏、原生控件和 overscroll 留在旧主题。
  root.setAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE, resolved);
  root.style.colorScheme = resolved;
  setThemeMetaContent("color-scheme", resolved);

  const background = getComputedStyle(root).getPropertyValue("--color-background").trim();
  if (background) {
    setThemeMetaContent("theme-color", background);
  }
}

export function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  // 唯一的 Lumi 主题层：始终启用 theme-lumi，并清掉上游 dark / zai 主题类。
  // 既保证 light-only，也让旧的 localStorage 主题值不会留下混合状态。
  root.classList.remove("dark", "theme-zai-light", "theme-zai-dark");
  root.classList.add("theme-lumi");
  root.style.colorScheme = "light";
  syncBrowserThemeSurface(resolved);
}

function isTheme(value: string | null): value is Theme {
  return (
    value === "light" ||
    value === "dark" ||
    value === "zai-light" ||
    value === "zai-dark" ||
    value === "system"
  );
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    // Lumi Agents 默认 light；normalizeThemePreference 会把旧的 dark 偏好收敛到 light。
    return isTheme(saved) ? normalizeThemePreference(saved) : "light";
  });

  const setTheme = useCallback((t: Theme) => {
    const normalizedTheme = normalizeThemePreference(t);
    localStorage.setItem(STORAGE_KEY, normalizedTheme);
    setThemeState(normalizedTheme);
    applyTheme(normalizedTheme);
  }, []);

  // 初始化 + system 模式下监听系统偏好变化
  useEffect(() => {
    applyTheme(theme);

    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return { theme, setTheme } as const;
}
