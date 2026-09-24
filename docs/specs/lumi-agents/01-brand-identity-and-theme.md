# Spec: Lumi Agents brand identity and light-only theme

Status: implementing
Owner: desktop-shell + design-system
Upstream baseline: `872ad96` (`feat: open source`) on `origin/main` (github.com/RunLumi/LumiAgents)
Upstream project: https://github.com/zai-org/ZCode

## 1. Problem

This repository is a fork of ZCode. The product must present as **Lumi Agents** while
keeping every upstream capability, protocol, package name, CLI command, environment
variable, and schema intact. The visual surface must follow the local `DESIGN.md`
(Lumi Design System): warm-paper, light-only, Geist/Geist Mono, folded-L, civic-ink
editorial language.

## 2. Scope

In scope:

- User-facing product name changes to `Lumi Agents` (and `Lumi Agents Preview` for the
  preview flavor).
- Desktop application identity: `appId`, bundle identifier, Windows AppUserModelId,
  Linux executable/package names, installer display name, protocol display name.
- A single UI product-brand constant consumed by display seams (logo alt text, sidebar
  fallback name, resource usage label, update dialogs).
- A thin, centralized Lumi theme layer (`.theme-lumi`) that resolves the DESIGN.md
  tokens, plus forcing the resolved theme to light on desktop and web.
- Maintenance artifacts: fork-difference manifest, upstream-sync runbook, branding/theme
  drift check.

Out of scope (explicitly not done):

- Global replacement of `ZCode`. Internal `@zcode/*` package names, source paths,
  `ZCODE_*` environment variables, `zcode://` protocol scheme, `zcode` CLI command,
  and protocol identifiers are preserved.
- Adding any feature or screen from DESIGN.md companion-product examples
  (CEO Brief, Daily Pulse, mobile shells, `frontend/` paths).
- Introducing a new styling framework or font package.
- Publishing a release, merging to `main`, or redirecting any production service.

## 3. Ownership

| Concern                               | Single owner                                                 | Consumers                                                              |
| ------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Desktop packaged identity             | `packages/desktop/scripts/desktop-product-identity.mjs`      | electron-builder config, bundle scripts, AUMID, deep-link registration |
| Runtime application name / data paths | `packages/desktop/src/main/desktopRuntimeEnv.ts`             | `app.setName`, menus, dialogs, crash capture, OAuth deep link          |
| UI product brand string               | `packages/ui/src/lib/productBrand.ts`                        | logo alt text, sidebar fallback, resource usage label, i18n overrides  |
| Theme tokens                          | `packages/ui/src/styles.css` (`.theme-lumi`)                 | every UI surface via semantic `--color-*` tokens                       |
| Theme resolution                      | `packages/ui/src/useTheme.ts` (`resolveTheme`, `applyTheme`) | store, App shell, code/terminal/diff surfaces                          |
| Maintenance artifacts                 | `docs/upstream/`                                             | maintainers                                                            |

No second source of truth is introduced for any of the above.

## 4. Interfaces

### 4.1 Packaged identity (`desktop-product-identity.mjs`)

```
production: { appId: "app.lumi.agents",        productName: "Lumi Agents",
              linuxExecutableName: "lumi-agents", linuxPackageName: "lumi-agents" }
preview:    { appId: "app.lumi.agents.preview", productName: "Lumi Agents Preview",
              linuxExecutableName: "lumi-agents-preview", linuxPackageName: "lumi-agents-preview" }
```

Environment variable `ZCODE_PREVIEW_IDENTITY` and flavor names stay unchanged
(compatibility-sensitive).

### 4.2 Runtime name and data paths (`desktopRuntimeEnv.ts`)

- `runtimeApplicationName`: `Lumi Agents Dev` (dev) / `Lumi Agents Preview` /
  `Lumi Agents`. Drives `app.setName`, menus, dialogs, crash reports.
- `runtimeUserDataDirName`: stays `ZCode` so Electron `userData` (localStorage,
  session, cache) is **not** orphaned for existing users. Display name and data
  directory name are deliberately decoupled.

### 4.3 UI brand (`packages/ui/src/lib/productBrand.ts`)

```
export const PRODUCT_NAME = "Lumi Agents";
export const PRODUCT_NAME_PREVIEW = "Lumi Agents Preview";
export const PRODUCT_NAME_DEV = "Lumi Agents Dev";
```

### 4.4 Theme

- `resolveTheme(theme)` returns `"light"` for every input (light-only contract).
- `applyTheme` toggles `theme-lumi` on `<html>` and never toggles `dark`.
- `.theme-lumi` in `styles.css` overrides the semantic token set with DESIGN.md values
  and sets `color-scheme: light`. Upstream `.dark` / `.theme-zai-*` blocks are preserved
  but unreachable.

