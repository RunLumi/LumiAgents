// Regression tests for production dependency graph semantics.
// Optional cross-platform native packages may be absent from the current install,
// but a missing mandatory production dependency must still fail closed.
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoticeInventoryProductionSet,
  assertProductionGraphs,
  missingProductionPackages,
  parseLockfilePlatformConstraints,
  parseSupportedArchitectures,
  platformUnsupportedPackageKeys,
} from "./third-party-npm.mjs";
import { isWorkspacePackageManifestInput } from "./third-party-notices.mjs";

function project({ dependencies = {}, optionalDependencies = {} } = {}) {
  return {
    name: "@zcode/test-app",
    path: "/tmp/test-app",
    dependencies,
    optionalDependencies,
  };
}

const leaf = (name, version, extra = {}) => ({ name, version, ...extra });

test("notice inventory accepts absent platform packages but rejects missing installed packages", () => {
  const required = new Map([
    ["app@1.0.0", { name: "app", version: "1.0.0", optional: false }],
    ["musl@1.0.0", { name: "musl", version: "1.0.0", platformUnsupported: true }],
  ]);
  const installed = new Map([["app@1.0.0", {}]]);
  const manifest = { packages: [leaf("app", "1.0.0"), leaf("musl", "1.0.0")] };
  assert.doesNotThrow(() => assertNoticeInventoryProductionSet(manifest, required, installed));
  assert.throws(
    () =>
      assertNoticeInventoryProductionSet(
        { packages: [leaf("musl", "1.0.0")] },
        required,
        installed,
      ),
    /Missing from inventory: app@1.0.0/,
  );
  assert.throws(
    () =>
      assertNoticeInventoryProductionSet(
        { packages: [...manifest.packages, leaf("unknown", "1.0.0")] },
        required,
        installed,
      ),
    /Stale in inventory: unknown@1.0.0/,
  );
});

test("missing optional platform package does not fail the production graph", () => {
  const locked = [
    project({
      dependencies: {
        pdfjs: leaf("pdfjs", "1.0.0", {
          optionalDependencies: {
            canvas: leaf("@napi-rs/canvas", "0.1.100", {
              optionalDependencies: {
                musl: leaf("@napi-rs/canvas-linux-arm64-musl", "0.1.100"),
              },
            }),
          },
        }),
      },
    }),
  ];
  const installed = [
    project({
      dependencies: {
        pdfjs: leaf("pdfjs", "1.0.0"),
      },
    }),
  ];

  const graph = assertProductionGraphs(locked, installed);
  assert.equal(graph.get("pdfjs@1.0.0")?.optional, false);
  assert.equal(graph.get("@napi-rs/canvas@0.1.100")?.optional, true);
  assert.equal(graph.get("@napi-rs/canvas-linux-arm64-musl@0.1.100")?.optional, true);

  const missing = missingProductionPackages(
    graph,
    new Map([["pdfjs@1.0.0", { pkg: { name: "pdfjs", version: "1.0.0" } }]]),
  );
  assert.deepEqual(
    missing.map((item) => item.name).sort(),
    ["@napi-rs/canvas", "@napi-rs/canvas-linux-arm64-musl"].sort(),
  );
});

test("dependencies below an optional parent remain optional", () => {
  const locked = [
    project({
      optionalDependencies: {
        native: leaf("native-wrapper", "2.0.0", {
          dependencies: {
            runtime: leaf("native-runtime", "2.0.0"),
          },
        }),
      },
    }),
  ];

  const graph = assertProductionGraphs(locked, [project()]);
  assert.equal(graph.get("native-wrapper@2.0.0")?.optional, true);
  assert.equal(graph.get("native-runtime@2.0.0")?.optional, true);
});

test("a mandatory path wins when the same package is also optional elsewhere", () => {
  const locked = [
    project({
      dependencies: {
        required: leaf("shared-native", "3.0.0"),
      },
      optionalDependencies: {
        optional: leaf("shared-native", "3.0.0"),
      },
    }),
  ];

  assert.throws(
    () => assertProductionGraphs(locked, [project()]),
    /Missing: shared-native@3\.0\.0/,
  );
});

test("missing mandatory package still fails the installed-material gate", () => {
  const required = new Map([
    ["required@1.0.0", { name: "required", version: "1.0.0", optional: false }],
    ["optional@1.0.0", { name: "optional", version: "1.0.0", optional: true }],
  ]);

  assert.throws(
    () => missingProductionPackages(required, new Map()),
    /Missing installed production dependencies: required@1\.0\.0/,
  );
});

test("workspace package manifests are recognized without masking legal evidence files", () => {
  for (const path of [
    "package.json",
    "packages/desktop/package.json",
    "apps/zcode-cli/package.json",
    "apps/zcode-cli/packages/cli/package.json",
    "apps/zcode-cli/tools/typescript/package.json",
  ]) {
    assert.equal(isWorkspacePackageManifestInput(path), true, path);
  }
  for (const path of [
    "third-party/npm-overrides.json",
    "third-party/copied-components.json",
    ".agents/skills/example/package.json",
    "scripts/license-texts/MIT.txt",
  ]) {
    assert.equal(isWorkspacePackageManifestInput(path), false, path);
  }
});

test("platform constraints exclude only targets outside the declared build matrix", () => {
  const workspace = `supportedArchitectures:
  os:
    - linux
    - darwin
    - win32
  cpu:
    - x64
    - arm64
  libc:
    - glibc
`;
  const lockfile = `lockfileVersion: '9.0'

packages:
  '@napi-rs/canvas-linux-arm64-gnu@0.1.100':
    cpu: [arm64]
    os: [linux]
    libc: [glibc]

  '@napi-rs/canvas-linux-arm64-musl@0.1.100':
    cpu: [arm64]
    os: [linux]
    libc: [musl]

  '@napi-rs/canvas-android-arm64@0.1.100':
    cpu: [arm64]
    os: [android]

snapshots:
`;
  const supported = parseSupportedArchitectures(workspace, {});
  const constraints = parseLockfilePlatformConstraints(lockfile);
  const required = new Map([
    [
      "@napi-rs/canvas-linux-arm64-gnu@0.1.100",
      { name: "@napi-rs/canvas-linux-arm64-gnu", version: "0.1.100" },
    ],
    [
      "@napi-rs/canvas-linux-arm64-musl@0.1.100",
      { name: "@napi-rs/canvas-linux-arm64-musl", version: "0.1.100" },
    ],
    [
      "@napi-rs/canvas-android-arm64@0.1.100",
      { name: "@napi-rs/canvas-android-arm64", version: "0.1.100" },
    ],
  ]);
  const unsupported = platformUnsupportedPackageKeys(required, constraints, supported);
  assert.equal(unsupported.has("@napi-rs/canvas-linux-arm64-gnu@0.1.100"), false);
  assert.equal(unsupported.has("@napi-rs/canvas-linux-arm64-musl@0.1.100"), true);
  assert.equal(unsupported.has("@napi-rs/canvas-android-arm64@0.1.100"), true);
});

test("current architecture expands into the supported matrix without weakening explicit targets", () => {
  const supported = parseSupportedArchitectures(
    `supportedArchitectures:
  os:
    - current
    - linux
  cpu:
    - current
    - arm64
  libc:
    - current
    - glibc
`,
    { os: "linux", cpu: "x64", libc: "glibc" },
  );
  assert.deepEqual([...supported.os].sort(), ["linux"]);
  assert.deepEqual([...supported.cpu].sort(), ["arm64", "x64"]);
  assert.deepEqual([...supported.libc].sort(), ["glibc"]);
});
