# Lumi control-plane account (DE2E-INT-01)

Status: implementation in progress; product wiring is not yet proven.

Lumi human session is independent from provider/ZCode OAuth. Preserve provider
login, active provider and local credentials. The host owns Lumi session/CSRF
cookies and S256 verifier. Renderer receives safe account projections and a
user approval code, never a session/device credential or PKCE verifier.

The transport uses fixed /api/v1 routes on an HTTPS origin (loopback HTTP for
local testing only). Reject credentials/query/fragment in origins, redirects,
malformed cookies and transport responses. Mutation CSRF derives from the same
session owner. Never export a generic authenticated fetch or credential getter
through renderer RPC. External approval URL is resolved against the fixed origin.
The backend exchange returns cookies, not a JSON bearer token.

Secure persistence must be injected by the Electron main/host boundary and fail
closed when unavailable; the existing renderer-accessible credential service
and predictable fallback cipher are not acceptable custody for Lumi sessions.
The first transport slice has memory-only cookies. Restart restoration and
actual Electron service registration are pending, not satisfied by this slice.

Start/cancel/new sign-in invalidates any earlier in-flight result. A cancelled
flow cannot replace a newer session. Backend currently answers the same denial
reason for pending and expired codes; do not invent a pending protocol. Exchange
is retried after explicit approval, bounded by the returned expiry. Document or
change that contract deliberately before background polling is implemented.

Acceptance: hostile origin/redirect refusal, exact cookie/CSRF propagation,
no token getters/serialization, stale-result rejection, provider-login isolation,
then real browser approval and Electron proof under DE2E-FE-01/QA-01.

## Persistent custody

Electron main owns an origin-keyed vault outside credentials.json, encrypted by
safeStorage after app ready. Reject unavailable encryption and Linux basic_text
or unknown backends. No plaintext fallback and no generic renderer read/delete
channel. Validate a closed session envelope before write and after decryption.
Origin separation prevents a staging account overwriting production; whole-file
locking plus atomic private writes preserve concurrent state. Treat corrupt
records as errors and preserve bytes. Tests inject cryptography, not a claim of
OS keychain proof. Real keychain and authorized host-main wiring remain QA work.

## Desktop integration entry point

Main registers a fixed-action Lumi IPC after app.ready. Account owner is lazy so
an unavailable secure store cannot prevent existing local/provider startup.
Only managed app-window main frames at the exact packaged renderer path or
configured development renderer URL are trusted. Arbitrary origins/routes/keys
cannot be named by renderer commands; guests/subframes/foreign navigation are
refused. Preload exposes safe actions through IPlatformService.lumiAccount;
settings consumes it via usePlatform. Existing provider login remains in place.

General settings has an optional account panel with restore/loading, begin,
browser code matching, explicit completion, cancel, error and logout states.
English and Chinese locale entries follow the existing intl contract. It does
not offer device enrollment or workspace adoption until their packets are wired.
Beginning Lumi sign-in creates a code and returns its fixed-origin approval URL;
opening the browser is a separate explicit UI action through existing platform
openExternal. No authentication attempt silently opens the user's browser.

## Device custody and confirmation

Main device owner is keyed by origin/org/user, with closed OS-encrypted Ed25519
private/public key/fingerprint record and private token. Persist pending identity
before enrollment; persist token before publishing successful enrollment. User
selects an active org/membership and confirms enrollment in UI. Signing in does
not bind workspaces. Restore reuses its own pending/device identity; another
account cannot load the previous user's key. Logout clears account owner cache,
not provider credentials or device evidence. Policy sync and refresh use device
auth, never human cookies. Expired tokens pause managed operations until the signed-in user explicitly starts recovery. Recovery uses a five-minute, one-time challenge issued with the Lumi human session and CSRF proof; only the original enrolled device key may sign the domain-separated challenge. The backend atomically consumes the challenge, rotates the token, and audits success. Anonymous nonce access, key regeneration, and silent re-enrollment never recover an expired device. See control-plane P03-CR-002 and DE2E-INT-02 runtime evidence.

### Main OS identity vs application state root

Status: candidate, not yet verified; behavior implemented by the workspace
adoption cut (see `05-workspace-adoption-runtime.md`).

Two contexts are distinct and must not be conflated in logs or manifests:

1. **Native OS keystore context** (Main only): the real OS account HOME that
   macOS Keychain / `safeStorage` need. A test profile or explicit app root never
   replaces, mocks or bypasses it; unavailable encryption stays fail-closed.
2. **Main application state root** (`ZCODE_DATA_BASE_DIR`, and the existing
   `ZCODE_DESKTOP_USER_DATA_DIR` / `..._SESSION_DATA_DIR`): explicit roots.

Rules: Main resolves its bootstrap home and `setting.json` through one boundary
(`getBootstrapHomeDir` / `getBootstrapSettingsFile` in `packages/services/src/paths.ts`)
in the order `ZCODE_DATA_BASE_DIR`, `ZCODE_DESKTOP_HOME_DIR`, `HOME`,
`USERPROFILE`, `homedir()`. The early data-dir bootstrap, hardware-acceleration
bootstrap, startup settings, `SettingService`, the MCP user directory and log
export all use it. An explicit `ZCODE_DATA_BASE_DIR` wins over a `dataBaseDir`
stored in settings (`applyConfiguredDataBaseDir` ignores the setting). Unset keeps
production behavior with no data migration; Main's own process HOME is never
rewritten and no new environment name is introduced. Acceptance: a fake OS HOME
holding a conflicting `setting.json` does not change an explicit root; a fresh
runtime replay proves nothing is created under the fake HOME. Not yet proven.

