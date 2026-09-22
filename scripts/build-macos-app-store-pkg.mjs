#!/usr/bin/env node

import { access, chmod, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const workspaceRoot = resolve(import.meta.dirname, "..");
const desktopRoot = join(workspaceRoot, "packages/desktop");
const distRoot = join(desktopRoot, process.env.ZCODE_DESKTOP_DIST_DIR || "dist");

function parseArgs(argv) {
  return {
    skipBuild: argv.includes("--skip-build"),
    upload: argv.includes("--upload"),
  };
}

function required(name, value) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

async function requireFile(name, filePath) {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`${name} is not readable: ${filePath}`);
  }
}

async function runWithReadableProvisioningProfile(profilePath, operation) {
  const originalMode = (await stat(profilePath)).mode & 0o777;
  await chmod(profilePath, originalMode | 0o444);
  try {
    await operation();
  } finally {
    await chmod(profilePath, originalMode);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || workspaceRoot,
      env: options.env || process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(`${command} exited with ${code ?? "null"}${signal ? ` (${signal})` : ""}`),
        );
    });
  });
}

function resolvePath(value) {
  return isAbsolute(value) ? value : resolve(workspaceRoot, value);
}

function resolveKeychainIdentity(identityName) {
  const requestedIdentity = identityName.trim();
  const keychain = process.env.CSC_KEYCHAIN?.trim();
  const args = ["find-identity", "-v"];
  if (keychain) args.push(keychain);
  const result = spawnSync("security", args, {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (process.env.MAS_APP_CERTIFICATE || process.env.MAS_INSTALLER_CERTIFICATE) {
      return requestedIdentity;
    }
    throw new Error(
      `cannot inspect ${keychain || "the login keychain"} for MAS identity ${requestedIdentity}`,
    );
  }
  const matches = result.stdout
    .split("\n")
    .map((line) => line.match(/^\s*\d+\)\s+([A-F0-9]{40})\s+"([^"]+)"/))
    .filter((match) => match?.[2] === requestedIdentity || match?.[1] === requestedIdentity)
    .filter(Boolean);
  const match = matches.at(-1);
  if (!match) {
    if (process.env.MAS_APP_CERTIFICATE || process.env.MAS_INSTALLER_CERTIFICATE) {
      return requestedIdentity;
    }
    throw new Error(
      `MAS identity is not present in ${keychain || "the login keychain"}: ${requestedIdentity}`,
    );
  }
  return match[1];
}

async function resolvePkg() {
  const roots = [distRoot, join(distRoot, "mas-arm64")];
  const packages = [];
  for (const root of roots) {
    let files;
    try {
      files = await readdir(root);
    } catch {
      continue;
    }
    packages.push(...files.filter((file) => file.endsWith(".pkg")).map((file) => join(root, file)));
  }
  if (packages.length !== 1) {
    throw new Error(`expected exactly one MAS .pkg in ${distRoot}, found ${packages.length}`);
  }
  return packages[0];
}

