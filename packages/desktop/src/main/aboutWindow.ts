// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
interface CustomAboutDialogHtmlInput {
  applicationName: string;
  appVersion: string;
  /** Fork developer/maintainer identity; not a copyright ownership claim. */
  maintainerCredit?: string;
  /** Retained for callers that explicitly supply a copyright notice. */
  copyright?: string;
  optimizationLine: string;
  versionLabel: string;
  okButtonLabel: string;
  /**
   * 新增：离线许可入口文案。为空则不渲染该按钮。
   * 原因：让用户容易找到随包提供的许可与 NOTICE 材料。
   * 这是可发现性设计；Apache-2.0 §4 并未指定必须使用 About 按钮。
   */
  licensesButtonLabel?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createCustomAboutDialogHtml(input: CustomAboutDialogHtmlInput): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    />
    <title>${escapeHtml(input.applicationName)}</title>
    <style>
      :root {
        /* 修改原因：Lumi 是 light-only 主题（DESIGN.md §5、docs/upstream/FORK-DIFFERENCES.md），
           原来的 light dark 取值会让 About 窗口在本机深色系统下继续渲染深色。 */
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
        --startup-page-bg: #f4f0e8;
        --about-primary: #006093;
        --about-primary-foreground: #ffffff;
        --about-primary-active: color-mix(in oklab, var(--about-primary) 80%, transparent);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: var(--startup-page-bg);
      }

      body {
        display: grid;
        place-items: center;
        padding: 0;
        user-select: none;
      }

      .about-window {
        width: 100%;
        max-width: 256px;
        height: 280px;
        display: grid;
        place-items: stretch;
        padding: 0;
        background: transparent;
      }

      .about-card {
        width: 100%;
        height: 100%;
        padding: 22px 15px 14px;
        display: flex;
        flex-direction: column;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #102a43;
        box-shadow: none;
        -webkit-app-region: drag;
      }

      .content {
        width: 100%;
        max-width: 222px;
        margin: 0 auto;
        flex: 1;
        min-height: 0;
      }

      /* 修改原因：去掉固定深色底/发光阴影，改为 DESIGN.md 的白色卡片 + 温和边框。 */
      .app-icon {
        width: 52px;
        height: 52px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(16, 42, 67, 0.12);
        border-radius: 12px;
        background: #ffffff;
        color: #006093;
        box-shadow: none;
      }

      .app-logo {
        width: 30px;
        height: auto;
        display: block;
      }

      .title {
        margin: 20px 0 0;
        font-size: 13.5px;
        line-height: 1.18;
        font-weight: 700;
        letter-spacing: 0;
      }

      .meta {
        margin-top: 28px;
        display: flex;
        flex-direction: column;
        gap: 17px;
        font-size: 13px;
        line-height: 1.2;
        font-weight: 400;
        letter-spacing: 0;
        color: #3d5266;
      }


      .ok-button {
        width: 100%;
        height: 36px;
        border: 0;
        border-radius: 18px;
        background: var(--about-primary);
        color: var(--about-primary-foreground);
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0;
        outline: none;
        cursor: default;
        -webkit-app-region: no-drag;
      }

      .ok-button:active {
        background: var(--about-primary-active);
      }

      .licenses-button {
        width: 100%;
        height: 30px;
        margin-top: 8px;
        border: 1px solid rgba(16, 42, 67, 0.16);
        border-radius: 15px;
        background: transparent;
        color: #006093;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        outline: none;
        cursor: default;
        -webkit-app-region: no-drag;
      }

    </style>
  </head>
  <body>
    <main class="about-window" aria-label="${escapeHtml(input.applicationName)} About Window">
      <section class="about-card" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <div class="content">
          <div class="app-icon" aria-hidden="true">
            <!--
              修改原因：原样使用上游 ZCode 图形会继续展示上游产品标识。
              这里改为原创的 Lumi 折叠 L 标记（与 brand/lumi-mark.svg 同源）。
            -->
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="52"
              height="52"
              fill="none"
              viewBox="0 0 256 256"
              class="app-logo"
              focusable="false"
            >
              <path fill="currentColor" d="M56 32H120V160L56 224Z" />
              <path fill="currentColor" fill-opacity="0.55" d="M120 176L128 168H232V232H64Z" />
            </svg>
          </div>
          <h1 id="about-title" class="title">
            ${escapeHtml(input.applicationName)}<br />
            ${escapeHtml(input.versionLabel)} ${escapeHtml(input.appVersion)}
          </h1>
          <div class="meta">
            ${input.optimizationLine ? `<div>${escapeHtml(input.optimizationLine)}</div>` : ""}
            ${input.maintainerCredit ? `<div>${escapeHtml(input.maintainerCredit)}</div>` : ""}
            ${input.copyright ? `<div>${escapeHtml(input.copyright)}</div>` : ""}
          </div>
        </div>
        <div class="spacer"></div>
        ${input.licensesButtonLabel ? `<button class="licenses-button" type="button" id="licenses-button">${escapeHtml(input.licensesButtonLabel)}</button>` : ""}
        <button class="ok-button" type="button" autofocus>${escapeHtml(input.okButtonLabel)}</button>
      </section>
    </main>
    <script>
      const closeWindow = () => window.close();
      document.querySelector(".ok-button")?.addEventListener("click", closeWindow);
      // 通过 window.open 触发主进程的 setWindowOpenHandler，无需 preload/IPC 通道。
      document.getElementById("licenses-button")?.addEventListener("click", () => {
        window.open("zcode-about://licenses");
      });
      window.addEventListener("keydown", (event) => {
        // 修改原因：Enter 由聚焦按钮原生处理，否则打开致谢时也会关闭父窗口。
        if (event.key === "Escape") {
          closeWindow();
        }
      });
    </script>
  </body>
</html>`;
}