## 5. Acceptance scenarios

1. **Packaged identity** — `resolveDesktopProductIdentity()` for production returns
   `app.lumi.agents` / `Lumi Agents`; preview returns `app.lumi.agents.preview` /
   `Lumi Agents Preview`. `ZCODE_ENV=test` still yields preview.
2. **Display name** — `app.setName` receives `Lumi Agents` in a packaged production
   build; the application menu, About panel, and update dialogs show `Lumi Agents`.
3. **User data preserved** — `runtimeUserDataPath` is unchanged from the pre-rebrand
   path for a given `appData` root.
4. **Light-only render** — with `localStorage["zcode-theme"]` set to `dark` or `system`
   on a dark-mode OS, the app resolves light, `<html>` has `theme-lumi` and not `dark`,
   and `color-scheme` is `light`.
5. **Token parity** — `--color-background` resolves to `#F4F0E8`, `--color-card` to
   `#FFFFFF`, `--color-brand` to `#006093`, `--color-foreground` to `#102A43` under
   `.theme-lumi`.
6. **Upstream untouched** — `pnpm typecheck`, `pnpm lint`, `pnpm fmt:check`, and
   `pnpm architecture:check -- --changed` pass.
7. **Drift check** — `node scripts/check-lumi-branding-drift.mjs` exits non-zero if the
   identity, brand constant, or `.theme-lumi` contract is edited away.

## 5.1 Acceptance scenarios — licensing, assets, distribution safety

Added in the second pass (see `docs/licensing/COMPLIANCE.md` for results):

8. **Original brand assets** — `pnpm lumi:brand-assets` regenerates platform icons from
   `brand/` alone; `packages/ui/src/assets/Z.svg` and `ZCodeAboutLogo.tsx` no longer exist;
   `LumiBrandMark` and the About window draw the Lumi folded-L geometry.
9. **§4(b) modification notices** — `pnpm lumi:notice` passes; every file in `MODIFIED_FILES`
   carries the canonical notice sentence in its header region; JSON/binary entries are
   registered in `NOTICE_EXCEPTIONS` and documented in `docs/licensing/MODIFICATIONS.md`.
10. **Attribution preserved** — `LICENSE` still contains `Copyright 2026 Z.AI Co., Ltd`;
    `NOTICE.md` keeps the upstream disclosure sections verbatim and marks them as inherited
    (not Lumi policy); both READMEs carry the fork/attribution statement.
11. **Auto-update off by default** — with no `LUMI_UPDATE_FEED_URL`, `initAutoUpdater` is
    called with `enabled: false`; a non-https or absent feed never enables it.
12. **Telemetry off by default** — `ZCODE_TELEMETRY_ENABLED` resolves to `false` unless
    `LUMI_TELEMETRY` is truthy; no endpoint is embedded in the build.
13. **Legal material accessible offline** — the About panel exposes a Licenses entry that
    renders the packaged `THIRD-PARTY-NOTICES.md` / `LICENSE` / `NOTICE.md` with no network
    access, and shows an explicit unavailable state when a file is missing.
14. **Drift detection is real** — `packages/ui/test/lumiCompliance.test.ts` proves the
    drift and notice checks fail on representative violations (dark-theme regression,
    restored upstream logo asset, reverted updater/telemetry defaults, removed copyright,
    missing notice, deleted manifest file).

## 6. External configuration required (not done here)

- Code signing identity, notarization credentials, and update feed for `app.lumi.agents`
  must be provisioned by release owners; no service is redirected by this change.
- Geist / Geist Mono font assets are not bundled in this repository; the canonical stack
  is declared and falls back to system UI fonts until assets are added.
- The inherited ZCode DMG background files were subsequently removed; DMGs use a Lumi
  solid background color and no custom upstream image.
- The material-review inventory was subsequently reduced/reconciled to 15 evidence-based
  human-review records with `reviewRequired=0`. The strict gate must still pass on the
  actual PR/release environment; human legal sign-off remains separate from machine success.

## 7. Upstream v3.14.3 integration

The 2026-09-24 sync integrates upstream commit `29628c9`. Upstream documentation now
uses `README.md` for Chinese and `README.en.md` for English. Lumi keeps its existing
`README.md` English and `README.zh.md` Chinese entry points. Both must retain the
Lumi product name, fork attribution, compliance links, and reciprocal language links.
The drift and file-notice lists must name those actual files. Upstream workflow and
bot UI strings continue through the single `applyLumiBranding` display seam; internal
`ZCode` identifiers and protocol terms remain unchanged. Regenerate third-party
notices from the merged production graph before strict license verification.
