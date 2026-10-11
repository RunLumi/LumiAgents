# Lumi managed run and inference execution

Status: implementation plan for DE2E-INT-04; end-to-end managed work remains unproven.

Managed tool-call IDs derive from server runId plus the provider's local call ID.
Provider IDs may repeat across runs; the global ToolCallRef key must not collide.
Replay within one run retains the same deterministic ID. Local/legacy shorthand
contexts retain their existing ID behavior; managed result reports reuse the
exact scoped ID from admission, never regenerate a different binding.

Fingerprint v2 converts recognized Zod runtime input schemas through the existing
toToolJsonSchema contract before hashing; validator parse caches are not identity.
Successful or failed validation must preserve the fingerprint of unchanged
declarative schemas, while changed constraints must change it. Namespace is
lumi-tool-fingerprint-v2; v1 catalog/grants must not silently authorize v2.
Other runtime schema representations retain their existing serialization.

Local Electron mock inference, correlation/usage, restart and reversible binding
are now proven on the dirty candidate pair (parent evidence dated 2026-10-07).
Full tool/approval/scheduler execution and clean-checkout delivery remain owed.

## One request and authority owners

The Electron Main account/device/workspace owners create P05 session/run rows using the enrolled device token. Main never sends device tokens to the renderer or agent. Run context is server-issued and non-secret; it may cross the existing host/task protocol for one turn, but every use is revalidated against the control plane.

The Host owns one active local task/run association. The agent runtime receives the stable lumi-managed ModelSelection and safe P05 context only for that turn. Before each physical request it uses the existing provider-runtime-auth port. Host forwards the request to Main over the private utility-process parentPort. Main checks current user/org/device/workspace, P05 Run/Session and policy, then returns ephemeral P02 Bearer request auth with the P04/P05 correlation headers. This material is never stored in provider files, user settings, task/session persistence, renderer RPC, URLs or logs.

P04 authenticates the Bearer as the P02 user and enforces inference.use. P04-CR-001 resolves the request against the D1 Run. P05 device endpoints remain the authority for start/terminal lifecycle and device identity. Correlation headers select no authority.

## Execution order

1. The user explicitly selects managed_policy on one bound workspace, project, agent definition and model alias. Local-only workspaces keep their selected BYOK provider.
2. Main validates account/user/org, encrypted workspace mapping, server P03 binding/P08 stage, active device and acknowledged current policy; then creates P05 AgentSession and managed Run with idempotency.
3. The server-returned context includes org, project, device, P05 agent session/run, agent definition/version, correlation and policy snapshot/version. Host creates or reuses the existing local ZCode task only for that workspace. Provider selection remains ephemeral.
4. Each physical model request asks Host/Main for fresh ephemeral Bearer and context. The actual lumi-managed adapter calls OpenAI-compatible /api/v1/inference/chat/completions; P04 resolves all context against D1 before provider dispatch. Expiry, revocation, scope mismatch or policy failure blocks before dispatch, with no local/BYOK fallback.
5. On the actual terminal turn event, Host asks Main to call P05 complete/fail/cancel with the server version. Cancellation aborts the physical request first. Host reports success only after server acknowledgement.
6. The web control plane's Run, inference request, usage and audit are read back from Worker/D1 and correlated without storing prompt text for observability.

## Secret and persistence boundaries

- Main retains human session/device token in origin/org/user OS-encrypted owners; local P05 workspace mapping remains encrypted. No bearer or provider secret is persisted in task/session/provider configuration.
- Per-request Bearer exists in Host/Agent memory only for physical request authorization. Renderer sees safe status and opaque IDs.
- No prompt/response, local path, session/device token, provider secret or tool arguments are written to ordinary logs, audit payloads or evidence JSON.
- Main/Host request/reply uses strict discriminated schemas, random request IDs, bounded timeouts and abort cleanup. A stale reply cannot satisfy a newer request.
- Local provider selection stays unchanged and remains available offline. Managed provider config exists only in the Host's in-memory provider registry for an explicitly selected alias.

