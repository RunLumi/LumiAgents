import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { LumiAccountHostTransport } from "./hostTransport.js";

test("refuses credentials, insecure remote origins and non-origin URLs", () => {
  for (const origin of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/api",
    "https://example.com?token=secret",
    "https://example.com/#fragment",
  ]) {
    assert.throws(() => new LumiAccountHostTransport(origin));
  }
});

test("real S256 pair and host-private cookies follow the frozen auth contract", async () => {
  const session = "a".repeat(64);
  const csrf = "b".repeat(64);
  let challenge = "";
  let step = 0;
  const transport = new LumiAccountHostTransport("https://lumi.example", async (url, init) => {
    assert.equal(init?.redirect, "error");
    step++;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (step === 1) {
      assert.equal(new URL(String(url)).pathname, "/api/v1/auth/device-code");
      assert.equal(body.code_challenge_method, "S256");
      challenge = body.code_challenge;
      return Response.json({
        device_code: "private-code",
        user_code: "1234ABCD",
        verification_uri: "/desktop",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    if (step === 2) {
      assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), challenge);
      assert.equal(body.device_code, "private-code");
      const response = Response.json({ session: {} });
      response.headers.append("Set-Cookie", `lumi_session=${session}; HttpOnly; Secure`);
      response.headers.append("Set-Cookie", `lumi_csrf=${csrf}; Secure`);
      return response;
    }
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("cookie"), `lumi_session=${session}; lumi_csrf=${csrf}`);
    if (step === 3) {
      assert.equal(headers.get("X-CSRF-Token"), null);
      return Response.json({
        user: {
          id: "test-user",
          email: "test@example.com",
          display_name: "Test",
          private_metadata: "must-not-cross",
        },
        organizations: [],
      });
    }
    assert.equal(headers.get("X-CSRF-Token"), csrf);
    return new Response(null, { status: 204 });
  });
  const projection = await transport.beginSignIn("Test Desktop");
  assert.equal(projection.verificationUrl, "https://lumi.example/desktop?user_code=1234ABCD");
  assert.equal(JSON.stringify(projection).includes("private-code"), false);
  await transport.completeSignIn();
  assert.deepEqual(await transport.readAccount(), {
    user: { id: "test-user", email: "test@example.com", displayName: "Test" },
    organizations: [],
  });
  assert.equal(JSON.stringify(transport), "{}");
  await transport.signOut();
  assert.equal(step, 4);
});

test("cancelled asynchronous sign-in cannot publish a pending flow", async () => {
  let resolve!: (r: Response) => void;
  const transport = new LumiAccountHostTransport(
    "https://lumi.example",
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const start = transport.beginSignIn("Desktop");
  transport.cancelSignIn();
  resolve(
    Response.json({
      device_code: "secret",
      user_code: "1234ABCD",
      verification_uri: "/desktop",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
  );
  await assert.rejects(start, { code: "lumi_flow_cancelled" });
  await assert.rejects(transport.completeSignIn(), { code: "lumi_flow_expired" });
});

test("exchange missing CSRF cannot establish a session", async () => {
  let calls = 0;
  const transport = new LumiAccountHostTransport("https://lumi.example", async () => {
    if (++calls === 1)
      return Response.json({
        device_code: "secret",
        user_code: "1234ABCD",
        verification_uri: "/desktop",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    return Response.json(
      {},
      { headers: { "Set-Cookie": `lumi_session=${"a".repeat(64)}; HttpOnly` } },
    );
  });
  await transport.beginSignIn("Desktop");
  await assert.rejects(transport.completeSignIn(), { code: "lumi_cookie_missing" });
});

test("session restores only from same-origin private persistence and logout clears it", async () => {
  const row = {
    version: 1 as const,
    origin: "https://lumi.example",
    session: "a".repeat(64),
    csrf: "b".repeat(64),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  let stored: typeof row | null = row;
  const persistence = {
    load: async () => stored,
    save: async (value: typeof row) => {
      stored = value;
    },
    clear: async () => {
      stored = null;
    },
  };
  const transport = new LumiAccountHostTransport(
    row.origin,
    async (_url, init) => {
      assert.equal(
        new Headers(init?.headers).get("Cookie"),
        `lumi_session=${row.session}; lumi_csrf=${row.csrf}`,
      );
      return new Response(null, { status: 204 });
    },
    persistence,
  );
  assert.equal(await transport.restoreSession(), true);
  assert.equal(JSON.stringify(transport).includes(row.session), false);
  await transport.signOut();
  assert.equal(stored, null);
  stored = { ...row, origin: "https://other.example" };
  assert.equal(await transport.restoreSession(), false);
});

test("cancel during persistent write clears the stale session before publishing", async () => {
  let stored: unknown = null;
  let release!: () => void;
  let saving!: () => void;
  const entered = new Promise<void>((r) => {
    saving = r;
  });
  const persistence = {
    load: async () => null,
    save: async (record: unknown) => {
      stored = record;
      saving();
      await new Promise<void>((r) => {
        release = r;
      });
    },
    clear: async () => {
      stored = null;
    },
  };
  let calls = 0;
  const transport = new LumiAccountHostTransport(
    "https://lumi.example",
    async () => {
      if (++calls === 1)
        return Response.json({
          device_code: "private",
          user_code: "1234ABCD",
          verification_uri: "/desktop",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
      const response = Response.json({
        session: { expires_at: new Date(Date.now() + 60_000).toISOString() },
      });
      response.headers.append("Set-Cookie", `lumi_session=${"a".repeat(64)}`);
      response.headers.append("Set-Cookie", `lumi_csrf=${"b".repeat(64)}`);
      return response;
    },
    persistence,
  );
  await transport.beginSignIn("Desktop");
  const completed = transport.completeSignIn();
  await entered;
  transport.cancelSignIn();
  release();
  await assert.rejects(completed, { code: "lumi_flow_cancelled" });
  assert.equal(stored, null);
});
