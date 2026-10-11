import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { MUTATIONS } from "./patches.mjs";

type SourcePatch = (typeof MUTATIONS)[string]["patches"][number];

const HERE = fileURLToPath(new URL(".", import.meta.url));

function selectedPatches(): SourcePatch[] {
  const mutation = process.env.LUMI_UI_PROOF_MUTATION;
  if (mutation) {
    const entry = MUTATIONS[mutation];
    if (!entry)
      throw new Error(
        `unknown mutation '${mutation}'; known: ${Object.keys(MUTATIONS).join(", ")}`,
      );
    return entry.patches;
  }
  return [];
}

/** Applies the selected mutation patches to product source in memory only. */
function sourcePatchPlugin(patches: SourcePatch[]): Plugin {
  return {
    name: "lumi-ui-proof-source-patches",
    enforce: "pre",
    transform(code, id) {
      const path = id.split("?")[0]!;
      let next = code;
      for (const patch of patches.filter((p) => path.endsWith(p.file))) {
        const present =
          typeof patch.find === "string" ? next.includes(patch.find) : patch.find.test(next);
        if (!present)
          throw new Error(`patch '${patch.name}': target text not found in ${patch.file}`);
        next = next.replace(patch.find, patch.replace);
      }
      return next === code ? null : { code: next, map: null };
    },
  };
}

const patches = selectedPatches();

/**
 * Dev-server config for the Lumi UI proof fixture. It mirrors only what `packages/web` needs to
 * compile `packages/ui` source (React, Tailwind, the `@` alias); the runner starts it on an
 * ephemeral port and never proxies to a backend.
 */
export default defineConfig({
  root: HERE,
  // Keep the optimizer cache out of the repo; patched runs must not share a cache with clean runs.
  cacheDir: resolve(tmpdir(), `lumi-ui-proof-vite-${patches.length ? "patched" : "clean"}`),
  plugins: [...(patches.length ? [sourcePatchPlugin(patches)] : []), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(HERE, "../../packages/ui/src"),
      "d3-path": resolve(HERE, "../../node_modules/d3-path/src/index.js"),
    },
  },
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  optimizeDeps: {
    // Scan the dynamically imported startup fixture too, so Root's dependency tree is pre-bundled up
    // front instead of being discovered mid-run (which reloads the page under a running proof).
    entries: ["index.html", "src/startupFixture.tsx"],
    include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  define: {
    __ZCODE_ENDPOINT_ENV__: JSON.stringify({}),
    __ZCODE_VERSION__: JSON.stringify("lumi-ui-proof"),
    __ZCODE_COMMIT__: JSON.stringify("lumi-ui-proof"),
    __ZCODE_ENV__: JSON.stringify("test"),
  },
});
