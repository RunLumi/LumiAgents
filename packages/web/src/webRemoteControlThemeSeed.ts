// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
import { isWebRemoteControlThemeSeed, type WebRemoteControlThemeSeed } from "@zcode/shared";

// Lumi Agents 是 light-only（DESIGN.md §5）：Web/手机远控默认与已保存偏好都收敛到 light。
export const WEB_REMOTE_CONTROL_DEFAULT_THEME: WebRemoteControlThemeSeed = "light";

function normalizeWebRemoteControlThemeSeed(
  theme: WebRemoteControlThemeSeed,
): WebRemoteControlThemeSeed {
  // 旧的 dark / zai-dark 偏好（含扫码继承的桌面主题）统一收敛到 light，`system` 由渲染层解析为 light。
  if (theme === "dark" || theme === "zai-dark") return "light";
  if (theme === "light") return "zai-light";
  return theme;
}

export function resolveWebRemoteControlInitialTheme({
  storedTheme,
  qrTheme,
  defaultTheme = WEB_REMOTE_CONTROL_DEFAULT_THEME,
}: {
  storedTheme?: string | null;
  qrTheme?: string | null;
  defaultTheme?: WebRemoteControlThemeSeed;
}): WebRemoteControlThemeSeed {
  if (isWebRemoteControlThemeSeed(storedTheme)) {
    return normalizeWebRemoteControlThemeSeed(storedTheme);
  }

  if (isWebRemoteControlThemeSeed(qrTheme)) {
    return normalizeWebRemoteControlThemeSeed(qrTheme);
  }

  return normalizeWebRemoteControlThemeSeed(defaultTheme);
}

export function seedWebRemoteControlThemePreference(qrTheme?: string | null): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  const storedTheme = localStorage.getItem("zcode-theme");
  const resolvedTheme = resolveWebRemoteControlInitialTheme({ storedTheme, qrTheme });
  if (!storedTheme && isWebRemoteControlThemeSeed(qrTheme)) {
    // Bugfix: 手机远控首次打开原来只用 Web 默认主题，无法继承扫码时桌面端主题。
    // 这里只在手机本地还没有主题偏好时写入一次，后续手机改主题不会反向影响桌面端。
    localStorage.setItem("zcode-theme", resolvedTheme);
  }
}
