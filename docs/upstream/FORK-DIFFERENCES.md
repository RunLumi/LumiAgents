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
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------- | ------------------------------------------------- | ----------------------------------------------- | ---------------------- | --- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/scripts/desktop-product-identity.mjs` | production `appId → app.lumi.agents`, `productName → Lumi Agents`, `linuxExecutableName/linuxPackageName → lumi-agents`; preview → `app.lumi.agents.preview` / `Lumi Agents Preview` / `lumi-agents-preview` | Application/bundle identity                                 |                                         | `packages/desktop/package.json`                   | `productName → Lumi Agents`, description/author | Installer display name |     | `packages/desktop/electron-builder.config.js` | explicit `copyright: "Copyright © 2026 Lumi"`, `extraMetadata.author.name → Lumi`, and the macOS sign-without-identity guard now covers every flavor | Packaged `NSHumanReadableCopyright` and fail-closed signing; upstream attribution stays in LICENSE / NOTICE.md / THIRD-PARTY-NOTICES.md |
| `packages/desktop/scripts/bundle.mjs`                   | runs notarize + signing gate after electron-builder when macOS signing is enabled                                                                                                                            | Signed-build verification                                   |
| `scripts/notarize-macos-release.mjs`                    | **new** notarytool submit + staple stage (env credentials only)                                                                                                                                              | Notarization                                                |
| `scripts/verify-macos-release-signing.mjs`              | **new** fail-closed gate for Developer ID / hardened runtime / entitlements / staple                                                                                                                         | Verification gate                                           |
| `scripts/doctor-macos-release-app.sh`                   | default app path → `/Applications/Lumi Agents.app`                                                                                                                                                           | Branding                                                    |                                         | `docs/upstream/MACOS-SIGNING-AND-NOTARIZATION.md` | **new** runbook                                 | Maintenance            |
| `.github/workflows/macos-release.yml`                   | **new** tag-triggered build/sign/notarize/gate/publish pipeline (uploads only after the gate)                                                                                                                | Release CI for the Lumi identity                            |
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

## Brand assets (original, generated)

| File                                                                                             | Change                                                                                          | Reason                                      |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `brand/lumi-mark.svg`, `brand/lumi-app-icon.svg`, `brand/README.md`                              | **new** original interim folded-L geometry (two planes + 45° channel)                           | Replace upstream ZCode artwork              |
| `scripts/build-lumi-brand-assets.mjs`                                                            | **new** reproducible pipeline: SVG → PNG set, `.icns`, `.ico` for desktop + `public/logo/icons` | Deterministic, reviewable, no manual export |
| `packages/desktop/build/icon*`, `build/icons/*`, `public/logo/icons/*`, `public/icon_512@2x.png` | regenerated from `brand/` (upstream artwork replaced)                                           | Platform icons                              |
| `packages/ui/src/components/ui/LumiBrandMark.tsx`                                                | **new** inline mark; replaces `ZCodeAboutLogo.tsx`                                              | Product logo in UI                          |
| `packages/ui/src/assets/Z.svg`, `packages/ui/src/components/ui/ZCodeAboutLogo.tsx`               | **deleted** (upstream ZCode artwork)                                                            | Remove upstream product identity            |
| `packages/ui/src/v4/ConversationDraftEmptyState.tsx`                                             | watermark uses the Lumi folded-L outline; upstream dark-only `<img>` variant removed            | Theme/branding                              |
| `packages/desktop/src/main/aboutWindow.ts`                                                       | inline About logo → Lumi mark; dark `color-scheme`/black icon chip → DESIGN.md paper/white      | Branding + light-only theme                 |

## Licensing, attribution, and modification notices

| File                                                                                                                 | Change                                                                                                                                                                                                                       | Reason                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `scripts/lumi-modified-files.mjs`                                                                                    | **new** Apache-2.0 §4(b) manifest + checker + idempotent applier (42 inline files, 35 documented exceptions)                                                                                                                 | Required by Apache-2.0 §4(b)                                                                 |
| `scripts/lumi-drift-rules.mjs`                                                                                       | **new** pure drift expectations (brand, theme, attribution, distribution defaults) — testable                                                                                                                                | Keep the delta honest across upstream sync                                                   |
| `scripts/check-lumi-branding-drift.mjs`                                                                              | now an umbrella: drift rules + §4(b) notices + optional `--against-upstream` manifest sync                                                                                                                                   | Extended compliance check                                                                    |
| `docs/licensing/COMPLIANCE.md`, `docs/licensing/MODIFICATIONS.md`                                                    | **new** provenance, obligations vs safeguards, per-file notice mechanisms, retained references, release blockers                                                                                                             | Required compliance record                                                                   |
| `NOTICE.md`                                                                                                          | added a Lumi section; upstream disclosure sections retained verbatim (renumbered 二–五) and explicitly marked as inherited, **not** Lumi policy                                                                              | §4(d) + truthful attribution                                                                 |
| `README.md`, `README.en.md`                                                                                          | product name, original logo, fork/attribution block, compliance links; upstream community links (Feishu/Discord) removed                                                                                                     | Attribution must be discoverable; Lumi must not present upstream support channels as its own |
| `packages/desktop/src/main/about.ts`, `licensesWindow.ts`                                                            | About shows `Lumi Agents`; **new** offline “Licenses” window renders the packaged `THIRD-PARTY-NOTICES.md` / `LICENSE` / `NOTICE.md`                                                                                         | §4(a)/§4(d) accessibility of legal material                                                  |
| `AGENTS.md`                                                                                                          | documents the Lumi branch constraints and new `pnpm lumi:*` commands                                                                                                                                                         | Durable maintenance record                                                                   |
| `THIRD-PARTY-NOTICES.md`, `third-party/inventory.json`                                                               | regenerated; now carries per-item material-review determinations and the retained license texts                                                                                                                              | Reuse the existing pipeline, no parallel system                                              |
| `scripts/lumi-license-review.mjs`                                                                                    | **new** pure material-review model: required fields, allowed bases, retained-text verification, `reviewRequired` derivation — testable                                                                                       | Close the upstream gaps without a blanket allowlist; keep the gate fail-closed               |
| `third-party/npm-overrides.json`, `copied-components.json`, `embedded-components.json`, `native-search/sources.json` | per-item `materialReview` records with cited registry/archive/revision evidence; `keyv@4.5.4` switched to the real version-applicable LICENSE; the `rust-standard-library` record with a non-existent rust revision replaced | Evidence must be reproducible, not asserted                                                  |
| `third-party/README.md`                                                                                              | **new** material model: evidence classes, review fields, pre-release commands, highest-risk items                                                                                                                            | Durable maintenance record for the license pipeline                                          |
| `packages/ui/test/lumiLicenseReview.test.ts`                                                                         | **new** negative tests: incomplete reviews, missing/empty retained text, text that lacks the declared license's terms, new unreviewed gaps                                                                                   | Prove the gate fails visibly rather than silently passing                                    |

## Independent-distribution safety

| File                                       | Change                                                                                                                                                                     | Reason                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/shared/src/lumiDistribution.ts`  | **new** single seam: `resolveLumiUpdateFeedUrl` / `resolveLumiAutoUpdateEnabled` / `resolveLumiTelemetryEnabled`; records `UPSTREAM_ZCODE_PRODUCT_ORIGIN` as an audit fact | Lumi has no update/telemetry backend; never inherit upstream defaults |
| `packages/shared/src/env.ts`               | `ZCODE_TELEMETRY_ENABLED` no longer hard-coded `true` → opt-in via `LUMI_TELEMETRY` (default **off**)                                                                      | Disable unsolicited upstream product telemetry                        |
| `packages/desktop/src/main/index.ts`       | auto-update `enabled` now requires `resolveLumiAutoUpdateEnabled(process.env)`                                                                                             | Lumi must not install upstream ZCode updates                          |
| `packages/desktop/src/main/autoUpdater.ts` | packaged builds accept only the Lumi feed (`LUMI_UPDATE_FEED_URL`, https); upstream dev-only overrides unchanged                                                           | Explicit configuration instead of an upstream default                 |

## Not done / needs a separate decision

- **Official brand artwork.** `brand/*` is an **interim original mark** authored for this
  fork, not an approved final brand. Replace with the official folded-L set and re-run
  `pnpm lumi:brand-assets`.
- **Upstream DMG background.** `packages/desktop/build/dmg_background(.@2x).png` is still
  upstream promotional artwork; it is bound to the DMG window layout and is a **release
  blocker** (see `docs/licensing/COMPLIANCE.md` §9).
- **Geist / Geist Mono assets.** The canonical stacks are declared, but the fonts
  are not bundled, so hosts without Geist fall back to Noto/system fonts.
- **External release configuration.** Signing identity, notarization, and the
  update feed for `app.lumi.agents` are owned by release engineering and are not
  redirected here. Auto-update stays **off** until they exist.
- **Third-party material completeness.** `node scripts/licenses.mjs check --strict`
  still fails on 19 pre-existing upstream gaps (e.g. `@arms/rum-*`, Skia, QuickJS-NG).
- **Shared data directory / scheme.** Lumi keeps the upstream `ZCode` userData directory
  and `zcode://` registration (deliberate coexistence, no migration performed).
- **Localized long-tail product-name strings** where the overlay's protected
  phrases do not apply — review with translators.
