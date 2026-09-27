# Spec: Lumi Agents macOS App Store release

Status: shipped; macOS 27 crash follow-up in progress
Owner: desktop-release

## 1. Problem

The repository currently produces Developer ID `.dmg` and `.zip` artifacts. App
Store Connect/TestFlight requires a Mac App Store signed `.pkg` whose application
bundle uses the registered `app.lumi.agents` App ID.

## 2. Scope

In scope:

- Load the local App Store Connect API key metadata from the ignored root `.env`.
- Build a production `mas` target with electron-builder.
- Require Mac App Store application and installer signing identities and an
  explicit provisioning profile before a package can be produced.
- Validate the resulting `.pkg` signature and optionally upload it with
  iTMSTransporter using App Store Connect JWT credentials.
- Document recovery and credential handling without committing private key data.

Out of scope:

- Generating or storing certificates, provisioning profiles, or private keys in Git.
- Notarizing the Mac App Store package; Apple handles App Store distribution signing
  and processing for this channel.
- Automatically submitting the build for App Review or enabling external testers.

## 3. Ownership and invariants

| Concern                   | Single owner                            | Invariant                                                                  |
| ------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| Product/bundle identity   | `desktop-product-identity.mjs`          | Production remains `Lumi Agents` / `app.lumi.agents`.                      |
| MAS package configuration | `electron-builder.config.js`            | `ZCODE_MAC_TARGET=mas` selects only the `mas` target and MAS entitlements. |
| Release admission         | `scripts/build-macos-app-store-pkg.mjs` | Missing key, identities, profile, macOS host, or signature fails closed.   |
| API authentication        | App Store Connect JWT/Transporter       | `.p8` is read locally and never printed or committed.                      |

## 4. Release flow

```text
ignored .env + .p8
        ↓
release script validates credentials/profile/identities
        ↓
desktop build → electron-builder mas target → signed .pkg
        ↓
pkgutil signature check → optional iTMSTransporter upload
        ↓
Apple processing → App Store Connect/TestFlight readback
```

The script does not claim TestFlight availability after upload; the build must
be processed by Apple and independently read back from App Store Connect.

## 5. Configuration contract

Required API variables:

- `APPLE_API_KEY`: path to `AuthKey_3XJ664VDDN.p8`.
- `APPLE_API_KEY_ID`: `3XJ664VDDN`.
- `APPLE_API_ISSUER`: the App Store Connect issuer UUID.

Required MAS signing variables are provisioned outside Git:

- `MAS_APP_SIGNING_IDENTITY` or `CSC_NAME` (normally an `Apple Distribution`
  certificate; older teams may expose `3rd Party Mac Developer Application`).
- `MAS_INSTALLER_IDENTITY` or `CSC_INSTALLER_NAME` (a `3rd Party Mac Developer
Installer` certificate).
- `MAS_PROVISIONING_PROFILE` or `PROVISIONING_PROFILE`.

For the MAS target, the release script validates the requested app and
installer identities, then deliberately lets electron-builder auto-discover
the two certificate types from the login keychain. A single `CSC_NAME`
qualifier cannot represent both certificates: electron-builder reuses that
qualifier for the installer lookup, which can make a valid app certificate
appear to have no matching installer identity. The identity names remain
operator inputs and validation evidence; they are not forwarded as one shared
qualifier.

The `.env` file and `.p8` files are ignored by Git. CI must provide equivalent
values through protected secrets/files.

## 6. Acceptance scenarios

1. `pnpm build:macos:mas` fails before building when any MAS signing prerequisite
   is absent.
2. With valid credentials and signing material, it produces exactly one `.pkg`
   for the production `app.lumi.agents` identity.
3. `pnpm release:macos:mas -- --upload` validates the package before invoking
   Transporter and does not submit review or activate testers.
4. API key contents never appear in command output, logs, or tracked files.
5. MAS packaging resolves `app.asar` and packaged resources through the macOS
   `.app/Contents/Resources` layout when electron-builder reports the platform
   as either `darwin` or `mas`.
6. MAS packaging uses certificate-type auto-discovery after validating both
   requested identities, so app signing and installer wrapping select their
   respective keychain identities independently.
7. Every nested MAS executable receives the sandbox entitlement, MAS-only
   bundled tools are signed instead of ignored, and the embedded profile is
   readable by the installed non-root user.
8. The release script temporarily makes only the profile source readable while
   electron-builder embeds it, then restores its original restrictive mode.
9. MAS entitlements remain a subset of the provisioning profile; no unused
   App Group entitlement is auto-generated, and `MAS_BUILD_VERSION` can advance
   the build number without creating a new App Store version.
10. The MAS runtime must use the selected Electron stable line validated for the
    current macOS release. Electron `41.0.3` is not an acceptable runtime for
    macOS 27 after the observed V8/JIT `EXC_BREAKPOINT` crash on
    `ThreadPoolSingleThreadForegroundBlocking0`; the replacement target is
    Electron `44.3.0`.

## 7. macOS 27 crash evidence and remediation decision

The supplied crash logs for App Store version `3.14.0`, build `3.14.1`, show
the same native failure on macOS `27.2 (26B5086k)` and Apple Silicon:

- `EXC_BREAKPOINT (SIGTRAP)` / signal code 5;
- faulting thread `ThreadPoolSingleThreadForegroundBlocking0`;
- Electron Framework/V8 compile/JIT frames, with network-configuration worker
  activity in the same process;
- Electron Framework version `41.0.3`.

This is a runtime failure inside the MAS-sandboxed Electron/V8 stack, not an
App Store metadata, profile, or App Group entitlement failure. The remediation
owner is the Electron runtime version in `packages/desktop/package.json` and
the matching `electronVersion` in `electron-builder.config.js`. The release
gate must rebuild and launch-test the actual signed `.pkg` before submitting a
replacement App Store build.
