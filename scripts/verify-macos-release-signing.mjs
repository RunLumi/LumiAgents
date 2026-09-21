#!/usr/bin/env node
/**
 * macOS 发布签名 / 公证验收门（fail-closed）。
 *
 * 用途：在 electron-builder 产出 .app / .dmg / .zip 之后，机械校验它们真的走了
 * Developer ID 签名 + hardened runtime + entitlements（并在要求时校验 notarization staple），
 * 而不是“产物存在”就当作发布成功。任何一项不满足都以非 0 退出。
 *
 * 只读校验，不改写产物。仅在 macOS 上可运行（依赖 codesign / spctl / stapler）。
 *
 * 用法：
 *   node scripts/verify-macos-release-signing.mjs --app "dist/mac-arm64/Lumi Agents.app"
 *   node scripts/verify-macos-release-signing.mjs --app <app> --artifact <dmg> --artifact <zip> --require-staple
 *
 * 参数：
 *   --app <path>                要校验的 .app（必填）
 *   --artifact <path>           附加校验的 dmg/zip（可重复）
 *   --expect-bundle-id <id>     期望的 CFBundleIdentifier 前缀，默认 app.lumi.agents
 *   --expect-team-id <id>       期望的 TeamIdentifier（默认取 APPLE_TEAM_ID）
 *   --require-staple            要求 notarization staple（公证后应带此参数）
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

const BUNDLE_ID_PREFIX_DEFAULT = "app.lumi.agents";

function parseArgs(argv) {
  const options = {
    app: null,
    artifacts: [],
    expectBundleId: BUNDLE_ID_PREFIX_DEFAULT,
    expectTeamId: process.env.APPLE_TEAM_ID?.trim() || null,
    requireStaple: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? "";
    if (arg === "--app") options.app = next();
    else if (arg === "--artifact") options.artifacts.push(next());
    else if (arg === "--expect-bundle-id") options.expectBundleId = next();
    else if (arg === "--expect-team-id") options.expectTeamId = next();
    else if (arg === "--require-staple") options.requireStaple = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(
        "usage: verify-macos-release-signing.mjs --app <app> [--artifact <dmg|zip>]... " +
          "[--expect-bundle-id app.lumi.agents] [--expect-team-id <id>] [--require-staple]",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

const failures = [];
function fail(message) {
  failures.push(message);
}

function assertOnMacos() {
  if (process.platform !== "darwin") {
    fail("macOS signing verification requires darwin (codesign/spctl/stapler)");
  }
}

function verifyApp(appPath, options) {
  if (!appPath || !existsSync(appPath) || !statSync(appPath).isDirectory()) {
    fail(`--app is missing or not a bundle directory: ${appPath ?? "<unset>"}`);
    return;
  }

  const codesignInfo = run("codesign", ["-dv", "--verbose=4", appPath]).output;
  const authority = codesignInfo.match(/^Authority=(.*)$/m)?.[1]?.trim() ?? "";
  const teamId = codesignInfo.match(/^TeamIdentifier=(.*)$/m)?.[1]?.trim() ?? "";

  if (/Signature=adhoc/.test(codesignInfo) || !authority) {
    fail(`not Developer ID signed (ad-hoc or unsigned): ${appPath}`);
  }
  if (!authority.startsWith("Developer ID Application")) {
    fail(`unexpected signing authority: "${authority || "<none>"}"`);
  }
  if (options.expectTeamId && teamId !== options.expectTeamId) {
    fail(`TeamIdentifier mismatch: expected ${options.expectTeamId}, got "${teamId || "<none>"}"`);
  }

  const verify = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  if (verify.status !== 0)
    fail(`codesign --verify --deep --strict failed: ${verify.output.trim()}`);

  // hardened runtime 必须真的开启，否则公证会被拒。
  const runtimeInfo = run("codesign", ["-d", "--verbose=4", appPath]).output;
  if (!/flags=0x[0-9a-f]*10000\(runtime\)/.test(runtimeInfo)) {
    fail(`hardened runtime flag missing on ${appPath}`);
  }

  // Electron 需要 JIT / 未签名可执行内存 entitlement；缺失时运行期会崩溃。
  const entitlements = run("codesign", ["-d", "--entitlements", ":-", appPath]).output;
  if (!entitlements.includes("com.apple.security.cs.allow-jit")) {
    fail(`required entitlement com.apple.security.cs.allow-jit missing on ${appPath}`);
  }

  const bundleId = run("plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    "-o",
    "-",
    `${appPath}/Contents/Info.plist`,
  ]).stdout.trim();
  if (options.expectBundleId && !bundleId.startsWith(options.expectBundleId)) {
    fail(`CFBundleIdentifier "${bundleId}" does not start with ${options.expectBundleId}`);
  }

  const spctl = run("spctl", ["-a", "-vv", "-t", "exec", appPath]);
  if (spctl.status !== 0) fail(`Gatekeeper exec assessment failed: ${spctl.output.trim()}`);
  else if (!/source=Developer ID/.test(spctl.output)) {
    fail(`Gatekeeper did not accept a Developer ID source: ${spctl.output.trim()}`);
  }

  if (options.requireStaple) {
    const staple = run("xcrun", ["stapler", "validate", appPath]);
    if (staple.status !== 0) fail(`notarization staple missing/invalid: ${staple.output.trim()}`);
  }
}

function verifyArtifact(artifactPath, requireStaple) {
  if (!existsSync(artifactPath)) {
    fail(`--artifact not found: ${artifactPath}`);
    return;
  }
  if (!requireStaple) return;
  // stapler 只支持 .dmg/.pkg/.app；zip 归档根本无法被 staple，要求它会让合法的
  // 签名+公证构建误判失败（notarytool 已对 zip 内容做过公证）。
  if (artifactPath.endsWith(".zip")) {
    console.log(`[macos-signing-gate] skipping staple check for zip archive: ${artifactPath}`);
    return;
  }
  const staple = run("xcrun", ["stapler", "validate", artifactPath]);
  if (staple.status !== 0) fail(`artifact staple missing/invalid: ${staple.output.trim()}`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  assertOnMacos();
  if (failures.length === 0) {
    console.log(
      `[macos-signing-gate] verifying app=${options.app} artifacts=${options.artifacts.length} requireStaple=${options.requireStaple}`,
    );
    verifyApp(options.app, options);
    for (const artifact of options.artifacts) verifyArtifact(artifact, options.requireStaple);
  }
} catch (error) {
  console.error(`[macos-signing-gate] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error("[macos-signing-gate] FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  "[macos-signing-gate] OK: Developer ID signature, hardened runtime, entitlements verified.",
);
