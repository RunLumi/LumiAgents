import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveHostProcessHomeEnv } from "./hostProcessHomeEnv.js";

test("unset root keeps production behavior: no HOME override", () => {
  assert.deepEqual(resolveHostProcessHomeEnv(undefined), {});
});

test("explicit absolute root is forwarded as HOME and USERPROFILE, realpath-resolved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "host-home-env-"));
  try {
    const real = join(dir, "real");
    await mkdir(real);
    const alias = join(dir, "alias");
    await symlink(real, alias);
    const canonical = await realpath(real);
    assert.deepEqual(resolveHostProcessHomeEnv(alias), { HOME: canonical, USERPROFILE: canonical });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("not-yet-created root is kept normalized, not replaced by personal HOME", async () => {
  const dir = await mkdtemp(join(tmpdir(), "host-home-env-"));
  try {
    const future = join(dir, "later", "..", "home");
    const result = resolveHostProcessHomeEnv(future);
    assert.equal(result.HOME, join(dir, "home"));
    assert.equal(result.USERPROFILE, result.HOME);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("relative or empty root is refused, never a silent fallback", () => {
  for (const bad of ["relative/home", "", "."]) {
    assert.throws(() => resolveHostProcessHomeEnv(bad), /absolute path/, bad);
  }
});
