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
