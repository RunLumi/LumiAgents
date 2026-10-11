/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import { stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { createNodeReplBrowserBroker } from "../src/app/node-repl-browser-broker.js";

test("browser broker starts with a long TMPDIR while preserving socket auth and cleanup", async () => {
  if (process.platform === "win32") return;
  const before = process.env.TMPDIR;
  process.env.TMPDIR = "/tmp/" + "owned-long-temp-root-".repeat(12);
  let calls = 0;
  const broker = createNodeReplBrowserBroker({
    browserControlPort: {
      list: async () => {
        calls++;
        return [];
      },
    } as never,
    logger: { debug() {}, warn() {}, error() {} } as never,
  });
  async function request(token: string, runtimeScope: "main" | "subagent" = "main") {
    return new Promise<{ ok: boolean; browsers?: unknown[] }>((resolve, reject) => {
      const socket = createConnection(broker.socketPath);
      let data = "";
      socket.setTimeout(3000, () => socket.destroy(new Error("socket test timeout")));
      socket.on("error", reject);
      socket.on("data", (chunk) => {
        data += chunk;
      });
      socket.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
      socket.on("connect", () =>
        socket.end(
          JSON.stringify({
            id: randomUUID(),
            token,
            runtimeScope,
            op: "list",
            sessionId: "socket_fixture",
          }) + "\n",
        ),
      );
    });
  }
  try {
    await broker.ready;
    assert.ok(Buffer.byteLength(broker.socketPath, "utf8") < 100);
    assert.equal((await request("0".repeat(64))).ok, false);
    assert.equal(calls, 0);
    const allowed = await request(broker.token);
    assert.equal(allowed.ok, true);
    assert.deepEqual(allowed.browsers, []);
    assert.equal(calls, 1);
    // 上游 v3.15.1：subagent 不再在 socket 层拒绝，交给 BrowserControlPort 按 forChildSession
    // 登记做权威校验；有效 token 的 subagent 请求因此到达端口。
    await request(broker.token, "subagent");
    assert.equal(calls, 2);
  } finally {
    await broker.close();
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
  }
  await assert.rejects(
    stat(broker.socketPath),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );
});