The child CLI Registry receives non-secret origin/aliases at startup and creates
its own in-memory overlay; no provider config write. Both early admitted model
and execution model retain the current managed context. The turn loop carries
context into both streaming and completed tool schedules. A managed model
missing its context refuses before executor admission; context without a
managed decision broker fails closed before the tool handler. A missing broker
refusal is not tool allow/approval implementation evidence.

Single-turn runs use deferred local session persistence before first V4 input.
Main settles the backend run on the actual terminal event then closes the P05
session. Member-role and interruption recovery for session closure still need
runtime verification. Managed model option mapping is Lumi-specific:
reasoning is default with no provider-specific request field, output bounded at
4096 tokens; backend route capability/budget checks remain authoritative.

## Live managed alias registration (same running Agent)

Reproduced defect: first managed alias works, then a second alias on the SAME
already-running Agent fails at `session/create` with `model_not_found` because the
Agent process only learned aliases from spawn ENV. Host `ensureAlias` updates the
Host overlay only.

Owners: the Host owns the alias set and spawn ENV; the child process owns one
in-memory `LumiManagedProviderConfigSource` created from its trusted
`LUMI_MANAGED_PROVIDER_ORIGIN` (zero aliases allowed) and the formal Registry
built on it. No second inventory exists.

```text
UI prepareManagedProviderAlias(alias, exact workspace, Main-issued managed context)
  → Host ensureAlias (Host overlay + Host Registry refresh)
  → Host getClient(exact workspace) (process-owned Agent; spawn ENV already holds the alias)
  → provider/registerManagedAlias {modelAlias}   (private, process-scoped)
  → child source.ensureAlias → Registry refresh → alias model present or refuse
  ← {modelAlias, status: registered|unchanged}
  → Host resolves ModelSelection → UI createTask / session/create|resume selects it
```

Rules:

- The payload is exactly `{modelAlias}`: a stable alias (`^[a-z0-9][a-z0-9._-]{0,127}$`).
  No origin, credential, request header, provider/model config or run context. The
  child uses only its own startup origin; a process without that origin, or an old
  runtime that answers method-not-found, makes Host fail closed
  (`lumi_managed_runtime_unsupported`). Host never falls back to the first alias,
  restarting the Agent, persisting provider config or bypassing registry validation.
- Registration is availability of a hidden model in memory only. It grants no
  backend authority: Main run/account/device/policy/auth are still required for every
  request. It writes nothing to disk or user settings and is not accepted across
  workspaces: Host sends it only to the client it owns for the exact workspace key.
- Ordering: the reply is awaited before the task is created, so `session/create`
  and `session/resume` can never select an alias the process Registry lacks.
  After refresh the child verifies the model exists in its own Registry; a refresh
  that publishes nothing (e.g. pending Built-in) is a refusal, not success.
- Idempotent: repeated alias returns `unchanged` but still refreshes. A new
  process (restart) receives the Host alias set through spawn ENV and the same call
  is a no-op there. Aliases are capped at the source's bound.
- Existing ZCode/local/BYOK sessions and the hidden-model semantics are unchanged;
  a process started without the origin ENV keeps no managed source.
- Acceptance: tests cover live second alias and a process started with zero
  aliases, no disk/config mutation, invalid alias, unconfigured origin, old-runtime
  refusal, and prepare→register→createTask ordering.

## External-provider boundary

## Managed tool broker continuation

The per-turn Core decision port sends only the strict bounded P05 request over
the existing Agent reverse RPC. Host derives workspace identity from its owned
Agent process, never a client-supplied path. Main requires a previously bound
local session and rechecks the exact run lease, current workspace, device and
policy before the private device transport asks the backend for a decision.
Only Main holds the device credential. Responses must bind run, tool call,
tool ID, fingerprint, risk and the server's canonical argument-summary hash.

```text
Core per-turn context → Agent reverse RPC → process-owned Host workspace
  → Main run lease and live scope checks → DeviceToken P05 decision
  ← strict bound decision ← Main ← Host ← Core tool gate → handler
```

