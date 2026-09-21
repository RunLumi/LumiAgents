# Fork differences: Lumi Agents ↔ upstream ZCode

This file is the manifest of **intentional** differences from upstream
[zai-org/ZCode](https://github.com/zai-org/ZCode). Every difference below is
justified by branding, application identity, the DESIGN.md visual contract, or
necessary validation/maintenance support. Nothing else is changed.

## Baseline

| Item                          | Value                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Our branch                    | `main`                                                                                                   |
| Upstream remote               | `https://github.com/zai-org/ZCode` (`upstream`)                                                          |
| Upstream `main` at last check | `872ad960de7ec172591f7e1952f7849229f94521`                                                               |
| Merge base                    | `872ad960de7ec172591f7e1952f7849229f94521`                                                               |
| Fork delta                    | same commit as upstream `main` at the time of this change; the working tree carries the fork edits below |

## Identity (packaged / runtime)

| File                                                    | Change                                                                                                                                                                                                       | Reason                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------- |
| `packages/desktop/scripts/desktop-product-identity.mjs` | production `appId → app.lumi.agents`, `productName → Lumi Agents`, `linuxExecutableName/linuxPackageName → lumi-agents`; preview → `app.lumi.agents.preview` / `Lumi Agents Preview` / `lumi-agents-preview` | Application/bundle identity                                 |
| `packages/desktop/package.json`                         | `productName → Lumi Agents`, description/author                                                                                                                                                              | Installer display name                                      |
| `packages/desktop/src/main/desktopRuntimeEnv.ts`        | `runtimeApplicationName → Lumi Agents [Dev                                                                                                                                                                   | Preview]`; **new** `runtimeUserDataDirName`pinned to`ZCode` | Display name vs. user-data preservation |

`ZCODE_PREVIEW_IDENTITY`, `ZCODE_ENV`, `ZCODE_DESKTOP_*` and every other
environment variable keep their upstream names. The `zcode://` protocol scheme is
unchanged (only the protocol **display name** follows the product name), as are
all `@zcode/*` packages, source paths, CLI command, and protocol identifiers.

## Product name in UI

| File                                                                                                                                                                                    | Change                                                                                                                                        | Reason                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/ui/src/lib/productBrand.ts`                                                                                                                                                   | **new** single source of truth for the product name                                                                                           | Centralized branding                                           |
| `packages/ui/src/i18n/lumiBrandingOverlay.ts`                                                                                                                                           | **new** overlay applied at `formatMessage`, replaces the standalone `ZCode` product token, protects `ZCode Agent` / `ZCode CDN` / `ZCode CLI` | Centralized branding without editing 80+ upstream locale lines |
| `packages/ui/src/i18n/IntlProvider.tsx`                                                                                                                                                 | wire the overlay at the single `formatMessage` exit                                                                                           | Integration point                                              |
| `packages/ui/src/i18n/locales/{en-US,zh-CN}.ts`                                                                                                                                         | `resourceManager.appUsage` label only                                                                                                         | Branding that the overlay cannot express alone                 |
| logo alt / aria-label seams (`WindowsTopLeftLogo`, `WorkspaceSidebarCollapsedRail`, `DesktopTopOverlay`, `WelcomeScreen`, `onboarding/OnboardingWelcomeView`, `WorkspaceSidebarFooter`) | use `PRODUCT_NAME`                                                                                                                            | Branding                                                       |
| `packages/desktop/src/main/forceUpdatePrompt.ts`                                                                                                                                        | update-dialog copy uses `Lumi Agents`                                                                                                         | Branding                                                       |

The localized long-tail (e.g. “ZCode Agent”, “ZCode CDN”) is intentionally left to
the overlay's protected list so upstream text keeps working.

## Light-only theme

DESIGN.md §5 is light-only. The upstream dark theme implementation is **preserved
in `styles.css`** (`.dark`, `.theme-zai-dark`) but made unreachable.

| File                                                                                                                                                                    | Change                                                                                                                                         | Reason                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `packages/ui/src/styles.css`                                                                                                                                            | **new** `.theme-lumi` token layer (DESIGN.md §5 palette, paper/ink tokens, terminal, diff, charts); Geist / Geist Mono font stacks in `@theme` | Centralized theme layer |
| `packages/ui/src/useTheme.ts`                                                                                                                                           | `resolveTheme` returns `light`; `applyTheme` applies `theme-lumi`, removes `dark`/`theme-zai-*`; saved `dark` preferences normalize to `light` | Force light-only        |
| `packages/ui/src/store/index.ts`                                                                                                                                        | default theme `light`                                                                                                                          | Force light-only        |
| `packages/desktop/src/renderer/src/main.tsx`, `resource-manager.tsx`                                                                                                    | startup theme seed applies `theme-lumi`                                                                                                        | Startup surface         |
| `packages/web/src/main.tsx`, `packages/web/src/webThemeSeed.ts`, `packages/web/index.html`                                                                              | web seed defaults/forces light, Geist font, paper startup shell, `Inter` removed                                                               | Startup / web surface   |
| `packages/desktop/src/renderer/index.html`                                                                                                                              | paper startup shell, title `Lumi Agents`                                                                                                       | Startup surface         |
| `packages/ui/src/settings/model-provider-section/codingPlanEmbeddedWebview.ts`                                                                                          | embedded webview forced light                                                                                                                  | Dialog surface          |
| `packages/desktop/src/main/aboutWindow.ts`, `forceUpdatePrompt.ts`, `windowsCuaOperationIndicatorContent.ts`, `packages/desktop/src/renderer/cua-permission-panel.html` | removed `prefers-color-scheme: dark` blocks                                                                                                    | Dialog surfaces         |

## Maintenance support

| File                                                    | Change              | Reason                                             |
| ------------------------------------------------------- | ------------------- | -------------------------------------------------- |
| `docs/specs/lumi-agents/01-brand-identity-and-theme.md` | spec                | AGENTS.md requires a spec before behavior changes  |
| `docs/upstream/FORK-DIFFERENCES.md`                     | this manifest       | Upstream maintenance                               |
| `docs/upstream/UPSTREAM-SYNC.md`                        | runbook             | Upstream maintenance                               |
| `scripts/check-lumi-branding-drift.mjs`                 | drift check         | Fails visibly instead of silently rewriting source |
| `package.json`                                          | `lumi:drift` script | Discoverability                                    |

## Not done / needs a separate decision

- **Brand artwork.** `packages/desktop/build/*`, `public/logo/*`, and the inline
  logos still use the upstream mark. Replacing them needs the official folded-L
  asset set and platform icon pipeline; not authored here.
- **Geist / Geist Mono assets.** The canonical stacks are declared, but the fonts
  are not bundled, so hosts without Geist fall back to Noto/system fonts.
- **External release configuration.** Signing identity, notarization, and the
  update feed for `app.lumi.agents` are owned by release engineering and are not
  redirected here.
- **Localized long-tail product-name strings** where the overlay's protected
  phrases do not apply — review with translators.
