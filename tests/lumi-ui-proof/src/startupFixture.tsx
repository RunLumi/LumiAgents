import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { LumiAccountBridge, OAuthProviderMeta, UserInfo } from "@zcode/shared";
import { ServiceProvider } from "@/hooks/useServices.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ZCodeIntlProvider, useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Root } from "@/Root.js";
import { WelcomeScreen, type LoginCompleteReason } from "@/WelcomeScreen.js";
import { StoreProvider, useZCodeStore } from "@/store/StoreProvider.js";
import { createHostFixture, type HostFixture } from "./hostFixture.js";

export interface StartupInit {
  /** Whether `platform.lumiAccount` exists at all (web/test hosts have none). */
  lumiBridge: boolean;
  /** A cached ZCode OAuth session the host reports at launch. */
  zcodeUser?: UserInfo;
  /** OAuth providers the host lists (z.ai / BigModel). They must never be rendered at entry. */
  providers: OAuthProviderMeta[];
  /** Mounts Root with `restoreSession` (default false) and a persisted local workspace session. */
  persistedWorkspace?: string;
}

export interface StartupProof {
  completed: LoginCompleteReason[];
  hostCalls: () => HostFixture["calls"] extends () => infer R ? R : never;
  externalOpens: string[];
  t: (id: string, values?: Record<string, string>) => string;
  setZcodeUser: (user: UserInfo | null) => void;
  requestLogin: (providerId: OAuthProviderMeta["id"]) => void;
}

declare global {
  interface Window {
    __startup: StartupProof;
  }
}

function IntlProbe() {
  const { intl } = useZCodeIntl();
  useEffect(() => {
    window.__startup.t = (id, values) => intl.formatMessage({ id }, values);
  }, [intl]);
  return null;
}

/** Only the WelcomeScreen surface owns its store; Root creates its own inside. */
function StoreProbe() {
  const setUser = useZCodeStore((s) => s.setUser);
  const requestLoginEntry = useZCodeStore((s) => s.requestLoginEntry);
  useEffect(() => {
    window.__startup.setZcodeUser = setUser;
    window.__startup.requestLogin = (providerId) => void requestLoginEntry(providerId);
  }, [setUser, requestLoginEntry]);
  return null;
}

/** The one BYOK template the entry's default (en-US) provider choice resolves to. */
const BYOK_TEMPLATE = {
  templateId: "zai-api",
  config: { access: { type: "api-key", apiKeyManagementUrl: "https://keys.example.invalid/" } },
};

const EMPTY_PROVIDER_VIEW = {
  revision: 1,
  providerTemplates: [BYOK_TEMPLATE],
  providerOrder: [],
  providers: [],
};

export function mountStartup(
  surface: "welcome" | "root",
  locale: "en-US" | "zh-CN",
  init: StartupInit,
  bridge: LumiAccountBridge | undefined,
) {
  const host = createHostFixture(
    {
      overrides: {
        // Empty-but-valid host views: no provider configured, nothing migrated, nothing to onboard.
        "settingService.get": {
          providerFamilyDomain: "zai",
          ...(init.persistedWorkspace
            ? {
                lastWorkspaceSession: [{ kind: "local", workspacePath: init.persistedWorkspace }],
                lastActiveTabIndex: 0,
                recentProjects: [init.persistedWorkspace],
              }
            : {}),
        },
        "providerSettingsService.getView": EMPTY_PROVIDER_VIEW,
        "modelSelectionService.getView": { revision: 1, providers: [] },
        "onboardingRecordService.shouldOnboard": false,
        // Empty-but-valid answers for the three shell reads that follow a workspace being opened, so the
        // real shell reports no fixture-port errors and nothing needs to be tolerated.
        "windowControllerService.listTaskList": { items: [], hasMore: false },
        // A restored workspace lists its tasks: none.
        "zcodeTaskService.listTasks": [],
        "zcodeTaskService.listArchivedTasks": [],
        "zcodeTaskService.listPinnedTasks": [],
        "zcodeTaskService.listPinnedTaskIds": [],
        "zcodeTaskService.listDeletedTaskIds": [],
        // BYOK save: the existing ZCode provider owner answers; nothing is stored anywhere.
        "providerSettingsService.createPersonalProvider": {
          providerId: "prov_byok_proof",
          view: EMPTY_PROVIDER_VIEW,
        },
        "settingsSyncService.getFirstRunPromptState": { handled: true },
        "subagentsService.list": { agents: [], capability: null },
        "platform.getUpdateState": { kind: "idle" },
        "systemService.info": { homedir: "/synthetic/home" },
        // The default workspace is requested but never delivered: the call is the observable, and the real
        // workspace shell (which needs far more host surface than this fixture models) is not mounted.
        "fileService.ensureConversationWorkspace": { path: "/synthetic/default-workspace" },
        // Explicit provider-connect requests start OAuth and then wait on the browser, forever here.
        "oauthService.startOAuthWithPolling": () => new Promise(() => undefined),
        "oauthService.getProviders": init.providers,
        "oauthService.getActiveProvider": null,
        "oauthService.restoreCachedSessionState": init.zcodeUser
          ? { status: "authenticated", userInfo: init.zcodeUser }
          : { status: "signed-out" },
      },
    },
    init.lumiBridge ? bridge : undefined,
  );
  window.__startup = {
    completed: [],
    hostCalls: () => host.calls(),
    externalOpens: host.externalOpens,
    t: (id) => id,
    setZcodeUser: () => undefined,
    requestLogin: () => undefined,
  };
  const tree =
    surface === "welcome" ? (
      <ServiceProvider services={host.services}>
        <PlatformProvider platform={host.platform}>
          <StoreProvider broadcastService={host.services.broadcastService}>
            <StoreProbe />
            <WelcomeScreen onComplete={(reason) => void window.__startup.completed.push(reason)} />
          </StoreProvider>
        </PlatformProvider>
      </ServiceProvider>
    ) : (
      <Root
        services={host.services}
        platform={host.platform}
        restoreSession={Boolean(init.persistedWorkspace)}
      />
    );
  createRoot(document.getElementById("root")!).render(
    <ZCodeIntlProvider initialLocale={locale}>
      <IntlProbe />
      {tree}
    </ZCodeIntlProvider>,
  );
}