Each request has independent correlation, bounded timeout and stale-reply
rejection; mobile attachment delivery does not acquire a separate credential or
authority. No decision goes through renderer interaction. Unknown privileged
tools stay refused until server catalog review. Device transport now requires
the atomic grant-consumption/execution-claim response before releasing any allow.
Automatic terminal reporting is wired through Core/Host/Main with supporting
Core/bootstrap/device/Worker proof; model-driven Electron tool reporting remains
unproven. Main approval waiting is wired as a bounded poll of the existing
decision route, with live lease/policy validation on every attempt. Desktop
approval UX and model-driven Electron waiting proof remain owed.
A pending approval is never an allow.

The tool's native handler deadline excludes managed admission/approval waiting
and terminal report ACK delivery. These phases own independent bounded RPC
deadlines; user cancellation still aborts execution and cannot release a handler
after a late permit. Reuse the existing depth-counted ToolDeadline pause/resume
mechanism so nested model admission waits preserve the remaining native budget.
Do not increase every handler's timeout to cover a human approval delay.
Raw arguments, secrets and local paths remain outside the broker payload.

Reviewed catalog lookup is a Main-owned human-session read, not registration or
execution authorization. Match exact runtime fingerprint/source/risk/complete
capability-ID set against one active org catalog row. Refuse duplicate matches,
incomplete pagination or any mismatch. Return only strict identity with server
tool ID/runtime name; current P05 run/device/project/policy still authorize use.
Never cache accepted identity globally across org/run scopes or drop requirements.

Built-in browser/computer descriptors use the platform capability IDs established
by control-plane migration 0023: browser `cap_62726f77736572000000000000000000`,
computer `cap_636f6d70757465720000000000000000`. These IDs identify capability
requirements only; device reports and current policy still determine support.
Other deterministic capability IDs remain required and fail closed until the
backend catalog and runtime-report contract support them. No capability is removed
to make a tool eligible. Changing this identity mapping changes derived tool
fingerprints; old reviewed definitions must not silently authorize the new one.

Private device heartbeat accepts only bounded boolean runtime capabilities and
app version; its fixed API route uses DeviceToken without human cookies. Validate
server time, nullable policy version and nullable minimum version, and reject a
response after the held device credential changes. Reporting is not policy ACK
or permission. Main must derive availability from its runtime; renderer/model
cannot submit arbitrary reports. No path/process inventory is sent.
Device owner serializes heartbeat before policy fetch/ACK on enrollment,
recovery and explicit sync. Missing runtime provider sends an empty report,
never assumed support. Heartbeat failure stops that sync before ACK.
Main serializes runtime snapshot authorization, replacement, heartbeat and
rollback as one operation per exact live lease. Queued reports recheck lease
ownership when admitted; an earlier failed publish cannot restore a snapshot
over a later successful report. Device transport serialization alone is not
sufficient because snapshot replacement occurs before device IO.

Runtime capability snapshot (single inventory truth = the session's actual
ToolRegistry). Core derives six booleans (filesystem_write, process_execution,
network_access, mcp_execution, browser_use, computer_use) from the model-visible
registered entries' managed risk class; it never reads arguments, paths, tokens
or prompts and never infers a grant. Before identity resolution for a managed
call, Core sends `interaction/reportRuntimeCapabilities` (strict context, trace,
session, six booleans) only when the snapshot for that run changed. Host adds its
process-owned workspace identity and forwards over the existing managed bridge;
Main requires the exact live lease bound to that host session, revalidates
workspace/policy/run, publishes one bounded heartbeat through the single device
owner (deduplicated, serialized before policy/ACK sync), then re-checks the lease
and acks `{runId, recorded}`. Missing/stale lease, logout, mismatched workspace,
schema failure or heartbeat refusal fails closed: the call is denied
(`runtime_capabilities_unavailable`) and no tool handler runs. remote_environment
and automation_eligible are never reported by this path. Capability support is
availability only; catalog identity, grants, policy and approval remain separate.

Per-call resolution uses interaction/resolveManagedToolIdentity with strict
context/session/trace and descriptor, no arguments. Host supplies its process-owned
workspace. Main requires the exact already bound lease, revalidates before the
human-session catalog read and checks lease ownership after it. Reply binds run
and identity or null. Core accepts only catalogued exact name/fingerprint/source/
risk/capability/MCP correlation match, uses the server tool ID for that call and
never changes ToolEntry/registry. Unknown or changed identities cannot reach broker
admission or the handler. Resolution alone remains no authorization grant.

