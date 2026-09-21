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

## 6. External configuration required (not done here)

- Code signing identity, notarization credentials, and update feed for `app.lumi.agents`
  must be provisioned by release owners; no service is redirected by this change.
- Geist / Geist Mono font assets are not bundled in this repository; the canonical stack
  is declared and falls back to system UI fonts until assets are added.
