// Bundles the main process (with the bridge from ../src, zod and the Agent SDK) and the preload.
import { readFileSync } from "node:fs";

import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const bridgePackage = JSON.parse(readFileSync(new URL("../package.json", root), "utf8"));

const common = {
  bundle: true,
  platform: "node",
  target: "node24",
  external: ["electron"],
  sourcemap: "linked",
  logLevel: "info",
  absWorkingDir: root.pathname,
};

const builds = [
  {
    ...common,
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main/main.mjs",
    format: "esm",
    define: { __BRIDGE_VERSION__: JSON.stringify(bridgePackage.version) },
    // Bundled CommonJS dependencies still call require().
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  },
  // Sandboxed preloads must be CommonJS.
  { ...common, entryPoints: ["src/preload/preload.ts"], outfile: "dist/preload/preload.cjs", format: "cjs" },
];

await Promise.all(builds.map((options) => build(options)));