async function main() {
  if (process.platform !== "darwin") throw new Error("MAS packaging requires macOS");
  const options = parseArgs(process.argv.slice(2));
  if (process.env.ZCODE_ENV?.trim() !== "production") {
    throw new Error("MAS packaging requires ZCODE_ENV=production");
  }

  const apiKey = resolvePath(required("APPLE_API_KEY", process.env.APPLE_API_KEY));
  const apiKeyId = required("APPLE_API_KEY_ID", process.env.APPLE_API_KEY_ID);
  const issuer = required("APPLE_API_ISSUER", process.env.APPLE_API_ISSUER);
  const appIdentity = required(
    "MAS_APP_SIGNING_IDENTITY or CSC_NAME",
    process.env.MAS_APP_SIGNING_IDENTITY || process.env.CSC_NAME,
  );
  const installerIdentity = required(
    "MAS_INSTALLER_IDENTITY or CSC_INSTALLER_NAME",
    process.env.MAS_INSTALLER_IDENTITY || process.env.CSC_INSTALLER_NAME,
  );
  const appIdentitySpecifier = resolveKeychainIdentity(appIdentity);
  const installerIdentitySpecifier = resolveKeychainIdentity(installerIdentity);
  const provisioningProfile = resolvePath(
    required(
      "MAS_PROVISIONING_PROFILE or PROVISIONING_PROFILE",
      process.env.MAS_PROVISIONING_PROFILE || process.env.PROVISIONING_PROFILE,
    ),
  );
  await requireFile("APPLE_API_KEY", apiKey);
  await requireFile("MAS_PROVISIONING_PROFILE", provisioningProfile);
  if (!/(Apple Distribution|3rd Party Mac Developer Application)/i.test(appIdentity)) {
    throw new Error(
      "MAS app identity must be an Apple Distribution or 3rd Party Mac Developer Application certificate",
    );
  }
  if (!/3rd Party Mac Developer Installer/i.test(installerIdentity)) {
    throw new Error(
      "MAS installer identity must be a 3rd Party Mac Developer Installer certificate",
    );
  }

  const env = {
    ...process.env,
    ZCODE_ENV: "production",
    ZCODE_MAC_TARGET: "mas",
    ZCODE_ENABLE_MAC_SIGN: "1",
    MAS_APP_SIGNING_IDENTITY: appIdentitySpecifier,
    MAS_INSTALLER_IDENTITY: installerIdentitySpecifier,
    MAS_PROVISIONING_PROFILE: provisioningProfile,
    ...(process.env.MAS_INSTALLER_CERTIFICATE
      ? {
          CSC_INSTALLER_LINK: process.env.MAS_INSTALLER_CERTIFICATE,
          CSC_INSTALLER_KEY_PASSWORD: process.env.MAS_INSTALLER_CERTIFICATE_PASSWORD || "",
        }
      : {}),
    ...(process.env.MAS_APP_CERTIFICATE
      ? {
          CSC_LINK: process.env.MAS_APP_CERTIFICATE,
          CSC_KEY_PASSWORD: process.env.MAS_APP_CERTIFICATE_PASSWORD || "",
        }
      : {}),
    PROVISIONING_PROFILE: provisioningProfile,
    APPLE_API_KEY: apiKey,
    APPLE_API_KEY_ID: apiKeyId,
    APPLE_API_ISSUER: issuer,
  };

  // electron-builder uses the same `identity` qualifier for the MAS app and
  // installer lookup. Passing the app certificate hash through CSC_NAME makes
  // the later installer lookup search for that same hash and fail, even when
  // both valid certificates are present in the login keychain. Keep the
  // operator-selected identities as validated metadata, but let the two
  // certificate-type searches auto-discover independently.
  delete env.CSC_NAME;
  delete env.CSC_INSTALLER_NAME;
  env.CSC_IDENTITY_AUTO_DISCOVERY = "true";

  if (!options.skipBuild) {
    await run("pnpm", ["--filter", "@zcode/desktop", "prepare:runtime-assets"], { env });
    await run("pnpm", ["--filter", "@zcode/desktop", "build:no-runtime-assets"], { env });
  }

  await runWithReadableProvisioningProfile(provisioningProfile, () =>
    run(
      "pnpm",
      [
        "--filter",
        "@zcode/desktop",
        "exec",
        "electron-builder",
        "--config",
        "electron-builder.config.js",
        "--mac",
        "mas",
        "--arm64",
      ],
      { env },
    ),
  );

  const pkg = await resolvePkg();
  await run("pkgutil", ["--check-signature", pkg]);
  console.log(`[mas-release] verified package: ${pkg}`);

  if (options.upload) {
    await run(
      "xcrun",
      [
        "iTMSTransporter",
        "-m",
        "upload",
        "-apiIssuer",
        issuer,
        "-apiKey",
        apiKeyId,
        "-assetFile",
        pkg,
      ],
      { env },
    );
    console.log("[mas-release] upload accepted by Transporter; Apple processing is still pending");
  }
}

main().catch((error) => {
  console.error(`[mas-release] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
