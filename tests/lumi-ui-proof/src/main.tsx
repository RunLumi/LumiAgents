import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { IPlatformService, LumiAccountProjection } from "@zcode/shared";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ZCodeIntlProvider, useZCodeIntl } from "@/i18n/IntlProvider.js";
import { LumiEntryPanel } from "@/lumi/LumiEntryPanel.js";
import { LumiWorkspaceSection } from "@/settings/LumiWorkspaceSection.js";
import "@/styles.css";
import { createProofBridge, type AutoTable, type ProofController } from "./proofBridge.js";

declare global {
  interface Window {
    __proofInit?: { auto?: AutoTable; startup?: import("./startupFixture.js").StartupInit };
    __proof: ProofController;
  }
}

const params = new URLSearchParams(location.search);
const surfaceParam = params.get("surface");
const surface = surfaceParam === "workspace" ? "workspace" : "entry";
const locale = params.get("locale") === "zh-CN" ? "zh-CN" : "en-US";
const orgCount = params.get("orgs") === "2" ? 2 : 1;

// Same theme boot as packages/web/src/main.tsx (Lumi is light-only, DESIGN.md §5).
document.documentElement.classList.add("theme-lumi");
document.documentElement.style.colorScheme = "light";
document.documentElement.lang = locale;

const ACCOUNT: LumiAccountProjection = {
  user: { id: "usr_proof", email: "proof@example.invalid", displayName: "Proof User" },
  organizations: [
    {
      id: "org_a",
      displayName: "Acme Labs",
      slug: "acme",
      state: "active",
      role: "owner",
      status: "active",
    },
    ...(orgCount === 2
      ? [
          {
            id: "org_b",
            displayName: "Borealis Research",
            slug: "borealis",
            state: "active",
            role: "member",
            status: "active",
          },
        ]
      : []),
  ],
};

const { bridge, controller } = createProofBridge(window.__proofInit?.auto ?? {});
const startup = surfaceParam === "welcome" || surfaceParam === "root" ? surfaceParam : null;
const externalOpens: string[] = [];

// Only the members the two surfaces read; everything else is deliberately absent so a surface
// reaching for another host capability fails loudly instead of being silently satisfied.
const platform = {
  lumiAccount: bridge,
  openExternal: async (url: string) => {
    externalOpens.push(url);
  },
} as unknown as IPlatformService;

function IntlProbe() {
  const { intl } = useZCodeIntl();
  useEffect(() => {
    window.__proof.t = (id, values) => intl.formatMessage({ id }, values);
  }, [intl]);
  return null;
}

function Fixture() {
  const [path, setPath] = useState("/synthetic/workspace-alpha");
  useEffect(() => {
    window.__proof.setWorkspacePath = setPath;
  }, []);
  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-4 text-foreground">
      <p className="mb-3 text-ui-sm text-foreground-subtle">
        Fixture frame (not product UI) — surface: {surface}, locale: {locale}
      </p>
      {surface === "entry" ? (
        <>
          <LumiEntryPanel onSignedIn={() => void (window.__proof.signedIn += 1)} />
          <button type="button" className="mt-3 rounded border border-border px-2 py-1 text-ui-sm">
            after-panel sentinel
          </button>
        </>
      ) : (
        <LumiWorkspaceSection account={ACCOUNT} workspacePath={path} environmentType="local" />
      )}
    </main>
  );
}

window.__proof = {
  ...controller,
  externalOpens,
  signedIn: 0,
  t: (id) => id,
  setWorkspacePath: () => undefined,
};

if (startup) {
  // Real WelcomeScreen / Root over a recording host fixture (see startupFixture.tsx).
  const init = window.__proofInit?.startup;
  if (!init) throw new Error("startup surface needs __proofInit.startup");
  void import("./startupFixture.js").then((m) => m.mountStartup(startup, locale, init, bridge));
} else {
  createRoot(document.getElementById("root")!).render(
    <PlatformProvider platform={platform}>
      <ZCodeIntlProvider initialLocale={locale}>
        <IntlProbe />
        <Fixture />
      </ZCodeIntlProvider>
    </PlatformProvider>,
  );
}
