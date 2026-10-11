import { until } from "../harness.mjs";
import { expect } from "./report.mjs";

/** Locators are derived from real message ids so the same driver works in EN and ZH. */
export async function copy(fx, id, values) {
  return fx.t(id, values);
}

export const button = async (fx, id) =>
  fx.page.getByRole("button", { name: await copy(fx, id), exact: true });

export const see = (locator, description) =>
  until(
    () =>
      locator
        .first()
        .isVisible()
        .catch(() => false),
    `visible: ${description}`,
  );

export const gone = (locator, description) =>
  until(async () => (await locator.count()) === 0, `absent: ${description}`);

export const seeText = async (fx, id, description = id) =>
  see(fx.page.getByText(await copy(fx, id), { exact: false }).first(), description);

export const textAbsent = async (fx, id, description = id) =>
  gone(fx.page.getByText(await copy(fx, id), { exact: false }), description);

export const alertText = (fx) => fx.page.getByRole("alert");

export const field = {
  org: (fx) => fx.page.locator("#lumi-workspace-org"),
  project: (fx) => fx.page.locator("#lumi-workspace-project"),
  name: (fx) => fx.page.locator("#lumi-workspace-name"),
  radio: (fx, mode) => fx.page.locator(`#lumi-credential-${mode}`),
};

export async function bindButton(fx) {
  return button(fx, "lumiWorkspace.bind");
}

export async function describeActive(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    const label =
      el.getAttribute("aria-label") ||
      (el instanceof HTMLInputElement || el instanceof HTMLSelectElement
        ? el.labels?.[0]?.innerText
        : "") ||
      el.innerText ||
      el.id ||
      el.tagName;
    const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      label: label.trim().replace(/\s+/g, " ").slice(0, 60),
      focusIndicator: style.boxShadow !== "none" || outline,
      // Forced-colors mode ignores box-shadow, so only a real outline counts there.
      outline,
      forcedColors: matchMedia("(forced-colors: active)").matches,
    };
  });
}

/** Reads the focused element, allowing a short real-time window for a focus transition to land. */
async function settledActive(page) {
  const deadline = Date.now() + 700;
  let stop = await describeActive(page);
  while (stop && !stop.focusIndicator && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 50));
    stop = await describeActive(page);
  }
  return stop;
}

/** Presses Tab until `stopWhen` matches or `max` steps; returns each focus stop in order. */
export async function tabWalk(fx, stopWhen, max = 14) {
  const stops = [];
  for (let step = 0; step < max; step += 1) {
    await fx.page.keyboard.press("Tab");
    const stop = await settledActive(fx.page);
    expect(stop, "Tab moved focus to nothing (focus lost to <body>)");
    stops.push(stop);
    if (stopWhen(stop)) break;
  }
  return stops;
}

export const sentinel = (stop) => stop.label === "after-panel sentinel";
export const stopLabels = (stops) => stops.map((s) => s.label);
export function expectVisibleFocus(stops, where) {
  const bad = stops.filter((s) => !s.focusIndicator);
  expect(
    bad.length === 0,
    `${where}: no visible focus indicator on ${JSON.stringify(bad.map((s) => s.label))}`,
  );
}

/** Forced-colors stops must be in that mode (positive control) and carry a real outline. */
export function expectForcedColorsOutline(stops, where) {
  expect(
    stops.length > 0 && stops.every((s) => s.forcedColors),
    `${where}: page is not in forced-colors mode (control failed)`,
  );
  const bad = stops.filter((s) => !s.outline);
  expect(
    bad.length === 0,
    `${where}: no outline in forced-colors mode on ${JSON.stringify(bad.map((s) => s.label))}`,
  );
}
