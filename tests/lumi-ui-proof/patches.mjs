/**
 * In-memory deliberate faults applied by the fixture's Vite plugin for sensitivity runs. Nothing here
 * is ever written to the repository. A patch whose target text is missing throws, so a stale mutant
 * can never silently no-op and be mistaken for an undetected mutation.
 */
/**
 * @typedef {object} SourcePatch
 * @property {string} name
 * @property {string} file Path suffix of the product file the patch rewrites.
 * @property {string | RegExp} find
 * @property {string} replace
 */

const SECTION = "packages/ui/src/settings/LumiWorkspaceSection.tsx";
const HOOK = "packages/ui/src/lumi/useLumiAccountFlow.ts";

/**
 * Deliberate faults (`--mutate=<name>`), each removing one load-bearing guard. A check that claims
 * to protect that guard must go red under the matching mutant (see `expectedRed`).
 */
/** @type {Record<string, { expectedRed: string[]; patches: SourcePatch[] }>} */
export const MUTATIONS = {
  "timeout-supersede": {
    expectedRed: [
      "entry.late-restore-after-timeout-ignored",
      "entry.late-complete-after-timeout-ignored",
    ],
    patches: [
      {
        name: "timeout-supersede",
        file: HOOK,
        find: "const nextSeq = ++sequence.current;",
        replace: "const nextSeq = seq;",
      },
    ],
  },
  "stale-load-guard": {
    expectedRed: ["workspace.stale-load-result-dropped"],
    patches: [
      {
        name: "stale-load-guard",
        file: SECTION,
        find: ".then((result) => {\n        if (current !== sequence.current) return;",
        replace: ".then((result) => {",
      },
    ],
  },
  "stale-write-guard": {
    expectedRed: ["workspace.stale-write-result-dropped"],
    patches: [
      {
        name: "stale-write-guard",
        file: SECTION,
        find: "const result = await lumiAccount.request(command);\n      if (current !== sequence.current) return;",
        replace: "const result = await lumiAccount.request(command);",
      },
    ],
  },
  "reread-keeps-projection": {
    expectedRed: [
      "workspace.dropped-bind-reread-fails-disables-bind",
      "workspace.credential-refusal-reread-fails-clears-choice",
    ],
    patches: [
      {
        name: "reread-keeps-projection",
        file: SECTION,
        find: "setWorkspace(reread.ok ? reread.workspace : undefined);",
        replace: "if (reread.ok) setWorkspace(reread.workspace);",
      },
      {
        name: "reread-catch-keeps-projection",
        file: SECTION,
        find: "if (current === sequence.current) setWorkspace(undefined);",
        replace: "void 0;",
      },
    ],
  },
  "credential-choice-no-remount": {
    expectedRed: ["workspace.credential-refusal-rereads-and-discards-pick"],
    patches: [
      {
        name: "credential-choice-no-remount",
        file: SECTION,
        find: "key={`${workspace.adoptionStateId}:${workspace.adoptionVersion}:${workspace.credentialMode}`}",
        replace: 'key="static"',
      },
    ],
  },
  "page-incomplete-retryable": {
    expectedRed: ["workspace.page-incomplete-fails-closed"],
    patches: [
      {
        name: "page-incomplete-retryable",
        file: "packages/ui/src/lumi/lumiErrorCopy.ts",
        find: 'return code !== "lumi_page_incomplete" && code !== "lumi_sender_denied";',
        replace: "return true;",
      },
    ],
  },
  "restore-failure-begins-sign-in": {
    expectedRed: ["entry.check-again-is-explicit-restore", "entry.check-again-failure-no-sign-in"],
    patches: [
      {
        // Retry restore as a sign-in: the failed-restore branch stops being an explicit re-check.
        name: "restore-failure-begins-sign-in",
        file: "packages/ui/src/lumi/LumiEntryPanel.tsx",
        find: 'onClick={() => void run("restore")}',
        replace: 'onClick={() => void run("begin")}',
      },
    ],
  },
  "bind-no-confirm-flag": {
    expectedRed: ["workspace.bind-not-duplicated"],
    patches: [
      {
        name: "bind-no-confirm-flag",
        file: SECTION,
        find: "              displayName,\n              confirm: true,",
        replace: "              displayName,\n              confirm: false as unknown as true,",
      },
    ],
  },
  "forced-colors-outline-none": {
    expectedRed: ["keyboard.forced-colors-focus"],
    patches: [
      {
        // Reintroduces the original defect for forced-colors only: the mode drops the outline.
        name: "forced-colors-outline-none",
        file: "packages/ui/src/styles.css",
        find: "    outline: 2px solid Highlight;",
        replace: "    outline: none !important;",
      },
    ],
  },
  "welcome-bridge-zcode-bypass": {
    expectedRed: ["startup.welcome-bridge-ignores-zcode-user", "startup.root-zcode-only"],
    patches: [
      {
        // A cached ZCode session would again skip the Lumi-first entry on a bridge host.
        name: "welcome-bridge-zcode-bypass",
        file: "packages/ui/src/WelcomeScreen.tsx",
        find: "      !hasLumiBridge &&\n",
        replace: "",
      },
    ],
  },
  "welcome-providers-listed": {
    expectedRed: ["startup.root-neither"],
    patches: [
      {
        // Re-adds the hidden z.ai / BigModel OAuth buttons next to the Lumi entry.
        name: "welcome-providers-listed",
        file: "packages/ui/src/WelcomeScreen.tsx",
        find: '<LumiEntryPanel onSignedIn={() => void onComplete("lumi")} />',
        replace:
          '<LumiEntryPanel onSignedIn={() => void onComplete("lumi")} />{providers.map((p) => (<Button key={p.id} variant="outline">{p.displayName}</Button>))}',
      },
    ],
  },
  "welcome-local-wrong-reason": {
    expectedRed: ["startup.welcome-bridge-ignores-zcode-user"],
    patches: [
      {
        name: "welcome-local-wrong-reason",
        file: "packages/ui/src/WelcomeScreen.tsx",
        find: 'onClick={() => void onComplete("skip")}',
        replace: 'onClick={() => void onComplete("lumi")}',
      },
    ],
  },
  "startup-gate-timeout-removed": {
    expectedRed: ["startup.root-hung-and-late"],
    patches: [
      {
        // A hung host restore would hold the app on the startup screen forever.
        name: "startup-gate-timeout-removed",
        file: "packages/ui/src/lumi/useLumiStartupGate.ts",
        find: 'setTimeout(() => settle("entry-required"), LUMI_STARTUP_RESTORE_TIMEOUT_MS)',
        replace: "setTimeout(() => undefined, LUMI_STARTUP_RESTORE_TIMEOUT_MS)",
      },
    ],
  },
  "startup-gate-any-result-signed-in": {
    expectedRed: ["startup.root-neither"],
    patches: [
      {
        // A signed-out restore would be treated as a session and the entry never opens.
        name: "startup-gate-any-result-signed-in",
        file: "packages/ui/src/lumi/useLumiStartupGate.ts",
        find: '(result) => settle(result.ok && result.account ? "signed-in" : "entry-required")',
        replace: '() => settle("signed-in")',
      },
    ],
  },
  "startup-gate-begins-sign-in": {
    expectedRed: ["startup.root-neither"],
    patches: [
      {
        // The read-only gate would start a sign-in on its own.
        name: "startup-gate-begins-sign-in",
        file: "packages/ui/src/lumi/useLumiStartupGate.ts",
        find: "requestStartupRestore(lumiAccount).then(",
        replace: 'lumiAccount.request("begin").then(',
      },
    ],
  },
  "startup-workspace-race-reintroduced": {
    expectedRed: ["startup.root-no-workspace-before-entry"],
    patches: [
      {
        // Reverts the one-commit gap fix: the fallback may create the workspace before the entry opens.
        name: "startup-workspace-race-reintroduced",
        file: "packages/ui/src/Root.tsx",
        find: '    lumiStartupGate === "pending" ||\n    isLumiEntryPending;',
        replace: '    lumiStartupGate === "pending";',
      },
    ],
  },
  "shell-same-prefix-error": {
    expectedRed: ["startup.root-lumi-only"],
    patches: [
      {
        // A different fault from the module that used to be tolerated: it must fail, not be ignored.
        name: "shell-same-prefix-error",
        file: "packages/ui/src/hooks/useGlobalTaskList.ts",
        find: "result.items.map(",
        replace: "result.itemz.map(",
      },
    ],
  },
  "byok-key-leaked-to-settings": {
    expectedRed: ["startup.root-byok-save"],
    patches: [
      {
        // The saved key would also be written to app settings.
        name: "byok-key-leaked-to-settings",
        file: "packages/ui/src/login/LoginApiKeyForm.tsx",
        find: "      markApiKeyLoginSuccess(defaultModelPreference);",
        replace:
          "      void settingService.update({ leakedKey: apiKey } as never);\n      markApiKeyLoginSuccess(defaultModelPreference);",
      },
    ],
  },
};
