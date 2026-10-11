// @vitest-environment jsdom

/**
 * Fresh entry product decision (spec 04, 2026-10-08): the startup entry offers Lumi sign-in,
 * "Use API key" and "Continue locally"; the Z.ai/BigModel OAuth buttons are not listed there,
 * while an explicit provider connect from Model Provider settings still starts provider OAuth.
 * Assertions use test ids, never button text.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TID_LOGIN_CONTINUE_LOCAL,
  TID_LOGIN_USE_API_KEY_BUTTON,
  TID_LUMI_ENTRY_SIGN_IN,
  TID_OAUTH_LOGIN_BUTTON,
} from "@zcode/shared";

const oauth = vi.hoisted(() => ({ startLogin: vi.fn() }));
const store = vi.hoisted(() => ({
  loginEntryRequest: null as { id: number; providerId?: string; purpose?: string } | null,
  clearLoginEntryRequest: vi.fn(),
  markLoginEntryAttemptStatus: vi.fn(),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    lumiAccount: {},
    openExternal: vi.fn(),
    executeDesktopCommand: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/lumi/useLumiAccountFlow.js", () => ({
  useLumiAccountFlow: () => ({
    available: true,
    state: {
      account: null,
      signIn: null,
      busy: false,
      error: null,
      errorCommand: null,
      restored: true,
      slow: false,
    },
    run: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOAuth.js", () => ({
  useOAuth: () => ({
    startLogin: oauth.startLogin,
    cancel: vi.fn(),
    reset: vi.fn(),
    status: "idle",
    error: null,
    // Both provider OAuth channels are enabled: hiding them is the entry's decision, not data.
    providers: [
      { id: "zai", displayName: "Z.ai", enabled: true, order: 0 },
      { id: "bigmodel", displayName: "BigModel", enabled: true, order: 1 },
    ],
    activeProvider: null,
    loadingProviders: false,
    pendingProvider: null,
    refreshProviders: vi.fn(),
  }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: null,
      oauthError: null,
      setOAuthError: vi.fn(),
      oauthSuccessSeq: 0,
      lastOAuthSuccessProvider: null,
      loginEntryRequest: store.loginEntryRequest,
      loginEntryAttempt: null,
      clearLoginEntryRequest: store.clearLoginEntryRequest,
      markLoginEntryAttemptStatus: store.markLoginEntryAttemptStatus,
    }),
}));

async function renderEntry() {
  const { WelcomeScreen } = await import("@/WelcomeScreen.js");
  return render(createElement(WelcomeScreen, { onComplete: vi.fn() }));
}

describe("Lumi fresh entry", () => {
  beforeEach(() => {
    store.loginEntryRequest = null;
    oauth.startLogin.mockClear();
  });
  afterEach(() => cleanup());

  it("offers Lumi sign-in, Use API key and Continue locally, and no provider OAuth button", async () => {
    const view = await renderEntry();

    expect(screen.getByTestId(TID_LUMI_ENTRY_SIGN_IN).tagName).toBe("BUTTON");
    expect(screen.getByTestId(TID_LOGIN_USE_API_KEY_BUTTON).tagName).toBe("BUTTON");
    expect(screen.getByTestId(TID_LOGIN_CONTINUE_LOCAL).tagName).toBe("BUTTON");
    // Provider buttons carry `oauth-login-button` with or without a provider suffix.
    expect(
      view.container.querySelectorAll(`[data-testid^="${TID_OAUTH_LOGIN_BUTTON}"]`),
    ).toHaveLength(0);
    expect(oauth.startLogin).not.toHaveBeenCalled();
  });

  it("an explicit provider connect from Model Provider settings still starts provider OAuth", async () => {
    // Settings → Model Provider → Connect calls `requestLoginEntry(providerId)`
    // (modelProviderPresetSubscriptionAction.test.ts); the entry consumes that request.
    store.loginEntryRequest = { id: 7, providerId: "zai" };

    await renderEntry();

    expect(store.clearLoginEntryRequest).toHaveBeenCalledWith(7);
    expect(oauth.startLogin).toHaveBeenCalledTimes(1);
    expect(oauth.startLogin).toHaveBeenCalledWith("zai", { purpose: undefined });
  });
});
