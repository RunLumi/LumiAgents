// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
type WebThemeSeed = "light" | "dark" | "zai-light" | "zai-dark" | "system";

// Lumi Agents 是 light-only（DESIGN.md §5）：Web 端默认与已保存偏好都收敛到 light。
export const WEB_DEFAULT_THEME: WebThemeSeed = "light";

function isWebThemeSeed(value: unknown): value is WebThemeSeed {
  return (
    value === "light" ||
    value === "dark" ||
    value === "zai-light" ||
    value === "zai-dark" ||
    value === "system"
  );
}

function normalizeWebThemeSeed(theme: WebThemeSeed): WebThemeSeed {
  // 旧的 dark / zai-dark 偏好统一收敛到 light，`system` 保留但由渲染层解析为 light。
  if (theme === "dark" || theme === "zai-dark") return "light";
  if (theme === "light") return "zai-light";
  return theme;
}

export function resolveWebInitialTheme({
  storedTheme,
  defaultTheme = WEB_DEFAULT_THEME,
}: {
  storedTheme?: string | null;
  defaultTheme?: WebThemeSeed;
}): WebThemeSeed {
  if (isWebThemeSeed(storedTheme)) {
    return normalizeWebThemeSeed(storedTheme);
  }

  return normalizeWebThemeSeed(defaultTheme);
}
