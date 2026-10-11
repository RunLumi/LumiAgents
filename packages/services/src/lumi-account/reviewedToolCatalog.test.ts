/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import { LumiReviewedToolCatalogTransport } from "./reviewedToolCatalog.js";
import type { ZCodeManagedToolIdentity } from "@zcode/shared";
const id = (prefix: string) => `${prefix}_${"a".repeat(32)}`;
const local: ZCodeManagedToolIdentity = {
  toolId: `tool_${"c".repeat(32)}`,
  name: "RuntimeWrite",
  fingerprint: "b".repeat(64),
  source: "built_in",
  riskClass: "filesystem_write",
  capabilityIds: [id("cap")],
  catalogued: false,
};
const record = {
  tool_id: id("tool"),
  org_id: id("org"),
  source: local.source,
  risk_class: local.riskClass,
  capability_ids: local.capabilityIds,
  fingerprint: local.fingerprint,
  lifecycle: "active",
  version: 1,
  metadata: { private: "DO_NOT_PROJECT" },
};
test("reviewed identity uses server ID with exact runtime needs and no catalog metadata", async () => {
  const catalog = new LumiReviewedToolCatalogTransport(async (path) => {
    assert.equal(path, `/api/v1/orgs/${id("org")}/tools?limit=100`);
    return { items: [record], has_more: false };
  });
  const resolved = await catalog.resolve(id("org"), local);
  assert.equal(resolved?.toolId, id("tool"));
  assert.equal(resolved?.name, local.name);
  assert.equal(resolved?.catalogued, true);
  assert.equal(JSON.stringify(resolved).includes("DO_NOT_PROJECT"), false);
});
test("mismatch never drops capabilities or lowers risk/source", async () => {
  for (const change of [
    { risk_class: "read_only" },
    { capability_ids: [] },
    { source: "plugin" },
    { capability_ids: [`cap_${"d".repeat(32)}`] },
  ]) {
    const catalog = new LumiReviewedToolCatalogTransport(async () => ({
      items: [{ ...record, ...change }],
      has_more: false,
    }));
    await assert.rejects(catalog.resolve(id("org"), local), /lumi_tool_catalog_mismatch/);
  }
});
test("unknown, review and disabled tools are not accepted", async () => {
  for (const change of [
    { fingerprint: "d".repeat(64) },
    { lifecycle: "review" },
    { lifecycle: "disabled" },
  ]) {
    assert.equal(
      await new LumiReviewedToolCatalogTransport(async () => ({
        items: [{ ...record, ...change }],
        has_more: false,
      })).resolve(id("org"), local),
      undefined,
    );
  }
});
test("foreign/malformed/duplicate catalog rows fail closed", async () => {
  for (const items of [
    [{ ...record, org_id: `org_${"d".repeat(32)}` }],
    [{ ...record, version: 0 }],
    [{ ...record, id: `tool_${"d".repeat(32)}` }],
    [record, record],
  ]) {
    await assert.rejects(
      new LumiReviewedToolCatalogTransport(async () => ({ items, has_more: false })).resolve(
        id("org"),
        local,
      ),
    );
  }
});
test("all pages are reviewed and cycles/incomplete catalogs cannot release a match", async () => {
  let calls = 0;
  const catalog = new LumiReviewedToolCatalogTransport(async (path) => {
    calls++;
    if (calls === 1) return { items: [record], has_more: true, next_cursor: "next&scope=foreign" };
    assert(path.endsWith("cursor=next%26scope%3Dforeign"));
    return { items: [], has_more: false };
  });
  assert.equal((await catalog.resolve(id("org"), local))?.toolId, id("tool"));
  assert.equal(calls, 2);
  for (const cursor of [null, "", "cycle"]) {
    await assert.rejects(
      new LumiReviewedToolCatalogTransport(async () => ({
        items: [record],
        has_more: true,
        next_cursor: cursor,
      })).resolve(id("org"), local),
    );
  }
});