After an awaited broker/approval result, Core rechecks cancellation before entering
the actual tool handler. Reporting a cancelled task alone is insufficient: the
regression measures handler calls and real file contents after the late result.
Main also refuses an awaited auth/tool response if logout or settlement removed
or replaced its exact in-memory lease. A tool cannot establish the local session
binding; that binding is created only after successful inference auth resolution.

Managed argument summaries must not export caller field names, paths, commands,
content, arbitrary strings or nested values. They contain a SHA-256 digest of the
complete canonical JSON input, its type/count metadata, and closed-vocabulary
action/operation values only. Canonical JSON preserves object key/value identity
and array order; invalid/non-JSON/cyclic/oversized input fails before broker I/O.
The digest is not removed by summary bounds. Core recomputes the summary after
awaiting the broker/approval so mutation of the same input object cannot reuse a
grant. Existing local execution is unchanged. This extends the canonical bounded
P05 summary without changing its wire schema; old summary grants are not reused.
New grant issuance still requires catalog review and atomic pre-execution consume.

Private device transport must obtain `status: allowed` admission from the P05
device result route before releasing any backend allow, including decisions that
need no approval. It sends the exact bounded preflight, summary hash, observed
policy version and a fresh idempotency key; only Main supplies DeviceToken.
The returned run/call/tool/fingerprint/risk/hash/policy and approval binding must
match the evaluated decision, with valid execution_started_at. An older backend,
malformed/refused response or lost response fails closed; the client never retries
the claim automatically or treats a policy decision as an execution permit.
During pending approval Main waits up to 15 minutes, polling every 1.5 seconds;
it never resolves approval itself. Any denial, lost lease, changed approval ID,
expiry or live-policy failure stops. Device I/O retains its 30-second bound;
Host decision request has a 930-second bound and Agent reverse RPC 940 seconds,
including bounded in-flight I/O margin. Report cleanup retains its shorter bound.

Device result reporting accepts only completed/failed/cancelled, on the fixed
P05 run/tool-call route, using Main-held DeviceToken and a fresh idempotency key.
The report contains status only: no handler output, raw input, exception text,
path, credential or result summary. Validate returned run/call/status/time before
acknowledging success. Core/Host/Main automatic wiring must use this private port;
an explicit probe call is supporting transport proof, not automatic reporting.

Automatic reporting uses interaction/reportManagedToolResult with strict context,
local session/trace, P05 tool-call ID and status only. ACK repeats run/call/status
and recorded=true. Host derives workspace from the owned process; private Main
revalidates its exact bound lease and device/workspace/run before transport I/O,
then rechecks lease ownership after awaiting. No report can bind a new session.
Core reports the handler outcome and waits for ACK before returning a successful
tool step. Failed/ambiguous reporting produces a stable reporting error with no
raw exception/output and no automatic handler retry. Cancellation cleanup uses a
separate bounded report request rather than the already aborted execution signal.
If Main lost the lease or the device is no longer authorized, reporting refuses;
the existing once-only claim remains reconciliation evidence. Desktop requires
this reporter before managed handler admission; local/legacy embedders retain
their existing non-desktop optional port behavior.

```text
Core approved snapshot → handler once → bounded status report
  → Agent reverse RPC → Host-owned workspace → Main exact lease
  → DeviceToken result transaction → bound ACK → Core completion
```

The executor also checks the digest at its last synchronous handler boundary and
passes an isolated canonical JSON snapshot to the managed handler. No await
separates that check and handler invocation. This closes the Promise-continuation
gap and prevents external references from changing approved input while the
handler itself awaits I/O. Local handlers retain their existing input behavior.

A local mock:// provider proves Worker routing and stored effects, not a third-party provider response. External-provider response remains BLOCKED unless approved test credentials, an explicit spend cap and reachable controlled endpoint are available. Record actual Electron-to-Worker HTTP arrival, P04 D1 attribution, P05 terminal state, reservation settlement, audit readback, streaming/cancel faults and tenant/device/policy negatives separately.