### Test-profile isolation: Main OS identity vs Host/Agent home

Three contexts are distinct and must not be conflated in logs or manifests:

1. **Native OS keystore context** (Main only): the real OS account HOME that
   macOS Keychain / `safeStorage` need. A test profile never replaces, mocks or
   bypasses it; unavailable encryption stays fail-closed.
2. **Main application data** (`ZCODE_DESKTOP_USER_DATA_DIR`, `..._SESSION_DATA_DIR`,
   `ZCODE_DATA_BASE_DIR`): explicit test-profile roots.
3. **Host/Agent child home**: the existing `ZCODE_DESKTOP_HOME_DIR`. When set,
   Main writes `HOME` and `USERPROFILE` of every Host (and scheduler) process to
   that root, so Agent global hooks, settings, skills and session DB cannot read
   the operator's personal home. Agents inherit it from the Host unchanged.

Rules: the root must be absolute (else Main refuses to fork); an existing path is
resolved with realpath, a not-yet-created path is kept normalized. Unset keeps
production behavior (inherited HOME), with no data migration. No new env name is
introduced, remote Hosts are unaffected, and Main's own process HOME is never
rewritten by this seam. Acceptance: forwarding, default, and override tests in
`hostProcessHomeEnv.test.ts`; a fresh runtime replay proves Host/Agent paths.

### Ownership of extracted helpers (behavior-preserving, max-lines maintenance)

- Main `lumiAccountOwner` stays the sole owner of the managed-run lease map
  (`hostSessionId`, runtime capability snapshot/queue). `lumiManagedToolAdmission`
  (tool decision, reviewed-identity resolution, tool result) holds no lease map
  or credential: it reads the live lease and authorizes only through owner
  callbacks (`lease`, `authorize`, `resolveIdentity`). Each request re-authorizes
  the exact lease before the awaited call and re-checks lease identity after it;
  a replaced/removed lease refuses the late reply. Runtime-capability publication
  keeps its own atomic per-lease queue publisher, unchanged.
- `LumiDeviceHostTransport` stays the sole device-credential owner. The
  heartbeat/policy adapter (`deviceHeartbeatPolicy`) and shared field validators
  (`deviceFields`) read the credential through a private callback, never cache or
  export it, and reject a heartbeat response whose credential was rotated or
  cleared while in flight. Public signatures and error codes are unchanged.

## Lumi-first startup entry (supersedes visible ZCode login)

When the Lumi bridge exists, Lumi restore alone owns automatic login entry.
Provider-availability startup guards must not reopen entry for an authenticated
Lumi user lacking ZCode OAuth. Explicit provider-connect requests remain separate.

Use existing warm-paper background tokens from DESIGN.md for the startup entry.
Do not inherit the old decorative ThemeHeroVisual gradient; keep the supplied
Lumi mark and semantic surface/primary-action tokens. Verify desktop and 320px
render, keyboard focus and async states after the final build.

Product decision (2026-10-08): the visible z.ai / BigModel OAuth login is
temporarily hidden. This supersedes the earlier "provider login remains in
place" visibility; it does not remove ZCode auth/session/refresh/credential
custody, BYOK API keys, active provider state or local workspaces.

- First app open without a restored Lumi session shows the entry screen with
  Lumi sign-in as the primary action. Entry reasons are unchanged; the screen
  never lists the ZCode OAuth providers (onboarding, manual account entry,
  session-expired). Explicit provider-connect requests from Model Provider
  settings keep their own owner and are unaffected.
- Alternatives on that screen: "Use API key" (existing BYOK form) and an
  explicit "Continue locally" that completes entry as `skip`. Local use never
  requires a Lumi account. Continue-locally is per launch; there is no
  persisted dismissal.
- One session owner: the Electron host (`platform.lumiAccount`). The entry
  screen and `LumiAccountSection` share one renderer flow reducer
  (`lumiAccountFlow`) that only holds projections: restoring, signed-out,
  code pending, completing, signed-in, error. A newer request invalidates any
  older in-flight result (sequence guard). Cancel/unmount invalidate it.
- Startup creates nothing before the entry decision. While the startup gate is
  pending, or has decided the entry is required but the entry is not yet open,
  Root must not run the default-conversation-workspace fallback or restore
  workspace tabs. The fallback runs only after the entry closes through an
  explicit Continue / Continue locally / API key, or when no entry is required.
  Acceptance: `startup.root-no-workspace-before-entry` (tests/lumi-ui-proof).
- Successful sign-in completes the entry screen only. It does not enroll the
  device or adopt a workspace; those stay explicit steps in settings.
- Lumi logout clears only the Lumi session projection. Provider credentials,
  active provider and device evidence are untouched.
- States: restoring (status), error (alert, retry), pending code (browser
  open is a separate explicit action; cancel returns to signed-out), restored
  account (entry completes without prompting). If `platform.lumiAccount` is
  absent (web/test hosts) the entry screen offers only API key and
  Continue locally, and Lumi sign-in does not gate startup.
- Acceptance: reducer tests for stale-result rejection, cancel and logout;
  entry screen shows no ZCode OAuth provider button; keyboard focus lands on
  the primary action; narrow (320px) layout has no overflow.
