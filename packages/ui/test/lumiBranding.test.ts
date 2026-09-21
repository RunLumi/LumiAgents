import assert from "node:assert/strict";
import test from "node:test";
import { applyLumiBranding } from "../src/i18n/lumiBrandingOverlay.js";
import { normalizeThemePreference, resolveTheme } from "../src/useTheme.js";

test("applyLumiBranding renames the standalone product token", () => {
  assert.equal(applyLumiBranding("Welcome to ZCode"), "Welcome to Lumi Agents");
  assert.equal(applyLumiBranding("欢迎来到 ZCode"), "欢迎来到 Lumi Agents");
});

test("applyLumiBranding protects agent and infrastructure brand phrases", () => {
  assert.equal(applyLumiBranding("ZCode Agent"), "ZCode Agent");
  assert.equal(applyLumiBranding("the ZCode CDN"), "the ZCode CDN");
  assert.equal(applyLumiBranding("restart ZCode CLI"), "restart ZCode CLI");
  assert.equal(
    applyLumiBranding("ZCode will restart, while ZCode Agent keeps running"),
    "Lumi Agents will restart, while ZCode Agent keeps running",
  );
});

test("applyLumiBranding never touches internal identifiers", () => {
  for (const value of [
    "ZCODE_PREVIEW_IDENTITY",
    "@zcode/desktop",
    "~/.zcode/v2",
    "zcode://workspace/open",
  ]) {
    assert.equal(applyLumiBranding(value), value);
  }
});

test("resolveTheme is light-only for every preference", () => {
  for (const theme of ["light", "dark", "zai-light", "zai-dark", "system"] as const) {
    assert.equal(resolveTheme(theme), "light");
  }
});

test("normalizeThemePreference collapses legacy dark preferences to light", () => {
  assert.equal(normalizeThemePreference("dark"), "light");
  assert.equal(normalizeThemePreference("zai-dark"), "light");
  assert.equal(normalizeThemePreference("zai-light"), "light");
  assert.equal(normalizeThemePreference("light"), "light");
  assert.equal(normalizeThemePreference("system"), "system");
});
