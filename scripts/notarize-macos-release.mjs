#!/usr/bin/env node
/**
 * macOS 公证 + staple 阶段（两段式流水线的第二段）。
 *
 * electron-builder 的 `mac.notarize` 被显式关闭（见 electron-builder.config.js），
 * 因为 build 阶段内联公证会强制要求 APPLE_APP_SPECIFIC_PASSWORD 并在产物生成前失败。
 * 这里改为独立阶段：先产出已 Developer ID 签名的产物，再对它们做 notarytool 提交与 staple。
 *
 * 凭据只从环境读取，脚本不生成、不推断、不写入任何凭据。三者取其一：
 *   1. NOTARYTOOL_KEYCHAIN_PROFILE                      — 预先 `notarytool store-credentials` 的 profile
 *   2. APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER — App Store Connect API Key（.p8 路径）
 *   3. APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID — Apple ID 凭据
 *
 * 缺凭据时 fail-closed（非 0 退出），不会静默产出“未公证却通过”的发布包。
 *
 * 用法：
 *   node scripts/notarize-macos-release.mjs --artifact <dmg> --artifact <zip> --app <app>
 *
 * 说明：notarytool 支持提交 .dmg/.zip/.pkg；stapler 只支持 .app/.dmg/.pkg。
 * zip 仅做提交与 Accepted 校验，不做 staple（Apple 不支持对 zip staple）。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function parseArgs(argv) {
  const options = { artifacts: [], app: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifact") options.artifacts.push(argv[++index] ?? "");
    else if (arg === "--app") options.app = argv[++index] ?? null;
    else if (arg === "-h" || arg === "--help") {
      console.log(
        "usage: notarize-macos-release.mjs --artifact <dmg|zip> [--artifact ...] [--app <app>]",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function resolveNotaryCredentials() {
  const profile = process.env.NOTARYTOOL_KEYCHAIN_PROFILE?.trim();
  if (profile) return { mode: "keychain-profile", args: ["--keychain-profile", profile] };

  const apiKey = process.env.APPLE_API_KEY?.trim();
  const apiKeyId = process.env.APPLE_API_KEY_ID?.trim();
  const apiIssuer = process.env.APPLE_API_ISSUER?.trim();
  if (apiKey || apiKeyId || apiIssuer) {
    if (!apiKey || !apiKeyId || !apiIssuer) {
      throw new Error(
        "incomplete App Store Connect API credentials: APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER are all required",
      );
    }
    return {
      mode: "api-key",
      args: ["--key", apiKey, "--key-id", apiKeyId, "--issuer", apiIssuer],
    };
  }

  const appleId = process.env.APPLE_ID?.trim();
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim();
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  if (appleId || password || teamId) {
    if (!appleId || !password || !teamId) {
      throw new Error(
        "incomplete Apple ID credentials: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID are all required",
      );
    }
    return {
      mode: "apple-id",
      args: ["--apple-id", appleId, "--password", password, "--team-id", teamId],
    };
  }

  throw new Error(
    "no notarization credentials found; set NOTARYTOOL_KEYCHAIN_PROFILE, or APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER, or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID",
  );
}

function run(command, args) {
  return spawnSync(command, args, { stdio: "inherit" });
}

try {
  if (process.platform !== "darwin") {
    throw new Error("notarization requires darwin (xcrun notarytool)");
  }
  const options = parseArgs(process.argv.slice(2));
  if (options.artifacts.length === 0) throw new Error("at least one --artifact is required");

  const credentials = resolveNotaryCredentials();
  console.log(`[notarize] using credential mode: ${credentials.mode}`);

  for (const artifact of options.artifacts) {
    if (!existsSync(artifact)) throw new Error(`artifact not found: ${artifact}`);
    console.log(`[notarize] submitting ${artifact}`);
    const submit = run("xcrun", ["notarytool", "submit", artifact, ...credentials.args, "--wait"]);
    if (submit.status !== 0) throw new Error(`notarytool submit failed for ${artifact}`);

    // stapler 不支持 zip；.dmg 与 .app 可 staple。
    if (artifact.endsWith(".zip")) continue;
    const staple = run("xcrun", ["stapler", "staple", artifact]);
    if (staple.status !== 0) throw new Error(`stapler staple failed for ${artifact}`);
    const validate = run("xcrun", ["stapler", "validate", artifact]);
    if (validate.status !== 0) throw new Error(`stapler validate failed for ${artifact}`);
  }

  // 已提交的 zip/dmg 覆盖其中的 .app；本地 .app 单独 staple，供安装/验收使用。
  // 注意：staple 会改写 .app 内容，因此需要“已 staple 的 .app 打包分发”的场景应在
  // 本步骤之后重新生成 zip（见 docs/upstream/MACOS-SIGNING-AND-NOTARIZATION.md）。
  if (options.app) {
    if (!existsSync(options.app)) throw new Error(`app not found: ${options.app}`);
    const staple = run("xcrun", ["stapler", "staple", options.app]);
    if (staple.status !== 0) throw new Error(`stapler staple failed for ${options.app}`);
    const validate = run("xcrun", ["stapler", "validate", options.app]);
    if (validate.status !== 0) throw new Error(`stapler validate failed for ${options.app}`);
  }

  console.log("[notarize] done");
} catch (error) {
  console.error(`[notarize] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
